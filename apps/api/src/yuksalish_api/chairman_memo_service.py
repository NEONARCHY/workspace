# ruff: noqa: RUF001
"""Private memoranda: authorised requesters -> named chair, no administrative bypass."""

import hashlib
import re
from datetime import UTC, datetime
from uuid import UUID, uuid4
from zoneinfo import ZoneInfo

from sqlalchemy import and_, false, func, insert, or_, select, true, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.engine import RowMapping
from sqlalchemy.ext.asyncio import AsyncConnection
from sqlalchemy.sql.elements import ColumnElement
from starlette.concurrency import run_in_threadpool

from .access_control import ensure_module_action, module_permissions_for_user
from .auth import AuthenticatedUser, load_authenticated_user
from .chairman_memo_pdf import memo_pdf
from .chairman_memo_schemas import (
    MemoContext,
    MemoCreate,
    MemoDecision,
    MemoDetail,
    MemoRegistry,
    MemoRevision,
    MemoSummary,
    MemoUpdate,
)
from .chairman_memo_tables import memoranda as memos
from .errors import WorkspaceRepositoryError as Error
from .memo_document_text import DocumentScript, document_parts
from .memo_processing_service import actors, flags, inbox, process, processing_visible
from .position_policy import is_executive_leader
from .tables import audit_events, hr_settings, workspace_notifications

PRIVATE = {"Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff"}


def is_memo_deputy(title: str | None) -> bool:
    apostrophes = str.maketrans({"‘": "'", "’": "'", "ʻ": "'", "ʼ": "'", "`": "'"})
    normalized = " ".join((title or "").translate(apostrophes).casefold().split())
    return bool(re.fullmatch(r"rais(?:ning)? (?:birinchi )?o'rinbosari", normalized))


async def can_create(
    c: AsyncConnection,
    user: AuthenticatedUser,
    additional_requesters: frozenset[UUID] = frozenset(),
) -> bool:
    hr_id = await c.scalar(select(hr_settings.c.hr_user_id).where(hr_settings.c.id == 1))
    return user.id == hr_id or is_memo_deputy(user.job_title) or user.id in additional_requesters


async def chair(c: AsyncConnection) -> AuthenticatedUser:
    chair_id = await c.scalar(select(hr_settings.c.chair_user_id).where(hr_settings.c.id == 1))
    person = await load_authenticated_user(c, chair_id) if chair_id else None
    if person is None or not is_executive_leader(person.job_title):
        raise Error(409, "Назначьте действующего председателя в настройках HR")
    return person


def visible(user: AuthenticatedUser) -> ColumnElement[bool]:
    return or_(
        processing_visible(user),
        memos.c.requester_user_id == user.id,
        and_(
            memos.c.chair_user_id == user.id,
            true() if is_executive_leader(user.job_title) else false(),
            memos.c.status != "draft",
        ),
    )


async def context(
    c: AsyncConnection,
    user: AuthenticatedUser,
    additional_requesters: frozenset[UUID] = frozenset(),
) -> MemoContext:
    await ensure_module_action(c, user, "home", "view")
    access = (await module_permissions_for_user(c, user))["home"]
    creator = await can_create(c, user, additional_requesters) and access["create"]
    pending = int(
        await c.scalar(
            select(func.count())
            .select_from(memos)
            .where(
                memos.c.chair_user_id == user.id,
                memos.c.status == "pending",
                true() if is_executive_leader(user.job_title) and access["approve"] else false(),
            )
        )
        or 0
    )
    processing_count = await inbox(c, user) if access["approve"] else 0
    pending += processing_count
    own = bool(await c.scalar(select(memos.c.id).where(visible(user)).limit(1)))
    configured_id = await c.scalar(select(hr_settings.c.chair_user_id).where(hr_settings.c.id == 1))
    reviewer = (
        is_executive_leader(user.job_title)
        and access["approve"]
        and (user.id == configured_id or pending > 0)
    )
    configured_processors = (
        await c.execute(
            select(hr_settings.c.hr_user_id, hr_settings.c.accountant_user_id).where(
                hr_settings.c.id == 1
            )
        )
    ).first()
    reviewer = reviewer or (
        access["approve"]
        and bool(processing_count or (configured_processors and user.id in configured_processors))
    )
    name, error = None, None
    if creator or reviewer:
        try:
            name = (await chair(c)).full_name
        except Error as problem:
            error = problem.detail
    return MemoContext(
        requester_name=user.full_name,
        requester_title=user.job_title or "",
        enabled=creator or reviewer or own,
        can_create=creator,
        can_review=reviewer,
        pending_count=pending,
        chair_name=name,
        configuration_error=error,
        document_labels={
            script: document_parts(name or "", user.full_name, user.job_title or "", "", script)
            for script in ("latin", "cyrillic")
        },
    )


