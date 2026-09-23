# Russian user-facing strings intentionally use Cyrillic characters.
# ruff: noqa: RUF001
"""Shared outgoing-letter workflow used by Workspace and, later, Telegram/Exat adapters."""

from __future__ import annotations

from datetime import UTC, datetime
from uuid import UUID, uuid4

from sqlalchemy import String, cast, func, insert, or_, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.engine import RowMapping
from sqlalchemy.ext.asyncio import AsyncConnection

from .access_control import ensure_module_action, module_permissions_for_user
from .ai_referent_schemas import (
    AIReferentAction,
    AIReferentActionRequest,
    AIReferentEventResponse,
    AIReferentLetterResponse,
    AIReferentRegistryResponse,
    CreateAIReferentLetterRequest,
    UpdateAIReferentLetterRequest,
)
from .ai_referent_shared_service import notify_letter, operation_replay, remember_operation
from .auth import AuthenticatedUser
from .tables import (
    ai_referent_configuration,
    ai_referent_delivery_commands,
    ai_referent_events,
    ai_referent_letters,
    ai_referent_number_counters,
    ai_referent_reviewers,
    attachments,
    audit_events,
    users,
)
from .workspace_schemas import AttachmentResponse

_EDITABLE_STATUSES = frozenset({"draft", "needs_revision"})
_FINAL_STATUSES = frozenset({"sent", "cancelled"})
_PRIVILEGED_ROLES = frozenset({"admin", "superadmin"})


class AIReferentServiceError(RuntimeError):
    def __init__(self, status_code: int, detail: str) -> None:
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


def _is_privileged(user: AuthenticatedUser) -> bool:
    return user.role in _PRIVILEGED_ROLES


def _may_view(row: RowMapping, user: AuthenticatedUser) -> bool:
    return bool(
        _is_privileged(user)
        or row["status"] == "sent"
        or row["created_by_user_id"] == user.id
        or row["reviewer_user_id"] == user.id
        or row.get("final_reviewer_user_id") == user.id
        or row.get("initial_reviewer_user_id") == user.id
    )


def _display_number(row: RowMapping) -> str | None:
    if row["outgoing_number"] is None or row["year_suffix"] is None:
        return None
    return f"{int(row['outgoing_number']):04d}/{row['year_suffix']}-AI"


def _attachment(row: RowMapping) -> AttachmentResponse:
    return AttachmentResponse(
        id=str(row["id"]),
        owner_type=row["owner_type"],
        owner_id=str(row["owner_id"]),
        file_name=row["file_name"],
        content_type=row["content_type"],
        byte_size=row["byte_size"],
        sha256=row["sha256"],
        uploaded_by_user_id=str(row["uploaded_by_user_id"]),
        document_role=row["document_role"] or "general",
        media_kind=row["media_kind"] or "file",
        media_duration_ms=row["media_duration_ms"],
        media_codec=row["media_codec"],
        created_at=row["created_at"],
    )


def _available_actions(
    row: RowMapping,
    current_user: AuthenticatedUser,
    *,
    may_approve: bool,
    attachment_count: int,
    may_operate: bool = False,
) -> tuple[list[AIReferentAction], bool]:
    status = row["status"]
    privileged = _is_privileged(current_user)
    is_creator = row["created_by_user_id"] == current_user.id
    is_reviewer = row["reviewer_user_id"] == current_user.id
    can_edit = status in _EDITABLE_STATUSES and (is_creator or privileged)
    actions: list[AIReferentAction] = []
    if can_edit and row["reviewer_user_id"] is not None and attachment_count > 0:
        actions.append("submit")
    if status == "pending_review" and may_approve and (is_reviewer or privileged):
        actions.extend(("approve", "return_for_revision"))
    if status == "approved" and may_approve and (is_reviewer or privileged):
        actions.append("queue_delivery")
    if status == "failed" and may_approve and (is_reviewer or privileged):
        actions.extend(("retry_delivery", "return_for_revision"))
    if status == "awaiting_final_send" and may_approve and (is_reviewer or privileged):
        actions.extend(("release_delivery", "return_for_revision"))
    if status == "referent_review_pending" and may_operate:
        actions.extend(("send", "return_for_revision"))
    if status == "delivery_unknown" and may_operate:
        actions.extend(("confirm_sent", "confirm_not_sent"))
    if status not in _FINAL_STATUSES | {"queued", "sending", "delivery_unknown"} and (
        is_creator or privileged
    ):
        actions.append("cancel")
    return actions, can_edit


