"""Private Workspace drafts, encrypted files and immutable signed-PDF copies."""

import hashlib
import re
from datetime import UTC, datetime
from pathlib import PurePosixPath
from uuid import UUID, uuid4

from pydantic import BaseModel
from sqlalchemy import String, cast, delete, func, insert, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.engine import RowMapping
from sqlalchemy.ext.asyncio import AsyncConnection
from sqlalchemy.sql import Select

from .access_control import ensure_module_action
from .auth import AuthenticatedUser
from .errors import WorkspaceRepositoryError
from .gmail_client import GmailClient
from .mail_connection_service import access_token, account
from .mail_crypto import open_bytes, open_text, seal_bytes, seal_text
from .mail_schemas import (
    MailDraft,
    MailDraftSummary,
    MailDraftWrite,
    MailFields,
    MailFile,
    MailSignedFile,
)
from .mail_tables import mail_drafts, mail_files
from .object_storage import ObjectStorage
from .settings import Settings
from .tables import ai_referent_files, ai_referent_letters

MAX_MAIL_BYTES = 18 * 1024 * 1024


class ReplyContext(BaseModel):
    thread_id: str = ""
    message_id: str = ""
    references: str = ""
    subject: str = ""


def draft_context(draft_id: UUID) -> str:
    return f"draft:{draft_id}"


def fields_from_row(settings: Settings, row: RowMapping) -> MailFields:
    return MailFields.model_validate_json(
        open_text(settings, row["payload_cipher"], draft_context(row["id"]))
    )


async def draft_row(
    connection: AsyncConnection,
    user: AuthenticatedUser,
    draft_id: UUID,
    *,
    lock: bool = False,
    editable: bool = False,
    expected: int | None = None,
) -> RowMapping:
    await ensure_module_action(connection, user, "mail", "edit" if editable else "view")
    # Same lock order as the delivery worker: account, then draft.
    await account(connection, user, lock=lock)
    query = select(mail_drafts).where(
        mail_drafts.c.id == draft_id, mail_drafts.c.owner_user_id == user.id
    )
    if lock:
        query = query.with_for_update()
    row = (await connection.execute(query)).mappings().first()
    if row is None:
        raise WorkspaceRepositoryError(404, "Черновик не найден")
    if editable and row["status"] not in {"draft", "failed"}:
        raise WorkspaceRepositoryError(409, "Письмо уже передано на отправку и не редактируется")
    if expected is not None and row["revision"] != expected:
        raise WorkspaceRepositoryError(409, "Письмо изменилось. Обновите карточку перед действием")
    return row


async def get_draft(
    connection: AsyncConnection,
    user: AuthenticatedUser,
    settings: Settings,
    draft_id: UUID,
) -> MailDraft:
    row = await draft_row(connection, user, draft_id)
    files = (
        (
            await connection.execute(
                select(
                    mail_files.c.id,
                    mail_files.c.file_name,
                    mail_files.c.content_type,
                    mail_files.c.size_bytes,
                    mail_files.c.signed_letter_id,
                ).where(mail_files.c.draft_id == draft_id)
            )
        )
        .mappings()
        .all()
    )
    return MailDraft(
        **fields_from_row(settings, row).model_dump(),
        id=str(row["id"]),
        revision=row["revision"],
        status=row["status"],
        reply_message_id=row["reply_message_id"],
        updated_at=row["updated_at"],
        provider_message_id=row["provider_message_id"],
        error=row["error"],
        attachments=[
            MailFile(
                id=str(item["id"]),
                file_name=item["file_name"],
                content_type=item["content_type"],
                size_bytes=item["size_bytes"],
                signed_letter_id=str(item["signed_letter_id"])
                if item["signed_letter_id"]
                else None,
            )
            for item in files
        ],
    )


