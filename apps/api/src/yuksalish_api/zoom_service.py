# Russian user-facing text next to Latin product names trips the ambiguity check.
# ruff: noqa: RUF001
"""Booking of Zoom conferences on the single shared corporate host.

Two systems book that host: this module and the standalone ZoomBot, which keeps
its own database. Inside Workspace the `ex_zoom_meetings_no_overlap` exclusion
constraint makes overlapping bookings impossible; against the bot we reconcile
with Zoom itself, freshly before every write and from a short-lived cache while
a day is only being displayed.

Writing follows the proven bot sequence: hold the slot, call Zoom, then store
the result. A crash between the steps leaves a `provisioning` row that
`recover_zoom_meetings` resolves instead of a silently lost slot.
"""

from __future__ import annotations

import asyncio
import time
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4
from zoneinfo import ZoneInfo

import structlog
from fastapi import HTTPException
from sqlalchemy import delete, insert, or_, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.engine import RowMapping
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncConnection, AsyncEngine

from .access_control import ensure_module_action
from .auth import AuthenticatedUser
from .settings import Settings
from .tables import users, workspace_notifications, zoom_meeting_participants, zoom_meetings
from .zoom_client import ZoomClient, ZoomError, ZoomHostBooking
from .zoom_schemas import (
    SLOT_MINUTES,
    ZoomAvailabilityResponse,
    ZoomBusyIntervalResponse,
    ZoomMeetingResponse,
    ZoomMeetingsResponse,
    ZoomMeetingWriteRequest,
)

logger = structlog.get_logger(__name__)

ACTIVE_STATUSES = ("provisioning", "scheduled", "cancellation_pending")
_OVERLAP_CONSTRAINT = "ex_zoom_meetings_no_overlap"
_PROVISIONING_TIMEOUT = timedelta(minutes=10)
_HISTORY_WINDOW = timedelta(days=30)
_PRIVILEGED_ROLES = frozenset({"admin", "superadmin"})


class ZoomServiceError(RuntimeError):
    def __init__(self, status_code: int, detail: str) -> None:
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


@dataclass
class _CachedHostCalendar:
    expires_at: float
    bookings: tuple[ZoomHostBooking, ...]


_host_calendar_cache: _CachedHostCalendar | None = None
_host_calendar_lock = asyncio.Lock()


def reset_host_calendar_cache() -> None:
    """Drop the cached host calendar; used by tests and after our own writes."""
    global _host_calendar_cache
    _host_calendar_cache = None


def _require_configured(settings: Settings) -> None:
    if not settings.zoom_configured:
        raise ZoomServiceError(
            503, "Интеграция с Zoom не настроена. Обратитесь к администратору сервера."
        )


def _is_privileged(current_user: AuthenticatedUser) -> bool:
    return current_user.role in _PRIVILEGED_ROLES


async def _host_calendar(
    settings: Settings, client: ZoomClient, *, fresh: bool
) -> tuple[ZoomHostBooking, ...]:
    global _host_calendar_cache
    now = time.monotonic()
    if not fresh and _host_calendar_cache is not None and _host_calendar_cache.expires_at > now:
        return _host_calendar_cache.bookings
    async with _host_calendar_lock:
        now = time.monotonic()
        if not fresh and _host_calendar_cache is not None and _host_calendar_cache.expires_at > now:
            return _host_calendar_cache.bookings
        bookings = tuple(await client.list_upcoming())
        _host_calendar_cache = _CachedHostCalendar(
            expires_at=now + max(15, settings.zoom_availability_cache_seconds),
            bookings=bookings,
        )
        return bookings


def _overlaps(
    booking: ZoomHostBooking, starts_at: datetime, ends_at: datetime
) -> bool:
    return booking.starts_at < ends_at and booking.ends_at > starts_at


async def _assert_host_is_free(
    settings: Settings,
    client: ZoomClient,
    starts_at: datetime,
    ends_at: datetime,
    *,
    known_zoom_meeting_ids: frozenset[str] = frozenset(),
) -> None:
    """Refuse a slot the corporate host already spends elsewhere, bot bookings included."""
    try:
        bookings = await _host_calendar(settings, client, fresh=True)
    except ZoomError as error:
        raise ZoomServiceError(error.status_code, error.detail) from error
    conflict = next(
        (
            booking
            for booking in bookings
            if booking.meeting_id not in known_zoom_meeting_ids
            and _overlaps(booking, starts_at, ends_at)
        ),
        None,
    )
    if conflict is not None:
        local = conflict.starts_at.astimezone(_zone(settings))
        raise ZoomServiceError(
            409,
            "Это время уже занято конференцией, созданной вне Workspace "
            f"(начало {local:%d.%m %H:%M}). Выберите другое время.",
        )


