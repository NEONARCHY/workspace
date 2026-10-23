"""Authorize every exported row, re-check access after conversion, audit no personal values."""

import asyncio
from dataclasses import dataclass
from datetime import datetime
from typing import Literal
from uuid import UUID
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncConnection

from . import dossier_service
from .auth import AuthenticatedUser, load_authenticated_user
from .dossier_documents import portrait_jpeg
from .dossier_schemas import PhotoCard, PhotoRosterExport
from .errors import WorkspaceRepositoryError
from .object_storage import ObjectStorage
from .photo_roster_documents import render_excel, render_word
from .tables import users

MAX_EXPORT_BYTES = 25 * 1024 * 1024
Format = Literal["word", "excel", "pdf"]
export_slots = asyncio.Semaphore(2)


@dataclass(frozen=True)
class RosterSource:
    cards: list[PhotoCard]
    photos: list[bytes | None]


async def _selected(
    connection: AsyncConnection, actor: AuthenticatedUser, identities: list[UUID],
) -> list[PhotoCard]:
    current = await load_authenticated_user(connection, actor.id)
    if current is None:
        raise WorkspaceRepositoryError(403, "Доступ к фотокарточкам изменился")
    allowed = await dossier_service.photos(connection, current, audit=False)
    selected = {card.user_id: card for card in allowed}
    if any(identity not in selected for identity in identities):
        raise WorkspaceRepositoryError(
            403, "Состав или доступ изменился. Обновите список сотрудников",
        )
    # Stable server ordering; caller cannot provide names, years, photo keys or other values.
    requested = set(identities)
    return [card for card in allowed if card.user_id in requested]


async def source(
    connection: AsyncConnection, actor: AuthenticatedUser, payload: PhotoRosterExport,
    storage: ObjectStorage,
) -> RosterSource:
    cards = await _selected(connection, actor, payload.user_ids)
    rows = (await connection.execute(select(users.c.id, users.c.avatar_storage_key).where(
        users.c.id.in_(payload.user_ids),
    ))).mappings()
    keys: dict[UUID, str | None] = {row["id"]: row["avatar_storage_key"] for row in rows}
    photos: list[bytes | None] = []
    total = 0
    for card in cards:
        key = keys.get(card.user_id)
        raw = await storage.get(key) if key else None
        try:
            photo = await asyncio.to_thread(portrait_jpeg, raw) if raw is not None else None
        except ValueError as error:
            raise WorkspaceRepositoryError(
                422, "Фото профиля не прочитано. Обновите фотографию",
            ) from error
        total += len(photo) if photo else 0
        if total > MAX_EXPORT_BYTES:
            raise WorkspaceRepositoryError(422, "Список слишком большой. Выберите подразделение")
        photos.append(photo)
    return RosterSource(cards, photos)


async def render(roster: RosterSource, kind: Format) -> bytes:
    renderer = render_excel if kind == "excel" else render_word
    content = await asyncio.to_thread(renderer, roster.cards, roster.photos,
                                      datetime.now(ZoneInfo("Asia/Tashkent")))
    if len(content) > MAX_EXPORT_BYTES:
        raise WorkspaceRepositoryError(422, "Список слишком большой. Выберите подразделение")
    return content


async def finish(
    connection: AsyncConnection, actor: AuthenticatedUser, roster: RosterSource, kind: Format,
) -> None:
    current = await _selected(connection, actor, [card.user_id for card in roster.cards])
    if current != roster.cards:
        raise WorkspaceRepositoryError(
            409, "Сведения изменились во время выгрузки. Обновите список",
        )
    await dossier_service._audit(connection, actor, None, "photo_roster_exported",
                                 {"format": kind, "count": len(roster.cards)})
