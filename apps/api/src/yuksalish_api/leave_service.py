"""Separate leave workflow: employee, appointed HR reviewer, first deputy."""

# Human-facing Russian messages intentionally contain Cyrillic glyphs.
# ruff: noqa: RUF001

from __future__ import annotations

import hashlib
from datetime import UTC, date, datetime, time, timedelta
from typing import Any, cast
from uuid import UUID, uuid4
from zoneinfo import ZoneInfo

from sqlalchemy import and_, func, insert, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.engine import RowMapping
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncConnection
from starlette.concurrency import run_in_threadpool

from .auth import AuthenticatedUser
from .hr_hiring_pdf import validate_signature
from .hr_hiring_tables import hiring_signatures
from .leave_pdf import application_pdf, order_pdf
from .object_storage import ObjectStorage
from .tables import (
    absence_requests,
    hr_settings,
    leave_request_actions,
    leave_requests,
    positions,
    trip_request_employees,
    trip_requests,
    users,
    workspace_notifications,
)
from .workspace_schemas import (
    LeaveActionHistoryResponse,
    LeaveContextResponse,
    LeaveDecision,
    LeaveDeputyDecisionRequest,
    LeaveHrDecisionRequest,
    LeaveRequestResponse,
    LeaveStatus,
    LeaveWriteRequest,
)

_LOCAL = ZoneInfo("Asia/Tashkent")
_ACTIVE = {"pending_hr", "pending_deputy", "approved"}
_LABELS = {
    "pending_hr": "На проверке кадровой службы",
    "pending_deputy": "На утверждении первого заместителя",
    "needs_revision": "Нужно дополнить заявление",
    "approved": "Утверждено",
    "rejected": "Отклонено",
    "withdrawn": "Отозвано",
}


class LeaveError(ValueError):
    def __init__(self, status_code: int, detail: str) -> None:
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


async def _reviewers(connection: AsyncConnection) -> tuple[UUID, UUID]:
    hr_id = await connection.scalar(select(hr_settings.c.hr_user_id).where(hr_settings.c.id == 1))
    if hr_id is None:
        raise LeaveError(409, "Назначьте кадровика в настройках HR")
    active_hr = await connection.scalar(
        select(users.c.id).where(
            users.c.id == hr_id,
            users.c.status == "active",
        )
    )
    if active_hr is None:
        raise LeaveError(409, "Назначенный кадровик неактивен")
    deputy_ids = (
        (
            await connection.execute(
                select(users.c.id)
                .join(positions, users.c.position_id == positions.c.id)
                .where(
                    users.c.status == "active",
                    positions.c.is_active.is_(True),
                    positions.c.name.ilike("Rais birinchi%"),
                )
                .limit(2)
            )
        )
        .scalars()
        .all()
    )
    if len(deputy_ids) != 1 or deputy_ids[0] == hr_id:
        raise LeaveError(409, "Назначьте одного действующего первого заместителя")
    return cast(UUID, hr_id), cast(UUID, deputy_ids[0])


async def _history(
    connection: AsyncConnection,
    request_id: UUID,
) -> list[LeaveActionHistoryResponse]:
    rows = (
        (
            await connection.execute(
                select(leave_request_actions)
                .where(leave_request_actions.c.request_id == request_id)
                .order_by(leave_request_actions.c.created_at, leave_request_actions.c.id)
            )
        )
        .mappings()
        .all()
    )
    return [
        LeaveActionHistoryResponse(
            id=str(row["id"]),
            actor_user_id=str(row["actor_user_id"]),
            from_status=row["from_status"],
            to_status=row["to_status"],
            action=row["action"],
            comment=row["comment"],
            created_at=row["created_at"],
        )
        for row in rows
    ]