async def _validate_reviewer(connection: AsyncConnection, reviewer_id: UUID | None) -> str | None:
    if reviewer_id is None:
        return None
    account = (
        (
            await connection.execute(
                select(users).where(users.c.id == reviewer_id, users.c.status == "active")
            )
        )
        .mappings()
        .one_or_none()
    )
    if account is None:
        raise AIReferentServiceError(422, "Выбранный согласующий недоступен.")
    key = await connection.scalar(
        select(ai_referent_reviewers.c.key).where(
            ai_referent_reviewers.c.user_id == reviewer_id,
            ai_referent_reviewers.c.enabled.is_(True),
        )
    )
    if key is None:
        raise AIReferentServiceError(422, "Аккаунт не назначен согласующим AI Referent.")
    permissions = await module_permissions_for_user(
        connection,
        AuthenticatedUser(
            id=account["id"],
            username=account["username"],
            full_name=account["full_name"],
            role=account["role"],
            position_id=account["position_id"],
            department_id=account["department_id"],
            job_title=None,
        ),
    )
    if not permissions["ai_referent"]["approve"]:
        raise AIReferentServiceError(422, "Согласующему запрещён доступ к модулю AI Referent.")
    return str(key) if key else None


async def _letter_row(
    connection: AsyncConnection, letter_id: UUID, *, lock: bool = False
) -> RowMapping:
    creator = users.alias("ai_creator")
    reviewer = users.alias("ai_reviewer")
    final_reviewer = users.alias("ai_final_reviewer")
    query = (
        select(
            ai_referent_letters,
            creator.c.full_name.label("creator_name"),
            reviewer.c.full_name.label("reviewer_name"),
            final_reviewer.c.full_name.label("final_reviewer_name"),
        )
        .select_from(
            ai_referent_letters.join(
                creator, creator.c.id == ai_referent_letters.c.created_by_user_id
            )
            .join(
                reviewer,
                reviewer.c.id == ai_referent_letters.c.reviewer_user_id,
                isouter=True,
            )
            .join(
                final_reviewer,
                final_reviewer.c.id == ai_referent_letters.c.final_reviewer_user_id,
                isouter=True,
            )
        )
        .where(ai_referent_letters.c.id == letter_id)
    )
    if lock:
        query = query.with_for_update(of=ai_referent_letters)
    row = (await connection.execute(query)).mappings().one_or_none()
    if row is None:
        raise AIReferentServiceError(404, "Исходящее письмо не найдено.")
    return row


async def _letter_events(
    connection: AsyncConnection, letter_id: UUID
) -> list[AIReferentEventResponse]:
    actor = users.alias("ai_event_actor")
    rows = (
        (
            await connection.execute(
                select(ai_referent_events, actor.c.full_name.label("actor_name"))
                .select_from(
                    ai_referent_events.join(
                        actor, actor.c.id == ai_referent_events.c.actor_user_id, isouter=True
                    )
                )
                .where(ai_referent_events.c.letter_id == letter_id)
                .order_by(ai_referent_events.c.created_at.desc())
            )
        )
        .mappings()
        .all()
    )
    return [
        AIReferentEventResponse(
            id=str(row["id"]),
            event_type=row["event_type"],
            actor_user_id=str(row["actor_user_id"]) if row["actor_user_id"] else None,
            actor_name=row["actor_name"] or "Системное действие",
            from_status=row["from_status"],
            to_status=row["to_status"],
            comment=row["comment"] or "",
            created_at=row["created_at"],
        )
        for row in rows
    ]