def _zone(settings: Settings) -> ZoneInfo:
    return ZoneInfo(settings.zoom_timezone)


def _validate_horizon(settings: Settings, starts_at: datetime, now: datetime) -> None:
    if starts_at <= now:
        raise ZoomServiceError(422, "Нельзя создать конференцию в прошлом.")
    horizon = now + timedelta(days=settings.zoom_booking_horizon_days)
    if starts_at > horizon:
        raise ZoomServiceError(
            422,
            "Конференцию можно запланировать не более чем на "
            f"{settings.zoom_booking_horizon_days} дней вперёд.",
        )


def _is_overlap_violation(error: IntegrityError) -> bool:
    return _OVERLAP_CONSTRAINT in str(error.orig)


async def _validate_participants(
    connection: AsyncConnection, participant_ids: Sequence[str]
) -> list[UUID]:
    if not participant_ids:
        return []
    try:
        wanted = [UUID(value) for value in participant_ids]
    except ValueError as error:
        raise ZoomServiceError(422, "Указан некорректный идентификатор участника.") from error
    known = set(
        (
            await connection.execute(
                select(users.c.id).where(
                    users.c.id.in_(wanted), users.c.status.in_(("active", "pending"))
                )
            )
        ).scalars()
    )
    missing = [value for value in wanted if value not in known]
    if missing:
        raise ZoomServiceError(422, "Среди участников есть недоступный сотрудник.")
    return wanted


async def _participants_by_meeting(
    connection: AsyncConnection, meeting_ids: Sequence[UUID]
) -> dict[UUID, list[str]]:
    if not meeting_ids:
        return {}
    rows = (
        await connection.execute(
            select(zoom_meeting_participants).where(
                zoom_meeting_participants.c.meeting_id.in_(meeting_ids)
            )
        )
    ).mappings().all()
    grouped: dict[UUID, list[str]] = {}
    for row in rows:
        grouped.setdefault(row["meeting_id"], []).append(str(row["user_id"]))
    return grouped


def _meeting_response(
    row: RowMapping,
    participant_ids: list[str],
    organizer_name: str,
    current_user: AuthenticatedUser,
) -> ZoomMeetingResponse:
    organizer_id = row["organizer_user_id"]
    is_organizer = organizer_id == current_user.id
    privileged = _is_privileged(current_user)
    # Connection details belong to the people who actually attend the meeting.
    may_see_link = is_organizer or privileged or str(current_user.id) in participant_ids
    manageable = row["status"] in {"provisioning", "scheduled"} and (is_organizer or privileged)
    return ZoomMeetingResponse(
        id=str(row["id"]),
        topic=row["topic"],
        description=row["description"] or "",
        starts_at=row["starts_at"],
        ends_at=row["ends_at"],
        duration_minutes=row["duration_minutes"],
        status=row["status"],
        source=row["source"],
        organizer_user_id=str(organizer_id) if organizer_id else None,
        organizer_name=organizer_name,
        participant_ids=participant_ids,
        zoom_meeting_id=row["zoom_meeting_id"] if may_see_link else None,
        join_url=row["join_url"] if may_see_link else None,
        passcode=row["passcode"] if may_see_link else None,
        can_edit=manageable,
        can_cancel=manageable,
    )


async def _load_meeting_rows(
    connection: AsyncConnection, *, since: datetime
) -> list[RowMapping]:
    return list(
        (
            await connection.execute(
                select(
                    zoom_meetings,
                    users.c.full_name.label("organizer_full_name"),
                )
                .select_from(
                    zoom_meetings.join(
                        users, users.c.id == zoom_meetings.c.organizer_user_id, isouter=True
                    )
                )
                .where(
                    zoom_meetings.c.ends_at >= since,
                    zoom_meetings.c.status.in_(("provisioning", "scheduled", "cancelled")),
                )
                .order_by(zoom_meetings.c.starts_at)
            )
        )
        .mappings()
        .all()
    )


