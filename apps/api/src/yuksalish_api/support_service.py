from __future__ import annotations

from datetime import UTC, datetime
from typing import Any
from uuid import UUID, uuid4

from sqlalchemy import func, insert, or_, select, update
from sqlalchemy.ext.asyncio import AsyncConnection

from .auth import AuthenticatedUser
from .repository import _upsert_notification
from .support_schemas import (
    SupportAdminAction,
    SupportMessageResponse,
    SupportRegistryResponse,
    SupportRequestCreate,
    SupportRequestResponse,
)
from .tables import (
    audit_events,
    support_request_messages,
    support_requests,
    users,
    workspace_notifications,
)

SUPPORT_OWNER_USERNAMES = frozenset({"almazovtemur", "temuralmazov", "baxtiyorsamugov"})
REJECTION_COPY = {
    "insufficient_information": "Недостаточно информации для решения обращения.",
    "not_needed": "Предложение отклонено: изменение сейчас не требуется.",
    "already_implemented": "Обращение отклонено: это уже реализовано в системе.",
}


class SupportServiceError(ValueError):
    def __init__(self, status_code: int, detail: str) -> None:
        super().__init__(detail)
        self.status_code, self.detail = status_code, detail


def _is_support_operator(actor: AuthenticatedUser) -> bool:
    return (
        actor.role in {"admin", "superadmin"}
        or actor.username.lower() in SUPPORT_OWNER_USERNAMES
    )


async def _recipient_ids(connection: AsyncConnection, author_id: UUID) -> set[UUID]:
    rows = (
        await connection.execute(
            select(users.c.id).where(
                users.c.status == "active",
                users.c.id != author_id,
                or_(
                    users.c.role.in_(("admin", "superadmin")),
                    func.lower(users.c.username).in_(SUPPORT_OWNER_USERNAMES),
                ),
            )
        )
    ).scalars()
    return set(rows)


def _message(row: Any) -> SupportMessageResponse:
    return SupportMessageResponse(
        id=str(row["id"]),
        request_id=str(row["request_id"]),
        author_id=str(row["author_user_id"]),
        author_name=row["author_name"],
        kind=row["kind"],
        body=row["body"],
        created_at=row["created_at"],
    )


def _request(row: Any, messages: list[SupportMessageResponse]) -> SupportRequestResponse:
    return SupportRequestResponse(
        id=str(row["id"]),
        author_id=str(row["author_user_id"]),
        author_name=row["author_name"],
        author_username=row["author_username"],
        category=row["category"],
        subject=row["subject"],
        body=row["body"],
        status=row["status"],
        resolution_code=row["resolution_code"],
        response_unread=bool(row["response_unread"]),
        latest_response_tone=row["latest_response_tone"],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
        resolved_at=row["resolved_at"],
        messages=messages,
    )


async def load_support_registry(
    connection: AsyncConnection,
    actor: AuthenticatedUser,
) -> SupportRegistryResponse:
    is_operator = _is_support_operator(actor)
    criteria = (
        []
        if is_operator
        else [support_requests.c.author_user_id == actor.id]
    )
    request_rows = (
        (
            await connection.execute(
                select(
                    support_requests,
                    users.c.full_name.label("author_name"),
                    users.c.username.label("author_username"),
                )
                .join(users, users.c.id == support_requests.c.author_user_id)
                .where(*criteria)
                .order_by(support_requests.c.updated_at.desc())
                .limit(300)
            )
        )
        .mappings()
        .all()
    )
    request_ids = [row["id"] for row in request_rows]
    messages_by_request: dict[UUID, list[SupportMessageResponse]] = {
        request_id: [] for request_id in request_ids
    }
    if request_ids:
        message_rows = (
            (
                await connection.execute(
                    select(
                        support_request_messages,
                        users.c.full_name.label("author_name"),
                    )
                    .join(users, users.c.id == support_request_messages.c.author_user_id)
                    .where(support_request_messages.c.request_id.in_(request_ids))
                    .order_by(support_request_messages.c.created_at.asc())
                )
            )
            .mappings()
            .all()
        )
        for row in message_rows:
            messages_by_request[row["request_id"]].append(_message(row))
    unread = [] if is_operator else [row for row in request_rows if row["response_unread"]]
    indicator = unread[0]["latest_response_tone"] if unread else None
    return SupportRegistryResponse(
        mode="inbox" if is_operator else "support",
        indicator=indicator,
        unread_response_count=len(unread),
        requests=[
            _request(row, messages_by_request[row["id"]])
            for row in request_rows
        ],
    )


