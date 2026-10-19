from contextlib import suppress
from datetime import UTC, datetime
from uuid import UUID, uuid4

from sqlalchemy import func, insert, select
from sqlalchemy.engine import RowMapping
from sqlalchemy.ext.asyncio import AsyncConnection

from .access_control import ensure_module_action
from .auth import AuthenticatedUser
from .errors import WorkspaceRepositoryError
from .messenger_service import (
    audit,
    chat_access,
    member_permissions,
    message_visible_to_member,
    message_with_details,
    send_chat_message,
)
from .object_storage import ObjectStorage, ObjectStorageError
from .tables import attachments, chats, feed_posts, messages, users
from .workspace_schemas import (
    ChatMessageResponse,
    ForwardMessageRequest,
    MessageEntity,
    SendMessageRequest,
)
from .zoom_invitations import invitation_detail_map


async def forward_message(
    connection: AsyncConnection,
    user: AuthenticatedUser,
    chat_id: UUID,
    payload: ForwardMessageRequest,
    storage: ObjectStorage | None = None,
) -> ChatMessageResponse:
    # The client supplies only source IDs; names, excerpts and provenance are server-owned.
    await ensure_module_action(connection, user, "messenger", "edit")
    await connection.execute(select(func.pg_advisory_xact_lock(payload.request_id.int % (2**63))))
    source_chat_id = None
    entities: list[MessageEntity] = []
    source_attachments: list[RowMapping] = []
    if payload.kind == "message":
        source_chat_id = await connection.scalar(
            select(messages.c.chat_id).where(
                messages.c.id == payload.source_id,
            )
        )
        if source_chat_id is None:
            raise WorkspaceRepositoryError(404, "Сообщение для пересылки недоступно")
    # Stable lock order protects membership checks and avoids A→B / B→A deadlocks.
    await connection.execute(
        select(chats.c.id)
        .where(
            chats.c.id.in_({chat_id, *([source_chat_id] if source_chat_id else [])}),
        )
        .order_by(chats.c.id)
        .with_for_update()
    )
    chat, member = await chat_access(connection, user, chat_id)
    if not member_permissions(member).send_messages:
        raise WorkspaceRepositoryError(403, "Отправка сообщений в этот чат недоступна")
    existing = (
        (
            await connection.execute(
                select(messages).where(
                    messages.c.id == payload.request_id,
                )
            )
        )
        .mappings()
        .first()
    )
    if existing is not None:
        origin = existing["forwarded"] or {}
        identity = (
            existing["author_user_id"],
            existing["chat_id"],
            origin.get("source_kind"),
            origin.get("source_id"),
        )
        if (
            identity != (user.id, chat_id, payload.kind, str(payload.source_id))
            or existing["deleted_at"]
        ):
            raise WorkspaceRepositoryError(409, "Запрос пересылки уже использован")
        return await message_with_details(connection, user, existing, chat, member)
    if payload.kind == "feed":
        await ensure_module_action(connection, user, "feed", "view")
        post = (
            (
                await connection.execute(
                    select(feed_posts)
                    .where(
                        feed_posts.c.id == payload.source_id,
                        feed_posts.c.deleted_at.is_(None),
                    )
                    .with_for_update(read=True)
                )
            )
            .mappings()
            .first()
        )
        if post is None:
            raise WorkspaceRepositoryError(404, "Объявление удалено или недоступно")
        author_id = post["author_user_id"]
        name = (
            await connection.scalar(select(users.c.full_name).where(users.c.id == author_id))
            if author_id
            else "Команда Yuksalish"
        )
        body = post["body"][:240]
        forwarded = {
            "kind": "feed",
            "post_id": str(post["id"]),
            "title": post["title"],
            "author_id": str(author_id) if author_id else None,
            "author_name": name or "Сотрудник",
        }
    else:
        if source_chat_id is None:
            raise WorkspaceRepositoryError(404, "Сообщение для пересылки недоступно")
        _, source_member = await chat_access(connection, user, source_chat_id)
        source = (
            (
                await connection.execute(
                    select(messages)
                    .where(
                        messages.c.id == payload.source_id,
                        messages.c.deleted_at.is_(None),
                        messages.c.system_kind.is_(None),
                    )
                    .with_for_update(read=True)
                )
            )
            .mappings()
            .first()
        )
        if source is None or not message_visible_to_member(source, source_member):
            raise WorkspaceRepositoryError(404, "Сообщение для пересылки недоступно")
        if source.get("zoom_meeting_id"):
            invitation = (await invitation_detail_map(connection, user, [source])).get(source["id"])
            if invitation is None or not invitation.available:
                raise WorkspaceRepositoryError(404, "Приглашение для пересылки недоступно")
        body = source["body"]
        source_attachments = list(
            (
                await connection.execute(
                    select(attachments)
                    .where(
                        attachments.c.owner_type == "message",
                        attachments.c.owner_id == payload.source_id,
                    )
                    .order_by(attachments.c.created_at, attachments.c.id)
                )
            ).mappings()
        )
        if source_attachments and not member_permissions(member).upload_files:
            raise WorkspaceRepositoryError(403, "Нет права отправлять файлы в этот чат")
        if source_attachments and storage is None:
            raise WorkspaceRepositoryError(503, "Хранилище файлов недоступно для пересылки")
        entities = [MessageEntity.model_validate(item) for item in (source.get("entities") or [])]
        if source["forwarded"]:
            forwarded = dict(source["forwarded"])
            if forwarded["kind"] == "feed":
                await ensure_module_action(connection, user, "feed", "view")
                post_exists = await connection.scalar(
                    select(feed_posts.c.id)
                    .where(
                        feed_posts.c.id == UUID(forwarded["post_id"]),
                        feed_posts.c.deleted_at.is_(None),
                    )
                    .with_for_update(read=True)
                )
                if post_exists is None:
                    raise WorkspaceRepositoryError(404, "Объявление удалено или недоступно")
        else:
            name = await connection.scalar(
                select(users.c.full_name).where(
                    users.c.id == source["author_user_id"],
                )
            )
            forwarded = {
                "kind": "message",
                "author_id": str(source["author_user_id"]),
                "author_name": name or "Сотрудник",
            }
    forwarded.update(source_kind=payload.kind, source_id=str(payload.source_id))
    copies: list[tuple[RowMapping, UUID, str]] = []
    completed = False
    try:
        # Copy bytes before creating a message; never silently send text without files.
        for attachment in source_attachments:
            attachment_id = uuid4()
            key = f"message/{payload.request_id}/{attachment_id}"
            copies.append((attachment, attachment_id, key))
            if storage is not None:
                await storage.copy(attachment["storage_key"], key)
        result = await send_chat_message(
            connection,
            user,
            chat_id,
            SendMessageRequest(body=body, entities=entities),
            message_id=payload.request_id,
            forwarded=forwarded,
        )
        for attachment, attachment_id, key in copies:
            await connection.execute(
                insert(attachments).values(
                    **{
                        **dict(attachment),
                        "id": attachment_id,
                        "storage_key": key,
                        "owner_id": UUID(result.id),
                        "uploaded_by_user_id": user.id,
                        "created_at": datetime.now(UTC),
                    }
                )
            )
        await audit(connection, user, "message.forwarded", chat_id, {"message_id": result.id})
        completed = True
        return result
    finally:
        if not completed and storage is not None:
            for _, _, key in copies:
                with suppress(ObjectStorageError):
                    await storage.delete(key)
