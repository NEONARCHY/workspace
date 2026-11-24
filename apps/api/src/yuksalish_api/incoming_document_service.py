"""Local incoming registry; execution reuses the protected task lifecycle."""

# ruff: noqa: RUF001

import hashlib
from contextlib import suppress
from datetime import UTC, datetime
from pathlib import PurePosixPath
from typing import Any, Literal
from uuid import UUID, uuid4

from fastapi import HTTPException
from sqlalchemy import Select, and_, exists, false, func, insert, or_, select, true
from sqlalchemy.engine import RowMapping
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncConnection
from sqlalchemy.sql.elements import ColumnElement

from .access_control import ensure_module_action, module_permissions_for_user
from .ai_referent_files_service import file_metadata, packet_entries
from .ai_referent_incoming_access import incoming_scope
from .auth import AuthenticatedUser
from .errors import WorkspaceRepositoryError
from .incoming_document_schemas import (
    IncomingDocument,
    IncomingDocumentAssign,
    IncomingDocumentDetail,
    IncomingDocumentFile,
    IncomingDocumentPage,
    IncomingExecution,
    IncomingExecutionDetail,
)
from .incoming_document_tables import incoming_document_executions as executions
from .object_storage import ObjectStorage, ObjectStorageError
from .repository import (
    _attachment,
    _task_access_row,
    _task_response,
    create_attachment,
    create_task,
)
from .tables import ai_referent_incoming_letters as incoming
from .tables import attachments, audit_events, task_participants, tasks, users
from .task_visibility import task_visibility_condition
from .workspace_schemas import CreateTaskRequest, TaskCreateParticipantRequest

DocumentFilter = Literal["all", "unassigned", "active", "review", "completed", "overdue"]
MAX_SNAPSHOT_BYTES = 200 * 1024 * 1024


async def _source_scope(
    connection: AsyncConnection, user: AuthenticatedUser,
) -> ColumnElement[bool]:
    # A Referent visibility denial does not remove an explicit task assignment.
    # It still prevents browsing or assigning any other source document.
    try:
        _mode, scope = await incoming_scope(connection, user)
    except HTTPException as error:
        if error.status_code != 403:
            raise
        return false()
    return true() if scope is None else scope


def _participation(user: AuthenticatedUser) -> ColumnElement[bool]:
    return or_(
        tasks.c.author_user_id == user.id,
        tasks.c.primary_assignee_user_id == user.id,
        tasks.c.id.in_(select(task_participants.c.task_id).where(
            task_participants.c.user_id == user.id,
        )),
    )


async def _query(
    connection: AsyncConnection, user: AuthenticatedUser,
) -> Select[Any]:
    await ensure_module_action(connection, user, "incoming_letters", "view")
    permissions = await module_permissions_for_user(connection, user)
    source_scope = await _source_scope(connection, user)
    task_permissions = permissions.get("tasks", {})
    can_assign = bool(
        permissions.get("incoming_letters", {}).get("edit")
        and task_permissions.get("create") and task_permissions.get("view")
    )
    participant_sources = select(executions.c.source_id).join(
        tasks, tasks.c.id == executions.c.task_id,
    ).where(_participation(user))
    visible_task = exists(select(tasks.c.id).where(
        tasks.c.id == executions.c.task_id, task_visibility_condition(user),
    ).correlate(executions)) if task_permissions.get("view") else false()
    assignee = users.alias("incoming_execution_assignee")
    return select(
        incoming,
        executions.c.task_id.label("execution_task_id"),
        tasks.c.status.label("execution_status"),
        tasks.c.due_at.label("execution_due_at"),
        tasks.c.primary_assignee_user_id.label("execution_assignee_id"),
        tasks.c.author_user_id.label("execution_author_id"),
        assignee.c.full_name.label("execution_assignee_name"),
        and_(source_scope, true() if can_assign else false()).label("can_assign"),
        visible_task.label("can_open_task"),
    ).select_from(
        incoming.outerjoin(executions, executions.c.source_id == incoming.c.id)
        .outerjoin(tasks, tasks.c.id == executions.c.task_id)
        .outerjoin(assignee, assignee.c.id == tasks.c.primary_assignee_user_id)
    ).where(or_(source_scope, incoming.c.id.in_(participant_sources)))


def _document(row: RowMapping) -> IncomingDocument:
    execution = None
    if row["execution_task_id"] is not None:
        execution = IncomingExecution(
            task_id=row["execution_task_id"], status=row["execution_status"],
            due_at=row["execution_due_at"], assignee_id=row["execution_assignee_id"],
            assignee_name=row["execution_assignee_name"], author_id=row["execution_author_id"],
        )
    return IncomingDocument(
        id=row["id"], revision=row["revision"],
        number=row["platform_incoming_number"] or row["sequence_number"] or "Без номера",
        subject=row["subject"] or "Входящее письмо", sender=row["sender_organization"] or "",
        received_at=row["received_at"], registered_at=row["registered_at"],
        added_at=row["created_at"], source=row["source"],
        files_expected=bool(row["has_attachments"]), execution=execution,
        can_assign=bool(row["can_assign"]) and execution is None,
        can_open_task=bool(row["can_open_task"]),
    )


