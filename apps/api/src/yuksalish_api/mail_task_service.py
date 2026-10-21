"""An explicit, idempotent export shares only reviewed text and selected files."""

import hashlib
import json
from pathlib import PurePosixPath
from uuid import UUID, uuid4

from fastapi import HTTPException
from sqlalchemy import select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncConnection

from .access_control import ensure_module_action
from .auth import AuthenticatedUser
from .errors import WorkspaceRepositoryError
from .gmail_client import GmailClient
from .mail_connection_service import access_token
from .mail_crypto import seal_text
from .mail_schemas import MailTaskExport
from .mail_service import MAX_MAIL_BYTES
from .mail_tables import mail_task_exports
from .object_storage import ObjectStorage, ObjectStorageError
from .repository import _task_access_row, _task_response, create_attachment, create_task
from .settings import Settings
from .workspace_schemas import TaskResponse


async def export_task(
    connection: AsyncConnection,
    user: AuthenticatedUser,
    settings: Settings,
    client: GmailClient,
    storage: ObjectStorage,
    payload: MailTaskExport,
) -> TaskResponse:
    await ensure_module_action(connection, user, "mail", "view")
    await ensure_module_action(connection, user, "tasks", "create")
    if payload.task.source_message_id or payload.task.calendar_event_id:
        raise WorkspaceRepositoryError(422, "Источник этой задачи — выбранное письмо")
    fingerprint = hashlib.sha256(payload.model_dump_json().encode()).hexdigest()
    existing = (
        (
            await connection.execute(
                select(mail_task_exports).where(
                    mail_task_exports.c.id == payload.operation_id,
                )
            )
        )
        .mappings()
        .first()
    )
    if existing:
        if (
            existing["owner_user_id"] != user.id
            or existing["fingerprint"] != fingerprint
            or not existing["task_id"]
        ):
            raise WorkspaceRepositoryError(409, "Номер создания задачи уже использован")
        await _task_access_row(connection, user, existing["task_id"])
        return await _task_response(connection, existing["task_id"], user)
    owner, token = await access_token(connection, user, settings, client)
    source = await client.message(token, payload.message_id)
    available = {item.id: item for item in source.attachments}
    if len(set(payload.attachment_ids)) != len(payload.attachment_ids) or not set(
        payload.attachment_ids
    ).issubset(available):
        raise WorkspaceRepositoryError(422, "Выберите вложения именно этого письма")
    if sum(available[item].size_bytes for item in payload.attachment_ids) > MAX_MAIL_BYTES:
        raise WorkspaceRepositoryError(413, "Общий размер выбранных файлов больше 18 МБ")
    downloaded: list[tuple[str, str, bytes]] = []
    total = 0
    for selected in payload.attachment_ids:
        item = available[selected]
        content = await client.attachment(token, source.id, selected)
        total += len(content)
        name = PurePosixPath(item.file_name.replace("\\", "/")).name
        if not name or len(name) > 240 or any(ord(char) < 32 for char in name):
            raise WorkspaceRepositoryError(422, "Имя одного из файлов письма недопустимо")
        if total > MAX_MAIL_BYTES:
            raise WorkspaceRepositoryError(413, "Общий размер выбранных файлов больше 18 МБ")
        downloaded.append((name, item.content_type, content))
    # Reload active connection/permissions after the external read, before sharing anything.
    await ensure_module_action(connection, user, "mail", "view")
    from .mail_connection_service import account

    current = await account(connection, user, lock=True)
    if current["id"] != owner["id"]:
        raise WorkspaceRepositoryError(409, "Почтовый аккаунт изменился. Откройте письмо заново")
    claimed = await connection.scalar(
        pg_insert(mail_task_exports)
        .values(
            id=payload.operation_id,
            owner_user_id=user.id,
            fingerprint=fingerprint,
            source_cipher=seal_text(
                settings,
                json.dumps({"messageId": source.id, "accountId": str(owner["id"])}),
                f"task-export:{payload.operation_id}",
            ),
        )
        .on_conflict_do_nothing()
        .returning(mail_task_exports.c.id)
    )
    if claimed is None:
        # The concurrent transaction has now committed; return its one task, not a duplicate.
        return await export_task(connection, user, settings, client, storage, payload)
    stored: list[str] = []
    try:
        task = await create_task(connection, user, payload.task)
        for name, mime, content in downloaded:
            key = f"mail-task/{payload.operation_id}/{uuid4()}"
            await storage.put(key, content, mime)
            stored.append(key)
            await create_attachment(
                connection,
                user,
                "task",
                UUID(task.id),
                file_name=name,
                content_type=mime,
                byte_size=len(content),
                sha256=hashlib.sha256(content).hexdigest(),
                storage_key=key,
            )
        await connection.execute(
            update(mail_task_exports)
            .where(
                mail_task_exports.c.id == payload.operation_id,
            )
            .values(task_id=UUID(task.id))
        )
    except (WorkspaceRepositoryError, HTTPException, SQLAlchemyError, ObjectStorageError):
        await connection.rollback()
        for key in stored:
            await storage.delete(key)
        raise
    # A connection loss during COMMIT has an unknown outcome. Do not delete files
    # that may already belong to a committed task; retrying the operation ID will
    # resolve the persisted task rather than creating another one.
    await connection.commit()
    return task