async def registry(c: AsyncConnection, user: AuthenticatedUser, offset: int) -> MemoRegistry:
    await ensure_module_action(c, user, "home", "view")
    rows = (
        (
            await c.execute(
                select(
                    memos.c.id,
                    memos.c.title,
                    memos.c.status,
                    memos.c.revision,
                    memos.c.requester_name,
                    memos.c.chair_name,
                    memos.c.created_at,
                    memos.c.submitted_at,
                    memos.c.decided_at,
                )
                .where(visible(user))
                .order_by(
                    (memos.c.status == "pending").desc(),
                    memos.c.created_at.desc(),
                    memos.c.id,
                )
                .offset(offset)
                .limit(50)
            )
        )
        .mappings()
        .all()
    )
    total = int(await c.scalar(select(func.count()).select_from(memos).where(visible(user))) or 0)
    return MemoRegistry(
        items=[MemoSummary.model_validate({**dict(r), "id": str(r["id"])}) for r in rows],
        total=total,
    )


async def row(
    c: AsyncConnection, user: AuthenticatedUser, memo_id: UUID, *, lock: bool = False
) -> RowMapping:
    await ensure_module_action(c, user, "home", "view")
    query = select(memos).where(memos.c.id == memo_id, visible(user))
    result = (await c.execute(query.with_for_update() if lock else query)).mappings().first()
    if result is None:
        raise Error(404, "Билдирги не найдена")
    return result


async def detail(
    c: AsyncConnection,
    user: AuthenticatedUser,
    memo_id: UUID,
    additional_requesters: frozenset[UUID] = frozenset(),
) -> MemoDetail:
    record = await row(c, user, memo_id)
    access = (await module_permissions_for_user(c, user))["home"]
    owner = record["requester_user_id"] == user.id
    editable = (
        owner
        and record["status"] in {"draft", "needs_revision"}
        and await can_create(c, user, additional_requesters)
        and access["edit"]
    )
    return MemoDetail.model_validate(
        {
            **dict(record),
            "id": str(record["id"]),
            **await flags(c, user, record, access["approve"]),
            "document_labels": document_parts(
                record["chair_name"],
                record["requester_name"],
                record["requester_title"],
                record["body"],
                record["document_script"],
            )
            if record["document_script"]
            else {},
            "can_edit": editable,
            "can_submit": editable and access["create"],
            "can_decide": record["status"] == "pending"
            and record["chair_user_id"] == user.id
            and is_executive_leader(user.job_title)
            and access["approve"],
            "can_withdraw": owner and record["status"] == "pending" and access["edit"],
            "has_pdf": record["pdf_content"] is not None,
            "pdf_byte_size": len(record["pdf_content"] or b""),
        }
    )


def check_revision(record: RowMapping, value: MemoRevision) -> None:
    if record["revision"] != value.expected_revision:
        raise Error(409, "Билдирги уже изменилась. Обновите карточку перед действием")


async def pdf_values(
    user: AuthenticatedUser, recipient: AuthenticatedUser, body: str, script: DocumentScript
) -> dict[str, object]:
    pdf = await run_in_threadpool(
        memo_pdf,
        chair=recipient.full_name,
        requester=user.full_name,
        job_title=user.job_title or "",
        body=body,
        script=script,
        dated=datetime.now(ZoneInfo("Asia/Tashkent")).date(),
    )
    parts = document_parts(recipient.full_name, user.full_name, user.job_title or "", body, script)
    return {
        "document_script": script,
        "pdf_content": pdf,
        "pdf_sha256": hashlib.sha256(pdf).hexdigest(),
        "requester_name": parts["requester"],
        "requester_title": parts["job_title"],
        "chair_name": parts["recipient"][:-2],
        "chair_user_id": recipient.id,
    }


