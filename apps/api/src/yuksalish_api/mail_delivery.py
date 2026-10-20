"""Persisted send queue. Unknown deliveries are reconciled, never auto-retried."""

import hashlib
import re
from datetime import UTC, datetime, timedelta
from email.message import EmailMessage
from email.policy import SMTP
from email.utils import format_datetime
from urllib.parse import urlsplit
from uuid import UUID, uuid4

from fastapi import HTTPException
from sqlalchemy import insert, select, update
from sqlalchemy.engine import RowMapping
from sqlalchemy.ext.asyncio import AsyncConnection, AsyncEngine

from .access_control import ensure_module_action
from .auth import AuthenticatedUser
from .errors import WorkspaceRepositoryError
from .gmail_client import GmailClient
from .mail_connection_service import access_token
from .mail_crypto import mail_configured, open_bytes, open_text
from .mail_schemas import MailDraft, MailSend
from .mail_service import (
    ReplyContext,
    draft_row,
    fields_from_row,
    get_draft,
    validate_signed_sources,
)
from .mail_tables import mail_accounts, mail_drafts, mail_files
from .settings import Settings
from .tables import audit_events, users


def user_from_row(row: RowMapping) -> AuthenticatedUser:
    return AuthenticatedUser(
        id=row["id"],
        username=row["username"],
        full_name=row["full_name"],
        role=row["role"],
        position_id=row["position_id"],
        department_id=row["department_id"],
        job_title=row["job_title"],
    )


async def audit_send(
    connection: AsyncConnection, row: RowMapping, state: str, operation_id: UUID | None = None
) -> None:
    await connection.execute(
        insert(audit_events).values(
            id=uuid4(),
            actor_user_id=row["owner_user_id"],
            action=f"mail.{state}",
            target_type="mail",
            target_id=row["id"],
            details={"status": state, "operationId": str(operation_id or row["operation_id"])},
            created_at=datetime.now(UTC),
        )
    )


async def mime_message(
    connection: AsyncConnection,
    settings: Settings,
    row: RowMapping,
    sender: str,
    *,
    rfc_message_id: str | None = None,
    updated_at: datetime | None = None,
) -> tuple[bytes, str]:
    fields = fields_from_row(settings, row)
    all_addresses = [*fields.to, *fields.cc, *fields.bcc]
    if not fields.to or not fields.subject.strip():
        raise WorkspaceRepositoryError(422, "Укажите получателя и тему письма")
    if len({value.casefold() for value in all_addresses}) != len(all_addresses):
        raise WorkspaceRepositoryError(
            422, "Один адрес не должен повторяться в получателях и копиях"
        )
    message = EmailMessage(policy=SMTP)
    message["From"] = sender
    message["To"] = ", ".join(fields.to)
    if fields.cc:
        message["Cc"] = ", ".join(fields.cc)
    if fields.bcc:
        message["Bcc"] = ", ".join(fields.bcc)
    message["Subject"] = fields.subject
    message["Message-ID"] = rfc_message_id or row["rfc_message_id"]
    message["Date"] = format_datetime(updated_at or row["updated_at"])
    reply = ReplyContext.model_validate_json(
        open_text(settings, row["reply_cipher"], f"reply:{row['id']}")
    )

    def normalize(value: str) -> str:
        return re.sub(r"^(?:(?:re|fw|fwd)\s*:\s*)+", "", value, flags=re.I).strip().casefold()

    thread = reply.thread_id if normalize(fields.subject) == normalize(reply.subject) else ""
    if thread and reply.message_id:
        message["In-Reply-To"] = reply.message_id
        message["References"] = (reply.references + " " + reply.message_id).strip()
    message.set_content(fields.body)
    files = (
        (await connection.execute(select(mail_files).where(mail_files.c.draft_id == row["id"])))
        .mappings()
        .all()
    )
    if not fields.body.strip() and not files:
        raise WorkspaceRepositoryError(422, "Напишите текст или приложите файл")
    for item in files:
        raw = open_bytes(settings, item["content_cipher"], f"file:{row['id']}:{item['id']}")
        if hashlib.sha256(raw).hexdigest() != item["sha256"]:
            raise WorkspaceRepositoryError(409, "Вложение повреждено. Прикрепите файл заново")
        mime = item["content_type"]
        if not re.fullmatch(r"[A-Za-z0-9.+-]+/[A-Za-z0-9.+-]+", mime):
            mime = "application/octet-stream"
        main, sub = mime.split("/", 1)
        message.add_attachment(raw, maintype=main, subtype=sub, filename=item["file_name"])
    raw_message = message.as_bytes()
    if len(raw_message) > 25 * 1024 * 1024:
        raise WorkspaceRepositoryError(413, "Общий размер письма и вложений слишком большой")
    return raw_message, thread


async def queue_send(
    connection: AsyncConnection,
    user: AuthenticatedUser,
    settings: Settings,
    draft_id: UUID,
    payload: MailSend,
) -> MailDraft:
    await ensure_module_action(connection, user, "mail", "create")
    await ensure_module_action(connection, user, "mail", "edit")
    if not settings.gmail_sending_enabled or not mail_configured(settings):
        raise WorkspaceRepositoryError(
            503, "Отправка Gmail ещё не включена администратором сервера"
        )
    row = await draft_row(connection, user, draft_id, lock=True)
    if row["operation_id"] == payload.operation_id:
        return await get_draft(connection, user, settings, draft_id)
    await draft_row(connection, user, draft_id, editable=True, expected=payload.expected_revision)
    await validate_signed_sources(connection, user, draft_id)
    owner = (
        (
            await connection.execute(
                select(mail_accounts).where(mail_accounts.c.id == row["account_id"])
            )
        )
        .mappings()
        .one()
    )
    now = datetime.now(UTC)
    rfc_id = f"<{payload.operation_id.hex}@{urlsplit(settings.gmail_redirect_uri).hostname}>"
    # Validate the exact frozen MIME payload before making it eligible for a worker.
    await mime_message(
        connection, settings, row, owner["email"], rfc_message_id=rfc_id, updated_at=now
    )
    await connection.execute(
        update(mail_drafts)
        .where(mail_drafts.c.id == draft_id)
        .values(
            status="queued",
            operation_id=payload.operation_id,
            rfc_message_id=rfc_id,
            error="",
            revision=row["revision"] + 1,
            updated_at=now,
        )
    )
    await audit_send(connection, row, "queued", payload.operation_id)
    return await get_draft(connection, user, settings, draft_id)


