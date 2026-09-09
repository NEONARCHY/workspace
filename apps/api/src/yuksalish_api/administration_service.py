from collections import defaultdict
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import UUID, uuid4

from sqlalchemy import func, insert, select, update
from sqlalchemy.ext.asyncio import AsyncConnection

from .access_control import module_permissions_for_user
from .administration_schemas import (
    AdministrativeChatInspectionCreateRequest,
    AdministrativeChatInspectionResponse,
    AdministrativeChatMemberResponse,
    AdministrativeChatMessageResponse,
    AdministrativeChatResponse,
)
from .auth import AuthenticatedUser
from .errors import WorkspaceRepositoryError
from .tables import admin_chat_inspections, audit_events, chat_members, chats, messages, users

MAX_INSPECTION_MESSAGES = 500


async def _require_chat_administrator(
    connection: AsyncConnection,
    actor: AuthenticatedUser,
) -> None:
    if actor.role not in {"admin", "superadmin"}:
        raise WorkspaceRepositoryError(
            403,
            "Доступ к контролю чатов есть только у администратора",  # noqa: RUF001
        )
    permissions = await module_permissions_for_user(connection, actor)
    if not permissions.get("messenger", {}).get("admin", False):
        raise WorkspaceRepositoryError(403, "Требуется административное право модуля «Мессенджер»")


async def _audit(
    connection: AsyncConnection,
    actor: AuthenticatedUser,
    action: str,
    chat_id: UUID,
    details: dict[str, Any],
) -> None:
    await connection.execute(
        insert(audit_events).values(
            id=uuid4(),
            actor_user_id=actor.id,
            action=action,
            target_type="chat",
            target_id=chat_id,
            details=details,
            created_at=datetime.now(UTC),
        )
    )


async def _chat_members(
    connection: AsyncConnection,
    chat_ids: list[UUID],
) -> dict[UUID, list[AdministrativeChatMemberResponse]]:
    if not chat_ids:
        return {}
    rows = (
        await connection.execute(
            select(
                chat_members.c.chat_id,
                users.c.id.label("user_id"),
                users.c.full_name,
                users.c.status,
            )
            .join(users, users.c.id == chat_members.c.user_id)
            .where(chat_members.c.chat_id.in_(chat_ids))
            .order_by(users.c.full_name)
        )
    ).mappings().all()
    result: dict[UUID, list[AdministrativeChatMemberResponse]] = defaultdict(list)
    for row in rows:
        result[row["chat_id"]].append(
            AdministrativeChatMemberResponse(
                user_id=str(row["user_id"]),
                name=row["full_name"],
                status=row["status"],
            )
        )
    return dict(result)


def _chat_title(chat: Any, members: list[AdministrativeChatMemberResponse]) -> str:
    if chat["title"]:
        return str(chat["title"])
    if chat["kind"] == "direct" and members:
        return " — ".join(member.name for member in members)
    return "Чат без названия"


def _chat_response(
    chat: Any,
    members: list[AdministrativeChatMemberResponse],
    message_count: int,
) -> AdministrativeChatResponse:
    return AdministrativeChatResponse(
        id=str(chat["id"]),
        title=_chat_title(chat, members),
        kind=chat["kind"],
        members=members,
        message_count=message_count,
        updated_at=chat["updated_at"],
    )


async def list_administrative_chats(
    connection: AsyncConnection,
    actor: AuthenticatedUser,
    query: str | None = None,
) -> list[AdministrativeChatResponse]:
    await _require_chat_administrator(connection, actor)
    chat_rows = (
        await connection.execute(select(chats).order_by(chats.c.updated_at.desc()).limit(500))
    ).mappings().all()
    chat_ids = [row["id"] for row in chat_rows]
    members = await _chat_members(connection, chat_ids)
    counts: dict[UUID, int] = {}
    if chat_ids:
        count_rows = (
            await connection.execute(
                select(messages.c.chat_id, func.count(messages.c.id))
                .where(messages.c.chat_id.in_(chat_ids))
                .group_by(messages.c.chat_id)
            )
        ).all()
        counts = {row[0]: int(row[1]) for row in count_rows}
    responses = [
        _chat_response(row, members.get(row["id"], []), int(counts.get(row["id"], 0)))
        for row in chat_rows
    ]
    normalized = " ".join((query or "").lower().split())
    if not normalized:
        return responses
    return [
        chat
        for chat in responses
        if normalized in f"{chat.title} {' '.join(member.name for member in chat.members)}".lower()
    ]


