# Russian user-facing strings intentionally use Cyrillic characters.
# ruff: noqa: RUF001
"""Shared outgoing-letter workflow used by Workspace and, later, Telegram/Exat adapters."""

from __future__ import annotations

from datetime import UTC, datetime
from uuid import UUID, uuid4

from sqlalchemy import func, insert, or_, select, update
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
        actions.append("retry_delivery")
    if status not in _FINAL_STATUSES and (is_creator or privileged):
        actions.append("cancel")
    return actions, can_edit


async def _validate_reviewer(
    connection: AsyncConnection, reviewer_id: UUID | None
) -> str | None:
    if reviewer_id is None:
        return None
    account = (await connection.execute(
        select(users).where(users.c.id == reviewer_id, users.c.status == "active")
    )).mappings().one_or_none()
    if account is None:
        raise AIReferentServiceError(422, "Выбранный согласующий недоступен.")
    key = await connection.scalar(select(ai_referent_reviewers.c.key).where(
        ai_referent_reviewers.c.user_id == reviewer_id, ai_referent_reviewers.c.enabled.is_(True)
    ))
    if key is None:
        raise AIReferentServiceError(422, "Аккаунт не назначен согласующим AI Referent.")
    permissions = await module_permissions_for_user(connection, AuthenticatedUser(
        id=account["id"], username=account["username"], full_name=account["full_name"],
        role=account["role"], position_id=account["position_id"],
        department_id=account["department_id"], job_title=None,
    ))
    if not permissions["ai_referent"]["approve"]:
        raise AIReferentServiceError(422, "Согласующему запрещён доступ к модулю AI Referent.")
    return str(key) if key else None


