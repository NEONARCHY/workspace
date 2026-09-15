from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any, Literal
from uuid import UUID, uuid4

from sqlalchemy import and_, insert, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.engine import RowMapping
from sqlalchemy.ext.asyncio import AsyncConnection

from .auth import AuthenticatedUser
from .tables import (
    absence_request_actions,
    absence_requests,
    attachments,
    trip_request_employees,
    trip_requests,
    users,
    workspace_notifications,
)
from .workspace_schemas import (
    AbsenceAction,
    AbsenceActionHistoryResponse,
    AbsenceActionRequest,
    AbsenceRequestResponse,
    AbsenceWriteRequest,
    PresenceSummaryItemResponse,
)


class AbsenceError(ValueError):
    def __init__(self, status_code: int, detail: str) -> None:
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


_APPROVAL_KINDS = {"vacation", "personal_time", "business_event"}
_STATUS_LABELS = {
    "draft": "Черновик",
    "pending": "Ожидает решения",
    "approved": "Согласовано",
    "acknowledged": "Подтверждено руководителем",
    "rejected": "Отклонено",
    "cancelled": "Отменено",
}


def _business_days_after(value: datetime, now: datetime) -> int:
    cursor = value.astimezone(UTC).date() + timedelta(days=1)
    today = now.astimezone(UTC).date()
    result = 0
    while cursor <= today:
        if cursor.weekday() < 5:
            result += 1
        cursor += timedelta(days=1)
    return result


async def _actions(
    connection: AsyncConnection, request_id: UUID
) -> list[AbsenceActionHistoryResponse]:
    rows = (
        (
            await connection.execute(
                select(absence_request_actions)
                .where(absence_request_actions.c.request_id == request_id)
                .order_by(absence_request_actions.c.created_at)
            )
        )
        .mappings()
        .all()
    )
    return [
        AbsenceActionHistoryResponse(
            id=str(row["id"]),
            actor_user_id=str(row["actor_user_id"]),
            action=row["action"],
            comment=row["comment"],
            created_at=row["created_at"],
        )
        for row in rows
    ]


async def _document_status(
    connection: AsyncConnection, data: RowMapping | dict[str, Any], now: datetime
) -> Literal["not_required", "required", "uploaded", "overdue"]:
    if data["kind"] != "sick_leave":
        return "not_required"
    uploaded = await connection.scalar(
        select(attachments.c.id)
        .where(attachments.c.owner_type == "absence", attachments.c.owner_id == data["id"])
        .limit(1)
    )
    if uploaded is not None:
        return "uploaded"
    if now >= data["ends_at"] and _business_days_after(data["ends_at"], now) >= 3:
        return "overdue"
    return "required"


async def _response(
    connection: AsyncConnection,
    current_user: AuthenticatedUser,
    data: RowMapping | dict[str, Any],
) -> AbsenceRequestResponse:
    is_owner = data["requester_user_id"] == current_user.id
    is_manager = data["direct_manager_user_id"] == current_user.id
    allowed: list[AbsenceAction] = []
    if is_owner and data["status"] == "draft":
        allowed.append("submit")
    if (
        is_owner
        and data["status"] in {"pending", "approved", "acknowledged"}
        and data["starts_at"] > datetime.now(UTC)
    ):
        allowed.append("cancel")
    if is_manager and data["status"] == "pending":
        allowed.extend(
            ["approve", "reject"] if data["kind"] in _APPROVAL_KINDS else ["acknowledge"]
        )
    return AbsenceRequestResponse(
        id=str(data["id"]),
        requester_user_id=str(data["requester_user_id"]),
        direct_manager_user_id=str(data["direct_manager_user_id"]),
        kind=data["kind"],
        reason=data["reason"],
        starts_at=data["starts_at"],
        ends_at=data["ends_at"],
        status=data["status"],
        status_label=_STATUS_LABELS[data["status"]],
        document_status=await _document_status(connection, data, datetime.now(UTC)),
        can_edit=is_owner and data["status"] in {"draft", "pending"},
        allowed_actions=allowed,
        actions=await _actions(connection, data["id"]),
        created_at=data["created_at"],
        updated_at=data["updated_at"],
    )