async def audit(
    c: AsyncConnection,
    actor: UUID,
    memo_id: UUID,
    action: str,
    revision: int,
    pdf_hash: str,
    *,
    from_status: str | None = None,
    to_status: str | None = None,
    comment: str = "",
    order_hash: str | None = None,
) -> None:
    await c.execute(
        insert(audit_events).values(
            id=uuid4(),
            actor_user_id=actor,
            action="chairman_memo." + action,
            target_type="chairman_memo",
            target_id=memo_id,
            details={
                "revision": revision,
                "pdfSha256": pdf_hash,
                "orderSha256": order_hash,
                "fromStatus": from_status,
                "toStatus": to_status,
                "comment": comment,
            },
            created_at=datetime.now(UTC),
        )
    )


async def create(
    c: AsyncConnection,
    user: AuthenticatedUser,
    value: MemoCreate,
    additional_requesters: frozenset[UUID] = frozenset(),
) -> MemoDetail:
    await ensure_module_action(c, user, "home", "create")
    if not await can_create(c, user, additional_requesters):
        raise Error(403, "Нет права подготовки билдирги председателю")
    recipient = await chair(c)
    if recipient.id == user.id:
        raise Error(409, "Нельзя направить билдирги самому себе")
    values = await pdf_values(user, recipient, value.body, value.document_script)
    now = datetime.now(UTC)
    inserted = await c.scalar(
        pg_insert(memos)
        .values(
            id=value.request_id,
            requester_user_id=user.id,
            title=value.title,
            body=value.body,
            status="draft",
            revision=1,
            decision_comment="",
            created_at=now,
            updated_at=now,
            **values,
        )
        .on_conflict_do_nothing(index_elements=[memos.c.id])
        .returning(memos.c.id)
    )
    if inserted is None:
        existing = await row(c, user, value.request_id)
        if (
            existing["requester_user_id"] != user.id
            or existing["title"] != value.title
            or existing["document_script"] != value.document_script
            or existing["body"] != value.body
            or existing["status"] != "draft"
        ):
            raise Error(409, "Этот запрос уже использован. Обновите список билдирги")
    else:
        await audit(c, user.id, value.request_id, "created", 1, str(values["pdf_sha256"]))
    return await detail(c, user, value.request_id, additional_requesters)


async def save(
    c: AsyncConnection,
    user: AuthenticatedUser,
    memo_id: UUID,
    value: MemoUpdate,
    additional_requesters: frozenset[UUID] = frozenset(),
) -> MemoDetail:
    await ensure_module_action(c, user, "home", "edit")
    record = await row(c, user, memo_id, lock=True)
    check_revision(record, value)
    if record["requester_user_id"] != user.id or record["status"] not in {
        "draft",
        "needs_revision",
    }:
        raise Error(409, "Изменять можно только свою неотправленную билдирги")
    if not await can_create(c, user, additional_requesters):
        raise Error(403, "Право подготовки билдирги больше недоступно")
    recipient = await chair(c)
    if recipient.id == user.id:
        raise Error(409, "Нельзя направить билдирги самому себе")
    values = await pdf_values(user, recipient, value.body, value.document_script)
    revision = record["revision"] + 1
    await c.execute(
        update(memos)
        .where(memos.c.id == memo_id)
        .values(
            title=value.title,
            body=value.body,
            revision=revision,
            updated_at=datetime.now(UTC),
            **values,
        )
    )
    await audit(c, user.id, memo_id, "edited", revision, str(values["pdf_sha256"]))
    return await detail(c, user, memo_id, additional_requesters)


