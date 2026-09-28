# ruff: noqa: RUF001
"""Exat address-book projection with administrator-managed shared additions."""

import hashlib
import json
import re
from datetime import UTC, datetime
from typing import Annotated, Literal
from uuid import UUID, uuid4

from fastapi import HTTPException
from pydantic import Field, field_validator
from sqlalchemy import delete, func, insert, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.engine import RowMapping
from sqlalchemy.ext.asyncio import AsyncConnection

from .tables import (
    ai_referent_configuration,
    ai_referent_manual_recipient_state,
    ai_referent_manual_recipients,
    ai_referent_recipient_catalog,
    audit_events,
)
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


class ManualRecipientInput(ApiModel):
    name: str = Field(min_length=2, max_length=300)
    address: str = Field(min_length=5, max_length=500)
    category_key: Literal[
        "ministries", "agencies", "committees", "other", "international"
    ] = "other"

    @field_validator("name", "address")
    @classmethod
    def trim_nonempty(cls, value: str) -> str:
        result = value.strip()
        if len(result) < 2:
            raise ValueError("Укажите название организации и адрес.")
        return result

    @field_validator("address")
    @classmethod
    def validate_address(cls, value: str) -> str:
        if not re.fullmatch(
            r"[A-Za-z0-9_][A-Za-z0-9._%+\-]*@[A-Za-z0-9][A-Za-z0-9.\-]*\.[A-Za-z]{2,}",
            value,
        ):
            raise ValueError("Укажите корректный E-XAT-адрес или email.")
        return value.casefold()


def _manual_entry(item: RowMapping) -> RecipientEntry:
    return RecipientEntry(
        id="manual-" + str(item["id"]),
        name=item["name"],
        category_key=item["category_key"],
        addresses=[item["address"]],
        route=item["route"],
        address_book_organization=item["name"],
    )


async def _touch_manual_state(connection: AsyncConnection) -> None:
    stamp = datetime.now(UTC)
    statement = pg_insert(ai_referent_manual_recipient_state).values(id=1, updated_at=stamp)
    await connection.execute(statement.on_conflict_do_update(
        index_elements=[ai_referent_manual_recipient_state.c.id],
        set_={"updated_at": stamp},
    ))


async def list_manual_recipients(connection: AsyncConnection) -> list[RecipientEntry]:
    rows = (await connection.execute(
        select(ai_referent_manual_recipients).order_by(
            ai_referent_manual_recipients.c.created_at.desc()
        )
    )).mappings().all()
    return [_manual_entry(row) for row in rows]


async def add_manual_recipient(
    connection: AsyncConnection, user_id: UUID, payload: ManualRecipientInput
) -> RecipientEntry:
    count = await connection.scalar(select(func.count()).select_from(ai_referent_manual_recipients))
    if count is not None and count >= 500:
        raise HTTPException(409, "Лимит дополнительных адресатов достигнут.")
    active_agent = await connection.scalar(select(ai_referent_configuration.c.execution_agent_id))
    snapshot_query = select(ai_referent_recipient_catalog.c.entries)
    if active_agent:
        snapshot_query = snapshot_query.where(
            ai_referent_recipient_catalog.c.agent_id == active_agent
        )
    else:
        snapshot_query = snapshot_query.order_by(
            ai_referent_recipient_catalog.c.updated_at.desc()
        ).limit(1)
    snapshot = await connection.scalar(snapshot_query)
    if any(payload.address == str(address).casefold()
           for item in (snapshot or []) for address in item.get("addresses", [])):
        raise HTTPException(409, "Этот адрес уже есть в справочнике робота.")
    route: Literal["exat", "webmail"] = (
        "exat" if payload.address.endswith("@exat.uz") else "webmail"
    )
    recipient_id = uuid4()
    statement = pg_insert(ai_referent_manual_recipients).values(
        id=recipient_id, name=payload.name, address=payload.address,
        route=route, category_key=payload.category_key,
        created_by_user_id=user_id, created_at=datetime.now(UTC),
    ).on_conflict_do_nothing(index_elements=[ai_referent_manual_recipients.c.address])
    inserted = await connection.execute(statement.returning(ai_referent_manual_recipients.c.id))
    if inserted.scalar() is None:
        raise HTTPException(409, "Этот адрес уже добавлен администратором.")
    now = datetime.now(UTC)
    await _touch_manual_state(connection)
    await connection.execute(insert(audit_events).values(
        id=uuid4(), actor_user_id=user_id, action="ai_referent.recipient_added",
        target_type="ai_referent_recipient", target_id=recipient_id,
        details={"name": payload.name, "address": payload.address, "route": route},
        created_at=now,
    ))
    return RecipientEntry(
        id="manual-" + str(recipient_id), name=payload.name,
        category_key=payload.category_key, addresses=[payload.address], route=route,
        address_book_organization=payload.name,
    )


async def remove_manual_recipient(
    connection: AsyncConnection, user_id: UUID, recipient_id: UUID
) -> None:
    result = await connection.execute(
        delete(ai_referent_manual_recipients).where(
            ai_referent_manual_recipients.c.id == recipient_id
        ).returning(
            ai_referent_manual_recipients.c.name,
            ai_referent_manual_recipients.c.address,
        )
    )
    removed = result.mappings().first()
    if removed is None:
        raise HTTPException(404, "Адресат не найден среди записей администратора.")
    await _touch_manual_state(connection)
    await connection.execute(insert(audit_events).values(
        id=uuid4(), actor_user_id=user_id, action="ai_referent.recipient_removed",
        target_type="ai_referent_recipient", target_id=recipient_id,
        details={"name": removed["name"], "address": removed["address"]},
        created_at=datetime.now(UTC),
    ))


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
    manual_rows = (await connection.execute(
        select(ai_referent_manual_recipients).order_by(
            ai_referent_manual_recipients.c.created_at.desc()
        )
    )).mappings().all()
    manual = [_manual_entry(item) for item in manual_rows]
    manual_addresses = {item.addresses[0].casefold() for item in manual}
    imported = [RecipientEntry.model_validate(item) for item in row["entries"]] if row else []
    entries = list(manual)
    for item in imported:
        remaining = [address for address in item.addresses
                     if address.casefold() not in manual_addresses]
        if not item.addresses:
            entries.append(item)
        elif remaining:
            entries.append(item.model_copy(update={"addresses": remaining}))
    page, count = search_recipients(entries, query, category, offset, limit)
    manual_updated_at = await connection.scalar(
        select(ai_referent_manual_recipient_state.c.updated_at)
    )
    updated_at = max(
        (stamp for stamp in (
            row["updated_at"] if row else None,
            manual_updated_at,
        ) if stamp is not None), default=None,
    ) if row or manual else None
    return RecipientRegistry(entries=page, total_count=count, updated_at=updated_at)
