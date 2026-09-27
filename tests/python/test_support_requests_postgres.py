import os
from datetime import UTC, datetime
from uuid import UUID, uuid4

import pytest
from httpx import ASGITransport, AsyncClient
from pydantic import SecretStr
from sqlalchemy import delete, insert, select

from yuksalish_api.auth_service import hash_password
from yuksalish_api.main import create_app
from yuksalish_api.settings import Settings
from yuksalish_api.tables import (
    support_request_messages,
    support_requests,
    users,
    workspace_notifications,
)


@pytest.mark.anyio
@pytest.mark.postgres
async def test_support_requests_notify_owners_and_return_admin_responses() -> None:
    database_url = os.environ.get("YUKSALISH_TEST_DATABASE_URL")
    if not database_url:
        pytest.skip("YUKSALISH_TEST_DATABASE_URL is not configured")
    password = "Yuksalish-Support-2026!"
    app = create_app(
        Settings(
            environment="test",
            database_url=database_url,
            auth_signing_key=SecretStr("support-test-signing-key"),
            auth_encryption_key=SecretStr("support-test-encryption-key"),
            demo_password=SecretStr(password),
            seed_demo_data=True,
        )
    )

    async with (
        app.router.lifespan_context(app),
        AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client,
    ):
        async def login(username: str) -> dict[str, str]:
            response = await client.post(
                "/api/v1/auth/login",
                json={
                    "username": username,
                    "password": password,
                    "deviceLabel": f"Support test {uuid4().hex[:6]}",
                },
            )
            assert response.status_code == 200
            return {"Authorization": f"Bearer {response.json()['accessToken']}"}

        employee, admin, manager = (
            await login("dilshod"),
            await login("malika"),
            await login("aziza"),
        )
        named_owner_id = uuid4()
        async with app.state.database_engine.begin() as connection:
            await connection.execute(delete(support_request_messages))
            await connection.execute(delete(support_requests))
            await connection.execute(
                delete(workspace_notifications).where(workspace_notifications.c.kind == "support")
            )
            await connection.execute(delete(users).where(users.c.username == "temuralmazov"))
            await connection.execute(
                insert(users).values(
                    id=named_owner_id,
                    username="temuralmazov",
                    full_name="Темур Алмазов",
                    password_hash=hash_password(password),
                    role="employee",
                    status="active",
                    created_at=datetime.now(UTC),
                    updated_at=datetime.now(UTC),
                    failed_login_count=0,
                )
            )
        owner = await login("temuralmazov")

        created = await client.post(
            "/api/v1/support-requests",
            headers=employee,
            json={
                "category": "bug",
                "subject": "Calendar does not open",
                "body": "The calendar stays empty after activation.",
            },
        )
        assert created.status_code == 201
        request_id = created.json()["id"]

        own = (await client.get("/api/v1/support-requests", headers=employee)).json()
        assert own["mode"] == "support"
        assert [item["id"] for item in own["requests"]] == [request_id]

        inbox = (await client.get("/api/v1/support-requests", headers=admin)).json()
        assert inbox["mode"] == "inbox"
        assert inbox["requests"][0]["authorUsername"] == "dilshod"
        owner_inbox = (await client.get("/api/v1/support-requests", headers=owner)).json()
        assert owner_inbox["mode"] == "inbox"
        assert owner_inbox["requests"][0]["id"] == request_id

        admin_workspace = await client.get("/api/v1/workspace/bootstrap", headers=admin)
        assert any(
            item["kind"] == "support" and item["entityId"] == request_id
            for item in admin_workspace.json()["notifications"]
        )

        async with app.state.database_engine.connect() as connection:
            named_notification = await connection.scalar(
                select(workspace_notifications.c.id).where(
                    workspace_notifications.c.user_id == named_owner_id,
                    workspace_notifications.c.kind == "support",
                    workspace_notifications.c.entity_id == UUID(request_id),
                )
            )
        assert named_notification is not None

        forbidden = await client.post(
            f"/api/v1/support-requests/{request_id}/actions",
            headers=manager,
            json={"action": "comment", "body": "Попытка ответа без роли"},
        )
        assert forbidden.status_code == 403

        response = await client.post(
            f"/api/v1/support-requests/{request_id}/actions",
            headers=owner,
            json={"action": "comment", "body": "Уточните версию приложения."},
        )
        assert response.status_code == 200
        assert response.json()["messages"][-1]["kind"] == "comment"
        admin_after_response = (
            await client.get("/api/v1/support-requests", headers=admin)
        ).json()
        assert admin_after_response["indicator"] is None
        assert admin_after_response["unreadResponseCount"] == 0

        answered = (await client.get("/api/v1/support-requests", headers=employee)).json()
        assert answered["indicator"] == "positive"
        assert answered["unreadResponseCount"] == 1
        employee_workspace = await client.get("/api/v1/workspace/bootstrap", headers=employee)
        assert any(
            item["kind"] == "support" and item["entityId"] == request_id
            for item in employee_workspace.json()["notifications"]
        )

        marked = await client.post("/api/v1/support-requests/responses/read", headers=employee)
        assert marked.status_code == 204
        after_read = (await client.get("/api/v1/support-requests", headers=employee)).json()
        assert after_read["indicator"] is None
        assert after_read["unreadResponseCount"] == 0

        rejected = await client.post(
            f"/api/v1/support-requests/{request_id}/actions",
            headers=admin,
            json={"action": "reject", "rejectionReason": "already_implemented"},
        )
        assert rejected.status_code == 200
        assert rejected.json()["status"] == "rejected"
        final = (await client.get("/api/v1/support-requests", headers=employee)).json()
        assert final["indicator"] == "negative"
        assert final["requests"][0]["resolutionCode"] == "already_implemented"
