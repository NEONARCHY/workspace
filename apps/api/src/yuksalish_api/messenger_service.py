from collections.abc import Mapping
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import UUID, uuid4
from zoneinfo import ZoneInfo

from sqlalchemy import delete, func, insert, select, text, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncConnection

from .auth import AuthenticatedUser
from .errors import WorkspaceRepositoryError
from .tables import (
    audit_events,
    chat_members,
    chats,
    message_receipts,
    message_versions,
    messages,
    users,
    workspace_notifications,
)
from .workspace_schemas import (
    AddChatMembersRequest,
    ChatMemberResponse,
    ChatMessageResponse,
    ChatPermissions,
    ChatSummaryResponse,
    CreateChatRequest,
    DeleteMessageRequest,
    EditMessageRequest,
    SendMessageRequest,
    SetChatMemberRequest,
    TransferChatOwnerRequest,
    UpdateChatRequest,
)

Record = Mapping[Any, Any]
FULL_PERMISSIONS = ChatPermissions(
    send_messages=True,
    upload_files=True,
    invite_members=True,
    manage_members=True,
    edit_info=True,
)


def member_permissions(member: Record) -> ChatPermissions:
    if member["member_role"] == "owner":
        return FULL_PERMISSIONS
    return ChatPermissions.model_validate(member["permissions"] or {})


async def chat_access(
    connection: AsyncConnection,
    user: AuthenticatedUser,
    chat_id: UUID,
    *,
    lock: bool = False,
) -> tuple[Record, Record]:
    statement = select(chats).where(chats.c.id == chat_id)
    if lock:
        statement = statement.with_for_update()
    chat = (await connection.execute(statement)).mappings().first()
    member = (
        (
            await connection.execute(
                select(chat_members).where(
                    chat_members.c.chat_id == chat_id,
                    chat_members.c.user_id == user.id,
                )
            )
        )
        .mappings()
        .first()
    )
    # Workspace-level admins are not implicitly members of a private conversation.
    if chat is None or member is None:
        raise WorkspaceRepositoryError(404, "Чат недоступен")
    return chat, member


def require_group(chat: Record) -> None:
    if chat["kind"] != "group":
        raise WorkspaceRepositoryError(
            403, "Состав этого служебного или личного чата не изменяется"
        )


async def audit(
    connection: AsyncConnection,
    user: AuthenticatedUser,
    action: str,
    target_id: UUID,
    details: dict[str, Any],
    *,
    target_type: str = "chat",
) -> None:
    await connection.execute(
        insert(audit_events).values(
            id=uuid4(),
            actor_user_id=user.id,
            action=action,
            target_type=target_type,
            target_id=target_id,
            details=details,
            created_at=datetime.now(UTC),
        )
    )


async def active_people(connection: AsyncConnection, member_ids: set[UUID]) -> None:
    found = set(
        (
            await connection.execute(
                select(users.c.id).where(
                    users.c.id.in_(member_ids),
                    users.c.status == "active",
                )
            )
        )
        .scalars()
        .all()
    )
    if found != member_ids:
        raise WorkspaceRepositoryError(422, "Можно выбрать только активных сотрудников Workspace")


async def chat_summary(
    connection: AsyncConnection,
    user: AuthenticatedUser,
    chat_id: UUID,
) -> ChatSummaryResponse:
    chat, membership = await chat_access(connection, user, chat_id)
    members = (
        (
            await connection.execute(
                select(chat_members)
                .where(
                    chat_members.c.chat_id == chat_id,
                )
                .order_by(chat_members.c.joined_at, chat_members.c.user_id)
            )
        )
        .mappings()
        .all()
    )
    title = chat["title"] or "Чат"
    if chat["kind"] == "direct" and len(members) == 2:
        peer = next(item for item in members if item["user_id"] != user.id)
        title = (
            await connection.scalar(select(users.c.full_name).where(users.c.id == peer["user_id"]))
            or "Сотрудник"
        )
    latest = (
        (
            await connection.execute(
                select(messages)
                .where(
                    messages.c.chat_id == chat_id,
                )
                .order_by(messages.c.created_at.desc())
                .limit(1)
            )
        )
        .mappings()
        .first()
    )
    unread = await connection.scalar(
        select(func.count())
        .select_from(
            message_receipts.join(messages, messages.c.id == message_receipts.c.message_id)
        )
        .where(
            messages.c.chat_id == chat_id,
            messages.c.deleted_at.is_(None),
            message_receipts.c.user_id == user.id,
            message_receipts.c.read_at.is_(None),
        )
    )
    preview = (
        "Сообщений пока нет"
        if latest is None
        else ("Сообщение удалено" if latest["deleted_at"] else latest["body"])
    )
    return ChatSummaryResponse(
        id=str(chat_id),
        title=title,
        description=chat["description"] or "",
        kind=chat["kind"],
        owner_id=next((str(m["user_id"]) for m in members if m["member_role"] == "owner"), None),
        members=[
            ChatMemberResponse(
                user_id=str(item["user_id"]),
                role=item["member_role"],
                permissions=member_permissions(item),
            )
            for item in members
        ],
        permissions=member_permissions(membership),
        preview=preview,
        unread=int(unread or 0),
        time=chat["updated_at"].astimezone(ZoneInfo("Asia/Tashkent")).strftime("%d.%m %H:%M"),
    )


