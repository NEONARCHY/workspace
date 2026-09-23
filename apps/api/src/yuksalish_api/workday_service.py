"""Explicit workday check-ins, personal schedules and read-only team presence."""

from __future__ import annotations

from datetime import UTC, date, datetime, time, timedelta
from uuid import UUID, uuid4
from zoneinfo import ZoneInfo

from sqlalchemy import insert, or_, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.engine import RowMapping
from sqlalchemy.ext.asyncio import AsyncConnection

from .auth import AuthenticatedUser
from .tables import absence_requests, audit_events, users, workday_schedules, workday_sessions
from .workday_schemas import (
    WorkdayMeResponse,
    WorkdayScheduleResponse,
    WorkdayScheduleWrite,
    WorkdaySessionResponse,
    WorkdayStatus,
    WorkdayTeamMemberResponse,
    WorkdayTeamResponse,
)

ZONE = ZoneInfo("Asia/Tashkent")
DEFAULT_START = time(9, 0)
DEFAULT_END = time(18, 0)


class WorkdayError(ValueError):
    def __init__(self, status_code: int, detail: str) -> None:
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


def local_day(value: datetime) -> date:
    return value.astimezone(ZONE).date()


def automatic_close_due(work_date: date) -> datetime:
    """A forgotten check-out becomes eligible at 06:00 Tashkent the following day."""
    return datetime.combine(work_date + timedelta(days=1), time(6), tzinfo=ZONE)


def schedule_bounds(work_date: date, start: time, end: time) -> tuple[datetime, datetime]:
    return (
        datetime.combine(work_date, start, tzinfo=ZONE),
        datetime.combine(work_date, end, tzinfo=ZONE),
    )


def _schedule(user_id: UUID, row: RowMapping | None) -> WorkdayScheduleResponse:
    return WorkdayScheduleResponse(
        user_id=user_id,
        starts_at=row["starts_at"] if row is not None else DEFAULT_START,
        ends_at=row["ends_at"] if row is not None else DEFAULT_END,
    )


def _session(row: RowMapping | None) -> WorkdaySessionResponse | None:
    if row is None:
        return None
    return WorkdaySessionResponse(
        id=row["id"],
        user_id=row["user_id"],
        work_date=row["work_date"],
        started_at=row["started_at"],
        ended_at=row["ended_at"],
        scheduled_start_at=row["scheduled_start_at"],
        scheduled_end_at=row["scheduled_end_at"],
        closed_at=row["closed_at"],
        close_source=row["close_source"],
        is_weekend=row["work_date"].weekday() >= 5,
    )


def _status(
    work_date: date, session: WorkdaySessionResponse | None, absence_kind: str | None
) -> WorkdayStatus:
    if session is not None:
        return "working" if session.ended_at is None else "finished"
    if absence_kind is not None:
        return "approved_absence"
    return "weekend_off" if work_date.weekday() >= 5 else "not_started"


async def _today_data(
    connection: AsyncConnection, user_ids: list[UUID], now: datetime
) -> tuple[dict[UUID, RowMapping], dict[UUID, RowMapping], dict[UUID, str]]:
    if not user_ids:
        return {}, {}, {}
    schedules = (
        (await connection.execute(select(workday_schedules).where(
            workday_schedules.c.user_id.in_(user_ids)
        ))).mappings().all()
    )
    sessions = (
        (await connection.execute(select(workday_sessions).where(
            workday_sessions.c.user_id.in_(user_ids),
            or_(workday_sessions.c.work_date == local_day(now),
                workday_sessions.c.ended_at.is_(None)),
        ).order_by(
            workday_sessions.c.ended_at.is_not(None),
            workday_sessions.c.started_at.desc(),
        ))).mappings().all()
    )
    absences = (
        (await connection.execute(select(absence_requests).where(
            absence_requests.c.requester_user_id.in_(user_ids),
            absence_requests.c.status.in_(("approved", "acknowledged")),
            absence_requests.c.starts_at <= now,
            absence_requests.c.ends_at > now,
        ))).mappings().all()
    )
    session_by_user: dict[UUID, RowMapping] = {}
    for row in sessions:
        session_by_user.setdefault(row["user_id"], row)
    return (
        {row["user_id"]: row for row in schedules},
        session_by_user,
        {row["requester_user_id"]: str(row["kind"]) for row in absences},
    )