def _organizer_name(row: RowMapping) -> str:
    return row["organizer_full_name"] or row["organizer_display_name"] or "Организатор неизвестен"


async def load_zoom_meetings(
    connection: AsyncConnection,
    current_user: AuthenticatedUser,
    settings: Settings,
) -> ZoomMeetingsResponse:
    """Everyone with view access sees the shared host calendar; links stay restricted."""
    rows = await _load_meeting_rows(connection, since=datetime.now(UTC) - _HISTORY_WINDOW)
    participants = await _participants_by_meeting(connection, [row["id"] for row in rows])
    return ZoomMeetingsResponse(
        configured=settings.zoom_configured,
        timezone=settings.zoom_timezone,
        reminder_minutes=settings.zoom_reminder_minutes,
        booking_horizon_days=settings.zoom_booking_horizon_days,
        meetings=[
            _meeting_response(
                row, participants.get(row["id"], []), _organizer_name(row), current_user
            )
            for row in rows
        ],
    )


async def load_zoom_availability(
    connection: AsyncConnection,
    settings: Settings,
    client: ZoomClient,
    day_start: datetime,
    day_end: datetime,
) -> ZoomAvailabilityResponse:
    """Busy intervals of the host for one day: our bookings plus everything in Zoom."""
    if not settings.zoom_configured:
        return ZoomAvailabilityResponse(
            configured=False, timezone=settings.zoom_timezone, host_calendar_synced=False
        )
    rows = (
        (
            await connection.execute(
                select(zoom_meetings).where(
                    zoom_meetings.c.status.in_(ACTIVE_STATUSES),
                    zoom_meetings.c.starts_at < day_end,
                    zoom_meetings.c.ends_at > day_start,
                )
            )
        )
        .mappings()
        .all()
    )
    intervals = [
        ZoomBusyIntervalResponse(
            starts_at=row["starts_at"],
            ends_at=row["ends_at"],
            topic=row["topic"],
            source="workspace",
            meeting_id=str(row["id"]),
        )
        for row in rows
    ]
    known_ids = {row["zoom_meeting_id"] for row in rows if row["zoom_meeting_id"]}
    synced = True
    try:
        bookings = await _host_calendar(settings, client, fresh=False)
    except ZoomError:
        # A stale or missing host calendar must not hide the bookings we do know.
        logger.warning("zoom_availability_degraded")
        bookings = ()
        synced = False
    intervals.extend(
        ZoomBusyIntervalResponse(
            starts_at=booking.starts_at,
            ends_at=booking.ends_at,
            topic=booking.topic,
            source="external",
        )
        for booking in bookings
        if booking.meeting_id not in known_ids and _overlaps(booking, day_start, day_end)
    )
    intervals.sort(key=lambda item: item.starts_at)
    return ZoomAvailabilityResponse(
        configured=True,
        timezone=settings.zoom_timezone,
        host_calendar_synced=synced,
        intervals=intervals,
    )


async def _read_meeting(
    connection: AsyncConnection,
    current_user: AuthenticatedUser,
    meeting_id: UUID,
) -> ZoomMeetingResponse:
    row = (
        (
            await connection.execute(
                select(zoom_meetings, users.c.full_name.label("organizer_full_name"))
                .select_from(
                    zoom_meetings.join(
                        users, users.c.id == zoom_meetings.c.organizer_user_id, isouter=True
                    )
                )
                .where(zoom_meetings.c.id == meeting_id)
            )
        )
        .mappings()
        .first()
    )
    if row is None:
        raise ZoomServiceError(404, "Конференция не найдена.")
    participants = await _participants_by_meeting(connection, [meeting_id])
    return _meeting_response(
        row, participants.get(meeting_id, []), _organizer_name(row), current_user
    )


async def _replace_participants(
    connection: AsyncConnection, meeting_id: UUID, participant_ids: Iterable[UUID]
) -> None:
    await connection.execute(
        delete(zoom_meeting_participants).where(
            zoom_meeting_participants.c.meeting_id == meeting_id
        )
    )
    values = [{"meeting_id": meeting_id, "user_id": user_id} for user_id in participant_ids]
    if values:
        await connection.execute(insert(zoom_meeting_participants), values)


