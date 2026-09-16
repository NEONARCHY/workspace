from __future__ import annotations

from collections.abc import Mapping
from datetime import UTC, date, datetime, time, timedelta
from typing import Any
from uuid import UUID, uuid4
from zoneinfo import ZoneInfo

from sqlalchemy import insert, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.engine import RowMapping
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncConnection

from .attendance_schemas import (
    AttendanceActionRequest,
    AttendanceCorrectionActionRequest,
    AttendanceCorrectionCreateRequest,
    AttendanceCorrectionResponse,
    AttendanceDayResponse,
    AttendanceProfileResponse,
    AttendanceProfileUpdateRequest,
    SmartOfficeAttendanceEventRequest,
    SmartOfficeAttendanceEventResponse,
    SmartOfficeSnapshotEmployeeResponse,
    SmartOfficeSnapshotResponse,
    WorkScheduleExceptionResponse,
    WorkScheduleExceptionWriteRequest,
    WorkSchedulePeriodResponse,
    WorkSchedulePeriodWriteRequest,
)
from .auth import AuthenticatedUser
from .tables import (
    absence_requests,
    attendance_birthday_events,
    attendance_correction_actions,
    attendance_corrections,
    attendance_days,
    attendance_events,
    audit_events,
    feed_posts,
    users,
    work_schedule_exceptions,
    work_schedule_periods,
    workspace_notifications,
)

TASHKENT = ZoneInfo("Asia/Tashkent")


class AttendanceError(ValueError):
    def __init__(self, status_code: int, detail: str) -> None:
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


async def _audit(
    connection: AsyncConnection,
    actor_user_id: UUID,
    action: str,
    target_id: UUID,
    details: dict[str, Any],
) -> None:
    await connection.execute(
        insert(audit_events).values(
            id=uuid4(),
            actor_user_id=actor_user_id,
            action=action,
            target_type="attendance",
            target_id=target_id,
            details=details,
            created_at=datetime.now(UTC),
        )
    )


def _period_response(data: Mapping[str, Any] | RowMapping) -> WorkSchedulePeriodResponse:
    return WorkSchedulePeriodResponse(
        id=str(data["id"]),
        user_id=str(data["user_id"]),
        starts_on=data["starts_on"],
        ends_on=data["ends_on"],
        weekdays=[int(day) for day in data["weekdays"]],
        starts_at=data["starts_at"],
        ends_at=data["ends_at"],
    )


def _exception_response(data: Mapping[str, Any] | RowMapping) -> WorkScheduleExceptionResponse:
    return WorkScheduleExceptionResponse(
        id=str(data["id"]),
        user_id=str(data["user_id"]),
        work_date=data["work_date"],
        kind=data["kind"],
        starts_at=data["starts_at"],
        ends_at=data["ends_at"],
    )


def _day_response(data: Mapping[str, Any] | RowMapping) -> AttendanceDayResponse:
    return AttendanceDayResponse(
        id=str(data["id"]),
        user_id=str(data["user_id"]),
        work_date=data["work_date"],
        status=data["status"],
        scheduled_starts_at=data["scheduled_starts_at"],
        scheduled_ends_at=data["scheduled_ends_at"],
        arrived_at=data["arrived_at"],
        started_at=data["started_at"],
        ended_at=data["ended_at"],
        absence_kind=data["absence_kind"],
    )


def _correction_response(data: Mapping[str, Any] | RowMapping) -> AttendanceCorrectionResponse:
    return AttendanceCorrectionResponse(
        id=str(data["id"]),
        user_id=str(data["user_id"]),
        direct_manager_user_id=str(data["direct_manager_user_id"]),
        event_kind=data["event_kind"],
        requested_at=data["requested_at"],
        reason=data["reason"],
        status=data["status"],
        comment=data["comment"],
        created_at=data["created_at"],
    )


def _local_date(value: datetime) -> date:
    return value.astimezone(TASHKENT).date()


def _scheduled_datetime(work_date: date, value: time) -> datetime:
    return datetime.combine(work_date, value, TASHKENT).astimezone(UTC)