async def load_me(
    connection: AsyncConnection, current_user: AuthenticatedUser, *, now: datetime | None = None
) -> WorkdayMeResponse:
    checked_at = now or datetime.now(UTC)
    schedules, sessions, absences = await _today_data(connection, [current_user.id], checked_at)
    session = _session(sessions.get(current_user.id))
    absence_kind = absences.get(current_user.id)
    return WorkdayMeResponse(
        status=_status(local_day(checked_at), session, absence_kind),
        schedule=_schedule(current_user.id, schedules.get(current_user.id)),
        session=session,
        absence_kind=absence_kind,
        as_of=checked_at,
    )


async def start_workday(
    connection: AsyncConnection, current_user: AuthenticatedUser, *, now: datetime | None = None
) -> WorkdayMeResponse:
    checked_at = now or datetime.now(UTC)
    await close_overdue_sessions(connection, now=checked_at)
    # Serialise repeated clicks and two active sessions from different desktop clients.
    await connection.execute(
        select(users.c.id).where(users.c.id == current_user.id).with_for_update()
    )
    open_row = (
        (await connection.execute(select(workday_sessions).where(
            workday_sessions.c.user_id == current_user.id,
            workday_sessions.c.ended_at.is_(None),
        ))).mappings().first()
    )
    if open_row is not None:
        if open_row["work_date"] != local_day(checked_at):
            raise WorkdayError(409, "Сначала завершите предыдущий рабочий день")
        return await load_me(connection, current_user, now=checked_at)
    schedules, _sessions, absences = await _today_data(connection, [current_user.id], checked_at)
    if current_user.id in absences:
        raise WorkdayError(409, "На это время оформлено согласованное отсутствие")  # noqa: RUF001
    schedule = _schedule(current_user.id, schedules.get(current_user.id))
    planned_start, planned_end = schedule_bounds(
        local_day(checked_at), schedule.starts_at, schedule.ends_at
    )
    session_id = uuid4()
    await connection.execute(insert(workday_sessions).values(
        id=session_id,
        user_id=current_user.id,
        work_date=local_day(checked_at),
        started_at=checked_at,
        ended_at=None,
        scheduled_start_at=planned_start,
        scheduled_end_at=planned_end,
        closed_at=None,
        close_source=None,
    ))
    await _audit(connection, current_user.id, "workday.started", session_id, checked_at)
    return await load_me(connection, current_user, now=checked_at)


async def finish_workday(
    connection: AsyncConnection, current_user: AuthenticatedUser, *, now: datetime | None = None
) -> WorkdayMeResponse:
    checked_at = now or datetime.now(UTC)
    await close_overdue_sessions(connection, now=checked_at)
    row = (
        (await connection.execute(select(workday_sessions).where(
            workday_sessions.c.user_id == current_user.id,
            workday_sessions.c.ended_at.is_(None),
        ).with_for_update())).mappings().first()
    )
    if row is None:
        existing = await load_me(connection, current_user, now=checked_at)
        if existing.session is not None:
            return existing
        raise WorkdayError(409, "Рабочий день ещё не начат")
    await connection.execute(update(workday_sessions).where(
        workday_sessions.c.id == row["id"],
        workday_sessions.c.ended_at.is_(None),
    ).values(ended_at=checked_at, closed_at=checked_at, close_source="manual"))
    await _audit(connection, current_user.id, "workday.finished", row["id"], checked_at)
    return await load_me(connection, current_user, now=checked_at)


async def close_overdue_sessions(
    connection: AsyncConnection, *, now: datetime | None = None
) -> int:
    checked_at = now or datetime.now(UTC)
    rows = (
        (await connection.execute(select(workday_sessions).where(
            workday_sessions.c.ended_at.is_(None),
            workday_sessions.c.work_date < local_day(checked_at),
        ).with_for_update(skip_locked=True))).mappings().all()
    )
    count = 0
    for row in rows:
        if checked_at < automatic_close_due(row["work_date"]):
            continue
        # Scheduled checkout is an estimate, never a claim that the employee pressed a button.
        nominal_end = max(row["started_at"], row["scheduled_end_at"])
        await connection.execute(update(workday_sessions).where(
            workday_sessions.c.id == row["id"],
            workday_sessions.c.ended_at.is_(None),
        ).values(ended_at=nominal_end, closed_at=checked_at, close_source="automatic"))
        await _audit(
            connection, row["user_id"], "workday.auto_closed", row["id"], checked_at,
            {"initiator": "scheduler"},
        )
        count += 1
    return count


