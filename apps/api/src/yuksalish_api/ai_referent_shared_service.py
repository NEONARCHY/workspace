"""Identity, deduplication and transactional notifications for both clients."""

from __future__ import annotations

import hashlib
import secrets
from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

from fastapi import HTTPException
from pydantic import BaseModel
from sqlalchemy import insert, or_, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.engine import RowMapping
from sqlalchemy.ext.asyncio import AsyncConnection

from .access_control import ensure_module_action, module_permissions_for_user
from .ai_referent_visibility import OPERATOR_VISIBLE_STATUSES, may_view_letter
from .auth import AuthenticatedUser
from .tables import (
    ai_referent_configuration,
    ai_referent_letters,
    ai_referent_operations,
    ai_referent_reviewers,
    ai_referent_telegram_links,
    ai_referent_telegram_outbox,
    telegram_bot_grants,
    users,
    workspace_notifications,
)


async def operation_replay(
    connection: AsyncConnection,
    user: AuthenticatedUser,
    payload: BaseModel,
    scope: str,
) -> UUID | None:
    operation_id = getattr(payload, "operation_id", None)
    if operation_id is None:
        return None
    fingerprint = hashlib.sha256((scope + payload.model_dump_json()).encode()).hexdigest()
    record = (
        (
            await connection.execute(
                select(ai_referent_operations).where(
                    ai_referent_operations.c.operation_id == operation_id,
                )
            )
        )
        .mappings()
        .one_or_none()
    )
    if record is None:
        return None
    if record["user_id"] != user.id or record["fingerprint"] != fingerprint:
        raise HTTPException(409, "Идентификатор операции уже использован для других данных.")
    return UUID(str(record["letter_id"]))


async def remember_operation(
    connection: AsyncConnection,
    user: AuthenticatedUser,
    payload: BaseModel,
    scope: str,
    letter_id: UUID,
) -> None:
    operation_id = getattr(payload, "operation_id", None)
    if operation_id is not None:
        await connection.execute(
            insert(ai_referent_operations).values(
                operation_id=operation_id,
                user_id=user.id,
                letter_id=letter_id,
                fingerprint=hashlib.sha256(
                    (scope + payload.model_dump_json()).encode()
                ).hexdigest(),
                created_at=datetime.now(UTC),
            )
        )


async def telegram_id_for(connection: AsyncConnection, user_id: UUID) -> str | None:
    linked = await connection.scalar(
        select(ai_referent_telegram_links.c.telegram_id)
        .join(telegram_bot_grants,
              telegram_bot_grants.c.user_id == ai_referent_telegram_links.c.user_id)
        .where(
            ai_referent_telegram_links.c.user_id == user_id,
            ai_referent_telegram_links.c.verified_at.is_not(None),
            telegram_bot_grants.c.bot_key == "ai_referent",
        )
    )
    if not linked:
        return None
    active = await connection.scalar(
        select(users.c.id).where(users.c.id == user_id, users.c.status == "active")
    )
    if active is None:
        return None
    assigned = await connection.scalar(
        select(ai_referent_reviewers.c.telegram_id).where(
            ai_referent_reviewers.c.user_id == user_id,
            ai_referent_reviewers.c.enabled.is_(True),
        )
    )
    return str(linked) if assigned is None or str(assigned) == linked else None


async def verified_telegram_id_for(connection: AsyncConnection, user_id: UUID) -> str | None:
    linked = await connection.scalar(
        select(ai_referent_telegram_links.c.telegram_id).where(
            ai_referent_telegram_links.c.user_id == user_id,
            ai_referent_telegram_links.c.verified_at.is_not(None),
        )
    )
    return str(linked) if linked else None


async def telegram_actor(connection: AsyncConnection, telegram_id: str) -> AuthenticatedUser:
    linked = await connection.scalar(
        select(ai_referent_telegram_links.c.user_id)
        .join(telegram_bot_grants,
              telegram_bot_grants.c.user_id == ai_referent_telegram_links.c.user_id)
        .where(
            ai_referent_telegram_links.c.telegram_id == telegram_id,
            ai_referent_telegram_links.c.verified_at.is_not(None),
            telegram_bot_grants.c.bot_key == "ai_referent",
        )
    )
    user_id = linked
    if user_id is None:
        raise HTTPException(
            403, "Нет подтверждённого Telegram ID или доступа к AI Referent. "
            "Обратитесь к администратору."
        )
    current_assignment = await connection.scalar(
        select(ai_referent_reviewers.c.telegram_id).where(
            ai_referent_reviewers.c.user_id == user_id,
            ai_referent_reviewers.c.enabled.is_(True),
        )
    )
    if current_assignment and str(current_assignment) != telegram_id:
        raise HTTPException(403, "Telegram ID согласующего изменён администратором.")
    account = (
        (
            await connection.execute(
                select(users).where(
                    users.c.id == user_id,
                    users.c.status == "active",
                )
            )
        )
        .mappings()
        .one_or_none()
    )
    if account is None:
        raise HTTPException(403, "Учётная запись недоступна.")
    actor = AuthenticatedUser(
        id=account["id"],
        username=account["username"],
        full_name=account["full_name"],
        role=account["role"],
        position_id=account["position_id"],
        department_id=account["department_id"],
        job_title=None,
    )
    await ensure_module_action(connection, actor, "ai_referent", "view")
    return actor