async def _letter_attachments(
    connection: AsyncConnection, letter_id: UUID
) -> list[AttachmentResponse]:
    rows = (
        (
            await connection.execute(
                select(attachments)
                .where(
                    attachments.c.owner_type == "ai_referent_letter",
                    attachments.c.owner_id == letter_id,
                )
                .order_by(attachments.c.created_at)
            )
        )
        .mappings()
        .all()
    )
    return [_attachment(row) for row in rows]


async def _response(
    connection: AsyncConnection,
    row: RowMapping,
    current_user: AuthenticatedUser,
    *,
    may_approve: bool | None = None,
) -> AIReferentLetterResponse:
    letter_attachments = await _letter_attachments(connection, row["id"])
    permissions = await module_permissions_for_user(connection, current_user)
    if may_approve is None:
        may_approve = permissions.get("ai_referent", {}).get("approve", False)
    actions, can_edit = _available_actions(
        row,
        current_user,
        may_approve=may_approve,
        attachment_count=sum(
            item.document_role == "primary" and item.file_name.lower().endswith(".docx")
            for item in letter_attachments
        ),
        may_operate=permissions.get("ai_referent", {}).get("admin", False),
    )
    if not permissions.get("ai_referent", {}).get("edit", False):
        can_edit = False
        actions = [action for action in actions if action not in {"submit", "cancel"}]
    return AIReferentLetterResponse(
        id=str(row["id"]),
        display_number=_display_number(row),
        outgoing_number=row["outgoing_number"],
        year_suffix=row["year_suffix"],
        subject=row["subject"],
        recipient_organization=row["recipient_organization"],
        recipient_address=row["recipient_address"] or "",
        route=row["route"],
        note=row["note"] or "",
        status=row["status"],
        source=row["source"],
        created_by_user_id=str(row["created_by_user_id"]),
        created_by_name=row["creator_name"],
        reviewer_user_id=str(row["reviewer_user_id"]) if row["reviewer_user_id"] else None,
        reviewer_name=row["reviewer_name"],
        final_reviewer_user_id=str(row["final_reviewer_user_id"])
        if row.get("final_reviewer_user_id")
        else None,
        final_reviewer_name=row.get("final_reviewer_name"),
        delivery_error=row.get("delivery_error") or "",
        revision=row["revision"],
        sent_at=row["sent_at"],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
        attachments=letter_attachments,
        events=await _letter_events(connection, row["id"]),
        available_actions=actions,
        can_edit=can_edit,
    )


async def _event(
    connection: AsyncConnection,
    letter_id: UUID,
    actor_user_id: UUID | None,
    event_type: str,
    *,
    from_status: str | None,
    to_status: str | None,
    comment: str = "",
) -> None:
    await connection.execute(
        insert(ai_referent_events).values(
            id=uuid4(),
            letter_id=letter_id,
            actor_user_id=actor_user_id,
            event_type=event_type,
            from_status=from_status,
            to_status=to_status,
            comment=comment,
            metadata={},
            created_at=datetime.now(UTC),
        )
    )


async def create_letter(
    connection: AsyncConnection,
    current_user: AuthenticatedUser,
    payload: CreateAIReferentLetterRequest,
) -> AIReferentLetterResponse:
    await connection.execute(select(ai_referent_configuration).with_for_update())
    await ensure_module_action(connection, current_user, "ai_referent", "create")
    replay = await operation_replay(connection, current_user, payload, "create")
    if replay:
        return await load_letter(connection, current_user, replay)
    reviewer_key = await _validate_reviewer(connection, payload.reviewer_user_id)
    final_key = await _validate_reviewer(connection, payload.final_reviewer_user_id)
    now = datetime.now(UTC)
    letter_id = uuid4()
    await connection.execute(
        insert(ai_referent_letters).values(
            id=letter_id,
            outgoing_number=None,
            year_suffix=None,
            subject=payload.subject,
            recipient_organization=payload.recipient_organization,
            recipient_address=payload.recipient_address,
            route=payload.route,
            note=payload.note,
            status="draft",
            source="workspace",
            created_by_user_id=current_user.id,
            reviewer_user_id=payload.reviewer_user_id,
            reviewer_key=reviewer_key,
            initial_reviewer_user_id=payload.reviewer_user_id,
            initial_reviewer_key=reviewer_key,
            final_reviewer_user_id=payload.final_reviewer_user_id,
            final_reviewer_key=final_key,
            delivery_error="",
            legacy_id=None,
            revision=1,
            sent_at=None,
            created_at=now,
            updated_at=now,
        )
    )
    await _event(
        connection,
        letter_id,
        current_user.id,
        "letter.created",
        from_status=None,
        to_status="draft",
    )
    await remember_operation(connection, current_user, payload, "create", letter_id)
    return await _response(connection, await _letter_row(connection, letter_id), current_user)