async def _schedule_for(
    connection: AsyncConnection, user_id: UUID, work_date: date
) -> tuple[time, time] | None:
    exception = (
        (
            await connection.execute(
                select(work_schedule_exceptions).where(
                    work_schedule_exceptions.c.user_id == user_id,
                    work_schedule_exceptions.c.work_date == work_date,
                )
            )
        )
        .mappings()
        .first()
    )
    if exception is not None:
        if exception["kind"] == "day_off":
            return None
        return exception["starts_at"], exception["ends_at"]
    rows = (
        (
            await connection.execute(
                select(work_schedule_periods)
                .where(
                    work_schedule_periods.c.user_id == user_id,
                    work_schedule_periods.c.starts_on <= work_date,
                    work_schedule_periods.c.ends_on >= work_date,
                )
                .order_by(work_schedule_periods.c.starts_on.desc())
            )
        )
        .mappings()
        .all()
    )
    for row in rows:
        if work_date.weekday() in {int(day) for day in row["weekdays"]}:
            return row["starts_at"], row["ends_at"]
    return None


async def _absence_for(connection: AsyncConnection, user_id: UUID, work_date: date) -> str | None:
    start = datetime.combine(work_date, time.min, TASHKENT).astimezone(UTC)
    end = datetime.combine(work_date, time.max, TASHKENT).astimezone(UTC)
    row = (
        (
            await connection.execute(
                select(absence_requests.c.kind)
                .where(
                    absence_requests.c.requester_user_id == user_id,
                    absence_requests.c.status.in_(("approved", "acknowledged")),
                    absence_requests.c.starts_at <= end,
                    absence_requests.c.ends_at >= start,
                )
                .order_by(absence_requests.c.starts_at)
                .limit(1)
            )
        )
        .mappings()
        .first()
    )
    return row["kind"] if row is not None else None


async def _upsert_day(
    connection: AsyncConnection,
    user_id: UUID,
    work_date: date,
    *,
    arrived_at: datetime | None = None,
    started_at: datetime | None = None,
    ended_at: datetime | None = None,
) -> AttendanceDayResponse:
    schedule = await _schedule_for(connection, user_id, work_date)
    absence_kind = await _absence_for(connection, user_id, work_date)
    existing = (
        (
            await connection.execute(
                select(attendance_days)
                .where(
                    attendance_days.c.user_id == user_id, attendance_days.c.work_date == work_date
                )
                .with_for_update()
            )
        )
        .mappings()
        .first()
    )
    now = datetime.now(UTC)
    scheduled_start = _scheduled_datetime(work_date, schedule[0]) if schedule else None
    scheduled_end = _scheduled_datetime(work_date, schedule[1]) if schedule else None
    previous_arrival = existing["arrived_at"] if existing else None
    candidates = [value for value in (previous_arrival, arrived_at) if isinstance(value, datetime)]
    actual_arrival: datetime | None = min(candidates) if candidates else None
    actual_start = started_at or (existing["started_at"] if existing else None)
    actual_end = ended_at or (existing["ended_at"] if existing else None)
    values: dict[str, Any] = {
        "scheduled_starts_at": scheduled_start,
        "scheduled_ends_at": scheduled_end,
        "arrived_at": actual_arrival,
        "started_at": actual_start,
        "ended_at": actual_end,
        "absence_kind": absence_kind,
        "updated_at": now,
    }
    if absence_kind:
        values["status"] = "absence"
    elif values["ended_at"]:
        values["status"] = "completed"
    elif values["started_at"]:
        values["status"] = "working"
    elif actual_arrival is not None:
        values["status"] = (
            "late"
            if scheduled_start is not None and actual_arrival > scheduled_start
            else "arrived"
        )
    else:
        values["status"] = "scheduled" if schedule else "unscheduled"
    if existing is None:
        day_id = uuid4()
        await connection.execute(
            insert(attendance_days).values(
                id=day_id, user_id=user_id, work_date=work_date, created_at=now, **values
            )
        )
    else:
        day_id = existing["id"]
        await connection.execute(
            update(attendance_days).where(attendance_days.c.id == day_id).values(**values)
        )
    row = (
        (await connection.execute(select(attendance_days).where(attendance_days.c.id == day_id)))
        .mappings()
        .one()
    )
    return _day_response(row)