async def create_support_request(
    connection: AsyncConnection,
    actor: AuthenticatedUser,
    payload: SupportRequestCreate,
) -> tuple[SupportRequestResponse, set[UUID]]:
    now, request_id, message_id = datetime.now(UTC), uuid4(), uuid4()
    await connection.execute(
        insert(support_requests).values(
            id=request_id,
            author_user_id=actor.id,
            category=payload.category,
            subject=payload.subject,
            body=payload.body,
            status="open",
            resolution_code=None,
            response_unread=False,
            latest_response_tone=None,
            created_at=now,
            updated_at=now,
            resolved_at=None,
        )
    )
    await connection.execute(
        insert(support_request_messages).values(
            id=message_id,
            request_id=request_id,
            author_user_id=actor.id,
            kind="submission",
            body=payload.body,
            created_at=now,
        )
    )
    recipients = await _recipient_ids(connection, actor.id)
    for recipient_id in recipients:
        await _upsert_notification(
            connection,
            user_id=recipient_id,
            event_key=f"support:created:{request_id}",
            kind="support",
            priority="attention",
            title="Новое обращение в поддержку",
            body=f"{actor.full_name}: {payload.subject}",
            section="notifications",
            entity_id=request_id,
            requires_action=True,
            occurred_at=now,
        )
    registry = await load_support_registry(connection, actor)
    created = next(item for item in registry.requests if item.id == str(request_id))
    return created, recipients


async def act_on_support_request(
    connection: AsyncConnection,
    actor: AuthenticatedUser,
    request_id: UUID,
    payload: SupportAdminAction,
) -> SupportRequestResponse:
    if not _is_support_operator(actor):
        raise SupportServiceError(403, "Отвечать на обращения могут только администраторы")
    row = (
        (
            await connection.execute(
                select(support_requests)
                .where(support_requests.c.id == request_id)
                .with_for_update()
            )
        )
        .mappings()
        .one_or_none()
    )
    if row is None:
        raise SupportServiceError(404, "Обращение не найдено")
    now = datetime.now(UTC)
    kind = {"comment": "comment", "implement": "implemented", "reject": "rejected"}[
        payload.action
    ]
    resolution_code = None
    status = "open"
    resolved_at = None
    tone = "positive"
    if payload.action == "implement":
        status, resolution_code, resolved_at = "implemented", "implemented", now
        default_body = "Обращение учтено и реализовано в системе."
    elif payload.action == "reject":
        if payload.rejection_reason is None:
            raise SupportServiceError(422, "Выберите причину отклонения")
        status, resolution_code, resolved_at, tone = (
            "rejected",
            payload.rejection_reason,
            now,
            "negative",
        )
        default_body = REJECTION_COPY[payload.rejection_reason]
    else:
        status = row["status"]
        resolution_code = row["resolution_code"]
        resolved_at = row["resolved_at"]
        default_body = payload.body
    body = payload.body or default_body
    await connection.execute(
        update(support_requests)
        .where(support_requests.c.id == request_id)
        .values(
            status=status,
            resolution_code=resolution_code,
            response_unread=True,
            latest_response_tone=tone,
            updated_at=now,
            resolved_at=resolved_at,
        )
    )
    await connection.execute(
        insert(support_request_messages).values(
            id=uuid4(),
            request_id=request_id,
            author_user_id=actor.id,
            kind=kind,
            body=body,
            created_at=now,
        )
    )
    await connection.execute(
        update(workspace_notifications)
        .where(
            workspace_notifications.c.event_key == f"support:created:{request_id}",
            workspace_notifications.c.resolved_at.is_(None),
        )
        .values(resolved_at=now)
    )
    await _upsert_notification(
        connection,
        user_id=row["author_user_id"],
        event_key=f"support:response:{request_id}:{now.isoformat()}",
        kind="support",
        priority="attention" if tone == "negative" else "normal",
        title="Ответ по вашему обращению",
        body=body,
        section="notifications",
        entity_id=request_id,
        requires_action=False,
        occurred_at=now,
    )
    await connection.execute(
        insert(audit_events).values(
            id=uuid4(),
            actor_user_id=actor.id,
            action=f"support.request.{kind}",
            target_type="support_request",
            target_id=request_id,
            details={
                "status": status,
                "resolutionCode": resolution_code,
            },
            created_at=now,
        )
    )
    registry = await load_support_registry(connection, actor)
    return next(item for item in registry.requests if item.id == str(request_id))


async def mark_support_responses_read(
    connection: AsyncConnection,
    actor: AuthenticatedUser,
) -> None:
    if _is_support_operator(actor):
        return
    await connection.execute(
        update(support_requests)
        .where(
            support_requests.c.author_user_id == actor.id,
            support_requests.c.response_unread.is_(True),
        )
        .values(response_unread=False)
    )