async def notify(
    c: AsyncConnection,
    record: RowMapping,
    user_id: UUID,
    title: str,
    *,
    action: bool,
    status: str,
    revision: int,
) -> None:
    await c.execute(
        pg_insert(workspace_notifications)
        .values(
            id=uuid4(),
            user_id=user_id,
            event_key=f"chairman-memo:{record['id']}:{revision}:{status}:{user_id}",
            kind="approval",
            priority="attention" if action else "normal",
            title=title,
            body=record["title"],
            section="home",
            entity_id=record["id"],
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


async def transition(
    c: AsyncConnection,
    user: AuthenticatedUser,
    memo_id: UUID,
    value: MemoRevision,
    action: str,
    additional_requesters: frozenset[UUID] = frozenset(),
) -> MemoDetail:
    record = await row(c, user, memo_id, lock=True)
    check_revision(record, value)
    if action in {"start_processing", "hr_complete", "complete"}:
        return await process(c, user, record, action, additional_requesters)
    now, revision = datetime.now(UTC), record["revision"] + 1
    values: dict[str, object] = {"revision": revision, "updated_at": now}
    if action == "submit":
        await ensure_module_action(c, user, "home", "create")
        if record["requester_user_id"] != user.id or not await can_create(
            c, user, additional_requesters
        ):
            raise Error(403, "Отправить билдирги может только её заявитель с действующим доступом")
        if record["status"] not in {"draft", "needs_revision"}:
            raise Error(409, "Билдирги уже отправлена")
        recipient = await chair(c)
        if recipient.id == user.id:
            raise Error(409, "Нельзя согласовать собственную билдирги")
        values.update(
            await pdf_values(
                user, recipient, record["body"], record["document_script"] or "cyrillic"
            )
        )
        values.update(status="pending", submitted_at=now, decided_at=None, decision_comment="")
        target, title, needs_action = recipient.id, "Билдирги на вашем согласовании", True
    elif action == "withdraw":
        await ensure_module_action(c, user, "home", "edit")
        if record["requester_user_id"] != user.id or record["status"] != "pending":
            raise Error(409, "Отозвать можно только свою ожидающую решения билдирги")
        values.update(status="draft", submitted_at=None)
        target, title, needs_action = user.id, "Билдирги отозвана", False
    else:
        await ensure_module_action(c, user, "home", "approve")
        if record["chair_user_id"] != user.id or not is_executive_leader(user.job_title):
            raise Error(403, "Решение принимает только назначенный председатель")
        if record["status"] != "pending" or not isinstance(value, MemoDecision):
            raise Error(409, "Билдирги уже рассмотрена или отозвана")
        if value.decision == "return" and not value.comment:
            raise Error(422, "Укажите, что заявителю нужно исправить")
        values.update(
            status="hr_pending" if value.decision == "approve" else "needs_revision",
            decided_at=now,
            decision_comment=value.comment,
        )
        if value.decision == "approve":
            values.update(await actors(c, user.id))
        target, title, needs_action = (
            record["requester_user_id"],
            (
                "Председатель одобрил вашу билдирги"
                if value.decision == "approve"
                else "Билдирги возвращена на доработку"
            ),
            value.decision == "return",
        )
    await c.execute(
        update(workspace_notifications)
        .where(
            workspace_notifications.c.entity_id == memo_id,
            workspace_notifications.c.event_key.like("chairman-memo:%"),
            workspace_notifications.c.requires_action.is_(True),
            workspace_notifications.c.resolved_at.is_(None),
        )
        .values(resolved_at=now)
    )
    await c.execute(update(memos).where(memos.c.id == memo_id).values(**values))
    await notify(
        c,
        record,
        target,
        title,
        action=needs_action,
        status=str(values["status"]),
        revision=revision,
    )
    if values["status"] == "hr_pending":
        hr_target = values["hr_user_id"]
        if not isinstance(hr_target, UUID):
            raise Error(409, "Кадровик не назначен. Передача остановлена")
        await notify(
            c,
            record,
            hr_target,
            "Билдирги: подготовьте и прикрепите приказ",
            action=True,
            status="hr_pending",
            revision=revision,
        )
    await audit(
        c,
        user.id,
        memo_id,
        action,
        revision,
        str(values.get("pdf_sha256", record["pdf_sha256"])),
        from_status=record["status"],
        to_status=str(values["status"]),
        comment=value.comment if isinstance(value, MemoDecision) else "",
    )
    return await detail(c, user, memo_id, additional_requesters)
