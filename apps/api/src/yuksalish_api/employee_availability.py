"""Serialise decisions that reserve the same employee's leave/travel period."""

# Russian messages are shown directly in the workspace.
# ruff: noqa: RUF001

from collections.abc import Sequence
from datetime import UTC, date, datetime, time, timedelta
from uuid import UUID
from zoneinfo import ZoneInfo

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncConnection

from .errors import WorkspaceRepositoryError
from .tables import absence_requests, leave_requests, trip_request_employees, trip_requests, users


async def lock_employee_schedules(connection: AsyncConnection, user_ids: Sequence[UUID]) -> None:
    # A common lock and stable ordering prevent concurrent cross-module approvals
    # from both passing an overlap check before either transaction commits.
    for user_id in sorted(set(user_ids), key=str):
        await connection.execute(select(func.pg_advisory_xact_lock(
            func.hashtextextended(f"employee-availability:{user_id}", 0),
        )))


async def ensure_trip_available(
    connection: AsyncConnection, request_id: UUID, starts_on: date, ends_on: date,
) -> None:
    people = (await connection.execute(
        select(users.c.id, users.c.status)
        .join(trip_request_employees, trip_request_employees.c.user_id == users.c.id)
        .where(trip_request_employees.c.request_id == request_id)
    )).all()
    if not people or any(status != "active" for _, status in people):
        raise WorkspaceRepositoryError(
            409, "Проверьте участников: все должны быть действующими сотрудниками",
        )
    user_ids = [user_id for user_id, _ in people]
    await lock_employee_schedules(connection, user_ids)
    local = ZoneInfo("Asia/Tashkent")
    start_at = datetime.combine(starts_on, time.min, local).astimezone(UTC)
    end_at = datetime.combine(ends_on + timedelta(days=1), time.min, local).astimezone(UTC)
    leave = await connection.scalar(select(leave_requests.c.id).where(
        leave_requests.c.requester_user_id.in_(user_ids),
        leave_requests.c.status.in_(("pending_hr", "pending_deputy", "approved")),
        func.coalesce(leave_requests.c.starts_on, leave_requests.c.requested_starts_on) <= ends_on,
        func.coalesce(leave_requests.c.ends_on, leave_requests.c.requested_ends_on,
                      leave_requests.c.requested_starts_on) >= starts_on,
    ).limit(1))
    if leave is not None:
        raise WorkspaceRepositoryError(
            409, "Участник поездки имеет пересекающуюся заявку на отпуск",
        )
    absence = await connection.scalar(select(absence_requests.c.id).where(
        absence_requests.c.requester_user_id.in_(user_ids),
        absence_requests.c.status.in_(("pending", "approved", "acknowledged")),
        absence_requests.c.starts_at < end_at, absence_requests.c.ends_at > start_at,
    ).limit(1))
    if absence is not None:
        raise WorkspaceRepositoryError(409, "Период поездки пересекается с отсутствием участника")
    trip = await connection.scalar(select(trip_requests.c.id).join(
        trip_request_employees, trip_request_employees.c.request_id == trip_requests.c.id,
    ).where(
        trip_request_employees.c.user_id.in_(user_ids), trip_requests.c.id != request_id,
        trip_requests.c.status == "approved", trip_requests.c.start_date <= ends_on,
        trip_requests.c.end_date >= starts_on,
    ).limit(1))
    if trip is not None:
        raise WorkspaceRepositoryError(409, "Участник уже направлен в другую поездку на эти даты")