async def create_chat(
    connection: AsyncConnection,
    user: AuthenticatedUser,
    payload: CreateChatRequest,
) -> ChatSummaryResponse:
    ids = set(payload.member_ids) | {user.id}
    if len(ids) < 2:
        raise WorkspaceRepositoryError(422, "Выберите хотя бы одного другого сотрудника")
    await active_people(connection, ids)
    direct_key = ":".join(sorted(str(item) for item in ids)) if payload.kind == "direct" else None
    if direct_key:
        # Serialize the same pair even when reusing a pre-migration direct conversation.
        await connection.execute(
            text("SELECT pg_advisory_xact_lock(hashtextextended(:pair, 0))"), {"pair": direct_key}
        )
        existing = await connection.scalar(
            select(chats.c.id).where(chats.c.direct_key == direct_key)
        )
        if existing is None:
            candidates = (
                (
                    await connection.execute(
                        select(chats.c.id).where(
                            chats.c.kind == "direct",
                            chats.c.direct_key.is_(None),
                            chats.c.id.in_(
                                select(chat_members.c.chat_id).where(
                                    chat_members.c.user_id == user.id
                                )
                            ),
                        )
                    )
                )
                .scalars()
                .all()
            )
            for candidate in candidates:
                candidate_ids = set(
                    (
                        await connection.execute(
                            select(chat_members.c.user_id).where(
                                chat_members.c.chat_id == candidate,
                            )
                        )
                    )
                    .scalars()
                    .all()
                )
                if candidate_ids == ids:
                    existing = candidate
                    await connection.execute(
                        update(chats)
                        .where(chats.c.id == candidate)
                        .values(
                            direct_key=direct_key,
                        )
                    )
                    break
        if existing is not None:
            return await chat_summary(connection, user, existing)
    now, chat_id = datetime.now(UTC), uuid4()
    await connection.execute(
        insert(chats).values(
            id=chat_id,
            kind=payload.kind,
            title=payload.title or None,
            description=payload.description,
            direct_key=direct_key,
            created_by_user_id=user.id,
            created_at=now,
            updated_at=now,
        )
    )
    await connection.execute(
        insert(chat_members),
        [
            {
                "chat_id": chat_id,
                "user_id": person_id,
                "member_role": "owner"
                if person_id == user.id and payload.kind == "group"
                else "member",
                "permissions": ChatPermissions().model_dump(),
                "joined_at": now,
                "muted_until": None,
            }
            for person_id in sorted(ids)
        ],
    )
    await audit(connection, user, "chat.created", chat_id, {"kind": payload.kind})
    return await chat_summary(connection, user, chat_id)


async def update_chat(
    connection: AsyncConnection,
    user: AuthenticatedUser,
    chat_id: UUID,
    payload: UpdateChatRequest,
) -> ChatSummaryResponse:
    chat, member = await chat_access(connection, user, chat_id, lock=True)
    require_group(chat)
    if not member_permissions(member).edit_info:
        raise WorkspaceRepositoryError(403, "Нет права изменять описание группы")
    await connection.execute(
        update(chats)
        .where(chats.c.id == chat_id)
        .values(
            title=payload.title,
            description=payload.description,
            updated_at=datetime.now(UTC),
        )
    )
    await audit(connection, user, "chat.updated", chat_id, payload.model_dump())
    return await chat_summary(connection, user, chat_id)