async def _notify(
    connection: AsyncConnection,
    user_id: UUID,
    event_key: str,
    title: str,
    body: str,
    entity_id: UUID | None = None,
    requires_action: bool = False,
) -> None:
    await connection.execute(
        pg_insert(workspace_notifications)
        .values(
            id=uuid4(),
            user_id=user_id,
            event_key=event_key,
            kind="attendance",
            priority="attention" if requires_action else "normal",
            title=title,
            body=body,
            section="attendance",
            entity_id=entity_id,
            requires_action=requires_action,
            is_reminder=False,
            occurred_at=datetime.now(UTC),
            read_at=None,
            resolved_at=None,
            desktop_delivered_at=None,
        )
        .on_conflict_do_nothing(
            index_elements=[workspace_notifications.c.user_id, workspace_notifications.c.event_key]
        )
    )


async def record_user_action(
    connection: AsyncConnection, current_user: AuthenticatedUser, payload: AttendanceActionRequest
) -> AttendanceDayResponse:
    occurred_at = payload.occurred_at or datetime.now(UTC)
    if occurred_at.tzinfo is None:
        raise AttendanceError(422, "Attendance time must include a timezone")
    work_date = _local_date(occurred_at)
    await connection.execute(
        insert(attendance_events).values(
            id=uuid4(),
            event_key=f"manual:{uuid4()}",
            user_id=current_user.id,
            source="manual",
            kind=payload.action,
            occurred_at=occurred_at,
            created_at=datetime.now(UTC),
        )
    )
    await _audit(
        connection,
        current_user.id,
        "attendance.manual_action",
        current_user.id,
        {"action": payload.action, "occurred_at": occurred_at.isoformat()},
    )
    return await _upsert_day(
        connection,
        current_user.id,
        work_date,
        arrived_at=occurred_at if payload.action == "start" else None,
        started_at=occurred_at if payload.action == "start" else None,
        ended_at=occurred_at if payload.action == "end" else None,
    )


async def record_smartoffice_arrival(
    connection: AsyncConnection, payload: SmartOfficeAttendanceEventRequest
) -> SmartOfficeAttendanceEventResponse:
    if payload.occurred_at.tzinfo is None:
        raise AttendanceError(422, "Attendance time must include a timezone")
    employee = (
        (
            await connection.execute(
                select(users.c.id, users.c.full_name, users.c.date_of_birth).where(
                    users.c.smartoffice_staff_key == payload.staff_key, users.c.status == "active"
                )
            )
        )
        .mappings()
        .first()
    )
    if employee is None:
        raise AttendanceError(404, "Smart Office staff key is not linked to an active employee")
    exists = await connection.scalar(
        select(attendance_events.c.id).where(attendance_events.c.event_key == str(payload.event_id))
    )
    recent = await connection.scalar(
        select(attendance_events.c.id).where(
            attendance_events.c.user_id == employee["id"],
            attendance_events.c.source == "smartoffice",
            attendance_events.c.kind == "arrival",
            attendance_events.c.occurred_at >= payload.occurred_at - timedelta(seconds=90),
            attendance_events.c.occurred_at <= payload.occurred_at + timedelta(seconds=90),
        )
    )
    birthday_created = False
    if exists is None and recent is None:
        now = datetime.now(UTC)
        await connection.execute(
            insert(attendance_events).values(
                id=uuid4(),
                event_key=str(payload.event_id),
                user_id=employee["id"],
                source="smartoffice",
                kind="arrival",
                occurred_at=payload.occurred_at,
                created_at=now,
            )
        )
        await _upsert_day(
            connection,
            employee["id"],
            _local_date(payload.occurred_at),
            arrived_at=payload.occurred_at,
        )
        birthday = employee["date_of_birth"]
        work_date = _local_date(payload.occurred_at)
        if birthday is not None and (birthday.month, birthday.day) == (
            work_date.month,
            work_date.day,
        ):
            post_id = uuid4()
            result = await connection.execute(
                pg_insert(attendance_birthday_events)
                .values(
                    id=uuid4(),
                    user_id=employee["id"],
                    work_date=work_date,
                    feed_post_id=post_id,
                    created_at=now,
                )
                .on_conflict_do_nothing(
                    index_elements=[
                        attendance_birthday_events.c.user_id,
                        attendance_birthday_events.c.work_date,
                    ]
                )
            )
            if result.rowcount:
                await connection.execute(
                    insert(feed_posts).values(
                        id=post_id,
                        author_user_id=employee["id"],
                        system_author_label="Yuksalish",
                        title=f"С днём рождения, {employee['full_name']}!",  # noqa: RUF001
                        body="Пусть этот год принесёт вдохновение, здоровье и новые достижения.",
                        is_pinned=False,
                        created_at=now,
                        updated_at=now,
                    )
                )
                await _notify(
                    connection,
                    employee["id"],
                    f"birthday:{employee['id']}:{work_date}",
                    "С днём рождения!",  # noqa: RUF001
                    "Yuksalish поздравляет вас с днём рождения.",  # noqa: RUF001
                    post_id,
                )
                birthday_created = True
    return SmartOfficeAttendanceEventResponse(
        accepted=True, user_id=str(employee["id"]), birthday_greeting_created=birthday_created
    )


