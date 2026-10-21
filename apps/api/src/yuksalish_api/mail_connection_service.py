"""OAuth state is single-use, short-lived and bound to the authenticated employee."""

import base64
import hashlib
import secrets
from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

from fastapi import HTTPException
from sqlalchemy import delete, insert, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.engine import RowMapping
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncConnection

from .access_control import ensure_module_action
from .auth import AuthenticatedUser
from .errors import WorkspaceRepositoryError
from .gmail_client import GMAIL_SCOPES, GmailClient, GmailError
from .mail_crypto import mail_configured, open_text, seal_text
from .mail_schemas import MailConnect, MailConnection, MailConnectStatus
from .mail_tables import mail_accounts, mail_drafts, mail_oauth_requests
from .settings import Settings
from .tables import users


async def account(
    connection: AsyncConnection,
    user: AuthenticatedUser,
    *,
    lock: bool = False,
) -> RowMapping:
    await ensure_module_action(connection, user, "mail", "view")
    query = select(mail_accounts).where(mail_accounts.c.owner_user_id == user.id)
    if lock:
        query = query.with_for_update()
    row = (await connection.execute(query)).mappings().first()
    if row is None:
        raise WorkspaceRepositoryError(409, "Сначала подключите свой Gmail")
    return row


async def connection_info(
    connection: AsyncConnection,
    user: AuthenticatedUser,
    settings: Settings,
) -> MailConnection:
    await ensure_module_action(connection, user, "mail", "view")
    row = (
        (
            await connection.execute(
                select(mail_accounts).where(
                    mail_accounts.c.owner_user_id == user.id,
                )
            )
        )
        .mappings()
        .first()
    )
    return MailConnection(
        configured=mail_configured(settings),
        sending_enabled=settings.gmail_sending_enabled,
        account_id=str(row["id"]) if row else None,
        email=row["email"] if row else None,
        connected_at=row["connected_at"] if row else None,
        reconnect_required=row["reconnect_required"] if row else False,
    )


async def start_oauth(
    connection: AsyncConnection,
    user: AuthenticatedUser,
    settings: Settings,
    client: GmailClient,
) -> MailConnect:
    await ensure_module_action(connection, user, "mail", "edit")
    if not mail_configured(settings):
        raise WorkspaceRepositoryError(
            503, "Администратор должен настроить Google OAuth и шифрование почты"
        )
    now = datetime.now(UTC)
    active_owner = await connection.scalar(
        select(users.c.id)
        .where(users.c.id == user.id, users.c.status == "active")
        .with_for_update()
    )
    if active_owner is None:
        raise WorkspaceRepositoryError(403, "Учётная запись больше не активна")
    # Bound outstanding requests per employee; old windows cannot reconnect after disconnect.
    await connection.execute(
        update(mail_oauth_requests)
        .where(
            mail_oauth_requests.c.owner_user_id == user.id,
            mail_oauth_requests.c.status.in_(["pending", "exchanging"]),
        )
        .values(status="expired", verifier_cipher="")
    )
    request_id, state, verifier = uuid4(), secrets.token_urlsafe(32), secrets.token_urlsafe(48)
    await connection.execute(
        insert(mail_oauth_requests).values(
            id=request_id,
            owner_user_id=user.id,
            state_hash=hashlib.sha256(state.encode()).hexdigest(),
            verifier_cipher=seal_text(settings, verifier, f"oauth:{request_id}"),
            status="pending",
            expires_at=now + timedelta(minutes=10),
        )
    )
    challenge = (
        base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip("=")
    )
    return MailConnect(
        request_id=str(request_id), authorization_url=client.authorization_url(state, challenge)
    )


async def oauth_status(
    connection: AsyncConnection,
    user: AuthenticatedUser,
    request_id: UUID,
) -> MailConnectStatus:
    await ensure_module_action(connection, user, "mail", "view")
    row = (
        (
            await connection.execute(
                select(mail_oauth_requests).where(
                    mail_oauth_requests.c.id == request_id,
                    mail_oauth_requests.c.owner_user_id == user.id,
                )
            )
        )
        .mappings()
        .first()
    )
    if row is None:
        raise WorkspaceRepositoryError(404, "Подключение не найдено")
    state = row["status"]
    if state in {"pending", "exchanging"} and row["expires_at"] < datetime.now(UTC):
        state = "expired"
    return MailConnectStatus(status=state)