async def list_drafts(
    connection: AsyncConnection,
    user: AuthenticatedUser,
    settings: Settings,
) -> list[MailDraftSummary]:
    await account(connection, user)
    rows = (
        (
            await connection.execute(
                select(mail_drafts)
                .where(
                    mail_drafts.c.owner_user_id == user.id,
                )
                .order_by(mail_drafts.c.updated_at.desc())
                .limit(100)
            )
        )
        .mappings()
        .all()
    )
    result = []
    for row in rows:
        fields = fields_from_row(settings, row)
        result.append(
            MailDraftSummary(
                id=str(row["id"]),
                subject=fields.subject,
                to=fields.to,
                status=row["status"],
                revision=row["revision"],
                updated_at=row["updated_at"],
                error=row["error"],
            )
        )
    return result


async def save_draft(
    connection: AsyncConnection,
    user: AuthenticatedUser,
    settings: Settings,
    client: GmailClient,
    payload: MailDraftWrite,
) -> MailDraft:
    await ensure_module_action(connection, user, "mail", "create")
    await ensure_module_action(connection, user, "mail", "edit")
    fields = MailFields.model_validate(payload.model_dump())
    existing = (
        (
            await connection.execute(
                select(mail_drafts).where(
                    mail_drafts.c.id == payload.request_id,
                )
            )
        )
        .mappings()
        .first()
    )
    if existing and existing["owner_user_id"] != user.id:
        raise WorkspaceRepositoryError(404, "Черновик не найден")
    reply = ReplyContext()
    reply_account_id: UUID | None = None
    if existing and existing["reply_message_id"] == payload.reply_message_id:
        reply = ReplyContext.model_validate_json(
            open_text(settings, existing["reply_cipher"], f"reply:{payload.request_id}")
        )
    elif payload.reply_message_id:
        reply_account, token = await access_token(connection, user, settings, client)
        reply_account_id = reply_account["id"]
        original = await client.message(token, payload.reply_message_id)
        # Only syntactically valid Message-IDs reach MIME headers.
        message_ids = re.findall(r"<[^<>\s\r\n]{1,240}>", original.references)
        original_id = re.fullmatch(r"<[^<>\s\r\n]{1,240}>", original.message_id.strip())
        reply = ReplyContext(
            thread_id=original.thread_id,
            subject=original.subject,
            message_id=original_id.group() if original_id else "",
            references=" ".join(message_ids[-15:]),
        )
    owner = await account(connection, user, lock=True)
    if reply_account_id is not None and reply_account_id != owner["id"]:
        raise WorkspaceRepositoryError(409, "Почтовый аккаунт изменился. Откройте письмо заново")
    existing = (
        (
            await connection.execute(
                select(mail_drafts)
                .where(
                    mail_drafts.c.id == payload.request_id,
                )
                .with_for_update()
            )
        )
        .mappings()
        .first()
    )
    if existing:
        if existing["owner_user_id"] != user.id or existing["account_id"] != owner["id"]:
            raise WorkspaceRepositoryError(404, "Черновик не найден")
        if payload.expected_revision == 0:
            if (
                fields_from_row(settings, existing) == fields
                and existing["reply_message_id"] == payload.reply_message_id
            ):
                return await get_draft(connection, user, settings, payload.request_id)
            raise WorkspaceRepositoryError(409, "Содержание уже созданного черновика отличается")
        await draft_row(
            connection,
            user,
            payload.request_id,
            lock=True,
            editable=True,
            expected=payload.expected_revision,
        )
    elif payload.expected_revision != 0:
        raise WorkspaceRepositoryError(404, "Черновик не найден")
    values = {
        "payload_cipher": seal_text(
            settings, fields.model_dump_json(), draft_context(payload.request_id)
        ),
        "reply_message_id": payload.reply_message_id,
        "reply_cipher": seal_text(settings, reply.model_dump_json(), f"reply:{payload.request_id}"),
        "status": "draft",
        "error": "",
        "revision": existing["revision"] + 1 if existing else 1,
        "operation_id": None,
        "rfc_message_id": None,
        "provider_message_id": None,
        "updated_at": datetime.now(UTC),
    }
    if existing:
        await connection.execute(
            update(mail_drafts).where(mail_drafts.c.id == payload.request_id).values(**values)
        )
    else:
        created = await connection.scalar(
            pg_insert(mail_drafts)
            .values(
                id=payload.request_id,
                owner_user_id=user.id,
                account_id=owner["id"],
                **values,
            )
            .on_conflict_do_nothing()
            .returning(mail_drafts.c.id)
        )
        if created is None:
            raise WorkspaceRepositoryError(409, "Черновик уже сохранён. Обновите список")
    return await get_draft(connection, user, settings, payload.request_id)