async def load_letters(
    connection: AsyncConnection,
    current_user: AuthenticatedUser,
    *,
    query: str = "",
    status: str | None = None,
    offset: int = 0,
    limit: int = 50,
) -> AIReferentRegistryResponse:
    creator = users.alias("ai_creator")
    reviewer = users.alias("ai_reviewer")
    final_reviewer = users.alias("ai_final_reviewer")
    statement = select(
        ai_referent_letters,
        creator.c.full_name.label("creator_name"),
        reviewer.c.full_name.label("reviewer_name"),
        final_reviewer.c.full_name.label("final_reviewer_name"),
    ).select_from(
        ai_referent_letters.join(creator, creator.c.id == ai_referent_letters.c.created_by_user_id)
        .join(reviewer, reviewer.c.id == ai_referent_letters.c.reviewer_user_id, isouter=True)
        .join(
            final_reviewer,
            final_reviewer.c.id == ai_referent_letters.c.final_reviewer_user_id,
            isouter=True,
        )
    )
    permissions = await module_permissions_for_user(connection, current_user)
    if not _is_privileged(current_user) and not permissions.get("ai_referent", {}).get("admin"):
        statement = statement.where(
            or_(
                ai_referent_letters.c.status == "sent",
                ai_referent_letters.c.created_by_user_id == current_user.id,
                ai_referent_letters.c.reviewer_user_id == current_user.id,
                ai_referent_letters.c.final_reviewer_user_id == current_user.id,
                ai_referent_letters.c.initial_reviewer_user_id == current_user.id,
            )
        )
    if status:
        statement = statement.where(ai_referent_letters.c.status == status)
    cleaned = query.strip()
    if cleaned:
        pattern = f"%{cleaned}%"
        statement = statement.where(
            or_(
                ai_referent_letters.c.subject.ilike(pattern),
                ai_referent_letters.c.recipient_organization.ilike(pattern),
                ai_referent_letters.c.recipient_address.ilike(pattern),
                func.concat(
                    func.lpad(
                        cast(ai_referent_letters.c.outgoing_number, String),
                        func.greatest(
                            4, func.length(cast(ai_referent_letters.c.outgoing_number, String))
                        ),
                        "0",
                    ),
                    "/",
                    ai_referent_letters.c.year_suffix,
                    "-AI",
                ).ilike(pattern),
                creator.c.full_name.ilike(pattern),
                reviewer.c.full_name.ilike(pattern),
            )
        )
    matching = statement.subquery()
    totals = (
        (
            await connection.execute(
                select(matching.c.status, func.count().label("count")).group_by(matching.c.status)
            )
        )
        .mappings()
        .all()
    )
    counts = {item["status"]: item["count"] for item in totals}
    rows = (
        (
            await connection.execute(
                statement.order_by(
                    ai_referent_letters.c.updated_at.desc(), ai_referent_letters.c.id
                )
                .offset(offset)
                .limit(limit)
            )
        )
        .mappings()
        .all()
    )
    permissions = await module_permissions_for_user(connection, current_user)
    may_approve = permissions.get("ai_referent", {}).get("approve", False)
    letters = [
        await _response(connection, row, current_user, may_approve=may_approve) for row in rows
    ]
    return AIReferentRegistryResponse(
        letters=letters,
        total_count=sum(counts.values()),
        pending_review_count=sum(
            counts.get(key, 0) for key in ("pending_review", "awaiting_final_send")
        ),
        ready_count=sum(
            counts.get(key, 0)
            for key in ("approved", "queued", "sending", "referent_review_pending")
        ),
        sent_count=counts.get("sent", 0),
    )