async def add_chat_members(
    connection: AsyncConnection,
    user: AuthenticatedUser,
    chat_id: UUID,
    payload: AddChatMembersRequest,
) -> ChatSummaryResponse:
    chat, member = await chat_access(connection, user, chat_id, lock=True)
    require_group(chat)
    if not member_permissions(member).invite_members:
        raise WorkspaceRepositoryError(403, "Нет права добавлять участников")
    ids = set(payload.member_ids)
    await active_people(connection, ids)
    await connection.execute(
        pg_insert(chat_members)
        .values(
            [
                {
                    "chat_id": chat_id,
                    "user_id": person_id,
                    "member_role": "member",
                    "permissions": ChatPermissions().model_dump(),
                    "joined_at": datetime.now(UTC),
                }
                for person_id in sorted(ids)
            ]
        )
        .on_conflict_do_nothing()
    )
    await audit(
        connection, user, "chat.members_added", chat_id, {"user_ids": sorted(map(str, ids))}
    )
    return await chat_summary(connection, user, chat_id)


async def set_chat_member(
    connection: AsyncConnection,
    user: AuthenticatedUser,
    chat_id: UUID,
    member_id: UUID,
    payload: SetChatMemberRequest,
) -> ChatSummaryResponse:
    chat, actor = await chat_access(connection, user, chat_id, lock=True)
    require_group(chat)
    if actor["member_role"] != "owner" or member_id == user.id:
        raise WorkspaceRepositoryError(
            403, "Только владелец назначает роли и права других участников"
        )
    target = await connection.scalar(
        select(chat_members.c.user_id).where(
            chat_members.c.chat_id == chat_id,
            chat_members.c.user_id == member_id,
        )
    )
    if target is None:
        raise WorkspaceRepositoryError(404, "Участник не найден")
    await connection.execute(
        update(chat_members)
        .where(
            chat_members.c.chat_id == chat_id,
            chat_members.c.user_id == member_id,
        )
        .values(member_role=payload.role, permissions=payload.permissions.model_dump())
    )
    await audit(
        connection,
        user,
        "chat.member_permissions",
        chat_id,
        {
            "user_id": str(member_id),
            **payload.model_dump(),
        },
    )
    return await chat_summary(connection, user, chat_id)


async def remove_chat_member(
    connection: AsyncConnection,
    user: AuthenticatedUser,
    chat_id: UUID,
    member_id: UUID,
) -> None:
    chat, actor = await chat_access(connection, user, chat_id, lock=True)
    require_group(chat)
    target = (
        (
            await connection.execute(
                select(chat_members).where(
                    chat_members.c.chat_id == chat_id,
                    chat_members.c.user_id == member_id,
                )
            )
        )
        .mappings()
        .first()
    )
    if target is None:
        raise WorkspaceRepositoryError(404, "Участник не найден")
    if target["member_role"] == "owner":
        raise WorkspaceRepositoryError(409, "Перед выходом передайте владение группой")
    if member_id != user.id and (
        not member_permissions(actor).manage_members
        or (target["member_role"] == "moderator" and actor["member_role"] != "owner")
    ):
        raise WorkspaceRepositoryError(403, "Нет права исключить этого участника")
    await connection.execute(
        delete(chat_members).where(
            chat_members.c.chat_id == chat_id,
            chat_members.c.user_id == member_id,
        )
    )
    await connection.execute(
        delete(message_receipts).where(
            message_receipts.c.user_id == member_id,
            message_receipts.c.message_id.in_(
                select(messages.c.id).where(messages.c.chat_id == chat_id)
            ),
        )
    )
    await connection.execute(
        update(workspace_notifications)
        .where(
            workspace_notifications.c.user_id == member_id,
            workspace_notifications.c.section == "messenger",
            workspace_notifications.c.entity_id == chat_id,
        )
        .values(read_at=datetime.now(UTC), resolved_at=datetime.now(UTC))
    )
    await audit(connection, user, "chat.member_removed", chat_id, {"user_id": str(member_id)})