async def load_team(
    connection: AsyncConnection,
    current_user: AuthenticatedUser,
    *,
    can_edit_schedules: bool,
    now: datetime | None = None,
) -> WorkdayTeamResponse:
    if current_user.role not in {"manager", "admin", "superadmin"}:
        raise WorkdayError(403, "Обзор присутствия доступен только руководителю")
    checked_at = now or datetime.now(UTC)
    statement = select(users.c.id, users.c.full_name, users.c.job_title,
        users.c.direct_manager_user_id).where(users.c.status == "active")
    if current_user.role == "manager":
        statement = statement.where(
            (users.c.direct_manager_user_id == current_user.id) | (users.c.id == current_user.id)
        )
    rows = (await connection.execute(statement.order_by(users.c.full_name))).mappings().all()
    user_ids = [row["id"] for row in rows]
    schedules, sessions, absences = await _today_data(connection, user_ids, checked_at)
    members = [
        WorkdayTeamMemberResponse(
            user_id=row["id"],
            name=row["full_name"],
            job_title=row["job_title"],
            status=_status(
                local_day(checked_at), _session(sessions.get(row["id"])), absences.get(row["id"])
            ),
            schedule=_schedule(row["id"], schedules.get(row["id"])),
            session=_session(sessions.get(row["id"])),
            absence_kind=absences.get(row["id"]),
            can_edit_schedule=can_edit_schedules and row["id"] != current_user.id and (
                current_user.role in {"admin", "superadmin"}
                or row["direct_manager_user_id"] == current_user.id
            ),
        ) for row in rows
    ]
    return WorkdayTeamResponse(
        as_of=checked_at,
        working_count=sum(member.status == "working" for member in members),
        members=members,
    )


async def save_schedule(
    connection: AsyncConnection,
    current_user: AuthenticatedUser,
    user_id: UUID,
    payload: WorkdayScheduleWrite,
) -> WorkdayScheduleResponse:
    target = (
        (await connection.execute(select(users.c.id, users.c.direct_manager_user_id).where(
            users.c.id == user_id, users.c.status == "active"
        ))).mappings().first()
    )
    if target is None:
        raise WorkdayError(404, "Активный сотрудник не найден")
    if current_user.role not in {"admin", "superadmin"} and (
        current_user.role != "manager" or target["direct_manager_user_id"] != current_user.id
    ):
        raise WorkdayError(403, "График можно менять только своей команде")
    if user_id == current_user.id:
        raise WorkdayError(403, "Собственный график назначает другой руководитель")
    previous = await connection.execute(select(workday_schedules).where(
        workday_schedules.c.user_id == user_id
    ))
    previous_row = previous.mappings().first()
    checked_at = datetime.now(UTC)
    statement = pg_insert(workday_schedules).values(
        user_id=user_id,
        starts_at=payload.starts_at,
        ends_at=payload.ends_at,
        updated_by_user_id=current_user.id,
        updated_at=checked_at,
    )
    await connection.execute(statement.on_conflict_do_update(
        index_elements=[workday_schedules.c.user_id],
        set_={
            "starts_at": payload.starts_at,
            "ends_at": payload.ends_at,
            "updated_by_user_id": current_user.id,
            "updated_at": checked_at,
        },
    ))
    await _audit(connection, current_user.id, "workday.schedule_changed", user_id, checked_at, {
        "oldStart": str(previous_row["starts_at"] if previous_row else DEFAULT_START),
        "oldEnd": str(previous_row["ends_at"] if previous_row else DEFAULT_END),
        "newStart": str(payload.starts_at),
        "newEnd": str(payload.ends_at),
    })
    return WorkdayScheduleResponse(
        user_id=user_id, starts_at=payload.starts_at, ends_at=payload.ends_at
    )


async def _audit(
    connection: AsyncConnection,
    actor_id: UUID,
    action: str,
    target_id: UUID,
    now: datetime,
    details: dict[str, str] | None = None,
) -> None:
    await connection.execute(insert(audit_events).values(
        id=uuid4(),
        actor_user_id=actor_id,
        action=action,
        target_type="workday",
        target_id=target_id,
        details=details or {},
        created_at=now,
    ))
