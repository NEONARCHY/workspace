"""Administrator-managed Telegram identities and bot-scoped grants."""

import hashlib
import secrets
from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

from fastapi import HTTPException
from sqlalchemy import delete, insert, or_, select, update
from sqlalchemy.engine import RowMapping
from sqlalchemy.ext.asyncio import AsyncConnection

from .auth import AuthenticatedUser
from .tables import (
    ai_referent_configuration,
    ai_referent_reviewers,
    audit_events,
    telegram_bot_grants,
    telegram_identities,
    users,
)
from .telegram_access_schemas import (
    BotDescriptor,
    TelegramAccessPerson,
    TelegramAccessRegistry,
    TelegramAccessUpdate,
    TelegramVerificationCode,
)

BOT_CATALOG = [
    BotDescriptor(key="ai_referent", label="AI Referent", connected=True),
    BotDescriptor(key="hisobot", label="AI Hisobot", connected=False),
    BotDescriptor(key="takliflar", label="Takliflar va Murojatlar", connected=False),
    BotDescriptor(key="hudud_rating", label="Hudud AI Reyting", connected=False),
    BotDescriptor(key="ai_news_reader", label="AI News Reader", connected=False),
]


def require_telegram_admin(user: AuthenticatedUser) -> None:
    if user.role not in {"admin", "superadmin"}:
        raise HTTPException(403, "Управление ботами доступно только администратору.")


async def _active_user(connection: AsyncConnection, user_id: UUID) -> RowMapping:
    row = (
        (
            await connection.execute(
                select(users.c.id, users.c.username, users.c.full_name, users.c.job_title)
                .where(users.c.id == user_id, users.c.status == "active")
            )
        )
        .mappings()
        .one_or_none()
    )
    if row is None:
        raise HTTPException(404, "Активный сотрудник не найден.")
    return row


def _person(
    account: RowMapping,
    identity: RowMapping | None,
    grants: set[str],
) -> TelegramAccessPerson:
    verified = bool(identity and identity["telegram_id"] and identity["verified_at"])
    return TelegramAccessPerson(
        user_id=account["id"],
        username=str(account["username"]),
        full_name=str(account["full_name"]),
        job_title=str(account["job_title"]) if account["job_title"] else None,
        telegram_id=(identity["telegram_id"] or identity["pending_telegram_id"])
        if identity else None,
        verified=verified,
        verification_source=(
            identity["verification_source"] if identity is not None and verified else None
        ),
        bot_keys=[bot.key for bot in BOT_CATALOG if bot.key in grants],
        revision=identity["revision"] if identity else 0,
    )


async def list_telegram_access(connection: AsyncConnection) -> TelegramAccessRegistry:
    accounts = (
        (
            await connection.execute(
                select(users.c.id, users.c.username, users.c.full_name, users.c.job_title)
                .where(users.c.status == "active")
                .order_by(users.c.full_name, users.c.username)
            )
        )
        .mappings()
        .all()
    )
    identities = {
        row["user_id"]: row
        for row in (await connection.execute(select(telegram_identities))).mappings().all()
    }
    grants: dict[UUID, set[str]] = {}
    for user_id, bot_key in (await connection.execute(
        select(telegram_bot_grants.c.user_id, telegram_bot_grants.c.bot_key)
    )).all():
        grants.setdefault(user_id, set()).add(bot_key)
    return TelegramAccessRegistry(
        bots=BOT_CATALOG,
        people=[_person(account, identities.get(account["id"]), grants.get(account["id"], set()))
                for account in accounts],
    )