async def reconcile_send(
    connection: AsyncConnection,
    user: AuthenticatedUser,
    settings: Settings,
    client: GmailClient,
    draft_id: UUID,
) -> MailDraft:
    await ensure_module_action(connection, user, "mail", "edit")
    row = await draft_row(connection, user, draft_id)
    if row["status"] != "unknown":
        raise WorkspaceRepositoryError(
            409, "Сверка доступна только для неизвестного результата отправки"
        )
    _, token = await access_token(connection, user, settings, client)
    page = await client.list_messages(token, f"in:sent rfc822msgid:{row['rfc_message_id']}")
    matching = []
    for summary in page.messages:
        message = await client.message(token, summary.id)
        if message.message_id == row["rfc_message_id"]:
            matching.append(message.id)
    if len(matching) == 1:
        locked = await draft_row(connection, user, draft_id, lock=True)
        if locked["status"] == "unknown" and locked["operation_id"] == row["operation_id"]:
            await connection.execute(
                update(mail_drafts)
                .where(mail_drafts.c.id == draft_id)
                .values(
                    status="sent",
                    provider_message_id=matching[0],
                    error="",
                    revision=locked["revision"] + 1,
                    updated_at=datetime.now(UTC),
                )
            )
            await audit_send(connection, locked, "sent")
    return await get_draft(connection, user, settings, draft_id)


async def process_one(engine: AsyncEngine, settings: Settings, client: GmailClient) -> bool:
    if not mail_configured(settings) or not settings.gmail_sending_enabled:
        return False
    async with engine.connect() as connection:
        # A process may die after Google accepts the send. Never requeue its job.
        await connection.execute(
            update(mail_drafts)
            .where(
                mail_drafts.c.status == "sending",
                mail_drafts.c.updated_at < datetime.now(UTC) - timedelta(minutes=3),
            )
            .values(
                status="unknown",
                error="Отправка прервалась. Сначала проверьте папку «Отправленные»",
                revision=mail_drafts.c.revision + 1,
                updated_at=datetime.now(UTC),
            )
        )
        await connection.commit()
        candidate = (
            (
                await connection.execute(
                    select(mail_drafts.c.id, mail_drafts.c.account_id)
                    .where(
                        mail_drafts.c.status == "queued",
                    )
                    .order_by(mail_drafts.c.updated_at)
                    .limit(1)
                )
            )
            .mappings()
            .first()
        )
        if candidate is None:
            return False
        locked_account = await connection.scalar(
            select(mail_accounts.c.id)
            .where(
                mail_accounts.c.id == candidate["account_id"],
            )
            .with_for_update(skip_locked=True)
        )
        if locked_account is None:
            return False
        row = (
            (
                await connection.execute(
                    select(mail_drafts)
                    .where(
                        mail_drafts.c.id == candidate["id"],
                        mail_drafts.c.status == "queued",
                    )
                    .with_for_update(skip_locked=True)
                )
            )
            .mappings()
            .first()
        )
        if row is None:
            return False
        await connection.execute(
            update(mail_drafts)
            .where(mail_drafts.c.id == row["id"])
            .values(
                status="sending",
                revision=row["revision"] + 1,
                updated_at=datetime.now(UTC),
            )
        )
        await connection.commit()
        sent_id: str | None = None
        state, error_text = "failed", ""
        attempted = False
        try:
            actor_row = (
                (
                    await connection.execute(
                        select(users).where(
                            users.c.id == row["owner_user_id"],
                            users.c.status == "active",
                        )
                    )
                )
                .mappings()
                .first()
            )
            if actor_row is None:
                raise WorkspaceRepositoryError(403, "Учётная запись сотрудника больше не активна")
            user = user_from_row(actor_row)
            await ensure_module_action(connection, user, "mail", "create")
            await ensure_module_action(connection, user, "mail", "edit")
            owner, token = await access_token(connection, user, settings, client)
            await validate_signed_sources(connection, user, row["id"])
            raw, thread = await mime_message(connection, settings, row, owner["email"])
            await connection.commit()
            attempted = True
            sent_id = await client.send(token, raw, thread)
            state = "sent"
        except (WorkspaceRepositoryError, HTTPException) as error:
            status = error.status_code
            error_text = error.detail
            if attempted and status not in {400, 401, 403, 404, 413, 429}:
                state = "unknown"
        await connection.execute(
            update(mail_drafts)
            .where(
                mail_drafts.c.id == row["id"],
                mail_drafts.c.operation_id == row["operation_id"],
                mail_drafts.c.status == "sending",
            )
            .values(
                status=state,
                provider_message_id=sent_id,
                error=error_text[:400],
                revision=mail_drafts.c.revision + 1,
                updated_at=datetime.now(UTC),
            )
        )
        await audit_send(connection, row, state)
        await connection.commit()
        return True
