from uuid import UUID

from sqlalchemy import func, select
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
from .tables import chats, feed_posts, messages, users
from .workspace_schemas import ChatMessageResponse, ForwardMessageRequest, SendMessageRequest


async def forward_message(
    connection: AsyncConnection,
    user: AuthenticatedUser,
    chat_id: UUID,
    payload: ForwardMessageRequest,
) -> ChatMessageResponse:
    # The client supplies only source IDs; names, excerpts and provenance are server-owned.
    await ensure_module_action(connection, user, "messenger", "edit")
    await connection.execute(select(func.pg_advisory_xact_lock(payload.request_id.int % (2**63))))
    source_chat_id = None
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
        body = source["body"]
        if source["forwarded"]:
            forwarded = dict(source["forwarded"])
            if forwarded["kind"] == "feed":
                await ensure_module_action(connection, user, "feed", "view")
                post_exists = await connection.scalar(
                    select(feed_posts.c.id)
                    .where(
                        feed_posts.c.id == UUID(forwarded["post_id"]),
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
    result = await send_chat_message(
        connection,
        user,
        chat_id,
        SendMessageRequest(body=body),
        message_id=payload.request_id,
        forwarded=forwarded,
    )
    await audit(connection, user, "message.forwarded", chat_id, {"message_id": result.id})
    return result