async def list_documents(
    connection: AsyncConnection, user: AuthenticatedUser, *, query: str = "",
    category: DocumentFilter = "all", offset: int = 0, limit: int = 30,
    personal: bool = False,
) -> IncomingDocumentPage:
    statement = await _query(connection, user)
    if personal:
        statement = statement.where(_participation(user))
    if query.strip():
        # Search is literal; '%' and '_' in a registration number are not wildcards.
        pattern = "%" + query.strip().replace("\\", "\\\\").replace("%", "\\%").replace(
            "_", "\\_",
        ) + "%"
        statement = statement.where(or_(*[
            column.ilike(pattern, escape="\\") for column in (
                incoming.c.subject, incoming.c.platform_incoming_number,
                incoming.c.sequence_number, incoming.c.sender_organization,
            )
        ]))
    if category == "unassigned":
        statement = statement.where(executions.c.task_id.is_(None))
    elif category == "active":
        statement = statement.where(tasks.c.status.not_in(("completed", "cancelled")))
    elif category == "review":
        statement = statement.where(tasks.c.status == "awaiting_review")
    elif category == "completed":
        statement = statement.where(tasks.c.status == "completed")
    elif category == "overdue":
        statement = statement.where(
            tasks.c.status.not_in(("completed", "cancelled")),
            tasks.c.due_at < datetime.now(UTC),
        )
    total = await connection.scalar(select(func.count()).select_from(statement.subquery()))
    rows = (await connection.execute(statement.order_by(
        incoming.c.received_at.desc().nulls_last(), incoming.c.id,
    ).offset(offset).limit(limit))).mappings().all()
    return IncomingDocumentPage(
        documents=[_document(row) for row in rows], total=int(total or 0),
        offset=offset, limit=limit,
    )


async def get_document(
    connection: AsyncConnection, user: AuthenticatedUser, source_id: UUID,
    *, include_execution: bool = True,
) -> IncomingDocumentDetail:
    statement = (await _query(connection, user)).where(incoming.c.id == source_id)
    row = (await connection.execute(statement)).mappings().one_or_none()
    if row is None:
        raise HTTPException(404, "Письмо не найдено или доступ закрыт.")
    files = [IncomingDocumentFile.model_validate(item) for item in
             await packet_entries(connection, "incoming", source_id)]
    document = _document(row)
    execution_detail = None
    if include_execution and document.execution and document.can_open_task:
        execution_detail = await _execution_detail(connection, user, document.execution.task_id)
        if execution_detail is None:
            document.can_open_task = False
    return IncomingDocumentDetail(
        document=document, files=files, execution_detail=execution_detail,
    )


async def _execution_detail(
    connection: AsyncConnection, user: AuthenticatedUser, task_id: UUID,
) -> IncomingExecutionDetail | None:
    await ensure_module_action(connection, user, "tasks", "view")
    try:
        await _task_access_row(connection, user, task_id)
    except WorkspaceRepositoryError as error:
        if error.status_code not in {403, 404}:
            raise
        return None
    task = await _task_response(connection, task_id, user)
    permissions = (await module_permissions_for_user(connection, user)).get("tasks", {})
    can_manage = False
    if permissions.get("approve") and task.status == "awaiting_review":
        try:
            await _task_access_row(connection, user, task_id, manage=True)
            can_manage = True
        except WorkspaceRepositoryError as error:
            if error.status_code not in {403, 404}:
                raise
    co_ids = [item.user_id for item in task.participants if item.role == "co_assignee"]
    executor = str(user.id) == task.assignee_id or str(user.id) in co_ids
    file_rows = (await connection.execute(select(attachments).where(
        attachments.c.owner_type == "task", attachments.c.owner_id == task_id,
        ~attachments.c.storage_key.startswith("incoming-execution/"),
    ).order_by(attachments.c.created_at))).mappings().all()
    return IncomingExecutionDetail(
        description=task.description, result_text=task.result_text, co_assignee_ids=co_ids,
        latest_return=task.latest_return, files=[_attachment(file) for file in file_rows],
        can_submit=bool(permissions.get("edit")) and executor
        and task.status in {"new", "in_progress", "overdue"},
        can_accept=bool(permissions.get("approve")) and str(user.id) == task.author_id
        and task.status == "awaiting_review",
        can_return=can_manage,
    )


async def read_document_file(
    connection: AsyncConnection, user: AuthenticatedUser, storage: ObjectStorage,
    source_id: UUID, file_id: UUID,
    *, max_bytes: int | None = None,
) -> tuple[RowMapping, bytes]:
    await get_document(connection, user, source_id, include_execution=False)
    row = await file_metadata(connection, "incoming", source_id, file_id, "packet")
    if max_bytes is not None and row["byte_size"] > max_bytes:
        raise HTTPException(413, "Документ больше 25 МБ. Скачайте оригинал.")
    content = await storage.get(row["storage_key"])
    if max_bytes is not None and len(content) > max_bytes:
        raise HTTPException(413, "Документ больше 25 МБ. Скачайте оригинал.")
    if hashlib.sha256(content).hexdigest() != row["sha256"]:
        raise HTTPException(503, "Контрольная сумма документа не совпала.")
    return row, content