async def _letter_row(
    connection: AsyncConnection, letter_id: UUID, *, lock: bool = False
) -> RowMapping:
    creator = users.alias("ai_creator")
    reviewer = users.alias("ai_reviewer")
    query = (
        select(
            ai_referent_letters,
            creator.c.full_name.label("creator_name"),
            reviewer.c.full_name.label("reviewer_name"),
        )
        .select_from(
            ai_referent_letters.join(
                creator, creator.c.id == ai_referent_letters.c.created_by_user_id
            ).join(
                reviewer,
                reviewer.c.id == ai_referent_letters.c.reviewer_user_id,
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
    ).mappings().all()
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
        await connection.execute(
            select(attachments)
            .where(
                attachments.c.owner_type == "ai_referent_letter",
                attachments.c.owner_id == letter_id,
            )
            .order_by(attachments.c.created_at)
        )
    ).mappings().all()
    return [_attachment(row) for row in rows]


async def _response(
    connection: AsyncConnection,
    row: RowMapping,
    current_user: AuthenticatedUser,
    *,
    may_approve: bool | None = None,
) -> AIReferentLetterResponse:
    letter_attachments = await _letter_attachments(connection, row["id"])
    if may_approve is None:
        permissions = await module_permissions_for_user(connection, current_user)
        may_approve = permissions.get("ai_referent", {}).get("approve", False)
    actions, can_edit = _available_actions(
        row,
        current_user,
        may_approve=may_approve,
        attachment_count=len(letter_attachments),
    )
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
    reviewer_key = await _validate_reviewer(connection, payload.reviewer_user_id)
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
    return await _response(connection, await _letter_row(connection, letter_id), current_user)


async def load_letters(
    connection: AsyncConnection,
    current_user: AuthenticatedUser,
    *,
    query: str = "",
    status: str | None = None,
) -> AIReferentRegistryResponse:
    creator = users.alias("ai_creator")
    reviewer = users.alias("ai_reviewer")
    statement = select(
        ai_referent_letters,
        creator.c.full_name.label("creator_name"),
        reviewer.c.full_name.label("reviewer_name"),
    ).select_from(
        ai_referent_letters.join(
            creator, creator.c.id == ai_referent_letters.c.created_by_user_id
        ).join(
            reviewer, reviewer.c.id == ai_referent_letters.c.reviewer_user_id, isouter=True
        )
    )
    if not _is_privileged(current_user):
        statement = statement.where(
            or_(
                ai_referent_letters.c.status == "sent",
                ai_referent_letters.c.created_by_user_id == current_user.id,
                ai_referent_letters.c.reviewer_user_id == current_user.id,
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
            )
        )
    rows = (
        await connection.execute(
            statement.order_by(ai_referent_letters.c.updated_at.desc()).limit(200)
        )
    ).mappings().all()
    permissions = await module_permissions_for_user(connection, current_user)
    may_approve = permissions.get("ai_referent", {}).get("approve", False)
    letters = [
        await _response(connection, row, current_user, may_approve=may_approve)
        for row in rows
    ]
    all_statuses = [row["status"] for row in rows]
    return AIReferentRegistryResponse(
        letters=letters,
        total_count=len(all_statuses),
        pending_review_count=sum(value == "pending_review" for value in all_statuses),
        ready_count=sum(value in {"approved", "queued", "sending"} for value in all_statuses),
        sent_count=sum(value == "sent" for value in all_statuses),
    )


async def load_letter(
    connection: AsyncConnection,
    current_user: AuthenticatedUser,
    letter_id: UUID,
) -> AIReferentLetterResponse:
    row = await _letter_row(connection, letter_id)
    if not _may_view(row, current_user):
        raise AIReferentServiceError(404, "Исходящее письмо не найдено.")
    return await _response(connection, row, current_user)


async def update_letter(
    connection: AsyncConnection,
    current_user: AuthenticatedUser,
    letter_id: UUID,
    payload: UpdateAIReferentLetterRequest,
) -> AIReferentLetterResponse:
    await connection.execute(select(ai_referent_configuration).with_for_update())
    row = await _letter_row(connection, letter_id, lock=True)
    if row["revision"] != payload.expected_revision:
        raise AIReferentServiceError(409, "Письмо уже изменилось. Обновите данные.")
    if row["status"] not in _EDITABLE_STATUSES:
        raise AIReferentServiceError(409, "На текущем этапе письмо нельзя редактировать.")
    if row["created_by_user_id"] != current_user.id and not _is_privileged(current_user):
        raise AIReferentServiceError(403, "Редактировать письмо может его автор.")
    reviewer_key = await _validate_reviewer(connection, payload.reviewer_user_id)
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

    if action == "submit":
        await ensure_module_action(connection, current_user, "ai_referent", "edit")
        if current_status not in _EDITABLE_STATUSES or not (is_creator or privileged):
            raise AIReferentServiceError(403, "Отправить письмо может его автор.")
        if row["reviewer_user_id"] is None:
            raise AIReferentServiceError(422, "Сначала выберите согласующего.")
        values["reviewer_key"] = await _validate_reviewer(connection, row["reviewer_user_id"])
        file_count = await connection.scalar(
            select(func.count()).select_from(attachments).where(
                attachments.c.owner_type == "ai_referent_letter",
                attachments.c.owner_id == letter_id,
            )
        )
        if not file_count:
            raise AIReferentServiceError(422, "Перед согласованием приложите файл письма.")
        next_status = "pending_review"
    elif action in {"approve", "return_for_revision", "queue_delivery", "retry_delivery"}:
        await ensure_module_action(connection, current_user, "ai_referent", "approve")
        if not (is_reviewer or privileged):
            raise AIReferentServiceError(403, "Действие доступно назначенному согласующему.")
        if not privileged:
            await _validate_reviewer(connection, current_user.id)
        if action == "approve":
            if current_status != "pending_review":
                raise AIReferentServiceError(409, "Письмо не ожидает согласования.")
            number, year_suffix = await _reserve_number(connection)
            values.update(outgoing_number=number, year_suffix=year_suffix)
            next_status = "approved"
        elif action == "return_for_revision":
            if current_status != "pending_review":
                raise AIReferentServiceError(409, "Письмо не ожидает согласования.")
            if len(payload.comment) < 3:
                raise AIReferentServiceError(422, "Укажите причину возврата на доработку.")
            next_status = "needs_revision"
        else:
            expected = "approved" if action == "queue_delivery" else "failed"
            if current_status != expected:
                raise AIReferentServiceError(409, "Письмо нельзя поставить в очередь сейчас.")
            next_status = "queued"
    elif action == "cancel":
        await ensure_module_action(connection, current_user, "ai_referent", "edit")
        if current_status in _FINAL_STATUSES or not (is_creator or privileged):
            raise AIReferentServiceError(403, "Отменить письмо может его автор.")
        next_status = "cancelled"
    else:
        raise AIReferentServiceError(422, "Неизвестное действие.")

    now = datetime.now(UTC)
    next_revision = row["revision"] + 1
    values.update(status=next_status, revision=next_revision, updated_at=now)
    await connection.execute(
        update(ai_referent_letters)
        .where(ai_referent_letters.c.id == letter_id)
        .values(**values)
    )
    if next_status == "queued":
        await connection.execute(
            insert(ai_referent_delivery_commands).values(
                id=uuid4(),
                letter_id=letter_id,
                route=row["route"],
                status="pending",
                idempotency_key=f"letter:{letter_id}:revision:{next_revision}",
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
    return await _response(connection, await _letter_row(connection, letter_id), current_user)