async def load_letter(
    connection: AsyncConnection,
    current_user: AuthenticatedUser,
    letter_id: UUID,
) -> AIReferentLetterResponse:
    row = await _letter_row(connection, letter_id)
    if not _may_view(row, current_user):
        permissions = await module_permissions_for_user(connection, current_user)
        if not permissions.get("ai_referent", {}).get("admin"):
            raise AIReferentServiceError(404, "Исходящее письмо не найдено.")
    return await _response(connection, row, current_user)


async def update_letter(
    connection: AsyncConnection,
    current_user: AuthenticatedUser,
    letter_id: UUID,
    payload: UpdateAIReferentLetterRequest,
) -> AIReferentLetterResponse:
    await connection.execute(select(ai_referent_configuration).with_for_update())
    await ensure_module_action(connection, current_user, "ai_referent", "edit")
    scope = f"update:{letter_id}"
    replay = await operation_replay(connection, current_user, payload, scope)
    if replay:
        return await load_letter(connection, current_user, replay)
    row = await _letter_row(connection, letter_id, lock=True)
    if row["revision"] != payload.expected_revision:
        raise AIReferentServiceError(409, "Письмо уже изменилось. Обновите данные.")
    if row["status"] not in _EDITABLE_STATUSES:
        raise AIReferentServiceError(409, "На текущем этапе письмо нельзя редактировать.")
    if row["created_by_user_id"] != current_user.id and not _is_privileged(current_user):
        raise AIReferentServiceError(403, "Редактировать письмо может его автор.")
    reviewer_key = await _validate_reviewer(connection, payload.reviewer_user_id)
    final_key = await _validate_reviewer(connection, payload.final_reviewer_user_id)
    await connection.execute(
        update(ai_referent_letters)
        .where(ai_referent_letters.c.id == letter_id)
        .values(
            subject=payload.subject,
            recipient_organization=payload.recipient_organization,
            recipient_address=payload.recipient_address,
            route=payload.route,
            note=payload.note,
            reviewer_user_id=payload.reviewer_user_id,
            reviewer_key=reviewer_key,
            initial_reviewer_user_id=payload.reviewer_user_id,
            initial_reviewer_key=reviewer_key,
            final_reviewer_user_id=payload.final_reviewer_user_id,
            final_reviewer_key=final_key,
            revision=row["revision"] + 1,
            updated_at=datetime.now(UTC),
        )
    )
    await _event(
        connection,
        letter_id,
        current_user.id,
        "letter.updated",
        from_status=row["status"],
        to_status=row["status"],
    )
    await remember_operation(connection, current_user, payload, scope, letter_id)
    return await _response(connection, await _letter_row(connection, letter_id), current_user)


async def _reserve_number(connection: AsyncConnection) -> tuple[int, str]:
    now = datetime.now(UTC)
    year_suffix = now.strftime("%y")
    maximum = await connection.scalar(
        select(func.max(ai_referent_letters.c.outgoing_number)).where(
            ai_referent_letters.c.year_suffix == year_suffix
        )
    )
    first_value = int(maximum or 0) + 1
    statement = (
        pg_insert(ai_referent_number_counters)
        .values(year_suffix=year_suffix, last_number=first_value, updated_at=now)
        .on_conflict_do_update(
            index_elements=[ai_referent_number_counters.c.year_suffix],
            set_={
                "last_number": func.greatest(
                    ai_referent_number_counters.c.last_number + 1, first_value
                ),
                "updated_at": now,
            },
        )
        .returning(ai_referent_number_counters.c.last_number)
    )
    number = await connection.scalar(statement)
    if number is None:
        raise AIReferentServiceError(500, "Не удалось присвоить исходящий номер.")
    return int(number), year_suffix