async def issue_link_code(
    connection: AsyncConnection, user: AuthenticatedUser
) -> dict[str, object]:
    await ensure_module_action(connection, user, "ai_referent", "view")
    identity = (
        (await connection.execute(select(ai_referent_telegram_links).where(
            ai_referent_telegram_links.c.user_id == user.id
        ).with_for_update())).mappings().one_or_none()
    )
    if identity is None or not (identity["pending_telegram_id"] or identity["telegram_id"]):
        raise HTTPException(409, "Сначала попросите администратора указать ваш Telegram ID.")
    code = secrets.token_urlsafe(24)
    expires = datetime.now(UTC) + timedelta(minutes=10)
    await connection.execute(
        update(ai_referent_telegram_links)
        .where(ai_referent_telegram_links.c.user_id == user.id)
        .values(code_hash=hashlib.sha256(code.encode()).hexdigest(),
                code_expires_at=expires, updated_at=datetime.now(UTC))
    )
    return {"code": code, "expiresAt": expires.isoformat()}


async def consume_link_code(
    connection: AsyncConnection,
    telegram_id: str,
    code: str,
) -> None:
    await connection.execute(select(ai_referent_configuration).with_for_update())
    row = (
        (
            await connection.execute(
                select(ai_referent_telegram_links)
                .where(
                    ai_referent_telegram_links.c.code_hash
                    == hashlib.sha256(code.encode()).hexdigest(),
                    ai_referent_telegram_links.c.code_expires_at > datetime.now(UTC),
                )
                .with_for_update()
            )
        )
        .mappings()
        .one_or_none()
    )
    if row is None:
        raise HTTPException(422, "Код истёк или уже использован. Получите новый в Workspace.")
    active = await connection.scalar(
        select(users.c.id).where(
            users.c.id == row["user_id"],
            users.c.status == "active",
        )
    )
    assigned = await connection.scalar(
        select(ai_referent_reviewers.c.user_id).where(
            ai_referent_reviewers.c.telegram_id == telegram_id,
        )
    )
    conflict = await connection.scalar(
        select(ai_referent_telegram_links.c.user_id).where(
            or_(
                ai_referent_telegram_links.c.telegram_id == telegram_id,
                ai_referent_telegram_links.c.pending_telegram_id == telegram_id,
            ),
            ai_referent_telegram_links.c.user_id != row["user_id"],
        )
    )
    expected = await connection.scalar(
        select(ai_referent_reviewers.c.telegram_id).where(
            ai_referent_reviewers.c.user_id == row["user_id"],
        )
    )
    if (
        not active
        or conflict
        or (assigned and assigned != active)
        or not (
            row["pending_telegram_id"] == telegram_id
            or (row["verified_at"] and row["telegram_id"] == telegram_id)
        )
        or (expected and str(expected) != telegram_id and not row["pending_telegram_id"])
    ):
        raise HTTPException(409, "Привязка нарушает назначения. Обратитесь к администратору.")
    await connection.execute(
        update(ai_referent_telegram_links)
        .where(
            ai_referent_telegram_links.c.user_id == active,
        )
        .values(
            telegram_id=telegram_id,
            pending_telegram_id=None,
            verified_at=datetime.now(UTC),
            verification_source="bot",
            revision=ai_referent_telegram_links.c.revision + 1,
            code_hash=None,
            code_expires_at=None,
            updated_at=datetime.now(UTC),
        )
    )
    changed = await connection.execute(
        update(ai_referent_reviewers)
        .where(ai_referent_reviewers.c.user_id == active,
               ai_referent_reviewers.c.telegram_id.is_distinct_from(telegram_id))
        .values(telegram_id=telegram_id)
    )
    if changed.rowcount:
        await connection.execute(
            update(ai_referent_configuration)
            .where(ai_referent_configuration.c.id == 1)
            .values(revision=ai_referent_configuration.c.revision + 1,
                    updated_at=datetime.now(UTC))
        )


