# Russian user-facing strings intentionally use Cyrillic characters.
# ruff: noqa: RUF001
"""Shared outgoing-letter workflow used by Workspace and, later, Telegram/Exat adapters."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Literal
from uuid import UUID, uuid4

from sqlalchemy import String, and_, cast, false, func, insert, or_, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.engine import RowMapping
from sqlalchemy.ext.asyncio import AsyncConnection

from .access_control import ensure_module_action, module_permissions_for_user
from .ai_referent_audio import audio_response, decision_audio
from .ai_referent_mailing import (
    enqueue_recipient,
    load_recipients_for_letter,
    mailing_status,
    replace_recipients,
    set_recipient_status,
    stop_pending,
)
from .ai_referent_preflight import check_response, letter_check, require_passed
from .ai_referent_retry import failed_delivery_retry_plan
from .ai_referent_schemas import (
    AIReferentAction,
    AIReferentActionRequest,
    AIReferentEventResponse,
    AIReferentLetterResponse,
    AIReferentMailingRecipientInput,
    AIReferentRegistryResponse,
    CreateAIReferentLetterRequest,
    UpdateAIReferentLetterRequest,
    delivery_route_error,
)
from .ai_referent_shared_service import notify_letter, operation_replay, remember_operation
from .ai_referent_visibility import (
    MAILING_OPERATOR_STATUSES,
    OPERATOR_VISIBLE_STATUSES,
    may_view_all_workspace_letters,
    may_view_letter,
)
from .auth import AuthenticatedUser
from .tables import (
    ai_referent_comment_audio,
    ai_referent_configuration,
    ai_referent_delivery_commands,
    ai_referent_events,
    ai_referent_letters,
    ai_referent_mailing_recipients,
    ai_referent_number_counters,
    ai_referent_reviewers,
    attachments,
    audit_events,
    users,
)
from .workspace_schemas import AttachmentResponse

_EDITABLE_STATUSES = frozenset({"draft", "needs_revision"})
_FINAL_STATUSES = frozenset({"sent", "signed", "cancelled", "rejected"})
_PRIVILEGED_ROLES = frozenset({"admin", "superadmin"})


class AIReferentServiceError(RuntimeError):
    def __init__(self, status_code: int, detail: str) -> None:
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


def _is_privileged(user: AuthenticatedUser) -> bool:
    return user.role in _PRIVILEGED_ROLES


def _may_view_all_sent(user: AuthenticatedUser) -> bool:
    return _is_privileged(user) or user.role == "manager"


def _may_view(
    row: RowMapping, user: AuthenticatedUser, *, may_operate: bool = False
) -> bool:
    return may_view_letter(row, user, may_operate=may_operate)


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
    replacement_file_ready: bool = False,
) -> tuple[list[AIReferentAction], bool]:
    status = row["status"]
    is_creator = row["created_by_user_id"] == current_user.id
    is_reviewer = row["reviewer_user_id"] == current_user.id
    can_edit = status in _EDITABLE_STATUSES and is_creator
    actions: list[AIReferentAction] = []
    if status == "pending_review" and is_creator:
        actions.append("remind")
    if row["workflow_kind"] == "sign_only":
        if can_edit and row["reviewer_user_id"] is not None and attachment_count > 0:
            actions.append("submit")
        if status == "pending_review" and may_approve and is_reviewer:
            actions.extend(("approve", "return_for_revision", "reject"))
        if status == "failed" and may_approve and is_reviewer:
            actions.extend(("retry_delivery", "return_for_revision"))
        if status not in _FINAL_STATUSES | {"queued", "sending"} and is_creator:
            actions.append("cancel")
        return actions, can_edit
    if (
        can_edit
        and row["reviewer_user_id"] is not None
        and attachment_count > 0
        and row["recipient_organization"]
        and row["recipient_address"]
    ):
        actions.append("submit")
    if status == "pending_review" and may_approve and is_reviewer:
        actions.extend(("approve", "return_for_revision", "reject"))
    if status == "approved" and may_approve and is_reviewer:
        actions.append("queue_delivery")
    if status == "failed" and may_approve and is_reviewer:
        actions.extend(("retry_delivery", "return_for_revision"))
    if status == "awaiting_final_send" and is_creator:
        actions.extend(("release_delivery", "return_for_revision"))
    if status == "referent_review_pending" and may_operate:
        actions.extend(("send", "return_for_revision"))
        if not row.get("is_mailing"):
            actions.extend(("replace_document", "mark_sent"))
    if status == "operator_revision" and may_operate and replacement_file_ready:
        actions.append("prepare_replacement")
    if status == "delivery_unknown" and may_operate and not row.get("is_mailing"):
        actions.extend(("confirm_sent", "confirm_not_sent"))
    if status not in _FINAL_STATUSES | {"queued", "sending", "delivery_unknown"} and (
        is_creator and status != "operator_revision"
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


def _normalize_review_route(
    payload: CreateAIReferentLetterRequest | UpdateAIReferentLetterRequest,
    reviewer_key: str | None,
    final_key: str | None,
) -> tuple[str | None, str | None]:
    """The API stores execution order: preliminary first, Bobur last."""
    if payload.final_reviewer_user_id is None:
        return reviewer_key, None
    if payload.final_reviewer_user_id == payload.reviewer_user_id:
        raise AIReferentServiceError(422, "Выберите разных согласующих.")
    if reviewer_key == "bobur":
        payload.reviewer_user_id, payload.final_reviewer_user_id = (
            payload.final_reviewer_user_id,
            payload.reviewer_user_id,
        )
        return final_key, reviewer_key
    if final_key != "bobur":
        raise AIReferentServiceError(422, "Два этапа доступны только с финальным решением Бобура.")
    return reviewer_key, final_key


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
    audio_rows = (
        (
            await connection.execute(
                select(ai_referent_comment_audio).where(
                    ai_referent_comment_audio.c.letter_id == letter_id,
                )
            )
        )
        .mappings()
        .all()
    )
    audio_by_id = {str(item["id"]): audio_response(item) for item in audio_rows}
    return [
        AIReferentEventResponse(
            id=str(row["id"]),
            event_type=row["event_type"],
            actor_user_id=str(row["actor_user_id"]) if row["actor_user_id"] else None,
            actor_name=row["actor_name"] or "Системное действие",
            from_status=row["from_status"],
            to_status=row["to_status"],
            comment=row["comment"] or "",
            audio=audio_by_id.get((row["metadata"] or {}).get("audioId", "")),
            recipient_id=(row["metadata"] or {}).get("recipientId"),
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


async def _replacement_ready(connection: AsyncConnection, row: RowMapping) -> bool:
    if row["status"] != "operator_revision":
        return False
    started = await connection.scalar(
        select(func.max(ai_referent_events.c.created_at)).where(
            ai_referent_events.c.letter_id == row["id"],
            ai_referent_events.c.event_type == "letter.replace_document",
        )
    )
    if started is None:
        return False
    return bool(
        await connection.scalar(
            select(attachments.c.id)
            .where(
                attachments.c.owner_type == "ai_referent_letter",
                attachments.c.owner_id == row["id"],
                attachments.c.document_role == "primary",
                attachments.c.created_at > started,
                or_(
                    attachments.c.file_name.ilike("%.docx"), attachments.c.file_name.ilike("%.pdf")
                ),
            )
            .limit(1)
        )
    )


def _submission_block_reason(
    row: RowMapping, primary_count: int, check: RowMapping | None
) -> str:
    if row["workflow_kind"] == "delivery":
        if not row["recipient_organization"] or not row["recipient_address"]:
            return "Укажите организацию и адрес получателя."
        route_error = delivery_route_error(row["recipient_address"], row["route"])
        if route_error:
            return route_error
    if not row["reviewer_user_id"]:
        return "Выберите согласующего."
    if not primary_count:
        return "Приложите основной документ DOCX."
    if (
        row["workflow_kind"] == "delivery"
        and row["reviewer_key"] == "bobur"
        and not row.get("final_reviewer_user_id")
    ):
        return "Перед Бобуром обязательно выберите предварительного согласующего."
    if not check or check["status"] in {"pending", "checking"}:
        return "Дождитесь проверки DOCX роботом на ПК референта."
    if check["status"] != "passed":
        return check["detail"] or "Проверка DOCX не пройдена. Загрузите исправленный документ."
    if (row.get("final_reviewer_key") or row["reviewer_key"]) not in check["reviewer_keys"]:
        return (
            "В DOCX не найдено место для подписи выбранного руководителя. "
            "Проверьте согласующего или исправьте документ с IT-специалистом."
        )
    return ""


async def _response(
    connection: AsyncConnection,
    row: RowMapping,
    current_user: AuthenticatedUser,
    *,
    may_approve: bool | None = None,
) -> AIReferentLetterResponse:
    letter_attachments = await _letter_attachments(connection, row["id"])
    mailing = (
        await load_recipients_for_letter(connection, row["id"]) if row.get("is_mailing") else None
    )
    permissions = await module_permissions_for_user(connection, current_user)
    replacement_ready = await _replacement_ready(connection, row)
    if may_approve is None:
        may_approve = permissions.get("ai_referent", {}).get("approve", False)
    primary_count = sum(
        item.document_role == "primary" and item.file_name.lower().endswith(".docx")
        for item in letter_attachments
    )
    actions, can_edit = _available_actions(
        row,
        current_user,
        may_approve=may_approve,
        attachment_count=primary_count,
        may_operate=permissions.get("ai_referent", {}).get("admin", False),
        replacement_file_ready=replacement_ready,
    )
    if mailing and any(item.status != "draft" for item in mailing):
        actions = []
        if any(item.status == "queued" for item in mailing) and (
            permissions.get("ai_referent", {}).get("admin", False)
            or (row["created_by_user_id"] == current_user.id
                and permissions.get("ai_referent", {}).get("edit", False))
        ):
            actions.append("stop_mailing")
        if permissions.get("ai_referent", {}).get("admin", False):
            if any(item.status == "failed" for item in mailing) and row["status"] != "sending":
                actions.append("retry_recipient")
            if any(item.status == "unknown" for item in mailing) and row["status"] != "sending":
                actions.extend(("confirm_recipient_sent", "confirm_recipient_not_sent"))
    retry_block = ""
    if (not mailing and row["status"] == "failed" and row["workflow_kind"] == "delivery"
            and permissions.get("ai_referent", {}).get("admin", False)):
        _, retry_block = await failed_delivery_retry_plan(connection, row)
        if not retry_block:
            actions.append("retry_failed_delivery")
    if not permissions.get("ai_referent", {}).get("edit", False):
        can_edit = False
        actions = [action for action in actions if action not in {"submit", "cancel"}]
    check = await letter_check(connection, row)
    submission_block = _submission_block_reason(row, primary_count, check) if can_edit else ""
    if "submit" in actions and submission_block:
        actions.remove("submit")
    return AIReferentLetterResponse(
        mailing_recipients=mailing,
        retry_block_reason=retry_block,
        submission_block_reason=submission_block,
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
        workflow_kind=row["workflow_kind"],
        source=row["source"],
        created_by_user_id=str(row["created_by_user_id"]),
        created_by_name=row["creator_name"],
        reviewer_user_id=str(row["reviewer_user_id"]) if row["reviewer_user_id"] else None,
        reviewer_name=row["reviewer_name"],
        final_reviewer_user_id=str(row["final_reviewer_user_id"])
        if row.get("final_reviewer_user_id")
        else None,
        final_reviewer_name=row.get("final_reviewer_name"),
        initial_reviewer_user_id=(
            str(row["initial_reviewer_user_id"]) if row.get("initial_reviewer_user_id") else None
        ),
        delivery_error=row.get("delivery_error") or "",
        revision=row["revision"],
        sent_at=row["sent_at"],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
        attachments=letter_attachments,
        events=await _letter_events(connection, row["id"]),
        available_actions=actions,
        document_check=check_response(check) if check else None,
        final_pdf_file_id=str(row["final_pdf_file_id"]) if row.get("final_pdf_file_id") else None,
        can_edit=can_edit,
        can_delete=not bool(mailing) and bool(
            _is_privileged(current_user)
            or (permissions.get("ai_referent", {}).get("edit")
                and row["created_by_user_id"] == current_user.id)
        ),
        can_replace_document=(
            row["status"] == "operator_revision"
            and permissions.get("ai_referent", {}).get("admin", False)
        ),
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
    metadata: dict[str, object] | None = None,
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
            metadata=metadata or {},
            created_at=datetime.now(UTC),
        )
    )


async def _save_mailing_recipients(
    connection: AsyncConnection,
    letter_id: UUID,
    recipients: list[AIReferentMailingRecipientInput],
) -> None:
    mailing = await replace_recipients(connection, letter_id, recipients)
    first = mailing[0]
    await connection.execute(update(ai_referent_letters).where(
        ai_referent_letters.c.id == letter_id,
    ).values(
        recipient_organization=f"Рассылка · {len(mailing)}",
        recipient_address=first.address,
        route=first.route,
    ))


async def create_letter(
    connection: AsyncConnection,
    current_user: AuthenticatedUser,
    payload: CreateAIReferentLetterRequest,
    *,
    workspace: bool = True,
) -> AIReferentLetterResponse:
    await connection.execute(select(ai_referent_configuration).with_for_update())
    await ensure_module_action(connection, current_user, "ai_referent", "create")
    if payload.mailing_recipients is not None and (not workspace or payload.operation_id is None):
        raise AIReferentServiceError(422, "Сохраните рассылку из Workspace с ID операции.")
    replay = await operation_replay(connection, current_user, payload, "create")
    if replay:
        return await load_letter(connection, current_user, replay)
    reviewer_key = await _validate_reviewer(connection, payload.reviewer_user_id)
    final_key = await _validate_reviewer(connection, payload.final_reviewer_user_id)
    if payload.workflow_kind == "sign_only":
        if payload.final_reviewer_user_id is not None:
            raise AIReferentServiceError(422, "Выберите одного согласующего для подписи.")
        if payload.route != "exat":
            raise AIReferentServiceError(
                422, "Подписание без отправки не использует канал доставки."
            )
    operation_payload = payload
    payload = payload.model_copy()
    reviewer_key, final_key = _normalize_review_route(payload, reviewer_key, final_key)
    now = datetime.now(UTC)
    letter_id = uuid4()
    await connection.execute(
        insert(ai_referent_letters).values(
            id=letter_id,
            is_mailing=payload.mailing_recipients is not None,
            outgoing_number=None,
            year_suffix=None,
            subject=payload.subject,
            recipient_organization=(
                "Подписание без отправки" if payload.workflow_kind == "sign_only"
                else payload.recipient_organization
            ),
            recipient_address=(
                "" if payload.workflow_kind == "sign_only" else payload.recipient_address
            ),
            route=payload.route,
            note=payload.note,
            status="draft",
            workflow_kind=payload.workflow_kind,
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
    if payload.mailing_recipients is not None:
        await _save_mailing_recipients(connection, letter_id, payload.mailing_recipients)
    await _event(
        connection,
        letter_id,
        current_user.id,
        "letter.created",
        from_status=None,
        to_status="draft",
    )
    await remember_operation(connection, current_user, operation_payload, "create", letter_id)
    return await _response(connection, await _letter_row(connection, letter_id), current_user)


async def load_letters(
    connection: AsyncConnection,
    current_user: AuthenticatedUser,
    *,
    query: str = "",
    status: str | None = None,
    workflow_kind: str | None = None,
    participation: Literal["all", "mine"] = "all",
    active_only: bool = False,
    history_only: bool = False,
    include_mailings: bool = True,
    awaiting_my_signature: bool = False,
    offset: int = 0,
    limit: int = 50,
) -> AIReferentRegistryResponse:
    await ensure_module_action(connection, current_user, "ai_referent", "view")
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
    if not include_mailings:
        statement = statement.where(ai_referent_letters.c.is_mailing.is_(False))
    # This is an additional selection, never a replacement for access control below.
    # Apply before counts and pagination so every page and summary use the same scope.
    if participation == "mine":
        statement = statement.where(or_(
            ai_referent_letters.c.created_by_user_id == current_user.id,
            ai_referent_letters.c.reviewer_user_id == current_user.id,
            ai_referent_letters.c.final_reviewer_user_id == current_user.id,
            ai_referent_letters.c.initial_reviewer_user_id == current_user.id,
        ))
    if awaiting_my_signature:
        # Scope before counting/pagination, even for administrators. A future final
        # reviewer is not the current reviewer until the previous step approves.
        statement = statement.where(
            ai_referent_letters.c.status == "pending_review",
            ai_referent_letters.c.reviewer_user_id == current_user.id,
        )
        if not permissions.get("ai_referent", {}).get("approve", False):
            statement = statement.where(false())
    if history_only:
        statement = statement.where(ai_referent_letters.c.status == "sent")
        if not (
            _may_view_all_sent(current_user)
            or permissions.get("ai_referent", {}).get("admin", False)
        ):
            statement = statement.where(
                ai_referent_letters.c.created_by_user_id == current_user.id
            )
    elif not may_view_all_workspace_letters(current_user):
        participants = or_(
            ai_referent_letters.c.created_by_user_id == current_user.id,
            ai_referent_letters.c.reviewer_user_id == current_user.id,
            ai_referent_letters.c.final_reviewer_user_id == current_user.id,
            ai_referent_letters.c.initial_reviewer_user_id == current_user.id,
        )
        may_operate = permissions.get("ai_referent", {}).get("admin", False)
        non_sent = and_(ai_referent_letters.c.status != "sent", participants)
        if may_operate:
            non_sent = or_(
                non_sent,
                ai_referent_letters.c.status.in_(OPERATOR_VISIBLE_STATUSES),
                and_(
                    ai_referent_letters.c.is_mailing.is_(True),
                    ai_referent_letters.c.status.in_(MAILING_OPERATOR_STATUSES),
                ),
            )
        sent = ai_referent_letters.c.status == "sent"
        if not _may_view_all_sent(current_user) and not may_operate:
            sent = and_(sent, ai_referent_letters.c.created_by_user_id == current_user.id)
        statement = statement.where(
            or_(sent, non_sent)
        )
    if status:
        statement = statement.where(ai_referent_letters.c.status == status)
    if active_only:
        statement = statement.where(ai_referent_letters.c.status.not_in(_FINAL_STATUSES))
    if workflow_kind:
        statement = statement.where(ai_referent_letters.c.workflow_kind == workflow_kind)
    cleaned = query.strip()
    if cleaned:
        pattern = f"%{cleaned}%"
        statement = statement.where(
            or_(
                ai_referent_letters.c.subject.ilike(pattern),
                ai_referent_letters.c.recipient_organization.ilike(pattern),
                ai_referent_letters.c.recipient_address.ilike(pattern),
                select(ai_referent_mailing_recipients.c.id).where(
                    ai_referent_mailing_recipients.c.letter_id == ai_referent_letters.c.id,
                    or_(
                        ai_referent_mailing_recipients.c.address.ilike(pattern),
                        ai_referent_mailing_recipients.c.organization.ilike(pattern),
                    ),
                ).exists(),
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
        participation=participation,
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
        signed_count=counts.get("signed", 0),
    )


async def load_letter(
    connection: AsyncConnection,
    current_user: AuthenticatedUser,
    letter_id: UUID,
) -> AIReferentLetterResponse:
    await ensure_module_action(connection, current_user, "ai_referent", "view")
    row = await _letter_row(connection, letter_id)
    permissions = await module_permissions_for_user(connection, current_user)
    if not _may_view(
        row, current_user, may_operate=permissions.get("ai_referent", {}).get("admin", False)
    ):
        raise AIReferentServiceError(404, "Исходящее письмо не найдено.")
    return await _response(connection, row, current_user)


async def update_letter(
    connection: AsyncConnection,
    current_user: AuthenticatedUser,
    letter_id: UUID,
    payload: UpdateAIReferentLetterRequest,
    *,
    workspace: bool = True,
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
    if bool(row.get("is_mailing")) != (payload.mailing_recipients is not None):
        raise AIReferentServiceError(422, "Режим адресатов зафиксирован при создании черновика.")
    if row.get("is_mailing") and not workspace:
        raise AIReferentServiceError(403, "Редактируйте рассылку в Workspace.")
    if payload.workflow_kind != row["workflow_kind"]:
        raise AIReferentServiceError(422, "Вид заявки нельзя изменить после создания.")
    if row["status"] not in _EDITABLE_STATUSES:
        raise AIReferentServiceError(409, "На текущем этапе письмо нельзя редактировать.")
    if row["created_by_user_id"] != current_user.id:
        raise AIReferentServiceError(403, "Редактировать черновик может только его автор.")
    reviewer_key = await _validate_reviewer(connection, payload.reviewer_user_id)
    final_key = await _validate_reviewer(connection, payload.final_reviewer_user_id)
    if row["workflow_kind"] == "sign_only" and (
        payload.final_reviewer_user_id is not None or payload.route != "exat"
    ):
        raise AIReferentServiceError(422, "Для подписи выберите одного согласующего.")
    operation_payload = payload
    payload = payload.model_copy()
    reviewer_key, final_key = _normalize_review_route(payload, reviewer_key, final_key)
    await connection.execute(
        update(ai_referent_letters)
        .where(ai_referent_letters.c.id == letter_id)
        .values(
            subject=payload.subject,
            recipient_organization=(
                "Подписание без отправки" if row["workflow_kind"] == "sign_only"
                else payload.recipient_organization
            ),
            recipient_address=(
                "" if row["workflow_kind"] == "sign_only" else payload.recipient_address
            ),
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
    if payload.mailing_recipients is not None:
        await _save_mailing_recipients(connection, letter_id, payload.mailing_recipients)
    await _event(
        connection,
        letter_id,
        current_user.id,
        "letter.updated",
        from_status=row["status"],
        to_status=row["status"],
    )
    await remember_operation(connection, current_user, operation_payload, scope, letter_id)
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
    *,
    workspace: bool = True,
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
    mailing = (
        await load_recipients_for_letter(connection, letter_id) if row.get("is_mailing") else None
    )
    recipient_actions = {
        "stop_mailing", "retry_recipient", "confirm_recipient_sent", "confirm_recipient_not_sent",
    }
    if mailing is not None:
        await ensure_module_action(connection, current_user, "ai_referent", "view")
        if not workspace or payload.mailing is not True:
            raise AIReferentServiceError(403, "Откройте рассылку в актуальной версии Workspace.")
        if action in {"retry_failed_delivery", "prepare_replacement", "replace_document",
                      "mark_sent", "confirm_sent", "confirm_not_sent"} or (
            action not in recipient_actions and any(item.status != "draft" for item in mailing)
        ):
            raise AIReferentServiceError(409, "Выберите действие для получателя рассылки.")
    elif action in recipient_actions or payload.recipient_id is not None:
        raise AIReferentServiceError(422, "Действие доступно в рассылке.")
    current_status = row["status"]
    is_creator = row["created_by_user_id"] == current_user.id
    is_reviewer = row["reviewer_user_id"] == current_user.id
    next_status: str
    values: dict[str, object] = {}
    command_kind: str | None = None
    if payload.comment_audio_id is not None:
        if action != "return_for_revision":
            raise AIReferentServiceError(422, "Голосовая запись предназначена для возврата письма.")
        await decision_audio(
            connection, payload.comment_audio_id, letter_id, current_user.id, row["revision"]
        )

    if action == "stop_mailing":
        await ensure_module_action(
            connection, current_user, "ai_referent", "edit" if is_creator else "admin"
        )
        if not await stop_pending(connection, letter_id):
            raise AIReferentServiceError(409, "В очереди больше нет получателей.")
        next_status = await mailing_status(connection, letter_id)
    elif action in recipient_actions:
        await ensure_module_action(connection, current_user, "ai_referent", "admin")
        recipient = next((item for item in mailing or [] if item.id == payload.recipient_id), None)
        expected = "failed" if action == "retry_recipient" else "unknown"
        if recipient is None or recipient.status != expected or current_status == "sending":
            raise AIReferentServiceError(409, "Состояние отправки адресату изменилось.")
        if len(payload.comment) < 12:
            raise AIReferentServiceError(422, "Укажите основание или результат сверки.")
        if action == "retry_recipient":
            await enqueue_recipient(connection, row, recipient, current_user.id)
        else:
            await set_recipient_status(
                connection, recipient.id,
                "sent" if action == "confirm_recipient_sent" else "failed", payload.comment,
            )
        next_status = await mailing_status(connection, letter_id)
        if next_status == "sent":
            values["sent_at"] = datetime.now(UTC)
    elif action == "remind":
        await ensure_module_action(connection, current_user, "ai_referent", "edit")
        if current_status != "pending_review" or not is_creator:
            raise AIReferentServiceError(403, "Напомнить о согласовании может автор письма.")
        last_reminder = await connection.scalar(
            select(func.max(ai_referent_events.c.created_at)).where(
                ai_referent_events.c.letter_id == letter_id,
                ai_referent_events.c.event_type == "letter.remind",
            )
        )
        if last_reminder and datetime.now(UTC) - last_reminder < timedelta(minutes=5):
            raise AIReferentServiceError(429, "Повторное напоминание доступно через 5 минут.")
        next_status = current_status
    elif action == "reject":
        await ensure_module_action(connection, current_user, "ai_referent", "approve")
        if not is_reviewer:
            raise AIReferentServiceError(403, "Отклонить письмо может назначенный согласующий.")
        if current_status != "pending_review":
            raise AIReferentServiceError(409, "Письмо уже не ожидает согласования.")
        await _validate_reviewer(connection, current_user.id)
        if len(payload.comment) < 3:
            raise AIReferentServiceError(422, "Укажите причину окончательного отказа.")
        next_status = "rejected"
    elif row["workflow_kind"] == "sign_only":
        if action == "submit":
            await ensure_module_action(connection, current_user, "ai_referent", "edit")
            if current_status not in _EDITABLE_STATUSES or not is_creator:
                raise AIReferentServiceError(403, "Отправить на подпись может автор.")
            if row["reviewer_user_id"] is None:
                raise AIReferentServiceError(422, "Выберите согласующего.")
            values["reviewer_key"] = await _validate_reviewer(
                connection, row["reviewer_user_id"]
            )
            primary_count = await connection.scalar(
                select(func.count()).select_from(attachments).where(
                    attachments.c.owner_type == "ai_referent_letter",
                    attachments.c.owner_id == letter_id,
                    attachments.c.document_role == "primary",
                    attachments.c.file_name.ilike("%.docx"),
                )
            )
            if not primary_count:
                raise AIReferentServiceError(422, "Нужен основной DOCX для подписи.")
            await require_passed(connection, row)
            next_status = "pending_review"
        elif action == "approve":
            await ensure_module_action(connection, current_user, "ai_referent", "approve")
            if current_status != "pending_review" or not is_reviewer:
                raise AIReferentServiceError(403, "Подписать может только выбранный согласующий.")
            await _validate_reviewer(connection, current_user.id)
            if not await connection.scalar(
                select(ai_referent_configuration.c.execution_agent_id)
            ):
                raise AIReferentServiceError(409, "Робот референта ещё не подключён.")
            next_status = "queued"
            command_kind = "sign_only"
        elif action == "return_for_revision":
            await ensure_module_action(connection, current_user, "ai_referent", "approve")
            if current_status not in {"pending_review", "failed"} or not is_reviewer:
                raise AIReferentServiceError(403, "Вернуть может выбранный согласующий.")
            if len(payload.comment) < 3 and payload.comment_audio_id is None:
                raise AIReferentServiceError(422, "Укажите причину возврата.")
            next_status = "needs_revision"
        elif action == "retry_delivery":
            await ensure_module_action(connection, current_user, "ai_referent", "approve")
            if current_status != "failed" or not is_reviewer:
                raise AIReferentServiceError(403, "Повторить подпись может согласующий.")
            next_status = "queued"
            command_kind = "sign_only"
        elif action == "cancel":
            await ensure_module_action(connection, current_user, "ai_referent", "edit")
            if current_status in _FINAL_STATUSES | {"queued", "sending"} or not is_creator:
                raise AIReferentServiceError(403, "Заявку нельзя отменить на этом этапе.")
            next_status = "cancelled"
        else:
            raise AIReferentServiceError(422, "Этот маршрут только для подписи, без отправки.")
    elif action == "submit":
        await ensure_module_action(connection, current_user, "ai_referent", "edit")
        if current_status not in _EDITABLE_STATUSES:
            raise AIReferentServiceError(409, "Письмо не готово к повторному согласованию.")
        if not is_creator:
            raise AIReferentServiceError(403, "Отправить письмо может его автор.")
        if not row["recipient_organization"] or not row["recipient_address"]:
            raise AIReferentServiceError(422, "Выберите организацию и адрес получателя.")
        route_error = delivery_route_error(row["recipient_address"], row["route"])
        if route_error:
            raise AIReferentServiceError(422, route_error)
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
        if values["reviewer_key"] == "bobur" and not row.get("final_reviewer_user_id"):
            raise AIReferentServiceError(
                422, "Перед Бобуром обязательно выберите предварительного согласующего."
            )
        await require_passed(connection, row)
        next_status = "pending_review"
    elif action == "retry_failed_delivery":
        await ensure_module_action(connection, current_user, "ai_referent", "admin")
        command_kind, retry_block = await failed_delivery_retry_plan(connection, row)
        if retry_block:
            raise AIReferentServiceError(409, retry_block)
        if len(payload.comment) < 12:
            raise AIReferentServiceError(
                422, "Укажите результат проверки журнала E-XAT/Webmail: письмо не отправлено."
            )
        next_status = "queued"
        values["delivery_error"] = ""
    elif action == "prepare_replacement":
        await ensure_module_action(connection, current_user, "ai_referent", "admin")
        if current_status != "operator_revision" or not await _replacement_ready(connection, row):
            raise AIReferentServiceError(409, "Сначала загрузите новый DOCX или готовый PDF.")
        next_status, command_kind = "queued", "reprepare"
    elif action == "release_delivery" or (
        action == "return_for_revision" and current_status == "awaiting_final_send"
    ):
        await ensure_module_action(connection, current_user, "ai_referent", "edit")
        if not is_creator:
            raise AIReferentServiceError(403, "Итоговый PDF подтверждает отправитель письма.")
        if current_status != "awaiting_final_send" or not row.get("final_pdf_file_id"):
            raise AIReferentServiceError(409, "Подписанный документ не ожидает решения.")
        if action == "return_for_revision":
            if len(payload.comment) < 3 and payload.comment_audio_id is None:
                raise AIReferentServiceError(422, "Укажите причину возврата на доработку.")
            next_status = "needs_revision"
        else:
            if mailing is None:
                next_status, command_kind = "queued", "dispatch"
            else:
                next_status = "referent_review_pending"
    elif action in {
        "send",
        "confirm_sent",
        "confirm_not_sent",
        "mark_sent",
        "replace_document",
    } or (action == "return_for_revision" and current_status == "referent_review_pending"):
        await ensure_module_action(connection, current_user, "ai_referent", "admin")
        expected = (
            "referent_review_pending"
            if action in {"send", "return_for_revision", "mark_sent", "replace_document"}
            else "delivery_unknown"
        )
        if current_status != expected:
            raise AIReferentServiceError(409, "Этап отправки уже изменился.")
        if (
            action in {"confirm_sent", "confirm_not_sent", "return_for_revision"}
            and len(payload.comment) < 3
            and payload.comment_audio_id is None
        ):
            raise AIReferentServiceError(422, "Укажите основание и результат проверки доставки.")
        next_status = {
            "send": "queued",
            "confirm_sent": "sent",
            "confirm_not_sent": "referent_review_pending",
            "return_for_revision": "needs_revision",
            "mark_sent": "queued",
            "replace_document": "queued",
        }[action]
        if action == "send":
            if mailing is None:
                command_kind = "send"
            else:
                if not row["final_pdf_file_id"]:
                    raise AIReferentServiceError(409, "Подтвердите итоговый PDF рассылки.")
                for recipient in mailing:
                    await enqueue_recipient(connection, row, recipient, current_user.id)
        elif action == "mark_sent":
            command_kind = "record_sent"
        elif action == "replace_document":
            command_kind = "replace"
        if action == "confirm_sent":
            values["sent_at"] = datetime.now(UTC)
        values["delivery_error"] = ""
    elif action in {
        "approve",
        "return_for_revision",
        "queue_delivery",
        "retry_delivery",
    }:
        await ensure_module_action(connection, current_user, "ai_referent", "approve")
        if not is_reviewer:
            raise AIReferentServiceError(403, "Действие доступно назначенному согласующему.")
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
                next_status = "queued"
                command_kind = "prepare"
        elif action == "return_for_revision":
            if current_status not in {"pending_review", "awaiting_final_send", "failed"}:
                raise AIReferentServiceError(409, "Письмо не ожидает согласования.")
            if len(payload.comment) < 3 and payload.comment_audio_id is None:
                raise AIReferentServiceError(422, "Укажите причину возврата на доработку.")
            next_status = "needs_revision"
        else:
            expected = "approved" if action == "queue_delivery" else "failed"
            if current_status != expected:
                raise AIReferentServiceError(409, "Письмо нельзя поставить в очередь сейчас.")
            next_status = "queued"
            command_kind = "prepare"
    elif action == "cancel":
        await ensure_module_action(connection, current_user, "ai_referent", "edit")
        if current_status in _FINAL_STATUSES | {"queued", "sending", "delivery_unknown"}:
            raise AIReferentServiceError(403, "Отменить письмо может его автор.")
        if current_status == "operator_revision" or not is_creator:
            raise AIReferentServiceError(403, "Отменить письмо может его автор.")
        next_status = "cancelled"
        if row["outgoing_number"] is not None and mailing is None:
            next_status, command_kind = "queued", "cancel"
    else:
        raise AIReferentServiceError(422, "Неизвестное действие.")

    now = datetime.now(UTC)
    next_revision = row["revision"] + 1
    if next_status == "needs_revision":
        values["final_pdf_file_id"] = None
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
    if next_status == "queued" and (mailing is None or command_kind is not None):
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
        metadata=(
            {"recipientId": str(payload.recipient_id)} if payload.recipient_id
            else {"audioId": str(payload.comment_audio_id)} if payload.comment_audio_id else None
        ),
    )
    await connection.execute(
        insert(audit_events).values(
            id=uuid4(),
            actor_user_id=current_user.id,
            action=f"ai_referent.{action}",
            target_type="ai_referent_letter",
            target_id=letter_id,
            details={
                "fromStatus": current_status, "toStatus": next_status,
                **({"verification": payload.comment, "commandKind": command_kind,
                    "approvalPreserved": True} if action == "retry_failed_delivery" else {}),
            },
            created_at=now,
        )
    )
    await remember_operation(connection, current_user, payload, scope, letter_id)
    updated = await _letter_row(connection, letter_id)
    titles = {
        "submit": "Письмо поступило на согласование",
        "approve": "Письмо согласовано",
        "return_for_revision": "Письмо возвращено с комментарием",
        "reject": "Письмо отклонено согласующим",
        "queue_delivery": "Подготовка подписанного письма",
        "retry_delivery": "Повторная подготовка письма",
        "retry_failed_delivery": "Администратор повторяет отправку без нового согласования",
        "release_delivery": "Окончательный PDF подтверждён: подготовка отправки",
        "send": "Письмо передано на отправку",
        "stop_mailing": "Очередь рассылки остановлена",
        "retry_recipient": "Адресат повторно поставлен в очередь",
        "confirm_recipient_sent": "Результат отправки адресату подтверждён",
        "confirm_recipient_not_sent": "Подтверждено отсутствие отправки адресату",
        "cancel": "Письмо отменено",
        "confirm_sent": "Доставка письма подтверждена",
        "confirm_not_sent": "Отсутствие доставки подтверждено",
        "remind": "Напоминание: письмо ожидает вашего решения",
        "replace_document": "Администратор заменяет документ без повторного согласования",
        "mark_sent": "Референт подтвердил ручную отправку",
        "prepare_replacement": "Администратор подтвердил новую версию письма",
    }
    if row["workflow_kind"] == "sign_only":
        titles.update({
            "submit": "Документ поступил на подпись",
            "approve": "Подпись одобрена — робот готовит отдельные PDF",
            "retry_delivery": "Робот повторно готовит подписанные PDF",
            "cancel": "Заявка на подпись отменена",
        })
    await notify_letter(connection, updated, titles[action], payload.comment)
    return await _response(connection, updated, current_user)
