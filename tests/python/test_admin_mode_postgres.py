import os
from typing import Any
from uuid import UUID

import pytest
from httpx import ASGITransport, AsyncClient
from pydantic import SecretStr
from sqlalchemy import select

from yuksalish_api.main import create_app
from yuksalish_api.settings import Settings
from yuksalish_api.tables import audit_events, users


@pytest.mark.anyio
@pytest.mark.postgres
async def test_admin_can_suspend_and_restore_own_rights_across_refresh() -> None:
    url = os.environ.get("YUKSALISH_TEST_DATABASE_URL")
    if not url:
        pytest.skip("YUKSALISH_TEST_DATABASE_URL is not configured")
    password = "Yuksalish-Local-2026!"
    app = create_app(Settings(environment="test", database_url=url, seed_demo_data=True,
                              demo_password=SecretStr(password)))
    async with app.router.lifespan_context(app), AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test",
    ) as client:
        async def login(username: str) -> dict[str, Any]:
            response = await client.post("/api/v1/auth/login", json={
                "username": username, "password": password,
            })
            assert response.status_code == 200, response.text
            return response.json()

        session = await login("malika")
        other = await login("malika")
        employee = await login("dilshod")
        headers = {"Authorization": f"Bearer {session['accessToken']}"}
        other_headers = {"Authorization": f"Bearer {other['accessToken']}"}
        employee_headers = {"Authorization": f"Bearer {employee['accessToken']}"}
        full = await client.get("/api/v1/workspace/bootstrap", headers=headers)
        assert full.status_code == 200, full.text
        assert full.json()["currentUser"]["adminModeEnabled"] is True
        assert full.json()["tasks"]
        denied = await client.put("/api/v1/auth/admin-mode", headers=employee_headers,
                                  json={"enabled": True})
        assert denied.status_code == 403
        disabled = await client.put("/api/v1/auth/admin-mode", headers=headers,
                                    json={"enabled": False})
        assert disabled.status_code == 200, disabled.text
        assert disabled.json()["role"] == "employee"
        assert disabled.json()["adminModeEnabled"] is False
        assert disabled.json()["positionId"] == full.json()["currentUser"]["positionId"]
        assert (await client.get("/api/v1/auth/me", headers=headers)).json()["role"] == "employee"
        other_me = await client.get("/api/v1/auth/me", headers=other_headers)
        assert other_me.json()["role"] == "admin"
        normal = await client.get("/api/v1/workspace/bootstrap", headers=headers)
        assert normal.status_code == 200, normal.text
        assert normal.json()["currentUser"]["adminModeEnabled"] is False
        assert next(person for person in normal.json()["people"]
                    if person["id"] == session["user"]["id"])["role"] == "employee"
        # The seeded administrator is also the chairman. Disabling the admin
        # role preserves the chairman's read access without keeping admin actions.
        assert {task["id"] for task in normal.json()["tasks"]} == {
            task["id"] for task in full.json()["tasks"]
        }
        visible_ids = {task["id"] for task in normal.json()["tasks"]}
        assert all(item["entityId"] in visible_ids for item in normal.json()["notifications"]
                   if item["section"] == "tasks" and item["entityId"] is not None
                   )
        # Direct protected requests are denied as well as hiding admin UI.
        invitation = await client.post("/api/v1/auth/invitations", headers=headers, json={
            "username": "admin.mode.denied", "fullName": "Denied Employee", "role": "employee",
        })
        assert invitation.status_code == 403
        refresh = await client.post("/api/v1/auth/refresh", json={
            "refreshToken": session["refreshToken"],
        })
        assert refresh.status_code == 200, refresh.text
        assert refresh.json()["user"]["role"] == "employee"
        assert refresh.json()["user"]["adminModeEnabled"] is False
        renewed_headers = {"Authorization": f"Bearer {refresh.json()['accessToken']}"}
        restored = await client.put("/api/v1/auth/admin-mode", headers=renewed_headers,
                                    json={"enabled": True})
        assert restored.status_code == 200, restored.text
        assert restored.json()["role"] == "admin"
        restored_data = await client.get("/api/v1/workspace/bootstrap", headers=renewed_headers)
        assert {task["id"] for task in restored_data.json()["tasks"]} == {
            task["id"] for task in full.json()["tasks"]
        }
        visible_notification_ids = {item["id"] for item in normal.json()["notifications"]}
        restored_notifications = {
            item["id"]: item for item in restored_data.json()["notifications"]
        }
        for item in full.json()["notifications"]:
            if item["id"] not in visible_notification_ids and item["id"] in restored_notifications:
                assert restored_notifications[item["id"]]["resolvedAt"] == item["resolvedAt"]
        async with app.state.database_engine.connect() as connection:
            assert await connection.scalar(select(users.c.role).where(
                users.c.id == UUID(session["user"]["id"]),
            )) == "admin"
            actions = (await connection.execute(select(audit_events.c.details).where(
                audit_events.c.actor_user_id == UUID(session["user"]["id"]),
                audit_events.c.action == "auth.admin_mode_changed",
            ).order_by(audit_events.c.created_at))).scalars().all()
            assert [item["enabled"] for item in actions][-2:] == [False, True]


@pytest.mark.anyio
@pytest.mark.postgres
async def test_web_admin_mode_requires_csrf_and_trusted_origin() -> None:
    url = os.environ.get("YUKSALISH_TEST_DATABASE_URL")
    if not url:
        pytest.skip("YUKSALISH_TEST_DATABASE_URL is not configured")
    origin = "https://workspace.test"
    password = "Yuksalish-Local-2026!"
    app = create_app(Settings(environment="test", database_url=url, seed_demo_data=True,
                              demo_password=SecretStr(password), cors_origins=[origin]))
    async with app.router.lifespan_context(app), AsyncClient(
        transport=ASGITransport(app=app), base_url=origin,
    ) as client:
        login = await client.post("/api/v1/auth/web/login", headers={"Origin": origin}, json={
            "username": "malika", "password": password,
        })
        assert login.status_code == 200, login.text
        credentials = {"Authorization": f"Bearer {login.json()['accessToken']}"}
        missing = await client.put("/api/v1/auth/admin-mode", headers={
            **credentials, "Origin": origin,
        }, json={"enabled": False})
        assert missing.status_code == 403
        csrf = login.json()["csrfToken"]
        wrong_origin = await client.put("/api/v1/auth/admin-mode", headers={
            **credentials, "Origin": "https://untrusted.test", "X-CSRF-Token": csrf,
        }, json={"enabled": False})
        assert wrong_origin.status_code == 403
        valid = {**credentials, "Origin": origin, "X-CSRF-Token": csrf}
        disabled = await client.put("/api/v1/auth/admin-mode", headers=valid,
                                    json={"enabled": False})
        assert disabled.status_code == 200, disabled.text
        assert disabled.json()["adminModeEnabled"] is False
        restored = await client.put("/api/v1/auth/admin-mode", headers=valid,
                                    json={"enabled": True})
        assert restored.status_code == 200, restored.text
        assert restored.json()["role"] == "admin"