async def transfer_chat_owner(
    connection: AsyncConnection,
    user: AuthenticatedUser,
    chat_id: UUID,
    payload: TransferChatOwnerRequest,
) -> ChatSummaryResponse:
    chat, actor = await chat_access(connection, user, chat_id, lock=True)
    require_group(chat)
    if actor["member_role"] != "owner" or payload.user_id == user.id:
        raise WorkspaceRepositoryError(403, "Владение передаёт только текущий владелец")
    await active_people(connection, {payload.user_id})
    target = await connection.scalar(
        select(chat_members.c.user_id).where(
            chat_members.c.chat_id == chat_id,
            chat_members.c.user_id == payload.user_id,
        )
    )
    if target is None:
        raise WorkspaceRepositoryError(422, "Сначала добавьте нового владельца в группу")
    await connection.execute(
        update(chat_members)
        .where(
            chat_members.c.chat_id == chat_id,
            chat_members.c.user_id == user.id,
        )
        .values(member_role="moderator", permissions=FULL_PERMISSIONS.model_dump())
    )
    await connection.execute(
        update(chat_members)
        .where(
            chat_members.c.chat_id == chat_id,
            chat_members.c.user_id == payload.user_id,
        )
        .values(member_role="owner", permissions=FULL_PERMISSIONS.model_dump())
    )
    await audit(
        connection, user, "chat.owner_transferred", chat_id, {"user_id": str(payload.user_id)}
    )
    return await chat_summary(connection, user, chat_id)


def message_response(
    row: Record, user: AuthenticatedUser, *, can_send: bool = True
) -> ChatMessageResponse:
    own = row["author_user_id"] == user.id
    deleted = row["deleted_at"] is not None
    return ChatMessageResponse(
        id=str(row["id"]),
        chat_id=str(row["chat_id"]),
        author_id=str(row["author_user_id"]),
        body="" if deleted else row["body"],
        own=own,
        time=row["created_at"].astimezone(ZoneInfo("Asia/Tashkent")).strftime("%H:%M"),
        created_at=row["created_at"],
        edited_at=row["edited_at"],
        deleted_at=row["deleted_at"],
        reply_to_message_id=str(row["reply_to_message_id"]) if row["reply_to_message_id"] else None,
        mention_user_ids=[] if deleted else (row["mention_user_ids"] or []),
        revision=row["revision"],
        can_edit=own
        and not deleted
        and can_send
        and datetime.now(UTC) < row["created_at"] + timedelta(hours=24),
    )


async def validate_mentions(
    connection: AsyncConnection,
    chat_id: UUID,
    ids: list[UUID],
) -> list[str]:
    unique = set(ids)
    member_ids = set(
        (
            await connection.execute(
                select(chat_members.c.user_id)
                .join(
                    users,
                    users.c.id == chat_members.c.user_id,
                )
                .where(chat_members.c.chat_id == chat_id, users.c.status == "active")
            )
        )
        .scalars()
        .all()
    )
    if not unique.issubset(member_ids):
        raise WorkspaceRepositoryError(422, "Упоминать можно только участников этого чата")
    return sorted(map(str, unique))


async def notify_message(
    connection: AsyncConnection,
    chat: Record,
    author: AuthenticatedUser,
    row: Record,
    recipients: list[UUID],
    *,
    edited_mention: bool = False,
) -> None:
    author_name = await connection.scalar(select(users.c.full_name).where(users.c.id == author.id))
    for recipient in recipients:
        if recipient == author.id:
            continue
        mentioned = str(recipient) in row["mention_user_ids"]
        notice = "Упоминание в чате" if mentioned else "Новое сообщение"
        key = (
            f"message:{row['id']}"
            if not edited_mention
            else f"mention:{row['id']}:{row['revision']}"
        )
        await connection.execute(
            pg_insert(workspace_notifications)
            .values(
                id=uuid4(),
                user_id=recipient,
                event_key=key,
                kind="message",
                priority="attention" if mentioned else "normal",
                title=f"{notice} · {chat['title'] or author_name}"[:240],
                body=f"{author_name}: {row['body']}"[:4000],
                section="messenger",
                entity_id=chat["id"],
                requires_action=False,
                is_reminder=False,
                occurred_at=datetime.now(UTC),
            )
            .on_conflict_do_nothing()
        )