async def save_telegram_access(
    connection: AsyncConnection,
    actor: AuthenticatedUser,
    user_id: UUID,
    payload: TelegramAccessUpdate,
) -> TelegramAccessPerson:
    require_telegram_admin(actor)
    await connection.execute(
        select(ai_referent_configuration.c.id)
        .where(ai_referent_configuration.c.id == 1)
        .with_for_update()
    )
    account = await _active_user(connection, user_id)
    identity = (
        (
            await connection.execute(
                select(telegram_identities)
                .where(telegram_identities.c.user_id == user_id)
                .with_for_update()
            )
        )
        .mappings()
        .one_or_none()
    )
    revision = identity["revision"] if identity else 0
    if revision != payload.expected_revision:
        raise HTTPException(409, "Доступ уже изменён. Обновите список сотрудников.")
    target_id = payload.telegram_id
    if target_id:
        conflict = await connection.scalar(
            select(telegram_identities.c.user_id).where(
                telegram_identities.c.user_id != user_id,
                or_(
                    telegram_identities.c.telegram_id == target_id,
                    telegram_identities.c.pending_telegram_id == target_id,
                ),
            )
        )
        reviewer_conflict = await connection.scalar(
            select(ai_referent_reviewers.c.user_id).where(
                ai_referent_reviewers.c.telegram_id == target_id,
                ai_referent_reviewers.c.user_id != user_id,
            )
        )
        if conflict or reviewer_conflict:
            raise HTTPException(409, "Telegram ID уже относится к другому сотруднику.")
    active_id = identity["telegram_id"] if identity else None
    confirmed = bool(identity and identity["verified_at"] and active_id == target_id)
    now = datetime.now(UTC)
    values = {
        "telegram_id": target_id if confirmed else None,
        "pending_telegram_id": target_id if target_id and not confirmed else None,
        "verified_at": identity["verified_at"] if identity is not None and confirmed else None,
        "verification_source": (
            identity["verification_source"] if identity is not None and confirmed else None
        ),
        "code_hash": None,
        "code_expires_at": None,
        "updated_at": now,
        "revision": revision + 1,
    }
    if identity:
        await connection.execute(
            update(telegram_identities)
            .where(telegram_identities.c.user_id == user_id)
            .values(**values)
        )
    else:
        await connection.execute(
            insert(telegram_identities).values(user_id=user_id, **values)
        )
    await connection.execute(
        delete(telegram_bot_grants).where(telegram_bot_grants.c.user_id == user_id)
    )
    for bot_key in payload.bot_keys:
        await connection.execute(
            insert(telegram_bot_grants).values(
                user_id=user_id, bot_key=bot_key,
                updated_by_user_id=actor.id, updated_at=now,
            )
        )
    # The old reviewer Telegram ID must not remain an alternate route after an ID change.
    if not confirmed:
        changed = await connection.execute(
            update(ai_referent_reviewers)
            .where(ai_referent_reviewers.c.user_id == user_id,
                   ai_referent_reviewers.c.telegram_id.is_not(None))
            .values(telegram_id=None)
        )
        if changed.rowcount:
            await connection.execute(
                update(ai_referent_configuration)
                .where(ai_referent_configuration.c.id == 1)
                .values(revision=ai_referent_configuration.c.revision + 1, updated_at=now)
            )
    await connection.execute(
        insert(audit_events).values(
            id=uuid4(), actor_user_id=actor.id, action="telegram_access.saved",
            target_type="user", target_id=user_id,
            details={"bots": payload.bot_keys, "verified": confirmed}, created_at=now,
        )
    )
    saved_identity = (
        (await connection.execute(select(telegram_identities).where(
            telegram_identities.c.user_id == user_id
        ))).mappings().one()
    )
    return _person(account, saved_identity, set(payload.bot_keys))


async def issue_admin_code(
    connection: AsyncConnection, actor: AuthenticatedUser, user_id: UUID
) -> TelegramVerificationCode:
    require_telegram_admin(actor)
    await _active_user(connection, user_id)
    identity = (
        (
            await connection.execute(
                select(telegram_identities)
                .where(telegram_identities.c.user_id == user_id)
                .with_for_update()
            )
        )
        .mappings()
        .one_or_none()
    )
    if identity is None or not identity["pending_telegram_id"]:
        raise HTTPException(409, "Сначала сохраните новый Telegram ID сотрудника.")
    code = secrets.token_urlsafe(24)
    expires = datetime.now(UTC) + timedelta(minutes=10)
    await connection.execute(
        update(telegram_identities)
        .where(telegram_identities.c.user_id == user_id)
        .values(code_hash=hashlib.sha256(code.encode()).hexdigest(),
                code_expires_at=expires, updated_at=datetime.now(UTC))
    )
    return TelegramVerificationCode(code=code, expires_at=expires.isoformat())