async def create_zoom_meeting(
    engine: AsyncEngine,
    current_user: AuthenticatedUser,
    settings: Settings,
    client: ZoomClient,
    payload: ZoomMeetingWriteRequest,
) -> ZoomMeetingResponse:
    _require_configured(settings)
    now = datetime.now(UTC)
    starts_at = payload.starts_at.astimezone(UTC)
    ends_at = starts_at + timedelta(minutes=payload.duration_minutes)
    _validate_horizon(settings, starts_at, now)

    meeting_id = uuid4()
    # Hold the slot locally first: the exclusion constraint answers "is it taken
    # by us", so whatever Zoom still reports afterwards is a booking from outside.
    async with engine.begin() as connection:
        participant_ids = await _validate_participants(connection, payload.participant_ids)
        try:
            await connection.execute(
                insert(zoom_meetings).values(
                    id=meeting_id,
                    organizer_user_id=current_user.id,
                    organizer_display_name=None,
                    topic=payload.topic,
                    description=payload.description or None,
                    starts_at=starts_at,
                    ends_at=ends_at,
                    duration_minutes=payload.duration_minutes,
                    timezone=settings.zoom_timezone,
                    status="provisioning",
                    source="workspace",
                    reminders_enabled=True,
                    created_at=now,
                    updated_at=now,
                )
            )
        except IntegrityError as error:
            if _is_overlap_violation(error):
                raise ZoomServiceError(
                    409, "Это время уже занято другой конференцией. Выберите другое время."
                ) from error
            raise
        await _replace_participants(connection, meeting_id, participant_ids)

    try:
        await _assert_host_is_free(settings, client, starts_at, ends_at)
        created = await client.create_meeting(
            topic=payload.topic,
            starts_at=starts_at,
            duration_minutes=payload.duration_minutes,
            description=payload.description or None,
        )
    except ZoomError as error:
        await _mark_failed(engine, meeting_id, error)
        raise ZoomServiceError(error.status_code, error.detail) from error
    except ZoomServiceError as error:
        await _mark_failed(engine, meeting_id, error)
        raise

    reset_host_calendar_cache()
    async with engine.begin() as connection:
        await connection.execute(
            update(zoom_meetings)
            .where(zoom_meetings.c.id == meeting_id)
            .values(
                zoom_meeting_id=created.meeting_id,
                join_url=created.join_url,
                passcode=created.passcode,
                status="scheduled",
                technical_error=None,
                updated_at=datetime.now(UTC),
            )
        )
        return await _read_meeting(connection, current_user, meeting_id)


async def _mark_failed(engine: AsyncEngine, meeting_id: UUID, error: Exception) -> None:
    """Release the held slot so a failed Zoom call never blocks the calendar."""
    async with engine.begin() as connection:
        await connection.execute(
            update(zoom_meetings)
            .where(zoom_meetings.c.id == meeting_id)
            .values(
                status="failed",
                technical_error=type(error).__name__,
                updated_at=datetime.now(UTC),
            )
        )


async def _load_manageable(
    connection: AsyncConnection,
    current_user: AuthenticatedUser,
    meeting_id: UUID,
) -> RowMapping:
    row = (
        (
            await connection.execute(
                select(zoom_meetings).where(zoom_meetings.c.id == meeting_id).with_for_update()
            )
        )
        .mappings()
        .first()
    )
    if row is None:
        raise ZoomServiceError(404, "Конференция не найдена.")
    if row["organizer_user_id"] != current_user.id:
        # Someone else's conference is an administrative action, checked on the server.
        try:
            await ensure_module_action(connection, current_user, "zoom_meetings", "admin")
        except HTTPException as error:
            # The service speaks one error type, so it stays usable outside FastAPI.
            raise ZoomServiceError(
                error.status_code, "Чужую конференцию может изменить только администратор."
            ) from error
    if row["status"] != "scheduled":
        raise ZoomServiceError(409, "Эта конференция уже отменяется или отменена.")
    return row