async def act_on_letter(
    connection: AsyncConnection,
    current_user: AuthenticatedUser,
    letter_id: UUID,
    payload: AIReferentActionRequest,
) -> AIReferentLetterResponse:
    await connection.execute(select(ai_referent_configuration).with_for_update())
    scope = f"action:{letter_id}"
    replay = await operation_replay(connection, current_user, payload, scope)
    if replay:
        return await load_letter(connection, current_user, replay)
    row = await _letter_row(connection, letter_id, lock=True)
    if row["revision"] != payload.expected_revision:
        raise AIReferentServiceError(409, "Письмо уже изменилось. Обновите данные.")
    action = payload.action
    current_status = row["status"]
    privileged = _is_privileged(current_user)
    is_creator = row["created_by_user_id"] == current_user.id
    is_reviewer = row["reviewer_user_id"] == current_user.id
    next_status: str
    values: dict[str, object] = {}
    command_kind: str | None = None

    if action == "submit":
        await ensure_module_action(connection, current_user, "ai_referent", "edit")
        if current_status not in _EDITABLE_STATUSES or not (is_creator or privileged):
            raise AIReferentServiceError(403, "Отправить письмо может его автор.")
        if row["reviewer_user_id"] is None:
            raise AIReferentServiceError(422, "Сначала выберите согласующего.")
        values["reviewer_key"] = await _validate_reviewer(connection, row["reviewer_user_id"])
        file_count = await connection.scalar(
            select(func.count())
            .select_from(attachments)
            .where(
                attachments.c.owner_type == "ai_referent_letter",
                attachments.c.owner_id == letter_id,
                attachments.c.document_role == "primary",
                attachments.c.file_name.ilike("%.docx"),
            )
        )
        if not file_count:
            raise AIReferentServiceError(422, "Перед согласованием приложите основной файл письма.")
        next_status = "pending_review"
    elif action in {"send", "confirm_sent", "confirm_not_sent"} or (
        action == "return_for_revision" and current_status == "referent_review_pending"
    ):
        await ensure_module_action(connection, current_user, "ai_referent", "admin")
        expected = (
            "referent_review_pending"
            if action in {"send", "return_for_revision"}
            else "delivery_unknown"
        )
        if current_status != expected:
            raise AIReferentServiceError(409, "Этап отправки уже изменился.")
        if (
            action in {"confirm_sent", "confirm_not_sent", "return_for_revision"}
            and len(payload.comment) < 3
        ):
            raise AIReferentServiceError(422, "Укажите основание и результат проверки доставки.")
        next_status = {
            "send": "queued",
            "confirm_sent": "sent",
            "confirm_not_sent": "referent_review_pending",
            "return_for_revision": "needs_revision",
        }[action]
        if action == "send":
            command_kind = "send"
        if action == "confirm_sent":
            values["sent_at"] = datetime.now(UTC)
        values["delivery_error"] = ""
    elif action in {
        "approve",
        "return_for_revision",
        "queue_delivery",
        "retry_delivery",
        "release_delivery",
    }:
        await ensure_module_action(connection, current_user, "ai_referent", "approve")
        if not (is_reviewer or privileged):
            raise AIReferentServiceError(403, "Действие доступно назначенному согласующему.")
        if not privileged:
            await _validate_reviewer(connection, current_user.id)
        if action == "approve":
            if current_status != "pending_review":
                raise AIReferentServiceError(409, "Письмо не ожидает согласования.")
            final_id = row.get("final_reviewer_user_id")
            if row.get("final_reviewer_key") and final_id is None:
                raise AIReferentServiceError(
                    409,
                    "Второй согласующий отключён. Администратор должен восстановить назначение.",
                )
            if final_id and final_id != row["reviewer_user_id"]:
                final_key = await _validate_reviewer(connection, final_id)
                values.update(reviewer_user_id=final_id, reviewer_key=final_key)
                next_status = "pending_review"
            else:
                if row.get("outgoing_number") is None:
                    ready = await connection.scalar(
                        select(ai_referent_configuration.c.execution_agent_id)
                    )
                    if not ready:
                        raise AIReferentServiceError(
                            409,
                            "Робот ещё не сверил архив и нумерацию. Завершите подключение Exat.",
                        )
                    number, year_suffix = await _reserve_number(connection)
                    values.update(outgoing_number=number, year_suffix=year_suffix)
                next_status = "approved"
        elif action == "return_for_revision":
            if current_status not in {"pending_review", "awaiting_final_send", "failed"}:
                raise AIReferentServiceError(409, "Письмо не ожидает согласования.")
            if len(payload.comment) < 3:
                raise AIReferentServiceError(422, "Укажите причину возврата на доработку.")
            next_status = "needs_revision"
        elif action == "release_delivery":
            if current_status != "awaiting_final_send":
                raise AIReferentServiceError(409, "Подписанный документ не ожидает решения.")
            next_status = "referent_review_pending"
        else:
            expected = "approved" if action == "queue_delivery" else "failed"
            if current_status != expected:
                raise AIReferentServiceError(409, "Письмо нельзя поставить в очередь сейчас.")
            next_status = "queued"
            command_kind = "prepare"
    elif action == "cancel":
        await ensure_module_action(connection, current_user, "ai_referent", "edit")
        if current_status in _FINAL_STATUSES | {"queued", "sending", "delivery_unknown"} or not (
            is_creator or privileged
        ):
            raise AIReferentServiceError(403, "Отменить письмо может его автор.")
        next_status = "cancelled"
    else:
        raise AIReferentServiceError(422, "Неизвестное действие.")

    now = datetime.now(UTC)
    next_revision = row["revision"] + 1
    if next_status == "needs_revision" and row.get("initial_reviewer_key"):
        # A changed document restarts the configured route, never skips preliminary review.
        values.update(
            reviewer_user_id=row.get("initial_reviewer_user_id"),
            reviewer_key=row["initial_reviewer_key"],
        )
    values.update(status=next_status, revision=next_revision, updated_at=now)
    await connection.execute(
        update(ai_referent_letters).where(ai_referent_letters.c.id == letter_id).values(**values)
    )
    if next_status == "queued":
        await connection.execute(
            insert(ai_referent_delivery_commands).values(
                id=uuid4(),
                letter_id=letter_id,
                route=row["route"],
                status="pending",
                idempotency_key=f"letter:{letter_id}:revision:{next_revision}",
                kind=command_kind or "prepare",
                claimed_by=None,
                lease_until=None,
                attempt_count=0,
                last_error="",
                created_at=now,
                updated_at=now,
                completed_at=None,
            )
        )
    await _event(
        connection,
        letter_id,
        current_user.id,
        f"letter.{action}",
        from_status=current_status,
        to_status=next_status,
        comment=payload.comment,
    )
    await connection.execute(
        insert(audit_events).values(
            id=uuid4(),
            actor_user_id=current_user.id,
            action=f"ai_referent.{action}",
            target_type="ai_referent_letter",
            target_id=letter_id,
            details={"fromStatus": current_status, "toStatus": next_status},
            created_at=now,
        )
    )
    await remember_operation(connection, current_user, payload, scope, letter_id)
    updated = await _letter_row(connection, letter_id)
    titles = {
        "submit": "Письмо поступило на согласование",
        "approve": "Письмо согласовано",
        "return_for_revision": "Письмо возвращено с комментарием",
        "queue_delivery": "Подготовка подписанного письма",
        "retry_delivery": "Повторная подготовка письма",
        "release_delivery": "Письмо ожидает отправки референтом",
        "send": "Письмо передано на отправку",
        "cancel": "Письмо отменено",
        "confirm_sent": "Доставка письма подтверждена",
        "confirm_not_sent": "Отсутствие доставки подтверждено",
    }
    await notify_letter(connection, updated, titles[action], payload.comment)
    return await _response(connection, updated, current_user)
