import os
from datetime import UTC, datetime

import pytest
from pydantic import SecretStr
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import create_async_engine

from yuksalish_api.auth import InvalidTokenError, authenticate_access_token, load_authenticated_user
from yuksalish_api.auth_schemas import PasswordResetCreateRequest
from yuksalish_api.auth_service import (
    AuthServiceError,
    change_account_password,
    create_password_reset,
    login_with_password,
    verify_password,
)
from yuksalish_api.repository import find_active_user_by_username
from yuksalish_api.seed import seed_demo_data
from yuksalish_api.settings import Settings
from yuksalish_api.tables import audit_events, auth_sessions, users


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"


@pytest.mark.anyio
@pytest.mark.postgres
async def test_password_change_permissions_and_session_revocation() -> None:
    database_url = os.environ.get("YUKSALISH_TEST_DATABASE_URL")
    if not database_url:
        pytest.skip("YUKSALISH_TEST_DATABASE_URL is not configured")
    demo_password = SecretStr("Disposable-Test-Password-2026!")
    settings = Settings(
        environment="test",
        database_url=database_url,
        auth_signing_key=SecretStr("disposable-password-test-signing-key"),
        demo_password=demo_password,
    )
    engine = create_async_engine(database_url)
    try:
        await seed_demo_data(engine, demo_password)
        async with engine.connect() as connection:
            transaction = await connection.begin()
            try:
                records = {}
                for username in ("malika", "baxtiyor", "aziza", "dilshod"):
                    record = await find_active_user_by_username(connection, username)
                    assert record is not None
                    records[username] = record
                await connection.execute(
                    update(users)
                    .where(users.c.id == records["aziza"]["id"])
                    .values(role="superadmin")
                )
                await connection.execute(
                    update(users)
                    .where(users.c.id == records["baxtiyor"]["id"])
                    .values(role="admin")
                )
                admin = await load_authenticated_user(connection, records["malika"]["id"])
                superadmin = await load_authenticated_user(connection, records["aziza"]["id"])
                employee = await load_authenticated_user(connection, records["dilshod"]["id"])
                assert admin is not None and superadmin is not None and employee is not None

                for target in ("baxtiyor", "aziza"):
                    with pytest.raises(AuthServiceError) as denied:
                        await change_account_password(
                            connection, admin, records[target]["id"], "Secure-New-Password-2026!"
                        )
                    assert denied.value.status_code == 403
                with pytest.raises(AuthServiceError) as denied:
                    await change_account_password(
                        connection, employee, records["malika"]["id"],
                        "Secure-New-Password-2026!",
                    )
                assert denied.value.status_code == 403
                with pytest.raises(AuthServiceError) as denied:
                    await create_password_reset(
                        connection,
                        admin,
                        PasswordResetCreateRequest(username="aziza"),
                        settings,
                    )
                assert denied.value.status_code == 403

                login = await login_with_password(
                    connection, "dilshod", demo_password.get_secret_value(), None,
                    "Password test", settings,
                )
                assert login.access_token
                changed_at = datetime.now(UTC)
                await change_account_password(
                    connection, admin, employee.id, "Secure-New-Password-2026!", now=changed_at
                )
                stored_hash = (
                    await connection.execute(
                        select(users.c.password_hash).where(users.c.id == employee.id)
                    )
                ).scalar_one()
                assert verify_password(stored_hash, "Secure-New-Password-2026!")
                assert (
                    await connection.execute(
                        select(auth_sessions.c.revoked_at).where(
                            auth_sessions.c.user_id == employee.id
                        )
                    )
                ).scalar_one() == changed_at
                with pytest.raises(InvalidTokenError):
                    await authenticate_access_token(connection, login.access_token, settings)
                audit = (
                    await connection.execute(
                        select(audit_events.c.details).where(
                            audit_events.c.action == "auth.password_changed",
                            audit_events.c.target_id == employee.id,
                        )
                    )
                ).scalar_one()
                assert audit == {"self_service": False}

                await change_account_password(
                    connection, employee, employee.id, "Secure-Self-Password-2026!"
                )
                await change_account_password(
                    connection, superadmin, admin.id, "Secure-Admin-Password-2026!"
                )
            finally:
                await transaction.rollback()
    finally:
        await engine.dispose()
