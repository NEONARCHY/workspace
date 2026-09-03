import os
from uuid import uuid4

import pytest
from httpx import ASGITransport, AsyncClient
from pydantic import SecretStr
from sqlalchemy import delete

from yuksalish_api.auth_service import generate_totp
from yuksalish_api.main import create_app
from yuksalish_api.settings import Settings
from yuksalish_api.tables import users


@pytest.mark.anyio
@pytest.mark.postgres
async def test_authentication_http_vertical_slice() -> None:
    database_url = os.environ.get("YUKSALISH_TEST_DATABASE_URL")
    if not database_url:
        pytest.skip("YUKSALISH_TEST_DATABASE_URL is not configured")
    demo_password = "Yuksalish-Local-2026!"
    settings = Settings(
        environment="test",
        database_url=database_url,
        auth_signing_key=SecretStr("http-integration-signing-key"),
        auth_encryption_key=SecretStr("http-integration-encryption-key"),
        demo_password=SecretStr(demo_password),
        seed_demo_data=True,
    )
    app = create_app(settings)
    transport = ASGITransport(app=app)
    username = f"api.employee.{uuid4().hex[:8]}"

    async with (
        app.router.lifespan_context(app),
        AsyncClient(transport=transport, base_url="http://test") as client,
    ):
        missing = await client.get("/api/v1/auth/me")
        assert missing.status_code == 401

        login = await client.post(
            "/api/v1/auth/login",
            json={
                "username": "malika",
                "password": demo_password,
                "deviceLabel": "HTTP admin",
            },
        )
        assert login.status_code == 200
        admin_session = login.json()
        admin_headers = {"Authorization": f"Bearer {admin_session['accessToken']}"}

        me = await client.get("/api/v1/auth/me", headers=admin_headers)
        assert me.status_code == 200
        assert me.json()["role"] == "admin"

        invitation = await client.post(
            "/api/v1/auth/invitations",
            headers=admin_headers,
            json={
                "username": username,
                "fullName": "API Employee",
                "jobTitle": "Tester",
                "role": "employee",
            },
        )
        assert invitation.status_code == 201

        activated = await client.post(
            "/api/v1/auth/invitations/accept",
            json={
                "inviteToken": invitation.json()["inviteToken"],
                "password": "Secure-API-Employee-2026!",
                "deviceLabel": "HTTP employee",
            },
        )
        assert activated.status_code == 200
        employee_session = activated.json()
        employee_headers = {"Authorization": f"Bearer {employee_session['accessToken']}"}

        forbidden = await client.post(
            "/api/v1/auth/invitations",
            headers=employee_headers,
            json={
                "username": f"denied.{uuid4().hex[:8]}",
                "fullName": "Denied User",
                "role": "employee",
            },
        )
        assert forbidden.status_code == 403

        status = await client.get("/api/v1/auth/totp", headers=employee_headers)
        assert status.json() == {"enabled": False}
        setup = await client.post("/api/v1/auth/totp/setup", headers=employee_headers)
        assert setup.status_code == 200
        code, _ = generate_totp(setup.json()["secret"])
        confirmed = await client.post(
            "/api/v1/auth/totp/confirm",
            headers=employee_headers,
            json={"code": code},
        )
        assert confirmed.json() == {"enabled": True}

        reset = await client.post(
            "/api/v1/auth/password-resets",
            headers=admin_headers,
            json={"username": username, "resetTotp": True},
        )
        assert reset.status_code == 201
        assert reset.json()["resetTotp"] is True
        recovered = await client.post(
            "/api/v1/auth/password-resets/complete",
            json={
                "resetToken": reset.json()["resetToken"],
                "password": "Recovered-API-Employee-2026!",
                "deviceLabel": "Recovered HTTP employee",
            },
        )
        assert recovered.status_code == 200
        revoked_by_reset = await client.get("/api/v1/auth/me", headers=employee_headers)
        assert revoked_by_reset.status_code == 401
        employee_session = recovered.json()
        employee_headers = {"Authorization": f"Bearer {employee_session['accessToken']}"}
        reset_totp_status = await client.get("/api/v1/auth/totp", headers=employee_headers)
        assert reset_totp_status.json() == {"enabled": False}

        sessions = await client.get("/api/v1/auth/sessions", headers=employee_headers)
        assert sessions.status_code == 200
        assert sessions.json()[0]["current"] is True

        refreshed = await client.post(
            "/api/v1/auth/refresh",
            json={"refreshToken": employee_session["refreshToken"]},
        )
        assert refreshed.status_code == 200
        refreshed_headers = {"Authorization": f"Bearer {refreshed.json()['accessToken']}"}
        logout = await client.post("/api/v1/auth/logout", headers=refreshed_headers)
        assert logout.status_code == 204
        revoked = await client.get("/api/v1/auth/me", headers=refreshed_headers)
        assert revoked.status_code == 401

        async with app.state.database_engine.begin() as connection:
            await connection.execute(delete(users).where(users.c.username == username))