async def _response(
    connection: AsyncConnection,
    user: AuthenticatedUser,
    row: RowMapping | dict[str, Any],
    hr_id: UUID,
    deputy_id: UUID,
) -> LeaveRequestResponse:
    status = cast(LeaveStatus, str(row["status"]))
    owner = row["requester_user_id"] == user.id
    return LeaveRequestResponse(
        id=str(row["id"]),
        requester_user_id=str(row["requester_user_id"]),
        application_text=row["application_text"],
        requested_starts_on=row["requested_starts_on"],
        requested_ends_on=row["requested_ends_on"],
        starts_on=row["starts_on"],
        ends_on=row["ends_on"],
        work_year_starts_on=row["work_year_starts_on"],
        work_year_ends_on=row["work_year_ends_on"],
        calendar_days=row["calendar_days"],
        paid_days=row["paid_days"],
        return_on=row["return_on"],
        accounting_officer=row["accounting_officer"],
        order_employee_name=row["order_employee_name"],
        order_job_title=row["order_job_title"],
        order_signer_name=row["order_signer_name"],
        status=status,
        status_label=_LABELS[status],
        order_number=row["order_number"],
        order_year=row["order_year"],
        signed_by_user_id=(str(row["signed_by_user_id"]) if row["signed_by_user_id"] else None),
        approved_at=row["approved_at"],
        can_revise=owner and status in {"pending_hr", "needs_revision"},
        can_review_hr=user.id == hr_id and status == "pending_hr",
        can_review_deputy=user.id == deputy_id and status == "pending_deputy",
        can_withdraw=owner and status in {"pending_hr", "pending_deputy", "needs_revision"},
        has_order=status == "approved" and bool(row["order_key"]),
        actions=await _history(connection, row["id"]),
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


async def _notify(
    connection: AsyncConnection,
    user_id: UUID,
    request_id: UUID,
    event_id: UUID,
    title: str,
    body: str,
    *,
    action: bool,
) -> None:
    await connection.execute(
        pg_insert(workspace_notifications)
        .values(
            id=uuid4(),
            user_id=user_id,
            event_key=f"leave:{request_id}:{event_id}:{user_id}",
            kind="absence",
            priority="attention" if action else "normal",
            title=title,
            body=body,
            section="leave_approvals",
            entity_id=request_id,
            requires_action=action,
            is_reminder=False,
            occurred_at=datetime.now(UTC),
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


async def _resolve_action_notifications(connection: AsyncConnection, request_id: UUID) -> None:
    await connection.execute(
        update(workspace_notifications)
        .where(
            workspace_notifications.c.section == "leave_approvals",
            workspace_notifications.c.entity_id == request_id,
            workspace_notifications.c.requires_action.is_(True),
            workspace_notifications.c.resolved_at.is_(None),
        )
        .values(resolved_at=datetime.now(UTC))
    )


async def _audit(
    connection: AsyncConnection,
    row: RowMapping | dict[str, Any],
    actor_id: UUID,
    target: LeaveStatus,
    action: str,
    comment: str | None,
) -> UUID:
    event_id = uuid4()
    await connection.execute(
        insert(leave_request_actions).values(
            id=event_id,
            request_id=row["id"],
            actor_user_id=actor_id,
            from_status=row["status"],
            to_status=target,
            action=action,
            comment=comment,
            created_at=datetime.now(UTC),
        )
    )
    return event_id


async def _ensure_period(
    connection: AsyncConnection,
    user_id: UUID,
    starts_on: date,
    ends_on: date,
    *,
    excluded: UUID | None = None,
) -> None:
    if ends_on < starts_on:
        raise LeaveError(422, "Конец отпуска не может быть раньше начала")
    filters = [
        leave_requests.c.requester_user_id == user_id,
        leave_requests.c.status.in_(_ACTIVE),
        func.coalesce(leave_requests.c.starts_on, leave_requests.c.requested_starts_on) <= ends_on,
        func.coalesce(
            leave_requests.c.ends_on,
            leave_requests.c.requested_ends_on,
            leave_requests.c.requested_starts_on,
        )
        >= starts_on,
    ]
    if excluded is not None:
        filters.append(leave_requests.c.id != excluded)
    if await connection.scalar(select(leave_requests.c.id).where(and_(*filters)).limit(1)):
        raise LeaveError(409, "Период пересекается с другой заявкой на отпуск")
    start_at = datetime.combine(starts_on, time.min, _LOCAL).astimezone(UTC)
    end_at = datetime.combine(ends_on + timedelta(days=1), time.min, _LOCAL).astimezone(UTC)
    if await connection.scalar(
        select(absence_requests.c.id)
        .where(
            absence_requests.c.requester_user_id == user_id,
            absence_requests.c.status.in_(("pending", "approved", "acknowledged")),
            absence_requests.c.starts_at < end_at,
            absence_requests.c.ends_at > start_at,
        )
        .limit(1)
    ):
        raise LeaveError(409, "Период пересекается с другой заявкой об отсутствии")
    trip_ids = select(trip_request_employees.c.request_id).where(
        trip_request_employees.c.user_id == user_id
    )
    if await connection.scalar(
        select(trip_requests.c.id)
        .where(
            trip_requests.c.id.in_(trip_ids),
            trip_requests.c.status == "approved",
            trip_requests.c.start_date <= ends_on,
            trip_requests.c.end_date >= starts_on,
        )
        .limit(1)
    ):
        raise LeaveError(409, "Период пересекается с утверждённой поездкой")


async def _row(
    connection: AsyncConnection,
    request_id: UUID,
    *,
    lock: bool = False,
) -> RowMapping:
    query = select(leave_requests).where(leave_requests.c.id == request_id)
    if lock:
        query = query.with_for_update()
    row = (await connection.execute(query)).mappings().first()
    if row is None:
        raise LeaveError(404, "Заявка на отпуск не найдена")
    return row


async def _verified(storage: ObjectStorage, key: str | None, digest: str | None) -> bytes:
    if not key or not digest:
        raise LeaveError(409, "Документ ещё не подготовлен")
    content = await storage.get(key)
    if hashlib.sha256(content).hexdigest() != digest:
        raise LeaveError(503, "Сохранённый документ повреждён")
    return content


async def _application(
    connection: AsyncConnection,
    storage: ObjectStorage,
    request_id: UUID,
    requester_id: UUID,
    deputy_id: UUID,
    text: str,
    starts_on: date,
    ends_on: date | None,
    submitted_at: datetime,
) -> tuple[str, str]:
    people = (
        (
            await connection.execute(
                select(
                    users.c.id,
                    users.c.full_name,
                    users.c.job_title,
                ).where(users.c.id.in_([requester_id, deputy_id]))
            )
        )
        .mappings()
        .all()
    )
    directory = {person["id"]: person for person in people}
    requester = directory.get(requester_id)
    deputy = directory.get(deputy_id)
    if requester is None or deputy is None:
        raise LeaveError(409, "Сотрудник или первый заместитель не найден")
    content = await run_in_threadpool(
        application_pdf,
        employee_name=requester["full_name"],
        employee_job_title=requester["job_title"] or "ходим",
        deputy_name=deputy["full_name"],
        application_text=text,
        requested_start=starts_on,
        requested_end=ends_on,
        submitted_at=submitted_at.astimezone(_LOCAL),
    )
    key = f"leave-requests/{request_id}/applications/{uuid4()}.pdf"
    await storage.put(key, content, "application/pdf")
    return key, hashlib.sha256(content).hexdigest()


async def visible_leaves(
    connection: AsyncConnection,
    user: AuthenticatedUser,
) -> list[LeaveRequestResponse]:
    hr_id, deputy_id = await _reviewers(connection)
    query = select(leave_requests).order_by(leave_requests.c.updated_at.desc())
    if user.role not in {"admin", "superadmin"} and user.id not in {hr_id, deputy_id}:
        query = query.where(leave_requests.c.requester_user_id == user.id)
    rows = (await connection.execute(query)).mappings().all()
    return [await _response(connection, user, row, hr_id, deputy_id) for row in rows]


async def leave_context(
    connection: AsyncConnection,
    user: AuthenticatedUser,
) -> LeaveContextResponse:
    hr_id, deputy_id = await _reviewers(connection)
    ready = await connection.scalar(
        select(hiring_signatures.c.user_id).where(
            hiring_signatures.c.user_id == deputy_id,
        )
    )
    return LeaveContextResponse(
        hr_user_id=str(hr_id),
        deputy_user_id=str(deputy_id),
        can_configure_signature=user.id == deputy_id,
        signature_ready=ready is not None,
    )


async def save_deputy_signature(
    connection: AsyncConnection,
    user: AuthenticatedUser,
    storage: ObjectStorage,
    content: bytes,
) -> LeaveContextResponse:
    _, deputy_id = await _reviewers(connection)
    if user.id != deputy_id:
        raise LeaveError(403, "Подпись может настроить только первый заместитель")
    if len(content) > 1024 * 1024:
        raise LeaveError(413, "Изображение подписи должно быть не больше 1 МиБ")
    try:
        normalized = await run_in_threadpool(validate_signature, content)
    except ValueError as error:
        raise LeaveError(422, str(error)) from error
    key = f"hr-hiring/signatures/{user.id}/{uuid4()}.png"
    await storage.put(key, normalized, "image/png")
    now = datetime.now(UTC)
    await connection.execute(
        pg_insert(hiring_signatures)
        .values(
            user_id=user.id,
            storage_key=key,
            sha256=hashlib.sha256(normalized).hexdigest(),
            updated_at=now,
        )
        .on_conflict_do_update(
            index_elements=[hiring_signatures.c.user_id],
            set_={
                "storage_key": key,
                "sha256": hashlib.sha256(normalized).hexdigest(),
                "updated_at": now,
            },
        )
    )
    return await leave_context(connection, user)


async def create_leave(
    connection: AsyncConnection,
    user: AuthenticatedUser,
    storage: ObjectStorage,
    payload: LeaveWriteRequest,
) -> LeaveRequestResponse:
    hr_id, deputy_id = await _reviewers(connection)
    if not await connection.scalar(
        select(users.c.id).where(
            users.c.id == user.id,
            users.c.status == "active",
        )
    ):
        raise LeaveError(403, "Заявление доступно только действующему сотруднику")
    await _ensure_period(
        connection, user.id, payload.starts_on, payload.ends_on or payload.starts_on
    )
    now = datetime.now(UTC)
    request_id = uuid4()
    application_key, application_sha256 = await _application(
        connection,
        storage,
        request_id,
        user.id,
        deputy_id,
        payload.application_text,
        payload.starts_on,
        payload.ends_on,
        now,
    )
    row: dict[str, Any] = dict(
        id=request_id,
        requester_user_id=user.id,
        application_text=payload.application_text,
        application_key=application_key,
        application_sha256=application_sha256,
        requested_starts_on=payload.starts_on,
        requested_ends_on=payload.ends_on,
        starts_on=None,
        ends_on=None,
        work_year_starts_on=None,
        work_year_ends_on=None,
        calendar_days=None,
        paid_days=None,
        return_on=None,
        accounting_officer=None,
        order_employee_name=None,
        order_job_title=None,
        order_signer_name=None,
        status="pending_hr",
        order_number=None,
        order_year=None,
        order_key=None,
        order_sha256=None,
        signed_by_user_id=None,
        approved_at=None,
        created_at=now,
        updated_at=now,
    )
    await connection.execute(insert(leave_requests).values(**row))
    event_id = await _audit(
        connection, {**row, "status": None}, user.id, "pending_hr", "created", None
    )
    await _notify(
        connection,
        hr_id,
        row["id"],
        event_id,
        "Новое заявление на отпуск",
        "Проверьте заявление, даты и номер приказа",
        action=True,
    )
    return await _response(connection, user, row, hr_id, deputy_id)


async def revise_leave(
    connection: AsyncConnection,
    user: AuthenticatedUser,
    storage: ObjectStorage,
    request_id: UUID,
    payload: LeaveWriteRequest,
) -> LeaveRequestResponse:
    hr_id, deputy_id = await _reviewers(connection)
    row = await _row(connection, request_id, lock=True)
    if row["requester_user_id"] != user.id:
        raise LeaveError(403, "Изменить заявление может только его автор")
    if row["status"] not in {"pending_hr", "needs_revision"}:
        raise LeaveError(409, "Заявление уже находится на следующем этапе")
    await _ensure_period(
        connection,
        user.id,
        payload.starts_on,
        payload.ends_on or payload.starts_on,
        excluded=request_id,
    )
    now = datetime.now(UTC)
    application_key, application_sha256 = await _application(
        connection,
        storage,
        request_id,
        user.id,
        deputy_id,
        payload.application_text,
        payload.starts_on,
        payload.ends_on,
        now,
    )
    values = dict(
        application_text=payload.application_text,
        application_key=application_key,
        application_sha256=application_sha256,
        requested_starts_on=payload.starts_on,
        requested_ends_on=payload.ends_on,
        starts_on=None,
        ends_on=None,
        work_year_starts_on=None,
        work_year_ends_on=None,
        calendar_days=None,
        paid_days=None,
        return_on=None,
        accounting_officer=None,
        order_employee_name=None,
        order_job_title=None,
        order_signer_name=None,
        status="pending_hr",
        order_number=None,
        order_year=None,
        updated_at=now,
    )
    await connection.execute(
        update(leave_requests)
        .where(
            leave_requests.c.id == request_id,
        )
        .values(**values)
    )
    await _resolve_action_notifications(connection, request_id)
    event_id = await _audit(connection, row, user.id, "pending_hr", "revised", None)
    await _notify(
        connection,
        hr_id,
        request_id,
        event_id,
        "Заявление на отпуск дополнено",
        "Проверьте обновлённое заявление",
        action=True,
    )
    return await _response(connection, user, {**row, **values}, hr_id, deputy_id)


def _require_comment(action: LeaveDecision, comment: str) -> str | None:
    cleaned = comment.strip()
    if action in {"return", "reject"} and not cleaned:
        raise LeaveError(422, "Укажите причину возврата или отказа")
    return cleaned or None


async def review_hr(
    connection: AsyncConnection,
    user: AuthenticatedUser,
    request_id: UUID,
    payload: LeaveHrDecisionRequest,
) -> LeaveRequestResponse:
    hr_id, deputy_id = await _reviewers(connection)
    if user.id != hr_id:
        raise LeaveError(403, "Решение может принять только назначенный кадровик")
    row = await _row(connection, request_id, lock=True)
    if row["status"] != "pending_hr":
        raise LeaveError(409, "Заявление не ожидает кадровой проверки")
    comment = _require_comment(payload.action, payload.comment)
    values: dict[str, Any] = {"updated_at": datetime.now(UTC)}
    if payload.action == "approve":
        if not payload.starts_on or not payload.ends_on:
            raise LeaveError(422, "Укажите проверенные даты отпуска")
        if (
            not payload.work_year_starts_on
            or not payload.work_year_ends_on
            or not payload.calendar_days
            or not payload.paid_days
            or not payload.return_on
        ):
            raise LeaveError(422, "Заполните рабочий период, дни и дату выхода")
        if not all(
            (
                payload.order_employee_name.strip(),
                payload.order_job_title.strip(),
                payload.order_signer_name.strip(),
            )
        ):
            raise LeaveError(422, "Заполните ФИО и должность для приказа")
        if payload.work_year_ends_on < payload.work_year_starts_on:
            raise LeaveError(422, "Конец рабочего периода раньше начала")
        if payload.return_on <= payload.ends_on:
            raise LeaveError(422, "Дата выхода должна быть после окончания отпуска")
        number = payload.order_number.strip()
        if not number:
            raise LeaveError(422, "Укажите номер приказа до передачи заместителю")
        if any(char in number for char in "\\/\r\n\t"):
            raise LeaveError(422, "Номер приказа содержит недопустимые символы")
        await _ensure_period(
            connection,
            row["requester_user_id"],
            payload.starts_on,
            payload.ends_on,
            excluded=request_id,
        )
        order_year = datetime.now(_LOCAL).year
        taken = await connection.scalar(
            select(leave_requests.c.id).where(
                leave_requests.c.order_year == order_year,
                leave_requests.c.order_number == number,
                leave_requests.c.id != request_id,
            )
        )
        if taken:
            raise LeaveError(409, "Этот номер приказа уже занят")
        values.update(
            starts_on=payload.starts_on,
            ends_on=payload.ends_on,
            work_year_starts_on=payload.work_year_starts_on,
            work_year_ends_on=payload.work_year_ends_on,
            calendar_days=payload.calendar_days,
            paid_days=payload.paid_days,
            return_on=payload.return_on,
            accounting_officer=payload.accounting_officer.strip() or None,
            order_employee_name=payload.order_employee_name.strip(),
            order_job_title=payload.order_job_title.strip(),
            order_signer_name=payload.order_signer_name.strip(),
            order_number=number,
            order_year=order_year,
            status="pending_deputy",
        )
        target: LeaveStatus = "pending_deputy"
        action_name = "hr_approved"
        recipients = [
            (deputy_id, "Отпуск ожидает утверждения", True),
            (row["requester_user_id"], "Заявление проверено кадрами", False),
        ]
    else:
        target = "needs_revision" if payload.action == "return" else "rejected"
        action_name = "returned" if payload.action == "return" else "rejected"
        values["status"] = target
        recipients = [
            (
                row["requester_user_id"],
                "Заявление возвращено" if target == "needs_revision" else "В отпуске отказано",
                target == "needs_revision",
            )
        ]
    try:
        async with connection.begin_nested():
            await connection.execute(
                update(leave_requests)
                .where(
                    leave_requests.c.id == request_id,
                )
                .values(**values)
            )
    except IntegrityError as error:
        raise LeaveError(409, "Этот номер приказа уже занят") from error
    await _resolve_action_notifications(connection, request_id)
    event_id = await _audit(connection, row, user.id, target, action_name, comment)
    for recipient, title, needs_action in recipients:
        await _notify(
            connection,
            recipient,
            request_id,
            event_id,
            title,
            comment or _LABELS[target],
            action=needs_action,
        )
    return await _response(connection, user, {**row, **values}, hr_id, deputy_id)


async def withdraw_leave(
    connection: AsyncConnection,
    user: AuthenticatedUser,
    request_id: UUID,
) -> LeaveRequestResponse:
    hr_id, deputy_id = await _reviewers(connection)
    row = await _row(connection, request_id, lock=True)
    if row["requester_user_id"] != user.id or row["status"] not in {
        "pending_hr",
        "pending_deputy",
        "needs_revision",
    }:
        raise LeaveError(409, "Отозвать это заявление нельзя")
    now = datetime.now(UTC)
    await connection.execute(
        update(leave_requests)
        .where(
            leave_requests.c.id == request_id,
        )
        .values(status="withdrawn", updated_at=now)
    )
    await _resolve_action_notifications(connection, request_id)
    event_id = await _audit(connection, row, user.id, "withdrawn", "withdrawn", None)
    reviewer = deputy_id if row["status"] == "pending_deputy" else hr_id
    await _notify(
        connection,
        reviewer,
        request_id,
        event_id,
        "Заявление на отпуск отозвано",
        "Сотрудник отозвал заявление",
        action=False,
    )
    return await _response(
        connection, user, {**row, "status": "withdrawn", "updated_at": now}, hr_id, deputy_id
    )


async def review_deputy(
    connection: AsyncConnection,
    user: AuthenticatedUser,
    storage: ObjectStorage,
    request_id: UUID,
    payload: LeaveDeputyDecisionRequest,
) -> LeaveRequestResponse:
    hr_id, deputy_id = await _reviewers(connection)
    if user.id != deputy_id:
        raise LeaveError(403, "Решение может принять только первый заместитель")
    row = await _row(connection, request_id, lock=True)
    if row["status"] != "pending_deputy":
        raise LeaveError(409, "Заявление не ожидает решения первого заместителя")
    comment = _require_comment(payload.action, payload.comment)
    now = datetime.now(UTC)
    values: dict[str, Any] = {"updated_at": now}
    if payload.action == "approve":
        if row["order_year"] != now.astimezone(_LOCAL).year:
            raise LeaveError(409, "Номер приказа назначен в другом году — верните заявление кадрам")
        await _ensure_period(
            connection,
            row["requester_user_id"],
            row["starts_on"],
            row["ends_on"],
            excluded=request_id,
        )
        signature = (
            (
                await connection.execute(
                    select(hiring_signatures).where(
                        hiring_signatures.c.user_id == user.id,
                    )
                )
            )
            .mappings()
            .first()
        )
        if signature is None:
            raise LeaveError(409, "Сначала настройте личную подпись первого заместителя")
        image = await _verified(storage, signature["storage_key"], signature["sha256"])
        content = await run_in_threadpool(
            order_pdf,
            number=row["order_number"],
            issued_on=now.astimezone(_LOCAL).date(),
            employee_name=row["order_employee_name"],
            job_title=row["order_job_title"],
            work_year_start=row["work_year_starts_on"],
            work_year_end=row["work_year_ends_on"],
            starts_on=row["starts_on"],
            ends_on=row["ends_on"],
            calendar_days=row["calendar_days"],
            paid_days=row["paid_days"],
            return_on=row["return_on"],
            accounting_officer=row["accounting_officer"],
            signer_name=row["order_signer_name"],
            signature=image,
        )
        key = f"leave-requests/{request_id}/orders/{uuid4()}.pdf"
        await storage.put(key, content, "application/pdf")
        target: LeaveStatus = "approved"
        action_name = "deputy_approved"
        values.update(
            status=target,
            order_key=key,
            order_sha256=hashlib.sha256(content).hexdigest(),
            signed_by_user_id=user.id,
            approved_at=now,
        )
    else:
        target = "pending_hr" if payload.action == "return" else "rejected"
        action_name = "returned" if payload.action == "return" else "rejected"
        values["status"] = target
    await connection.execute(
        update(leave_requests)
        .where(
            leave_requests.c.id == request_id,
        )
        .values(**values)
    )
    await _resolve_action_notifications(connection, request_id)
    event_id = await _audit(connection, row, user.id, target, action_name, comment)
    if target == "approved":
        await _notify(
            connection,
            row["requester_user_id"],
            request_id,
            event_id,
            "Отпуск утверждён",
            "Подписанный приказ доступен в заявке",
            action=False,
        )
        await _notify(
            connection,
            hr_id,
            request_id,
            event_id,
            "Приказ об отпуске подписан",
            "Приказ зарегистрирован и доступен",
            action=False,
        )
    elif target == "pending_hr":
        await _notify(
            connection,
            hr_id,
            request_id,
            event_id,
            "Первый заместитель вернул заявление",
            comment or "Проверьте данные",
            action=True,
        )
        await _notify(
            connection,
            row["requester_user_id"],
            request_id,
            event_id,
            "Заявление возвращено кадрам",
            comment or "Уточняются данные",
            action=False,
        )
    else:
        for recipient in (hr_id, row["requester_user_id"]):
            await _notify(
                connection,
                recipient,
                request_id,
                event_id,
                "В отпуске отказано",
                comment or "Отказано",
                action=False,
            )
    return await _response(connection, user, {**row, **values}, hr_id, deputy_id)


async def read_leave_document(
    connection: AsyncConnection,
    user: AuthenticatedUser,
    storage: ObjectStorage,
    request_id: UUID,
    kind: str,
) -> bytes:
    hr_id, deputy_id = await _reviewers(connection)
    row = await _row(connection, request_id)
    if user.id not in {row["requester_user_id"], hr_id, deputy_id} and user.role not in {
        "admin",
        "superadmin",
    }:
        raise LeaveError(404, "Документ недоступен")
    if kind == "application":
        return await _verified(storage, row["application_key"], row["application_sha256"])
    if kind == "order":
        if row["status"] != "approved":
            raise LeaveError(409, "Приказ ещё не утверждён")
        return await _verified(storage, row["order_key"], row["order_sha256"])
    if kind == "order-preview":
        if row["status"] != "pending_deputy":
            raise LeaveError(409, "Предпросмотр приказа сейчас недоступен")
        return await run_in_threadpool(
            order_pdf,
            number=row["order_number"],
            issued_on=datetime.now(_LOCAL).date(),
            employee_name=row["order_employee_name"],
            job_title=row["order_job_title"],
            work_year_start=row["work_year_starts_on"],
            work_year_end=row["work_year_ends_on"],
            starts_on=row["starts_on"],
            ends_on=row["ends_on"],
            calendar_days=row["calendar_days"],
            paid_days=row["paid_days"],
            return_on=row["return_on"],
            accounting_officer=row["accounting_officer"],
            signer_name=row["order_signer_name"],
            signature=None,
        )
    raise LeaveError(404, "Неизвестный вид документа")