async def update_zoom_meeting(
    engine: AsyncEngine,
    current_user: AuthenticatedUser,
    settings: Settings,
    client: ZoomClient,
    meeting_id: UUID,
    payload: ZoomMeetingWriteRequest,
) -> ZoomMeetingResponse:
    _require_configured(settings)
    now = datetime.now(UTC)
    starts_at = payload.starts_at.astimezone(UTC)
    ends_at = starts_at + timedelta(minutes=payload.duration_minutes)
    _validate_horizon(settings, starts_at, now)

    async with engine.begin() as connection:
        row = await _load_manageable(connection, current_user, meeting_id)
        zoom_meeting_id = row["zoom_meeting_id"]
        participant_ids = await _validate_participants(connection, payload.participant_ids)
    if not zoom_meeting_id:
        raise ZoomServiceError(409, "У конференции нет идентификатора Zoom.")
    await _assert_host_is_free(
        settings,
        client,
        starts_at,
        ends_at,
        known_zoom_meeting_ids=frozenset({zoom_meeting_id}),
    )

    async with engine.begin() as connection:
        try:
            moved = await connection.execute(
                update(zoom_meetings)
                .where(zoom_meetings.c.id == meeting_id, zoom_meetings.c.status == "scheduled")
                .values(
                    topic=payload.topic,
                    description=payload.description or None,
                    starts_at=starts_at,
                    ends_at=ends_at,
                    duration_minutes=payload.duration_minutes,
                    updated_at=now,
                )
            )
        except IntegrityError as error:
            if _is_overlap_violation(error):
                raise ZoomServiceError(
                    409, "Это время уже занято другой конференцией. Выберите другое время."
                ) from error
            raise
        if moved.rowcount == 0:
            raise ZoomServiceError(409, "Конференция изменилась в другом окне. Обновите данные.")
        await _replace_participants(connection, meeting_id, participant_ids)

    try:
        await client.update_meeting(
            zoom_meeting_id,
            topic=payload.topic,
            starts_at=starts_at,
            duration_minutes=payload.duration_minutes,
            description=payload.description or None,
        )
    except ZoomError as error:
        # Zoom stays the source of truth: undo our move so the two never diverge.
        async with engine.begin() as connection:
            await connection.execute(
                update(zoom_meetings)
                .where(zoom_meetings.c.id == meeting_id)
                .values(
                    topic=row["topic"],
                    description=row["description"],
                    starts_at=row["starts_at"],
                    ends_at=row["ends_at"],
                    duration_minutes=row["duration_minutes"],
                    updated_at=datetime.now(UTC),
                )
            )
        raise ZoomServiceError(error.status_code, error.detail) from error

    reset_host_calendar_cache()
    async with engine.begin() as connection:
        return await _read_meeting(connection, current_user, meeting_id)


async def cancel_zoom_meeting(
    engine: AsyncEngine,
    current_user: AuthenticatedUser,
    settings: Settings,
    client: ZoomClient,
    meeting_id: UUID,
) -> ZoomMeetingResponse:
    _require_configured(settings)
    async with engine.begin() as connection:
        row = await _load_manageable(connection, current_user, meeting_id)
        zoom_meeting_id = row["zoom_meeting_id"]
        await connection.execute(
            update(zoom_meetings)
            .where(zoom_meetings.c.id == meeting_id)
            .values(status="cancellation_pending", updated_at=datetime.now(UTC))
        )
    if not zoom_meeting_id:
        raise ZoomServiceError(409, "У конференции нет идентификатора Zoom.")
    try:
        await client.delete_meeting(zoom_meeting_id)
    except ZoomError as error:
        # The meeting stays pending and recover_zoom_meetings retries the removal.
        raise ZoomServiceError(error.status_code, error.detail) from error

    reset_host_calendar_cache()
    async with engine.begin() as connection:
        await connection.execute(
            update(zoom_meetings)
            .where(zoom_meetings.c.id == meeting_id)
            .values(status="cancelled", updated_at=datetime.now(UTC))
        )
        return await _read_meeting(connection, current_user, meeting_id)