async def send_chat_message(
    connection: AsyncConnection,
    user: AuthenticatedUser,
    chat_id: UUID,
    payload: SendMessageRequest,
) -> ChatMessageResponse:
    chat, member = await chat_access(connection, user, chat_id, lock=True)
    if not member_permissions(member).send_messages:
        raise WorkspaceRepositoryError(403, "Доступно только чтение сообщений")
    mentions = await validate_mentions(connection, chat_id, payload.mention_user_ids)
    if payload.reply_to_message_id is not None:
        parent = await connection.scalar(
            select(messages.c.id).where(
                messages.c.id == payload.reply_to_message_id,
                messages.c.chat_id == chat_id,
                messages.c.deleted_at.is_(None),
            )
        )
        if parent is None:
            raise WorkspaceRepositoryError(422, "Сообщение для ответа недоступно в этом чате")
    now = datetime.now(UTC)
    row = (
        (
            await connection.execute(
                insert(messages)
                .values(
                    id=uuid4(),
                    chat_id=chat_id,
                    author_user_id=user.id,
                    body=payload.body,
                    reply_to_message_id=payload.reply_to_message_id,
                    mention_user_ids=mentions,
                    created_at=now,
                    edited_at=None,
                    deleted_at=None,
                    revision=1,
                )
                .returning(messages)
            )
        )
        .mappings()
        .one()
    )
    await connection.execute(
        insert(message_versions).values(
            message_id=row["id"],
            body=payload.body,
            mention_user_ids=mentions,
            actor_user_id=user.id,
            change_reason="initial",
            created_at=now,
        )
    )
    recipients = list(
        (
            await connection.execute(
                select(chat_members.c.user_id)
                .join(
                    users,
                    users.c.id == chat_members.c.user_id,
                )
                .where(chat_members.c.chat_id == chat_id, users.c.status == "active")
            )
        )
        .scalars()
        .all()
    )
    await connection.execute(
        insert(message_receipts),
        [
            {
                "message_id": row["id"],
                "user_id": recipient,
                "delivered_at": now,
                "read_at": now if recipient == user.id else None,
            }
            for recipient in recipients
        ],
    )
    await connection.execute(update(chats).where(chats.c.id == chat_id).values(updated_at=now))
    await notify_message(connection, chat, user, row, recipients)
    return message_response(row, user)


async def change_message(
    connection: AsyncConnection,
    user: AuthenticatedUser,
    message_id: UUID,
    payload: EditMessageRequest | DeleteMessageRequest,
) -> ChatMessageResponse:
    chat_id = await connection.scalar(select(messages.c.chat_id).where(messages.c.id == message_id))
    if chat_id is None:
        raise WorkspaceRepositoryError(404, "Сообщение не найдено")
    chat, member = await chat_access(connection, user, chat_id, lock=True)
    row = (
        (
            await connection.execute(
                select(messages)
                .where(
                    messages.c.id == message_id,
                )
                .with_for_update()
            )
        )
        .mappings()
        .one()
    )
    if not message_response(row, user, can_send=member_permissions(member).send_messages).can_edit:
        raise WorkspaceRepositoryError(403, "Можно менять только свои сообщения в течение 24 часов")
    if payload.expected_revision != row["revision"]:
        raise WorkspaceRepositoryError(409, "Сообщение уже изменилось. Обновите переписку")
    deleted = isinstance(payload, DeleteMessageRequest)
    if isinstance(payload, EditMessageRequest):
        mentions = await validate_mentions(connection, chat_id, payload.mention_user_ids)
        body = payload.body
    else:
        mentions = []
        body = ""
    now = datetime.now(UTC)
    changed = (
        (
            await connection.execute(
                update(messages)
                .where(messages.c.id == message_id)
                .values(
                    body=body,
                    mention_user_ids=mentions,
                    revision=row["revision"] + 1,
                    edited_at=row["edited_at"] if deleted else now,
                    deleted_at=now if deleted else None,
                )
                .returning(messages)
            )
        )
        .mappings()
        .one()
    )
    await connection.execute(
        insert(message_versions).values(
            message_id=message_id,
            body=body,
            mention_user_ids=mentions,
            actor_user_id=user.id,
            change_reason="deleted" if deleted else "edited",
            created_at=now,
        )
    )
    await audit(
        connection,
        user,
        "message.deleted" if deleted else "message.edited",
        message_id,
        {"revision": changed["revision"], "chat_id": str(chat_id)},
        target_type="message",
    )
    # Never expose removed text through the notification preview.
    values: dict[str, Any] = {"body": "Сообщение удалено" if deleted else body[:4000]}
    if deleted:
        values.update(title="Сообщение удалено", read_at=now, resolved_at=now)
    await connection.execute(
        update(workspace_notifications)
        .where(
            (workspace_notifications.c.event_key == f"message:{message_id}")
            | workspace_notifications.c.event_key.startswith(f"mention:{message_id}:"),
        )
        .values(**values)
    )
    if not deleted:
        new_mentions = [UUID(item) for item in mentions if item not in row["mention_user_ids"]]
        await notify_message(connection, chat, user, changed, new_mentions, edited_mention=True)
    return message_response(changed, user)