async def _notify(
    connection: AsyncConnection,
    user_id: UUID,
    event_key: str,
    title: str,
    body: str,
    request_id: UUID,
    action: bool,
) -> None:
    await connection.execute(
        pg_insert(workspace_notifications)
        .values(
            id=uuid4(),
            user_id=user_id,
            event_key=event_key,
            kind="absence",
            priority="attention" if action else "normal",
            title=title,
            body=body,
            section="absences",
            entity_id=request_id,
            requires_action=action,
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


async def _ensure_no_conflict(
    connection: AsyncConnection,
    user_id: UUID,
    starts_at: datetime,
    ends_at: datetime,
    excluded: UUID | None = None,
) -> None:
    condition = [
        absence_requests.c.requester_user_id == user_id,
        absence_requests.c.status.in_(("pending", "approved", "acknowledged")),
        absence_requests.c.starts_at < ends_at,
        absence_requests.c.ends_at > starts_at,
    ]
    if excluded is not None:
        condition.append(absence_requests.c.id != excluded)
    if (
        await connection.scalar(select(absence_requests.c.id).where(and_(*condition)).limit(1))
        is not None
    ):
        raise AbsenceError(409, "Имеется наложение периода другой заявки")
    trip_ids = select(trip_request_employees.c.request_id).where(
        trip_request_employees.c.user_id == user_id
    )
    trip = await connection.scalar(
        select(trip_requests.c.id)
        .where(
            trip_requests.c.id.in_(trip_ids),
            trip_requests.c.status == "approved",
            trip_requests.c.start_date < ends_at.date(),
            trip_requests.c.end_date >= starts_at.date(),
        )
        .limit(1)
    )
    if trip is not None:
        raise AbsenceError(409, "Имеется наложение периода утверждённой командировки")


async def create_absence(
    connection: AsyncConnection, current_user: AuthenticatedUser, payload: AbsenceWriteRequest
) -> AbsenceRequestResponse:
    employee = (
        (
            await connection.execute(
                select(users.c.direct_manager_user_id, users.c.status).where(
                    users.c.id == current_user.id
                )
            )
        )
        .mappings()
        .first()
    )
    if employee is None or employee["status"] != "active":
        raise AbsenceError(403, "Недоступно для неактивного сотрудника")
    if employee["direct_manager_user_id"] is None:
        raise AbsenceError(422, "Администратор ещё не назначил непосредственного руководителя")
    await _ensure_no_conflict(connection, current_user.id, payload.starts_at, payload.ends_at)
    now = datetime.now(UTC)
    request_id = uuid4()
    values = {
        "id": request_id,
        "requester_user_id": current_user.id,
        "direct_manager_user_id": employee["direct_manager_user_id"],
        "kind": payload.kind,
        "reason": payload.reason,
        "starts_at": payload.starts_at,
        "ends_at": payload.ends_at,
        "status": "pending",
        "created_at": now,
        "updated_at": now,
    }
    await connection.execute(insert(absence_requests).values(**values))
    await connection.execute(
        insert(absence_request_actions).values(
            id=uuid4(),
            request_id=request_id,
            actor_user_id=current_user.id,
            action="created",
            comment=None,
            created_at=now,
        )
    )
    await _notify(
        connection,
        employee["direct_manager_user_id"],
        f"absence:{request_id}:submitted",
        "Новое отсутствие",
        f"{current_user.full_name}: {payload.reason}",
        request_id,
        True,
    )
    return await _response(connection, current_user, values)


async def update_absence(
    connection: AsyncConnection,
    current_user: AuthenticatedUser,
    request_id: UUID,
    payload: AbsenceWriteRequest,
) -> AbsenceRequestResponse:
    row = (
        (
            await connection.execute(
                select(absence_requests)
                .where(absence_requests.c.id == request_id)
                .with_for_update()
            )
        )
        .mappings()
        .first()
    )
    if (
        row is None
        or row["requester_user_id"] != current_user.id
        or row["status"] not in {"draft", "pending"}
    ):
        raise AbsenceError(404, "Заявка отсутствия недоступна для изменения")
    await _ensure_no_conflict(
        connection, current_user.id, payload.starts_at, payload.ends_at, request_id
    )
    now = datetime.now(UTC)
    await connection.execute(
        update(absence_requests)
        .where(absence_requests.c.id == request_id)
        .values(
            kind=payload.kind,
            reason=payload.reason,
            starts_at=payload.starts_at,
            ends_at=payload.ends_at,
            updated_at=now,
        )
    )
    updated = {
        **row,
        "kind": payload.kind,
        "reason": payload.reason,
        "starts_at": payload.starts_at,
        "ends_at": payload.ends_at,
        "updated_at": now,
    }
    return await _response(connection, current_user, updated)


async def act_on_absence(
    connection: AsyncConnection,
    current_user: AuthenticatedUser,
    request_id: UUID,
    payload: AbsenceActionRequest,
) -> AbsenceRequestResponse:
    row = (
        (
            await connection.execute(
                select(absence_requests)
                .where(absence_requests.c.id == request_id)
                .with_for_update()
            )
        )
        .mappings()
        .first()
    )
    if row is None:
        raise AbsenceError(404, "Заявка отсутствия не найдена")
    owner, manager = (
        row["requester_user_id"] == current_user.id,
        row["direct_manager_user_id"] == current_user.id,
    )
    target: str | None = None
    if (
        payload.action == "cancel"
        and owner
        and row["status"] in {"pending", "approved", "acknowledged"}
        and row["starts_at"] > datetime.now(UTC)
    ):
        target = "cancelled"
    elif (
        manager
        and row["status"] == "pending"
        and row["kind"] in _APPROVAL_KINDS
        and payload.action == "approve"
    ):
        target = "approved"
    elif (
        manager
        and row["status"] == "pending"
        and row["kind"] in _APPROVAL_KINDS
        and payload.action == "reject"
    ):
        if not payload.comment.strip():
            raise AbsenceError(422, "Укажите причину отказа")
        target = "rejected"
    elif (
        manager
        and row["status"] == "pending"
        and row["kind"] not in _APPROVAL_KINDS
        and payload.action == "acknowledge"
    ):
        target = "acknowledged"
    if target is None:
        raise AbsenceError(409, "Это действие сейчас недоступно")
    now = datetime.now(UTC)
    await connection.execute(
        update(absence_requests)
        .where(absence_requests.c.id == request_id)
        .values(status=target, updated_at=now)
    )
    await connection.execute(
        insert(absence_request_actions).values(
            id=uuid4(),
            request_id=request_id,
            actor_user_id=current_user.id,
            action=payload.action,
            comment=payload.comment.strip() or None,
            created_at=now,
        )
    )
    recipient = row["direct_manager_user_id"] if owner else row["requester_user_id"]
    await _notify(
        connection,
        recipient,
        f"absence:{request_id}:{payload.action}",
        "Статус отсутствия изменён",
        _STATUS_LABELS[target],
        request_id,
        target == "pending",
    )
    return await _response(connection, current_user, {**row, "status": target, "updated_at": now})


async def visible_absences(
    connection: AsyncConnection, current_user: AuthenticatedUser, allow_admin: bool
) -> list[AbsenceRequestResponse]:
    statement = select(absence_requests).order_by(absence_requests.c.updated_at.desc())
    if not allow_admin or current_user.role not in {"admin", "superadmin"}:
        statement = statement.where(
            (absence_requests.c.requester_user_id == current_user.id)
            | (absence_requests.c.direct_manager_user_id == current_user.id)
        )
    rows = (await connection.execute(statement)).mappings().all()
    return [await _response(connection, current_user, row) for row in rows]


async def presence_summary(
    connection: AsyncConnection, allow_admin: bool
) -> list[PresenceSummaryItemResponse]:
    if not allow_admin:
        return []
    now = datetime.now(UTC)
    people = (
        (await connection.execute(select(users.c.id).where(users.c.status == "active")))
        .mappings()
        .all()
    )
    active = (
        (
            await connection.execute(
                select(absence_requests).where(
                    absence_requests.c.status.in_(("approved", "acknowledged")),
                    absence_requests.c.starts_at <= now,
                    absence_requests.c.ends_at > now,
                )
            )
        )
        .mappings()
        .all()
    )
    by_user = {row["requester_user_id"]: row for row in active}
    return [
        PresenceSummaryItemResponse(
            user_id=str(person["id"]),
            status=(by_user[person["id"]]["kind"] if person["id"] in by_user else "working"),
            starts_at=(by_user[person["id"]]["starts_at"] if person["id"] in by_user else None),
            ends_at=(by_user[person["id"]]["ends_at"] if person["id"] in by_user else None),
        )
        for person in people
    ]


async def materialize_sick_document_notifications(connection: AsyncConnection) -> int:
    now = datetime.now(UTC)
    rows = (
        (
            await connection.execute(
                select(absence_requests).where(
                    absence_requests.c.kind == "sick_leave",
                    absence_requests.c.status.in_(("approved", "acknowledged")),
                    absence_requests.c.ends_at <= now,
                )
            )
        )
        .mappings()
        .all()
    )
    admins = (
        (
            await connection.execute(
                select(users.c.id).where(
                    users.c.status == "active", users.c.role.in_(("admin", "superadmin"))
                )
            )
        )
        .mappings()
        .all()
    )
    created = 0
    for row in rows:
        if await _document_status(connection, row, now) != "overdue":
            continue
        event_key = f"absence:{row['id']}:document-overdue"
        await _notify(
            connection,
            row["requester_user_id"],
            event_key,
            "Нужно прикрепить больничное заключение",
            "Срок загрузки документа истёк.",
            row["id"],
            True,
        )
        for admin in admins:
            await _notify(
                connection,
                admin["id"],
                event_key,
                "Просрочен документ по больничному",
                "Сотрудник ещё не прикрепил заключение.",
                row["id"],
                False,
            )
        created += 1
    return created