async def recover_zoom_meetings(engine: AsyncEngine, client: ZoomClient) -> int:
    """Resolve bookings a crash or a Zoom outage left half-finished."""
    resolved = 0
    cutoff = datetime.now(UTC) - _PROVISIONING_TIMEOUT
    async with engine.begin() as connection:
        stale = await connection.execute(
            update(zoom_meetings)
            .where(
                zoom_meetings.c.status == "provisioning",
                zoom_meetings.c.created_at < cutoff,
            )
            .values(status="failed", technical_error="stale_provisioning")
        )
        resolved += stale.rowcount or 0
        pending = list(
            (
                await connection.execute(
                    select(zoom_meetings.c.id, zoom_meetings.c.zoom_meeting_id).where(
                        zoom_meetings.c.status == "cancellation_pending"
                    )
                )
            )
            .mappings()
            .all()
        )
    for row in pending:
        if row["zoom_meeting_id"]:
            try:
                await client.delete_meeting(row["zoom_meeting_id"])
            except ZoomError:
                logger.warning("zoom_cancel_retry_failed", meeting_id=str(row["id"]))
                continue
        async with engine.begin() as connection:
            await connection.execute(
                update(zoom_meetings)
                .where(zoom_meetings.c.id == row["id"])
                .values(status="cancelled", updated_at=datetime.now(UTC))
            )
        resolved += 1
    if resolved:
        reset_host_calendar_cache()
    return resolved


def upcoming_reminder_window(settings: Settings, now: datetime) -> tuple[datetime, datetime]:
    """Meetings whose reminder is due right now."""
    lead = timedelta(minutes=settings.zoom_reminder_minutes)
    return now, now + lead
async def materialize_zoom_reminders(
    connection: AsyncConnection,
    settings: Settings,
    current_time: datetime | None = None,
) -> int:
    """Remind the organizer and the invited employees once per conference."""
    now = current_time or datetime.now(UTC)
    if now.tzinfo is None:
        now = now.replace(tzinfo=UTC)
    rows = await due_reminder_rows(connection, settings, now)
    if not rows:
        return 0
    participants = await _participants_by_meeting(connection, [row["id"] for row in rows])
    zone = _zone(settings)
    created = 0
    for row in rows:
        recipients: list[UUID] = []
        organizer_id = row["organizer_user_id"]
        if organizer_id is not None:
            recipients.append(organizer_id)
        recipients.extend(
            UUID(value)
            for value in participants.get(row["id"], [])
            if UUID(value) != organizer_id
        )
        if not recipients:
            continue
        local_start = row["starts_at"].astimezone(zone)
        # The start time is part of the key, so a rescheduled meeting reminds again.
        event_key = f"zoom:{row['id']}:reminder:{row['starts_at'].isoformat()}"
        body = (
            f"{row['topic']} · начало в {local_start:%H:%M} "
            f"({settings.zoom_timezone.split('/')[-1]})"
        )
        for user_id in recipients:
            await connection.execute(
                pg_insert(workspace_notifications)
                .values(
                    id=uuid4(),
                    user_id=user_id,
                    event_key=event_key,
                    kind="zoom",
                    priority="attention",
                    title=f"Через {settings.zoom_reminder_minutes} минут конференция Zoom",
                    body=body[:4000],
                    section="zoom_meetings",
                    entity_id=row["id"],
                    requires_action=False,
                    is_reminder=True,
                    occurred_at=now,
                    read_at=None,
                    resolved_at=None,
                    desktop_delivered_at=None,
                )
                .on_conflict_do_nothing(
                    index_elements=[
                        workspace_notifications.c.user_id,
                        workspace_notifications.c.event_key,
                    ]
                )
            )
        created += 1
    return created


async def due_reminder_rows(
    connection: AsyncConnection, settings: Settings, now: datetime
) -> list[RowMapping]:
    window_start, window_end = upcoming_reminder_window(settings, now)
    return list(
        (
            await connection.execute(
                select(zoom_meetings).where(
                    zoom_meetings.c.status == "scheduled",
                    zoom_meetings.c.reminders_enabled.is_(True),
                    zoom_meetings.c.starts_at > window_start,
                    zoom_meetings.c.starts_at <= window_end,
                    or_(
                        zoom_meetings.c.organizer_user_id.is_not(None),
                        zoom_meetings.c.organizer_display_name.is_not(None),
                    ),
                )
            )
        )
        .mappings()
        .all()
    )


__all__ = [
    "ACTIVE_STATUSES",
    "SLOT_MINUTES",
    "ZoomServiceError",
    "cancel_zoom_meeting",
    "create_zoom_meeting",
    "due_reminder_rows",
    "load_zoom_availability",
    "load_zoom_meetings",
    "materialize_zoom_reminders",
    "recover_zoom_meetings",
    "reset_host_calendar_cache",
    "update_zoom_meeting",
]
