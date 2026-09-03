import asyncio
import os
from datetime import UTC, datetime, timedelta

import pytest
from pydantic import SecretStr
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from yuksalish_api.auth import InvalidTokenError, authenticate_access_token, read_access_token
from yuksalish_api.auth_schemas import InvitationCreateRequest
from yuksalish_api.auth_service import (
    AuthServiceError,
    accept_invitation,
    begin_totp_setup,
    bootstrap_initial_admin,
    confirm_totp_setup,
    create_invitation,
    disable_totp,
    generate_totp,
    list_user_sessions,
    login_with_password,
    refresh_session,
    revoke_session,
)
from yuksalish_api.repository import find_active_user_by_username
from yuksalish_api.seed import seed_demo_data
from yuksalish_api.settings import Settings


async def _exercise_production_auth(database_url: str) -> None:
    demo_password = SecretStr("Yuksalish-Local-2026!")
    settings = Settings(
        environment="test",
        database_url=database_url,
        auth_signing_key=SecretStr("integration-signing-key"),
        auth_encryption_key=SecretStr("integration-encryption-key"),
        demo_password=demo_password,
        access_token_ttl_seconds=900,
        refresh_token_ttl_days=30,
        invitation_ttl_hours=48,
        login_max_failures=2,
    )
    now = datetime.now(UTC).replace(microsecond=0)
    engine = create_async_engine(database_url, pool_pre_ping=True)
    await seed_demo_data(engine, demo_password)
    async with engine.connect() as connection:
        transaction = await connection.begin()
        try:
            with pytest.raises(AuthServiceError, match="empty database"):
                await bootstrap_initial_admin(
                    connection,
                    "initial.admin",
                    "Initial Admin",
                    "Secure-Bootstrap-2026!",
                    now=now,
                )
            with pytest.raises(AuthServiceError, match="Invalid username or password"):
                await login_with_password(
                    connection,
                    "baxtiyor",
                    "Wrong-Password-2026!",
                    None,
                    "Lock test",
                    settings,
                    now=now,
                )
            with pytest.raises(AuthServiceError, match="Invalid username or password"):
                await login_with_password(
                    connection,
                    "baxtiyor",
                    "Wrong-Password-2026!",
                    None,
                    "Lock test",
                    settings,
                    now=now,
                )
            with pytest.raises(AuthServiceError, match="temporarily locked"):
                await login_with_password(
                    connection,
                    "baxtiyor",
                    demo_password.get_secret_value(),
                    None,
                    "Lock test",
                    settings,
                    now=now,
                )

            malika = await find_active_user_by_username(connection, "malika")
            assert malika is not None
            manager_login = await login_with_password(
                connection,
                "malika",
                demo_password.get_secret_value(),
                None,
                "Integration desktop",
                settings,
                now=now,
            )
            manager = await authenticate_access_token(
                connection, manager_login.access_token, settings
            )
            assert manager.role == "admin"
            assert manager.session_id is not None

            invitation = await create_invitation(
                connection,
                manager,
                InvitationCreateRequest(
                    username="new.employee",
                    full_name="New Employee",
                    job_title="Specialist",
                    role="employee",
                ),
                settings,
                now=now,
            )
            invited_login = await accept_invitation(
                connection,
                invitation["invite_token"],
                "Secure-Invite-2026!",
                "Invited desktop",
                settings,
                now=now,
            )
            with pytest.raises(AuthServiceError, match="no longer active"):
                await accept_invitation(
                    connection,
                    invitation["invite_token"],
                    "Secure-Invite-2026!",
                    "Second attempt",
                    settings,
                    now=now,
                )

            invited_user = await authenticate_access_token(
                connection, invited_login.access_token, settings
            )
            setup = await begin_totp_setup(connection, invited_user, settings, now=now)
            code, _ = generate_totp(setup["secret"], at_time=int(now.timestamp()))
            await confirm_totp_setup(connection, invited_user, code, settings, now=now)

            totp_login = await login_with_password(
                connection,
                "new.employee",
                "Secure-Invite-2026!",
                code,
                "TOTP desktop",
                settings,
                now=now,
            )
            assert read_access_token(totp_login.access_token, settings.auth_signing_key).session_id
            with pytest.raises(AuthServiceError, match="already used"):
                await login_with_password(
                    connection,
                    "new.employee",
                    "Secure-Invite-2026!",
                    code,
                    "Replay attempt",
                    settings,
                    now=now,
                )
            disable_code, _ = generate_totp(setup["secret"], at_time=int(now.timestamp()) + 30)
            await disable_totp(
                connection,
                invited_user,
                "Secure-Invite-2026!",
                disable_code,
                settings,
                now=now + timedelta(seconds=30),
            )

            rotated = await refresh_session(
                connection, manager_login.refresh_token, settings, now=now
            )
            assert rotated.refresh_token != manager_login.refresh_token
            with pytest.raises(AuthServiceError, match="not active"):
                await refresh_session(connection, manager_login.refresh_token, settings, now=now)

            rotated_user = await authenticate_access_token(
                connection, rotated.access_token, settings
            )
            sessions = await list_user_sessions(connection, rotated_user, now=now)
            assert any(session["current"] is True for session in sessions)
            assert rotated_user.session_id is not None
            await revoke_session(connection, rotated_user, rotated_user.session_id, now=now)
            with pytest.raises(InvalidTokenError, match="no longer active"):
                await authenticate_access_token(connection, rotated.access_token, settings)
        finally:
            await transaction.rollback()
    await engine.dispose()


async def _exercise_initial_admin_bootstrap(database_url: str) -> None:
    settings = Settings(
        environment="test",
        database_url=database_url,
        auth_signing_key=SecretStr("bootstrap-signing-key"),
    )
    now = datetime.now(UTC).replace(microsecond=0)
    engine = create_async_engine(database_url, pool_pre_ping=True)
    async with engine.connect() as connection:
        transaction = await connection.begin()
        try:
            await connection.execute(text("TRUNCATE TABLE core_users CASCADE"))
            user_id = await bootstrap_initial_admin(
                connection,
                "First.Admin",
                "First Administrator",
                "Secure-First-Admin-2026!",
                now=now,
            )
            user = await find_active_user_by_username(connection, "first.admin")
            assert user is not None
            assert user["id"] == user_id
            assert user["role"] == "admin"
            authenticated = await login_with_password(
                connection,
                "first.admin",
                "Secure-First-Admin-2026!",
                None,
                "Bootstrap verification",
                settings,
                now=now,
            )
            assert authenticated.user["id"] == user_id
        finally:
            await transaction.rollback()
    await engine.dispose()


@pytest.mark.postgres
def test_production_authentication_vertical_slice() -> None:
    database_url = os.environ.get("YUKSALISH_TEST_DATABASE_URL")
    if not database_url:
        pytest.skip("YUKSALISH_TEST_DATABASE_URL is not configured")
    asyncio.run(_exercise_production_auth(database_url))


@pytest.mark.postgres
def test_initial_administrator_bootstrap_on_empty_database() -> None:
    database_url = os.environ.get("YUKSALISH_TEST_DATABASE_URL")
    if not database_url:
        pytest.skip("YUKSALISH_TEST_DATABASE_URL is not configured")
    asyncio.run(_exercise_initial_admin_bootstrap(database_url))