async def cancel_oauth(
    connection: AsyncConnection, user: AuthenticatedUser, request_id: UUID
) -> None:
    await ensure_module_action(connection, user, "mail", "edit")
    await connection.execute(select(users.c.id).where(users.c.id == user.id).with_for_update())
    row = (
        (
            await connection.execute(
                select(mail_oauth_requests)
                .where(
                    mail_oauth_requests.c.id == request_id,
                    mail_oauth_requests.c.owner_user_id == user.id,
                )
                .with_for_update()
            )
        )
        .mappings()
        .first()
    )
    if row is None:
        raise WorkspaceRepositoryError(404, "Подключение не найдено")
    if row["status"] == "connected":
        raise WorkspaceRepositoryError(409, "Ящик уже подключён. При необходимости отключите Gmail")
    await connection.execute(
        update(mail_oauth_requests)
        .where(mail_oauth_requests.c.id == request_id)
        .values(status="expired", verifier_cipher="")
    )


async def complete_oauth(
    connection: AsyncConnection,
    settings: Settings,
    client: GmailClient,
    *,
    state: str,
    code: str,
    denied: bool,
) -> None:
    if not 20 <= len(state) <= 200 or len(code) > 4096:
        raise WorkspaceRepositoryError(
            400, "Недействительное подключение. Начните заново из Workspace"
        )
    row = (
        (
            await connection.execute(
                select(mail_oauth_requests)
                .where(
                    mail_oauth_requests.c.state_hash == hashlib.sha256(state.encode()).hexdigest(),
                )
                .with_for_update()
            )
        )
        .mappings()
        .first()
    )
    if row is None or row["status"] != "pending" or row["expires_at"] < datetime.now(UTC):
        raise WorkspaceRepositoryError(400, "Подключение истекло или уже использовано")
    await connection.execute(
        update(mail_oauth_requests)
        .where(
            mail_oauth_requests.c.id == row["id"],
        )
        .values(
            status="failed" if denied or not code else "exchanging",
            verifier_cipher="" if denied or not code else row["verifier_cipher"],
        )
    )
    # Consume state BEFORE exchanging the single-use code, including across API instances.
    await connection.commit()
    if denied or not code:
        raise WorkspaceRepositoryError(400, "Вы отменили подключение Gmail")
    if not mail_configured(settings):
        raise WorkspaceRepositoryError(503, "Google OAuth временно не настроен")
    try:
        tokens = await client.tokens(
            code=code, verifier=open_text(settings, row["verifier_cipher"], f"oauth:{row['id']}")
        )
        if not tokens.refresh_token or not GMAIL_SCOPES.issubset(tokens.scope.split()):
            raise WorkspaceRepositoryError(
                400, "Разрешите чтение и отправку писем при подключении Google"
            )
        email = await client.profile(tokens.access_token)
        # Serialize callbacks with disconnect and prevent an archived employee from linking mail.
        owner = (
            (
                await connection.execute(
                    select(users)
                    .where(
                        users.c.id == row["owner_user_id"],
                        users.c.status == "active",
                    )
                    .with_for_update()
                )
            )
            .mappings()
            .first()
        )
        flow = await connection.scalar(
            select(mail_oauth_requests.c.status)
            .where(
                mail_oauth_requests.c.id == row["id"],
            )
            .with_for_update()
        )
        if owner is None or flow != "exchanging":
            raise WorkspaceRepositoryError(403, "Подключение больше не разрешено")
        actor = AuthenticatedUser(
            id=owner["id"],
            username=owner["username"],
            full_name=owner["full_name"],
            role=owner["role"],
            position_id=owner["position_id"],
            department_id=owner["department_id"],
            job_title=owner["job_title"],
        )
        await ensure_module_action(connection, actor, "mail", "edit")
        existing = (
            (
                await connection.execute(
                    select(mail_accounts)
                    .where(
                        mail_accounts.c.owner_user_id == actor.id,
                    )
                    .with_for_update()
                )
            )
            .mappings()
            .first()
        )
        if existing and existing["email"] != email:
            raise WorkspaceRepositoryError(409, "Для смены ящика сначала отключите текущий Gmail")
        account_id = existing["id"] if existing else uuid4()
        now = datetime.now(UTC)
        values = {
            "refresh_cipher": seal_text(
                settings, tokens.refresh_token, f"account:{account_id}:refresh"
            ),
            "access_cipher": seal_text(
                settings, tokens.access_token, f"account:{account_id}:access"
            ),
            "access_expires_at": now + timedelta(seconds=tokens.expires_in),
            "reconnect_required": False,
            "connected_at": now,
        }
        if existing:
            await connection.execute(
                update(mail_accounts).where(mail_accounts.c.id == account_id).values(**values)
            )
        else:
            inserted = await connection.scalar(
                pg_insert(mail_accounts)
                .values(
                    id=account_id,
                    owner_user_id=actor.id,
                    email=email,
                    **values,
                )
                .on_conflict_do_nothing()
                .returning(mail_accounts.c.id)
            )
            if inserted is None:
                raise WorkspaceRepositoryError(
                    409, "Этот ящик уже подключён. Проверьте выбранный аккаунт"
                )
        await connection.execute(
            update(mail_oauth_requests)
            .where(
                mail_oauth_requests.c.id == row["id"],
            )
            .values(status="connected", verifier_cipher="")
        )
        await connection.commit()
    except (WorkspaceRepositoryError, HTTPException, SQLAlchemyError):
        await connection.rollback()
        await connection.execute(
            update(mail_oauth_requests)
            .where(
                mail_oauth_requests.c.id == row["id"],
            )
            .values(status="failed", verifier_cipher="")
        )
        await connection.commit()
        raise


