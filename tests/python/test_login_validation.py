from collections.abc import AsyncIterator
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from pydantic import ValidationError

from yuksalish_api import auth_service
from yuksalish_api.auth_schemas import (
    DirectPasswordChangeRequest,
    InvitationAcceptRequest,
    LoginRequest,
    PasswordResetCompleteRequest,
)
from yuksalish_api.database import get_connection
from yuksalish_api.routers import authentication
from yuksalish_api.settings import Settings


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"


@pytest.mark.anyio
@pytest.mark.parametrize("path", ["/auth/login", "/auth/web/login"])
@pytest.mark.parametrize("password", ["x", "Short-123!", "Long-Password-2026!", "x" * 128])
async def test_login_checks_existing_password_instead_of_new_password_policy(
    monkeypatch: pytest.MonkeyPatch, path: str, password: str
) -> None:
    user = {
        "id": uuid4(),
        "username": "legacy.employee",
        "full_name": "Legacy Employee",
        "role": "employee",
        "job_title": None,
        "status": "active",
        "password_hash": auth_service.hash_password(password),
        "locked_until": None,
        "failed_login_count": 0,
    }
    user_result = MagicMock()
    user_result.mappings.return_value.first.return_value = user
    factor_result = MagicMock()
    factor_result.mappings.return_value.first.return_value = None
    connection = AsyncMock()
    connection.execute.side_effect = [user_result, factor_result, None, user_result, None]
    session = auth_service.AuthResult(
        access_token="test-access-token",
        refresh_token="test-refresh-token",
        expires_in=900,
        user=user,
        csrf_token="test-csrf-token",
    )
    create_session = AsyncMock(return_value=session)
    monkeypatch.setattr(auth_service, "_create_session", create_session)

    async def connection_override() -> AsyncIterator[AsyncMock]:
        yield connection

    origin = "https://workspace.test"
    app = FastAPI()
    app.state.settings = Settings(environment="test", cors_origins=[origin])
    app.include_router(authentication.router)
    app.dependency_overrides[get_connection] = connection_override
    async with AsyncClient(transport=ASGITransport(app=app), base_url=origin) as client:
        response = await client.post(
            path, headers={"Origin": origin},
            json={"username": "legacy.employee", "password": password},
        )
        assert response.status_code == 200
        assert response.json()["user"]["username"] == "legacy.employee"
        create_session.assert_awaited_once()
        connection.commit.assert_awaited_once()
        if path == "/auth/web/login":
            assert "refreshToken" not in response.json()
            assert "HttpOnly" in response.headers["set-cookie"]
        else:
            assert response.json()["refreshToken"] == session.refresh_token

        # A short incorrect password must reach authentication and return 401, not 422.
        rejected = await client.post(
            path, headers={"Origin": origin},
            json={"username": "legacy.employee", "password": "wrong"},
        )
        assert rejected.status_code == 401
        assert rejected.json()["detail"] == "Invalid username or password"
        create_session.assert_awaited_once()


@pytest.mark.parametrize("password", ["", "x" * 129])
def test_login_keeps_password_input_bounds(password: str) -> None:
    with pytest.raises(ValidationError):
        LoginRequest(username="employee", password=password)


@pytest.mark.parametrize("password", ["x", "Short-123!", "x" * 129])
def test_setting_a_new_password_keeps_existing_policy(password: str) -> None:
    with pytest.raises(ValidationError):
        InvitationAcceptRequest(invite_token="i" * 32, password=password)
    with pytest.raises(ValidationError):
        PasswordResetCompleteRequest(reset_token="r" * 32, password=password)
    with pytest.raises(ValidationError):
        DirectPasswordChangeRequest(password=password)