async def notify_letter(
    connection: AsyncConnection, row: RowMapping, title: str, comment: str = ""
) -> None:
    now = datetime.now(UTC)
    # Do not ask a future reviewer to decide before their stage has begun.
    recipients = {row["created_by_user_id"]}
    if row["status"] != "needs_revision":
        recipients.add(row["reviewer_user_id"])
    if row["status"] in {"sent", "signed"}:
        recipients.update({row.get("initial_reviewer_user_id"), row.get("final_reviewer_user_id")})
    action_recipients = set()
    if row["status"] == "needs_revision":
        action_recipients.add(row["created_by_user_id"])
    elif row["status"] in {"pending_review", "approved", "awaiting_final_send", "failed"}:
        action_recipients.add(row["reviewer_user_id"])
    if row["status"] in OPERATOR_VISIBLE_STATUSES:
        candidates = (
            (await connection.execute(select(users).where(users.c.status == "active")))
            .mappings()
            .all()
        )
        for account in candidates:
            actor = AuthenticatedUser(
                id=account["id"],
                username=account["username"],
                full_name=account["full_name"],
                role=account["role"],
                position_id=account["position_id"],
                department_id=account["department_id"],
                job_title=None,
            )
            rights = await module_permissions_for_user(connection, actor)
            if rights.get("ai_referent", {}).get("admin"):
                recipients.add(actor.id)
                action_recipients.add(actor.id)
    # Resolve old action indicators; audit and read state remain intact.
    await connection.execute(
        update(workspace_notifications)
        .where(
            workspace_notifications.c.section == "ai_referent",
            workspace_notifications.c.entity_id == row["id"],
            workspace_notifications.c.resolved_at.is_(None),
        )
        .values(resolved_at=now, requires_action=False)
    )
    for user_id in recipients - {None}:
        event_key = f"ai-letter:{row['id']}:{row['revision']}"
        subject = row["subject"] or (
            f"{int(row['outgoing_number']):04d}/{row['year_suffix']}-AI"
            if row["outgoing_number"] is not None
            else "Тема — будущий исходящий номер"
        )
        body = subject + (f"\n{comment}" if comment else "")
        if row.get("note"):
            body += f"\nСлужебная заметка: {row['note']}"  # noqa: RUF001
        text = f"{title}\n{body}"
        await connection.execute(
            pg_insert(workspace_notifications)
            .values(
                id=uuid4(),
                user_id=user_id,
                event_key=event_key,
                kind="approval",
                priority="attention",
                title=title,
                body=body,
                section="ai_referent",
                entity_id=row["id"],
                requires_action=user_id in action_recipients,
                is_reminder=False,
                occurred_at=now,
                read_at=None,
                resolved_at=None,
                desktop_delivered_at=None,
            )
            .on_conflict_do_nothing(
                index_elements=[
                    workspace_notifications.c.user_id,
                    workspace_notifications.c.event_key,
                ]
            )
        )
        await connection.execute(
            pg_insert(ai_referent_telegram_outbox)
            .values(
                id=uuid4(),
                user_id=user_id,
                letter_id=row["id"],
                event_key=event_key,
                text=text,
                attempt_count=0,
                last_error="",
                created_at=now,
            )
            .on_conflict_do_nothing(
                index_elements=[
                    ai_referent_telegram_outbox.c.user_id,
                    ai_referent_telegram_outbox.c.event_key,
                ]
            )
        )


async def claim_notifications(connection: AsyncConnection) -> list[dict[str, object]]:
    now = datetime.now(UTC)
    rows = (
        (
            await connection.execute(
                select(ai_referent_telegram_outbox)
                .where(
                    ai_referent_telegram_outbox.c.delivered_at.is_(None),
                    or_(
                        ai_referent_telegram_outbox.c.lease_until.is_(None),
                        ai_referent_telegram_outbox.c.lease_until < now,
                    ),
                )
                .order_by(ai_referent_telegram_outbox.c.created_at)
                .limit(20)
                .with_for_update(skip_locked=True)
            )
        )
        .mappings()
        .all()
    )
    result: list[dict[str, object]] = []
    for row in rows:
        telegram_id = await telegram_id_for(connection, row["user_id"])
        lease = uuid4()
        await connection.execute(
            update(ai_referent_telegram_outbox)
            .where(
                ai_referent_telegram_outbox.c.id == row["id"],
            )
            .values(
                lease_token=lease,
                lease_until=now + timedelta(minutes=2),
                attempt_count=row["attempt_count"] + 1,
            )
        )
        if not telegram_id:
            continue
        try:
            actor = await telegram_actor(connection, telegram_id)
        except HTTPException:
            continue
        if actor.id != row["user_id"]:
            continue
        letter = (
            (
                await connection.execute(
                    select(ai_referent_letters).where(
                        ai_referent_letters.c.id == row["letter_id"],
                    )
                )
            )
            .mappings()
            .one_or_none()
        )
        permissions = await module_permissions_for_user(connection, actor)
        if letter is None or not may_view_letter(
            letter,
            actor,
            may_operate=permissions.get("ai_referent", {}).get("admin", False),
        ):
            continue
        result.append(
            {
                "id": str(row["id"]),
                "leaseToken": str(lease),
                "telegramId": telegram_id,
                "letterId": str(row["letter_id"]),
                "text": row["text"],
            }
        )
    return result