async def create_correction(
    connection: AsyncConnection,
    current_user: AuthenticatedUser,
    payload: AttendanceCorrectionCreateRequest,
) -> AttendanceCorrectionResponse:
    manager = await connection.scalar(
        select(users.c.direct_manager_user_id).where(users.c.id == current_user.id)
    )
    if manager is None:
        raise AttendanceError(422, "Администратор ещё не назначил непосредственного руководителя")
    now = datetime.now(UTC)
    correction_id = uuid4()
    values = {
        "id": correction_id,
        "user_id": current_user.id,
        "direct_manager_user_id": manager,
        "event_kind": payload.event_kind,
        "requested_at": payload.requested_at,
        "reason": payload.reason,
        "status": "pending",
        "comment": None,
        "created_at": now,
        "updated_at": now,
    }
    await connection.execute(insert(attendance_corrections).values(**values))
    await connection.execute(
        insert(attendance_correction_actions).values(
            id=uuid4(),
            correction_id=correction_id,
            actor_user_id=current_user.id,
            action="created",
            comment=None,
            created_at=now,
        )
    )
    await _audit(
        connection,
        current_user.id,
        "attendance.correction_created",
        correction_id,
        {"event_kind": payload.event_kind, "requested_at": payload.requested_at.isoformat()},
    )
    await _notify(
        connection,
        manager,
        f"attendance:{correction_id}:submitted",
        "Исправление посещаемости",
        f"{current_user.full_name} просит исправить отметку",
        correction_id,
        True,
    )
    return _correction_response(values)


async def act_on_correction(
    connection: AsyncConnection,
    current_user: AuthenticatedUser,
    correction_id: UUID,
    payload: AttendanceCorrectionActionRequest,
) -> AttendanceCorrectionResponse:
    row = (
        (
            await connection.execute(
                select(attendance_corrections)
                .where(attendance_corrections.c.id == correction_id)
                .with_for_update()
            )
        )
        .mappings()
        .first()
    )
    if row is None:
        raise AttendanceError(404, "Заявка на исправление не найдена")
    owner = row["user_id"] == current_user.id
    manager = row["direct_manager_user_id"] == current_user.id
    if payload.action == "cancel" and owner and row["status"] == "pending":
        target = "cancelled"
    elif payload.action in {"approve", "reject"} and manager and row["status"] == "pending":
        if payload.action == "reject" and not payload.comment.strip():
            raise AttendanceError(422, "Укажите причину отказа")
        target = "approved" if payload.action == "approve" else "rejected"
    else:
        raise AttendanceError(409, "Это действие сейчас недоступно")
    now = datetime.now(UTC)
    await connection.execute(
        update(attendance_corrections)
        .where(attendance_corrections.c.id == correction_id)
        .values(status=target, comment=payload.comment.strip() or None, updated_at=now)
    )
    await connection.execute(
        insert(attendance_correction_actions).values(
            id=uuid4(),
            correction_id=correction_id,
            actor_user_id=current_user.id,
            action=payload.action,
            comment=payload.comment.strip() or None,
            created_at=now,
        )
    )
    await _audit(
        connection,
        current_user.id,
        f"attendance.correction_{payload.action}",
        correction_id,
        {"comment": payload.comment.strip() or None},
    )
    if target == "approved":
        await _upsert_day(
            connection,
            row["user_id"],
            _local_date(row["requested_at"]),
            arrived_at=row["requested_at"] if row["event_kind"] == "arrival" else None,
            started_at=row["requested_at"] if row["event_kind"] == "start" else None,
            ended_at=row["requested_at"] if row["event_kind"] == "end" else None,
        )
    recipient = row["direct_manager_user_id"] if owner else row["user_id"]
    await _notify(
        connection,
        recipient,
        f"attendance:{correction_id}:{payload.action}",
        "Статус исправления посещаемости",
        "Согласовано"
        if target == "approved"
        else "Отклонено"
        if target == "rejected"
        else "Отменено",
        correction_id,
    )
    return _correction_response(
        {**row, "status": target, "comment": payload.comment.strip() or None}
    )