async def add_file(
    connection: AsyncConnection,
    user: AuthenticatedUser,
    settings: Settings,
    draft_id: UUID,
    expected: int,
    name: str,
    content_type: str,
    content: bytes,
    *,
    signed_letter_id: UUID | None = None,
    signed_file_id: UUID | None = None,
) -> MailDraft:
    row = await draft_row(connection, user, draft_id, lock=True, editable=True, expected=expected)
    name = PurePosixPath(name.replace("\\", "/")).name
    if not name or len(name) > 240 or any(ord(char) < 32 for char in name):
        raise WorkspaceRepositoryError(422, "Некорректное имя файла")
    if not content or len(content) > MAX_MAIL_BYTES:
        raise WorkspaceRepositoryError(413, "Размер файла должен быть от 1 байта до 18 МБ")
    count, total = (
        await connection.execute(
            select(
                func.count(),
                func.coalesce(func.sum(mail_files.c.size_bytes), 0),
            ).where(mail_files.c.draft_id == draft_id)
        )
    ).one()
    if count >= 20 or total + len(content) > MAX_MAIL_BYTES:
        raise WorkspaceRepositoryError(413, "Допускается до 20 файлов общим размером до 18 МБ")
    file_id = uuid4()
    await connection.execute(
        insert(mail_files).values(
            id=file_id,
            draft_id=draft_id,
            file_name=name,
            content_type=content_type[:160],
            size_bytes=len(content),
            sha256=hashlib.sha256(content).hexdigest(),
            content_cipher=seal_bytes(settings, content, f"file:{draft_id}:{file_id}"),
            signed_letter_id=signed_letter_id,
            signed_file_id=signed_file_id,
        )
    )
    await connection.execute(
        update(mail_drafts)
        .where(mail_drafts.c.id == draft_id)
        .values(
            revision=row["revision"] + 1,
            updated_at=datetime.now(UTC),
        )
    )
    return await get_draft(connection, user, settings, draft_id)


async def read_file(
    connection: AsyncConnection,
    user: AuthenticatedUser,
    settings: Settings,
    file_id: UUID,
) -> tuple[str, bytes]:
    row = (
        (
            await connection.execute(
                select(mail_files)
                .join(
                    mail_drafts,
                    mail_drafts.c.id == mail_files.c.draft_id,
                )
                .where(mail_files.c.id == file_id, mail_drafts.c.owner_user_id == user.id)
            )
        )
        .mappings()
        .first()
    )
    if row is None:
        raise WorkspaceRepositoryError(404, "Файл не найден")
    await draft_row(connection, user, row["draft_id"])
    return row["file_name"], open_bytes(
        settings, row["content_cipher"], f"file:{row['draft_id']}:{file_id}"
    )


async def remove_file(
    connection: AsyncConnection,
    user: AuthenticatedUser,
    settings: Settings,
    draft_id: UUID,
    file_id: UUID,
    expected: int,
) -> MailDraft:
    row = await draft_row(connection, user, draft_id, lock=True, editable=True, expected=expected)
    await connection.execute(
        delete(mail_files).where(mail_files.c.id == file_id, mail_files.c.draft_id == draft_id)
    )
    await connection.execute(
        update(mail_drafts)
        .where(mail_drafts.c.id == draft_id)
        .values(
            revision=row["revision"] + 1,
            updated_at=datetime.now(UTC),
        )
    )
    return await get_draft(connection, user, settings, draft_id)


