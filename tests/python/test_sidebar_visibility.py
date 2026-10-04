import asyncio
import os
from datetime import UTC, datetime
from uuid import UUID, uuid4

import pytest
from httpx import ASGITransport, AsyncClient
from pydantic import SecretStr, ValidationError
from sqlalchemy import delete, select
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import create_async_engine

from yuksalish_api.main import create_app
from yuksalish_api.settings import Settings
from yuksalish_api.tables import audit_events, sidebar_visibility
from yuksalish_api.workspace_schemas import DEFAULT_NAVIGATION, SidebarVisibilityUpdate


def test_visibility_payload_rejects_duplicates_unknown_keys_and_privilege_injection() -> None:
    for payload in (
        {"hiddenKeys": ["tasks", "tasks"], "revision": 0},
        {"hiddenKeys": ["unknown"], "revision": 0},
        {"hiddenKeys": ["settings"], "revision": 0},
        {"hiddenKeys": [], "revision": -1},
        {"hiddenKeys": [], "revision": 0, "userId": str(uuid4())},
    ):
        with pytest.raises(ValidationError):
            SidebarVisibilityUpdate.model_validate(payload)


async def exercise_sidebar(url: str) -> None:
    assert (make_url(url).database or "").startswith("yuksalish_test")
    app = create_app(Settings(
        environment="test", database_url=url, seed_demo_data=True,
        demo_password=SecretStr("Yuksalish-Local-2026!"),
        auth_signing_key=SecretStr("sidebar-visibility-test-signing-key"),
    ))
    async with app.router.lifespan_context(app), AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test",
    ) as client:
        async def login(username: str) -> dict[str, str]:
            response = await client.post("/api/v1/auth/login", json={
                "username": username, "password": "Yuksalish-Local-2026!", "deviceLabel": "test",
            })
            assert response.status_code == 200, response.text
            return {"Authorization": f"Bearer {response.json()['accessToken']}"}

        admin = await login("malika")
        employee, manager = await login("aziza"), await login("baxtiyor")
        bootstrap = (await client.get("/api/v1/workspace/bootstrap", headers=employee)).json()
        employee_id = bootstrap["currentUser"]["id"]
        peer_id = next(person["id"] for person in bootstrap["people"]
                       if person["username"] == "baxtiyor")
        engine = create_async_engine(url)
        async with engine.begin() as connection:
            await connection.execute(delete(sidebar_visibility).where(
                sidebar_visibility.c.user_id.in_([UUID(employee_id), UUID(peer_id)]),
            ))
        started_at = datetime.now(UTC)
        base = f"/api/v1/directory/employees/{employee_id}/sidebar"
        assert (await client.get(base)).status_code == 401
        for unauthorized in (employee, manager):
            assert (await client.get(base, headers=unauthorized)).status_code == 403
            assert (await client.put(base, headers=unauthorized, json={
                "hiddenKeys": ["tasks"], "revision": 0,
            })).status_code == 403
        assert (await client.get(f"/api/v1/directory/employees/{uuid4()}/sidebar",
                                 headers=admin)).status_code == 404
        initial = (await client.get(base, headers=admin)).json()
        assert initial["hiddenKeys"] == [] and initial["revision"] == 0
        saved = await client.put(base, headers=admin, json={
            "hiddenKeys": ["payment_requests", "feed"], "revision": 0,
        })
        assert saved.status_code == 200, saved.text
        assert saved.json()["revision"] == 1
        assert (await client.get(base, headers=admin)).json()["hiddenKeys"] == [
            "payment_requests", "feed",
        ]
        preferences = (await client.get("/api/v1/personal-preferences", headers=employee)).json()
        assert preferences["hiddenNavigationKeys"] == ["payment_requests", "feed"]
        assert (await client.get("/api/v1/workspace/bootstrap", headers=employee)).json()[
            "personalPreferences"
        ]["hiddenNavigationKeys"] == ["payment_requests", "feed"]
        assert (await client.get(f"/api/v1/directory/employees/{peer_id}/sidebar",
                                 headers=admin)).json()["hiddenKeys"] == []
        # Existing personal mutations and older clients cannot overwrite admin presentation.
        reordered = await client.put("/api/v1/personal-preferences/navigation", headers=employee,
                                     json={"order": list(reversed(DEFAULT_NAVIGATION)),
                                           "revision": preferences["revision"]})
        assert reordered.status_code == 200, reordered.text
        assert reordered.json()["hiddenNavigationKeys"] == ["payment_requests", "feed"]
        forged = await client.put("/api/v1/personal-preferences/navigation", headers=employee,
                                  json={"order": DEFAULT_NAVIGATION, "revision": 1,
                                        "hiddenNavigationKeys": []})
        assert forged.status_code == 422
        assert (await client.put(base, headers=admin, json={
            "hiddenKeys": [], "revision": 0,
        })).status_code == 409
        for keys in (["settings"], ["tasks", "tasks"], ["unknown"]):
            assert (await client.put(base, headers=admin, json={
                "hiddenKeys": keys, "revision": 1,
            })).status_code == 422
        # Hiding does not revoke domain rights or access to direct object links.
        refreshed = (await client.get("/api/v1/workspace/bootstrap", headers=employee)).json()
        assert refreshed["moduleAccess"] == bootstrap["moduleAccess"]
        concurrent = await asyncio.gather(*(
            client.put(base, headers=admin, json={"hiddenKeys": keys, "revision": 1})
            for keys in (["tasks"], ["calendar"])
        ))
        assert sorted(result.status_code for result in concurrent) == [200, 409]
        restored = await client.put(base, headers=admin, json={"hiddenKeys": [], "revision": 2})
        assert restored.status_code == 200
        assert (await client.get("/api/v1/personal-preferences", headers=employee)).json()[
            "hiddenNavigationKeys"
        ] == []
        async with engine.connect() as connection:
            audits = (await connection.execute(select(audit_events.c.details).where(
                audit_events.c.action == "employee.sidebar_updated",
                audit_events.c.target_id == UUID(employee_id),
                audit_events.c.created_at >= started_at,
            ))).scalars().all()
            assert len(audits) == 3
            assert any(row == {"before": [], "after": ["payment_requests", "feed"]}
                       for row in audits)
        await engine.dispose()


def test_sidebar_visibility_postgres_integration() -> None:
    url = os.environ.get("YUKSALISH_TEST_DATABASE_URL")
    if not url:
        pytest.skip("YUKSALISH_TEST_DATABASE_URL is not configured")
    asyncio.run(exercise_sidebar(url))
