"""User-owned assistant chat lifecycle; binary attachments are never stored."""

from datetime import UTC, datetime
from uuid import UUID, uuid4

from fastapi import HTTPException
from sqlalchemy import case, delete, exists, func, literal, select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncConnection
from typing_extensions import TypedDict

from .tables import assistant_chats, assistant_messages


class AssistantChatRecord(TypedDict):
    id: str
    title: str
    isDefault: bool
    isPinned: bool
    createdAt: str
    updatedAt: str


async def list_chats(connection: AsyncConnection, user_id: UUID) -> list[AssistantChatRecord]:
    await connection.execute(
        insert(assistant_chats)
        .from_select(
            ["id", "user_id", "title", "is_default", "created_at", "updated_at"],
            select(
                literal(uuid4()), literal(user_id), literal("Первый чат"), literal(True),
                literal(datetime.now(UTC)), literal(datetime.now(UTC)),
            ).where(~exists(select(assistant_chats.c.id).where(
                assistant_chats.c.user_id == user_id,
            ))),
        )
        .on_conflict_do_nothing(
            index_elements=[assistant_chats.c.user_id],
            index_where=assistant_chats.c.is_default,
        )
    )
    rows = (
        (
            await connection.execute(
                select(assistant_chats)
                .where(assistant_chats.c.user_id == user_id)
                .order_by(assistant_chats.c.is_pinned.desc(),
                    assistant_chats.c.updated_at.desc(), assistant_chats.c.id.desc())
            )
        )
        .mappings()
        .all()
    )
    return [
        AssistantChatRecord(
            id=str(row["id"]),
            title=row["title"],
            isDefault=row["is_default"],
            isPinned=row["is_pinned"],
            createdAt=row["created_at"].isoformat(),
            updatedAt=row["updated_at"].isoformat(),
        )
        for row in rows
    ]


async def create_chat(connection: AsyncConnection, user_id: UUID) -> AssistantChatRecord:
    chat_id, now = uuid4(), datetime.now(UTC)
    await connection.execute(
        insert(assistant_chats).values(
            id=chat_id,
            user_id=user_id,
            title="Новый чат",
            is_default=False,
            created_at=now,
            updated_at=now,
        )
    )
    return AssistantChatRecord(
        id=str(chat_id),
        title="Новый чат",
        isDefault=False,
        isPinned=False,
        createdAt=now.isoformat(),
        updatedAt=now.isoformat(),
    )


async def chat_message_scope(
    connection: AsyncConnection,
    user_id: UUID,
    chat_id: UUID,
    *,
    lock: bool = False,
) -> UUID | None:
    query = select(assistant_chats.c.is_default).where(
        assistant_chats.c.id == chat_id,
        assistant_chats.c.user_id == user_id,
    )
    if lock:
        query = query.with_for_update()
    row = (await connection.execute(query)).one_or_none()
    if row is None:
        raise HTTPException(404, "Чат не найден")
    return None if row.is_default else chat_id


async def clear_chat(connection: AsyncConnection, user_id: UUID, chat_id: UUID) -> None:
    scope = await chat_message_scope(connection, user_id, chat_id, lock=True)
    now = datetime.now(UTC)
    # Erase content, drafts and references; retain only rate-limit timestamps.
    # Clearing a chat must not reset the account-wide hourly request allowance.
    await connection.execute(
        update(assistant_messages)
        .where(
            assistant_messages.c.user_id == user_id,
            assistant_messages.c.chat_id == scope,
            assistant_messages.c.cleared_at.is_(None),
        )
        .values(content="", source_labels=None, references=None, action_draft=None, cleared_at=now)
    )
    await connection.execute(
        update(assistant_chats)
        .where(
            assistant_chats.c.id == chat_id,
            assistant_chats.c.user_id == user_id,
        )
        .values(
            updated_at=now,
            title=case(
                (assistant_chats.c.is_default, "Первый чат"),
                else_="Новый чат",
            ),
        )
    )


async def touch_chat(
    connection: AsyncConnection,
    user_id: UUID,
    chat_id: UUID,
    message: str,
) -> None:
    """Name an untitled conversation on its first successful turn only."""
    await connection.execute(
        update(assistant_chats)
        .where(
            assistant_chats.c.id == chat_id,
            assistant_chats.c.user_id == user_id,
        )
        .values(
            updated_at=func.now(),
            title=case(
                (assistant_chats.c.title.in_(["Первый чат", "Новый чат"]), message.strip()[:100]),
                else_=assistant_chats.c.title,
            ),
        )
    )


async def pin_chat(
    connection: AsyncConnection, user_id: UUID, chat_id: UUID, pinned: bool,
) -> list[AssistantChatRecord]:
    await chat_message_scope(connection, user_id, chat_id, lock=True)
    await connection.execute(update(assistant_chats).where(
        assistant_chats.c.id == chat_id, assistant_chats.c.user_id == user_id,
    ).values(is_pinned=pinned))
    return await list_chats(connection, user_id)


async def delete_chat(
    connection: AsyncConnection, user_id: UUID, chat_id: UUID,
) -> list[AssistantChatRecord]:
    scope = await chat_message_scope(connection, user_id, chat_id, lock=True)
    # Scrub every turn, including previously cleared ones, before removing the
    # conversation. Detach the empty rows so CASCADE cannot erase account-wide
    # request timestamps and let repeated deletion bypass the hourly allowance.
    await connection.execute(update(assistant_messages).where(
        assistant_messages.c.user_id == user_id, assistant_messages.c.chat_id == scope,
    ).values(content="", source_labels=None, references=None, action_draft=None,
        chat_id=None, cleared_at=func.coalesce(assistant_messages.c.cleared_at, datetime.now(UTC))))
    await connection.execute(delete(assistant_chats).where(
        assistant_chats.c.id == chat_id, assistant_chats.c.user_id == user_id,
    ))
    # Only an entirely empty account receives a new, distinct blank conversation.
    # A deleted default chat is never recreated beside the remaining chats.
    return await list_chats(connection, user_id)