def signed_query(user: AuthenticatedUser) -> Select[tuple[object, ...]]:
    from .tables import ai_referent_delivery_commands

    published_job = (
        select(ai_referent_delivery_commands.c.id)
        .where(
            ai_referent_delivery_commands.c.letter_id == ai_referent_letters.c.id,
            ai_referent_delivery_commands.c.kind == "sign_only",
            ai_referent_delivery_commands.c.status == "completed",
        )
        .order_by(ai_referent_delivery_commands.c.completed_at.desc())
        .limit(1)
        .correlate(ai_referent_letters)
        .scalar_subquery()
    )
    return (
        select(ai_referent_files, ai_referent_letters.c.subject)
        .join(
            ai_referent_letters,
            ai_referent_letters.c.id == ai_referent_files.c.owner_id,
        )
        .where(
            ai_referent_letters.c.created_by_user_id == user.id,
            ai_referent_letters.c.workflow_kind == "sign_only",
            ai_referent_letters.c.status == "signed",
            ai_referent_files.c.kind == "outgoing",
            ai_referent_files.c.relative_path.like("signed/%.pdf"),
            ai_referent_files.c.relative_path.like(
                func.concat("signed/", cast(published_job, String), "/%")
            ),
        )
    )


async def signed_files(
    connection: AsyncConnection, user: AuthenticatedUser
) -> list[MailSignedFile]:
    await ensure_module_action(connection, user, "mail", "view")
    await ensure_module_action(connection, user, "ai_referent", "view")
    rows = (
        (
            await connection.execute(
                signed_query(user).order_by(ai_referent_files.c.created_at.desc()).limit(100)
            )
        )
        .mappings()
        .all()
    )
    return [
        MailSignedFile(
            id=str(row["id"]),
            letter_id=str(row["owner_id"]),
            title=row["subject"],
            file_name=PurePosixPath(row["relative_path"]).name,
            sha256=row["sha256"],
        )
        for row in rows
    ]


async def add_signed_file(
    connection: AsyncConnection,
    user: AuthenticatedUser,
    settings: Settings,
    storage: ObjectStorage,
    draft_id: UUID,
    file_id: UUID,
    expected: int,
) -> MailDraft:
    await ensure_module_action(connection, user, "ai_referent", "view")
    row = (
        (await connection.execute(signed_query(user).where(ai_referent_files.c.id == file_id)))
        .mappings()
        .first()
    )
    if row is None:
        raise WorkspaceRepositoryError(404, "Доступный подписанный PDF не найден")
    if row["byte_size"] > MAX_MAIL_BYTES:
        raise WorkspaceRepositoryError(413, "PDF больше допустимого размера письма")
    content = await storage.get(row["storage_key"])
    if hashlib.sha256(content).hexdigest() != row["sha256"] or not content.startswith(b"%PDF-"):
        raise WorkspaceRepositoryError(409, "Подписанный PDF изменился или повреждён")
    return await add_file(
        connection,
        user,
        settings,
        draft_id,
        expected,
        f"signed-{str(row['owner_id'])[:8]}-{PurePosixPath(row['relative_path']).name}",
        "application/pdf",
        content,
        signed_letter_id=row["owner_id"],
        signed_file_id=file_id,
    )


async def validate_signed_sources(
    connection: AsyncConnection, user: AuthenticatedUser, draft_id: UUID
) -> None:
    copied = (
        (
            await connection.execute(
                select(mail_files).where(
                    mail_files.c.draft_id == draft_id,
                    mail_files.c.signed_file_id.is_not(None),
                )
            )
        )
        .mappings()
        .all()
    )
    if copied:
        await ensure_module_action(connection, user, "ai_referent", "view")
    for item in copied:
        current = (
            (
                await connection.execute(
                    signed_query(user).where(
                        ai_referent_files.c.id == item["signed_file_id"],
                    )
                )
            )
            .mappings()
            .first()
        )
        if (
            current is None
            or current["sha256"] != item["sha256"]
            or current["owner_id"] != item["signed_letter_id"]
        ):
            raise WorkspaceRepositoryError(
                409, "Подписанный оригинал больше не доступен. Обновите вложения"
            )