async def assign_document(
    connection: AsyncConnection, user: AuthenticatedUser, storage: ObjectStorage,
    source_id: UUID, payload: IncomingDocumentAssign,
) -> IncomingDocumentDetail:
    await ensure_module_action(connection, user, "incoming_letters", "edit")
    await ensure_module_action(connection, user, "tasks", "create")
    await ensure_module_action(connection, user, "tasks", "view")
    scope = await _source_scope(connection, user)
    row = (await connection.execute(select(incoming).where(
        incoming.c.id == source_id, scope,
    ).with_for_update())).mappings().one_or_none()
    if row is None:
        raise HTTPException(404, "Письмо не найдено или назначение недоступно.")
    await ensure_module_action(connection, user, "incoming_letters", "view")
    fingerprint = hashlib.sha256(payload.model_dump_json().encode()).hexdigest()
    previous = (await connection.execute(select(executions).where(
        executions.c.source_id == source_id,
    ))).mappings().one_or_none()
    if previous:
        if (previous["operation_id"] == payload.operation_id
                and previous["created_by_user_id"] == user.id
                and previous["fingerprint"] == fingerprint):
            return await get_document(connection, user, source_id)
        raise HTTPException(409, "По письму уже создано поручение. Обновите карточку.")
    if row["revision"] != payload.expected_revision:
        raise HTTPException(409, "Письмо обновилось. Проверьте карточку перед назначением.")
    if payload.due_at <= datetime.now(UTC):
        raise HTTPException(422, "Срок исполнения должен быть в будущем.")
    details = await get_document(connection, user, source_id)
    if set(payload.file_ids) != {file.id for file in details.files}:
        raise HTTPException(
            409, "Документы письма обновились. Проверьте карточку перед назначением.",
        )
    if details.document.files_expected and not details.files:
        raise HTTPException(409, "Оригиналы письма ещё не переданы. Обновите карточку позже.")
    snapshot_bytes = sum(file.byte_size for file in details.files)
    if len(details.files) > 100 or snapshot_bytes > MAX_SNAPSHOT_BYTES:
        raise HTTPException(413, "Пакет больше 200 МБ или содержит больше 100 файлов.")
    number = details.document.number
    task_request = CreateTaskRequest(
        title=f"Письмо № {number}: {details.document.subject}"[:240],
        description=(f"Входящее письмо № {number}\nОтправитель: {details.document.sender}\n\n"
                     f"{payload.instruction}"),
        assignee_id=str(payload.assignee_id), due_at=payload.due_at,
        participants=[TaskCreateParticipantRequest(user_id=str(person), role="co_assignee")
                      for person in payload.co_assignee_ids],
    )
    stored: list[str] = []
    commit_started = False
    try:
        task = await create_task(connection, user, task_request)
        for file in details.files:
            metadata = await file_metadata(connection, "incoming", source_id, file.id, "packet")
            key = f"incoming-execution/{payload.operation_id}/{uuid4()}"
            stored.append(key)
            await storage.copy(str(metadata["storage_key"]), key)
            await create_attachment(
                connection, user, "task", UUID(task.id), file_name=PurePosixPath(file.name).name,
                content_type=str(metadata["content_type"]), byte_size=file.byte_size,
                sha256=file.sha256, storage_key=key,
            )
        await connection.execute(insert(executions).values(
            source_id=source_id, task_id=UUID(task.id), operation_id=payload.operation_id,
            fingerprint=fingerprint, created_by_user_id=user.id, created_at=datetime.now(UTC),
        ))
        await connection.execute(insert(audit_events).values(
            id=uuid4(), actor_user_id=user.id, action="incoming_document.assigned",
            target_type="incoming_document", target_id=source_id,
            details={"taskId": task.id, "sourceRevision": row["revision"]},
            created_at=datetime.now(UTC),
        ))
        result = await get_document(connection, user, source_id)
        # A failed COMMIT has an unknown outcome. Retain copied objects; replaying
        # the operation ID will resolve the committed task instead of duplicating it.
        commit_started = True
        await connection.commit()
        return result
    except IntegrityError as error:
        raise HTTPException(409, "Номер операции уже использован. Обновите карточку.") from error
    except ObjectStorageError as error:
        raise HTTPException(503, "Документы недоступны. Назначение не сохранено.") from error
    except WorkspaceRepositoryError as error:
        message = error.detail
        if message in {"Assignee is not active", "User is not active"}:
            message = "Выбранный сотрудник больше не активен. Обновите список исполнителей."
        raise HTTPException(error.status_code, message) from error
    finally:
        if not commit_started:
            await connection.rollback()
            for key in stored:
                with suppress(ObjectStorageError):
                    await storage.delete(key)