async def save_profile(
    connection: AsyncConnection,
    actor: AuthenticatedUser,
    user_id: UUID,
    payload: AttendanceProfileUpdateRequest,
) -> AttendanceProfileResponse:
    if actor.role not in {"admin", "superadmin"}:
        raise AttendanceError(403, "Только администратор может менять интеграционный профиль")
    exists = await connection.scalar(select(users.c.id).where(users.c.id == user_id))
    if exists is None:
        raise AttendanceError(404, "Сотрудник не найден")
    try:
        async with connection.begin_nested():
            await connection.execute(
                update(users)
                .where(users.c.id == user_id)
                .values(
                    smartoffice_staff_key=payload.smartoffice_staff_key,
                    date_of_birth=payload.date_of_birth,
                    updated_at=datetime.now(UTC),
                )
            )
    except IntegrityError as error:
        raise AttendanceError(
            409, "Этот ключ Smart Office уже назначен другому сотруднику"
        ) from error
    await _audit(
        connection,
        actor.id,
        "attendance.profile_updated",
        user_id,
        {"smartoffice_staff_key_set": payload.smartoffice_staff_key is not None},
    )
    return AttendanceProfileResponse(
        user_id=str(user_id),
        smartoffice_staff_key=payload.smartoffice_staff_key,
        date_of_birth=payload.date_of_birth,
    )


async def create_schedule_period(
    connection: AsyncConnection, actor: AuthenticatedUser, payload: WorkSchedulePeriodWriteRequest
) -> WorkSchedulePeriodResponse:
    if actor.role not in {"admin", "superadmin"}:
        raise AttendanceError(403, "Только администратор может менять график")
    period_id = uuid4()
    now = datetime.now(UTC)
    values = {
        "id": period_id,
        **payload.model_dump(),
        "created_by_user_id": actor.id,
        "created_at": now,
        "updated_at": now,
    }
    await connection.execute(insert(work_schedule_periods).values(**values))
    await _audit(
        connection,
        actor.id,
        "attendance.schedule_period_created",
        period_id,
        {"user_id": str(payload.user_id), "starts_on": payload.starts_on.isoformat()},
    )
    return _period_response(values)


async def save_schedule_exception(
    connection: AsyncConnection,
    actor: AuthenticatedUser,
    payload: WorkScheduleExceptionWriteRequest,
) -> WorkScheduleExceptionResponse:
    if actor.role not in {"admin", "superadmin"}:
        raise AttendanceError(403, "Только администратор может менять график")
    now = datetime.now(UTC)
    values = {
        "id": uuid4(),
        **payload.model_dump(),
        "created_by_user_id": actor.id,
        "created_at": now,
    }
    await connection.execute(
        pg_insert(work_schedule_exceptions)
        .values(**values)
        .on_conflict_do_update(
            constraint="uq_attendance_exception_user_date",
            set_={
                "kind": payload.kind,
                "starts_at": payload.starts_at,
                "ends_at": payload.ends_at,
                "created_by_user_id": actor.id,
                "created_at": now,
            },
        )
    )
    row = (
        (
            await connection.execute(
                select(work_schedule_exceptions).where(
                    work_schedule_exceptions.c.user_id == payload.user_id,
                    work_schedule_exceptions.c.work_date == payload.work_date,
                )
            )
        )
        .mappings()
        .one()
    )
    await _audit(
        connection,
        actor.id,
        "attendance.schedule_exception_saved",
        row["id"],
        {"user_id": str(payload.user_id), "work_date": payload.work_date.isoformat()},
    )
    return _exception_response(row)


