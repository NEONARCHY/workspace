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

        workspace = await client.get("/api/v1/workspace/bootstrap", headers=admin_headers)
        chat_id = workspace.json()["chats"][0]["id"]
        message = await client.post(
            f"/api/v1/chats/{chat_id}/messages",
            headers=admin_headers,
            json={"body": "HTTP cross-workflow source message"},
        )
        assert message.status_code == 201
        message_id = message.json()["id"]
        uploaded = await client.put(
            f"/api/v1/attachments/message/{message_id}",
            headers={**admin_headers, "Content-Type": "text/plain"},
            params={"fileName": "invoice.txt"},
            content=b"invoice-body",
        )
        assert uploaded.status_code == 201
        assert uploaded.json()["sha256"]
        downloaded = await client.get(
            f"/api/v1/attachments/{uploaded.json()['id']}",
            headers=admin_headers,
        )
        assert downloaded.status_code == 200
        assert downloaded.content == b"invoice-body"

        task = await client.post(
            "/api/v1/tasks",
            headers=admin_headers,
            json={
                "title": "HTTP task from message",
                "assigneeId": admin_session["user"]["id"],
                "sourceMessageId": message_id,
            },
        )
        assert task.status_code == 201
        assert task.json()["sourceMessageId"] == message_id
        approval = await client.post(
            "/api/v1/approval-requests",
            headers=admin_headers,
            json={
                "title": "HTTP approval from task",
                "amount": 5_000_000,
                "currency": "UZS",
                "purpose": "Initial purpose",
                "sourceTaskId": task.json()["id"],
            },
        )
        assert approval.status_code == 201
        approval_id = approval.json()["id"]
        assert approval.json()["revision"] == 1
        returned = await client.post(
            f"/api/v1/approval-requests/{approval_id}/actions",
            headers=admin_headers,
            json={"action": "return", "comment": "Correct the amount"},
        )
        assert returned.status_code == 200
        assert returned.json()["status"] == "needs_revision"
        assert returned.json()["actions"][-1]["action"] == "return"
        assert returned.json()["actions"][-1]["comment"] == "Correct the amount"
        revised = await client.patch(
            f"/api/v1/approval-requests/{approval_id}",
            headers=admin_headers,
            json={
                "title": "HTTP corrected approval",
                "amount": 4_800_000,
                "currency": "UZS",
                "purpose": "Corrected purpose",
                "changeComment": "Corrected after review",
            },
        )
        assert revised.status_code == 200
        assert revised.json()["revision"] == 2
        assert len(revised.json()["versions"]) == 2
        resubmitted = await client.post(
            f"/api/v1/approval-requests/{approval_id}/actions",
            headers=admin_headers,
            json={"action": "resubmit", "comment": "Ready again"},
        )
        assert resubmitted.status_code == 200
        assert resubmitted.json()["status"] == "running"

        directory = await client.get("/api/v1/directory", headers=admin_headers)
        assert directory.status_code == 200
        assert len(directory.json()["positions"]) >= 24
        position_name = f"API Position {uuid4().hex[:8]}"
        position = await client.post(
            "/api/v1/directory/positions",
            headers=admin_headers,
            json={"name": position_name, "sortOrder": 50_000},
        )
        assert position.status_code == 201
        position_id = position.json()["id"]

        invitation = await client.post(
            "/api/v1/auth/invitations",
            headers=admin_headers,
            json={
                "username": username,
                "fullName": "API Employee",
                "positionId": position_id,
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
        assert employee_session["user"]["jobTitle"] == position_name
        employee_headers = {"Authorization": f"Bearer {employee_session['accessToken']}"}

        denied_position = await client.post(
            "/api/v1/directory/positions",
            headers=employee_headers,
            json={"name": "Denied Position"},
        )
        assert denied_position.status_code == 403

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

        directory = await client.get("/api/v1/directory", headers=admin_headers)
        employee = next(
            item for item in directory.json()["employees"] if item["username"] == username
        )
        changed = await client.patch(
            f"/api/v1/directory/employees/{employee['id']}",
            headers=admin_headers,
            json={"role": "manager", "positionId": position_id},
        )
        assert changed.status_code == 200
        assert changed.json()["role"] == "manager"
        deactivated = await client.patch(
            f"/api/v1/directory/positions/{position_id}",
            headers=admin_headers,
            json={"isActive": False},
        )
        assert deactivated.status_code == 200
        assert deactivated.json()["isActive"] is False

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