async def _load_inspection(
    connection: AsyncConnection,
    actor: AuthenticatedUser,
    inspection_id: UUID,
) -> AdministrativeChatInspectionResponse:
    await _require_chat_administrator(connection, actor)
    now = datetime.now(UTC)
    inspection = (
        await connection.execute(
            select(admin_chat_inspections).where(
                admin_chat_inspections.c.id == inspection_id,
                admin_chat_inspections.c.actor_user_id == actor.id,
            )
        )
    ).mappings().first()
    if inspection is None:
        raise WorkspaceRepositoryError(404, "Сеанс административного просмотра не найден")
    if inspection["revoked_at"] is not None:
        raise WorkspaceRepositoryError(410, "Сеанс административного просмотра завершён")
    if inspection["expires_at"] <= now:
        raise WorkspaceRepositoryError(410, "Срок административного просмотра истёк")

    chat = (
        await connection.execute(select(chats).where(chats.c.id == inspection["chat_id"]))
    ).mappings().first()
    if chat is None:
        raise WorkspaceRepositoryError(404, "Чат не найден")
    member_map = await _chat_members(connection, [chat["id"]])
    chat_members_response = member_map.get(chat["id"], [])
    total_messages = int(
        await connection.scalar(
            select(func.count(messages.c.id)).where(messages.c.chat_id == chat["id"])
        )
        or 0
    )
    message_rows = list(
        reversed(
            (
                await connection.execute(
                    select(messages, users.c.full_name.label("author_name"))
                    .join(users, users.c.id == messages.c.author_user_id)
                    .where(messages.c.chat_id == chat["id"])
                    .order_by(messages.c.created_at.desc())
                    .limit(MAX_INSPECTION_MESSAGES)
                )
            ).mappings().all()
        )
    )
    await connection.execute(
        update(admin_chat_inspections)
        .where(admin_chat_inspections.c.id == inspection_id)
        .values(last_accessed_at=now)
    )
    await _audit(
        connection,
        actor,
        "chat.admin_inspection_opened",
        chat["id"],
        {"inspectionId": str(inspection_id), "reason": inspection["reason"]},
    )
    return AdministrativeChatInspectionResponse(
        id=str(inspection_id),
        chat=_chat_response(chat, chat_members_response, total_messages),
        messages=[
            AdministrativeChatMessageResponse(
                id=str(row["id"]),
                author_user_id=str(row["author_user_id"]),
                author_name=row["author_name"],
                body="Сообщение удалено" if row["deleted_at"] is not None else row["body"],
                created_at=row["created_at"],
                edited_at=row["edited_at"],
                deleted_at=row["deleted_at"],
            )
            for row in message_rows
        ],
        reason=inspection["reason"],
        created_at=inspection["created_at"],
        expires_at=inspection["expires_at"],
        total_messages=total_messages,
        truncated=total_messages > MAX_INSPECTION_MESSAGES,
    )


async def create_chat_inspection(
    connection: AsyncConnection,
    actor: AuthenticatedUser,
    payload: AdministrativeChatInspectionCreateRequest,
) -> AdministrativeChatInspectionResponse:
    await _require_chat_administrator(connection, actor)
    chat_exists = await connection.scalar(select(chats.c.id).where(chats.c.id == payload.chat_id))
    if chat_exists is None:
        raise WorkspaceRepositoryError(404, "Чат не найден")
    now = datetime.now(UTC)
    inspection_id = uuid4()
    expires_at = now + timedelta(minutes=payload.duration_minutes)
    await connection.execute(
        insert(admin_chat_inspections).values(
            id=inspection_id,
            chat_id=payload.chat_id,
            actor_user_id=actor.id,
            reason=payload.reason,
            created_at=now,
            expires_at=expires_at,
            last_accessed_at=None,
            revoked_at=None,
        )
    )
    await _audit(
        connection,
        actor,
        "chat.admin_inspection_started",
        payload.chat_id,
        {
            "inspectionId": str(inspection_id),
            "reason": payload.reason,
            "durationMinutes": payload.duration_minutes,
            "expiresAt": expires_at.isoformat(),
        },
    )
    return await _load_inspection(connection, actor, inspection_id)


async def get_chat_inspection(
    connection: AsyncConnection,
    actor: AuthenticatedUser,
    inspection_id: UUID,
) -> AdministrativeChatInspectionResponse:
    return await _load_inspection(connection, actor, inspection_id)


async def revoke_chat_inspection(
    connection: AsyncConnection,
    actor: AuthenticatedUser,
    inspection_id: UUID,
) -> None:
    await _require_chat_administrator(connection, actor)
    inspection = (
        await connection.execute(
            select(admin_chat_inspections).where(
                admin_chat_inspections.c.id == inspection_id,
                admin_chat_inspections.c.actor_user_id == actor.id,
            )
        )
    ).mappings().first()
    if inspection is None:
        raise WorkspaceRepositoryError(404, "Сеанс административного просмотра не найден")
    if inspection["revoked_at"] is None:
        now = datetime.now(UTC)
        await connection.execute(
            update(admin_chat_inspections)
            .where(admin_chat_inspections.c.id == inspection_id)
            .values(revoked_at=now)
        )
        await _audit(
            connection,
            actor,
            "chat.admin_inspection_revoked",
            inspection["chat_id"],
            {"inspectionId": str(inspection_id), "reason": inspection["reason"]},
        )