async def load_attendance(
    connection: AsyncConnection, current_user: AuthenticatedUser, allow_admin: bool
) -> tuple[
    list[AttendanceDayResponse],
    list[WorkSchedulePeriodResponse],
    list[WorkScheduleExceptionResponse],
    list[AttendanceCorrectionResponse],
    list[AttendanceProfileResponse],
]:
    visible_ids = {current_user.id}
    if allow_admin and current_user.role in {"admin", "superadmin"}:
        rows = (
            await connection.execute(select(users.c.id).where(users.c.status == "active"))
        ).all()
        visible_ids = {row.id for row in rows}
    else:
        rows = (
            await connection.execute(
                select(users.c.id).where(users.c.direct_manager_user_id == current_user.id)
            )
        ).all()
        visible_ids.update(row.id for row in rows)
    days = (
        (
            await connection.execute(
                select(attendance_days)
                .where(attendance_days.c.user_id.in_(visible_ids))
                .order_by(attendance_days.c.work_date.desc())
                .limit(300)
            )
        )
        .mappings()
        .all()
    )
    periods = (
        (
            await connection.execute(
                select(work_schedule_periods)
                .where(work_schedule_periods.c.user_id.in_(visible_ids))
                .order_by(work_schedule_periods.c.starts_on.desc())
            )
        )
        .mappings()
        .all()
    )
    exceptions = (
        (
            await connection.execute(
                select(work_schedule_exceptions)
                .where(work_schedule_exceptions.c.user_id.in_(visible_ids))
                .order_by(work_schedule_exceptions.c.work_date.desc())
            )
        )
        .mappings()
        .all()
    )
    corrections = (
        (
            await connection.execute(
                select(attendance_corrections)
                .where(
                    (attendance_corrections.c.user_id.in_(visible_ids))
                    | (attendance_corrections.c.direct_manager_user_id == current_user.id)
                )
                .order_by(attendance_corrections.c.created_at.desc())
            )
        )
        .mappings()
        .all()
    )
    profile_ids = (
        visible_ids
        if allow_admin and current_user.role in {"admin", "superadmin"}
        else {current_user.id}
    )
    profiles = (
        (
            await connection.execute(
                select(users.c.id, users.c.smartoffice_staff_key, users.c.date_of_birth).where(
                    users.c.id.in_(profile_ids)
                )
            )
        )
        .mappings()
        .all()
    )
    return (
        [_day_response(row) for row in days],
        [_period_response(row) for row in periods],
        [_exception_response(row) for row in exceptions],
        [_correction_response(row) for row in corrections],
        [
            AttendanceProfileResponse(
                user_id=str(row["id"]),
                smartoffice_staff_key=row["smartoffice_staff_key"],
                date_of_birth=row["date_of_birth"],
            )
            for row in profiles
        ],
    )


async def smartoffice_snapshot(
    connection: AsyncConnection, work_date: date
) -> SmartOfficeSnapshotResponse:
    rows = (
        (
            await connection.execute(
                select(
                    users.c.id, users.c.smartoffice_staff_key, users.c.date_of_birth, users.c.status
                ).where(users.c.smartoffice_staff_key.is_not(None))
            )
        )
        .mappings()
        .all()
    )
    employees: list[SmartOfficeSnapshotEmployeeResponse] = []
    for row in rows:
        schedule = await _schedule_for(connection, row["id"], work_date)
        exception = (
            (
                await connection.execute(
                    select(work_schedule_exceptions).where(
                        work_schedule_exceptions.c.user_id == row["id"],
                        work_schedule_exceptions.c.work_date == work_date,
                    )
                )
            )
            .mappings()
            .first()
        )
        schedule_data: WorkScheduleExceptionResponse | WorkSchedulePeriodResponse | None = (
            _exception_response(exception) if exception else None
        )
        if schedule_data is None and schedule:
            schedule_data = WorkSchedulePeriodResponse(
                id="effective",
                user_id=str(row["id"]),
                starts_on=work_date,
                ends_on=work_date,
                weekdays=[work_date.weekday()],
                starts_at=schedule[0],
                ends_at=schedule[1],
            )
        birthday = row["date_of_birth"]
        employees.append(
            SmartOfficeSnapshotEmployeeResponse(
                staff_key=row["smartoffice_staff_key"],
                user_id=str(row["id"]),
                active=row["status"] == "active",
                birthday_today=birthday is not None
                and (birthday.month, birthday.day) == (work_date.month, work_date.day),
                schedule=schedule_data,
                absence_kind=await _absence_for(connection, row["id"], work_date),
            )
        )
    return SmartOfficeSnapshotResponse(
        generated_at=datetime.now(UTC), work_date=work_date, employees=employees
    )