async def access_token(
    connection: AsyncConnection,
    user: AuthenticatedUser,
    settings: Settings,
    client: GmailClient,
) -> tuple[RowMapping, str]:
    if not mail_configured(settings):
        raise WorkspaceRepositoryError(503, "Подключение Google OAuth не настроено")
    row = await account(connection, user, lock=True)
    key = f"account:{row['id']}"
    if row["access_expires_at"] > datetime.now(UTC) + timedelta(seconds=60):
        value = open_text(settings, row["access_cipher"], key + ":access")
        await connection.commit()
        return row, value
    try:
        tokens = await client.tokens(
            refresh=open_text(settings, row["refresh_cipher"], key + ":refresh")
        )
    except GmailError:
        # No retry: an explicit reconnect remains available in the UI.
        raise
    values = {
        "access_cipher": seal_text(settings, tokens.access_token, key + ":access"),
        "access_expires_at": datetime.now(UTC) + timedelta(seconds=tokens.expires_in),
    }
    if tokens.refresh_token:
        values["refresh_cipher"] = seal_text(settings, tokens.refresh_token, key + ":refresh")
    await connection.execute(
        update(mail_accounts).where(mail_accounts.c.id == row["id"]).values(**values)
    )
    await connection.commit()
    return row, tokens.access_token


async def disconnect(
    connection: AsyncConnection,
    user: AuthenticatedUser,
    settings: Settings,
    client: GmailClient,
) -> bool:
    await ensure_module_action(connection, user, "mail", "edit")
    await connection.execute(select(users.c.id).where(users.c.id == user.id).with_for_update())
    row = await account(connection, user, lock=True)
    active = await connection.scalar(
        select(mail_drafts.c.id)
        .where(
            mail_drafts.c.account_id == row["id"],
            mail_drafts.c.status == "sending",
        )
        .limit(1)
    )
    if active:
        raise WorkspaceRepositoryError(
            409, "Дождитесь результата текущей отправки перед отключением"
        )
    refresh = open_text(settings, row["refresh_cipher"], f"account:{row['id']}:refresh")
    await connection.execute(delete(mail_accounts).where(mail_accounts.c.id == row["id"]))
    await connection.execute(
        update(mail_oauth_requests)
        .where(
            mail_oauth_requests.c.owner_user_id == user.id,
        )
        .values(status="expired", verifier_cipher="")
    )
    await connection.commit()
    return await client.revoke(refresh)
