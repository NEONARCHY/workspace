# ruff: noqa: RUF001
"""Read-only Workspace projection of the Exat outgoing address book."""

import hashlib
import json
import re
from datetime import UTC, datetime
from typing import Annotated, Literal

from fastapi import HTTPException
from pydantic import Field
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncConnection

from .tables import ai_referent_configuration, ai_referent_recipient_catalog
from .workspace_schemas import ApiModel


class RecipientEntry(ApiModel):
    id: str = Field(min_length=1, max_length=128)
    name: str = Field(min_length=1, max_length=500)
    category_key: Literal["ministries", "agencies", "committees", "other", "international"]
    addresses: list[Annotated[str, Field(min_length=1, max_length=500)]] = Field(
        default_factory=list, max_length=20
    )
    route: Literal["exat", "webmail"]
    address_book_organization: str = Field(default="", max_length=500)


class RecipientSnapshot(ApiModel):
    agent_id: str = Field(pattern=r"^[A-Za-z0-9_.-]{1,128}$")
    entries: list[RecipientEntry] = Field(min_length=1, max_length=2000)


class RecipientRegistry(ApiModel):
    entries: list[RecipientEntry]
    total_count: int
    updated_at: datetime | None


_CYRILLIC = str.maketrans({
    "а": "a", "б": "b", "в": "v", "г": "g", "д": "d", "е": "e", "ё": "yo",
    "ж": "j", "з": "z", "и": "i", "й": "y", "к": "k", "л": "l", "м": "m",
    "н": "n", "о": "o", "п": "p", "р": "r", "с": "s", "т": "t", "у": "u",
    "ф": "f", "х": "x", "ц": "ts", "ч": "ch", "ш": "sh", "щ": "sh", "ъ": "",
    "ь": "", "э": "e", "ю": "yu", "я": "ya", "қ": "q", "ғ": "g", "ҳ": "h",
    "ў": "o", "ү": "u", "ң": "ng",
})


def _tokens(value: str) -> list[str]:
    text = value.casefold().translate(_CYRILLIC)
    for mark in ("'", "`", "ʻ", "ʼ", "‘", "’"):
        text = text.replace(mark, "")
    text = re.sub(r"[^a-z0-9@._%+]+", " ", text.replace("q", "k"))
    return [token for token in text.split() if len(token) > 1]


def search_recipients(
    entries: list[RecipientEntry], query: str, category: str, offset: int, limit: int
) -> tuple[list[RecipientEntry], int]:
    needles = _tokens(query)
    ranked: list[tuple[int, int, RecipientEntry]] = []
    for index, entry in enumerate(entries):
        if category and entry.category_key != category:
            continue
        if needles:
            haystack = _tokens(
                " ".join((entry.name, entry.address_book_organization, *entry.addresses))
            )
            hits = sum(any(word == needle or (len(needle) >= 3 and word.startswith(needle))
                           for word in haystack) for needle in needles)
            if not hits:
                continue
        else:
            hits = 0
        ranked.append((-hits, index, entry))
    ranked.sort(key=lambda value: (value[0], value[1]))
    return [entry for _, _, entry in ranked[offset : offset + limit]], len(ranked)


async def sync_recipients(connection: AsyncConnection, payload: RecipientSnapshot) -> str:
    config_agent = await connection.scalar(select(ai_referent_configuration.c.execution_agent_id))
    if config_agent and config_agent != payload.agent_id:
        raise HTTPException(409, "Справочник может обновлять только активный агент референта.")
    ids = [entry.id for entry in payload.entries]
    if len(set(ids)) != len(ids):
        raise HTTPException(422, "В справочнике повторяются идентификаторы адресатов.")
    rows = [entry.model_dump(by_alias=True) for entry in payload.entries]
    canonical = json.dumps(rows, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    digest = hashlib.sha256(canonical.encode("utf-8")).hexdigest()
    statement = pg_insert(ai_referent_recipient_catalog).values(
        agent_id=payload.agent_id, revision=digest, entries=rows, updated_at=datetime.now(UTC)
    )
    await connection.execute(statement.on_conflict_do_update(
        index_elements=[ai_referent_recipient_catalog.c.agent_id],
        set_={"revision": digest, "entries": rows, "updated_at": datetime.now(UTC)},
        where=ai_referent_recipient_catalog.c.revision != digest,
    ))
    return digest


async def load_recipients(
    connection: AsyncConnection, query: str, category: str, offset: int, limit: int
) -> RecipientRegistry:
    agent_id = await connection.scalar(select(ai_referent_configuration.c.execution_agent_id))
    statement = select(ai_referent_recipient_catalog)
    if agent_id:
        statement = statement.where(ai_referent_recipient_catalog.c.agent_id == agent_id)
    else:
        statement = statement.order_by(ai_referent_recipient_catalog.c.updated_at.desc()).limit(1)
    row = (await connection.execute(statement)).mappings().first()
    if row is None:
        return RecipientRegistry(entries=[], total_count=0, updated_at=None)
    entries = [RecipientEntry.model_validate(item) for item in row["entries"]]
    page, count = search_recipients(entries, query, category, offset, limit)
    return RecipientRegistry(entries=page, total_count=count, updated_at=row["updated_at"])
