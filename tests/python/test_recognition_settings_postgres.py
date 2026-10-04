import os
from datetime import UTC, datetime
from uuid import NAMESPACE_URL, uuid4, uuid5

import pytest
from httpx import ASGITransport, AsyncClient
from pydantic import SecretStr
from sqlalchemy import delete, insert, select
from sqlalchemy.engine import make_url

from yuksalish_api.auth import issue_access_token
from yuksalish_api.main import create_app
from yuksalish_api.settings import Settings
from yuksalish_api.tables import audit_events, recognition_settings, users


@pytest.mark.anyio
@pytest.mark.postgres
async def test_settings_round_trip_audit_permissions_and_profile_visibility() -> None:
    database_url = os.environ.get("YUKSALISH_TEST_DATABASE_URL")
    if not database_url:
        pytest.skip("YUKSALISH_TEST_DATABASE_URL is not configured")
    # This global-setting test must never run against the LAN application's database.
    assert (make_url(database_url).database or "").startswith(
        ("yuksalish_test", "yuksalish_recognition_qa_")
    )
    signing_key = SecretStr("recognition-settings-test-signing-key")
    app = create_app(Settings(
        environment="test", database_url=database_url, seed_demo_data=False,
        auth_signing_key=signing_key, auth_encryption_key=SecretStr("settings-test-encryption-key"),
    ))
    admin_id, employee_id = uuid4(), uuid4()
    async with (
        app.router.lifespan_context(app),
        AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client,
    ):
        async with app.state.database_engine.begin() as connection:
            original_settings = [dict(row) for row in (
                await connection.execute(select(recognition_settings).where(
                    recognition_settings.c.id == 1
                ))
            ).mappings()]
            now = datetime.now(UTC)
            await connection.execute(insert(users), [
                {"id": user_id, "username": f"settings-{user_id.hex[:12]}",
                 "full_name": "Settings test", "role": role, "status": "active",
                 "created_at": now, "updated_at": now}
                for user_id, role in [(admin_id, "admin"), (employee_id, "employee")]
            ])
        admin_headers = {"Authorization": f"Bearer {issue_access_token(admin_id, signing_key)}"}
        employee_headers = {
            "Authorization": f"Bearer {issue_access_token(employee_id, signing_key)}"
        }
        try:
            for visible in [False, True, False]:
                saved = await client.patch("/api/v1/recognition/settings", headers=admin_headers,
                                           json={"activeTaskCountVisible": visible})
                assert saved.status_code == 200
                assert saved.json()["activeTaskCountVisible"] is visible
                loaded = await client.get("/api/v1/recognition/settings", headers=admin_headers)
                assert loaded.status_code == 200
                assert loaded.json()["activeTaskCountVisible"] is visible
                assert loaded.json()["updatedAt"] == saved.json()["updatedAt"]
                profile = await client.get(
                    f"/api/v1/recognition/profiles/{employee_id}", headers=employee_headers
                )
                assert profile.status_code == 200
                assert profile.json()["activeTaskCountVisible"] is visible
                assert profile.json()["activeTaskCount"] == (0 if visible else None)
            denied = await client.patch("/api/v1/recognition/settings", headers=employee_headers,
                                        json={"activeTaskCountVisible": True})
            assert denied.status_code == 403
            async with app.state.database_engine.connect() as connection:
                records = (await connection.execute(select(audit_events).where(
                    audit_events.c.actor_user_id == admin_id,
                    audit_events.c.action == "recognition.settings.updated",
                ))).mappings().all()
                assert len(records) == 3
                assert {record["target_id"] for record in records} == {
                    uuid5(NAMESPACE_URL, "urn:workspace:recognition:settings:1")
                }
                value = (await connection.execute(select(
                    recognition_settings.c.active_task_count_visible
                ))).scalar_one()
                assert value is False
        finally:
            async with app.state.database_engine.begin() as connection:
                await connection.execute(delete(recognition_settings).where(
                    recognition_settings.c.id == 1
                ))
                if original_settings:
                    await connection.execute(insert(recognition_settings), original_settings)
                await connection.execute(delete(audit_events).where(
                    audit_events.c.actor_user_id.in_([admin_id, employee_id])
                ))
                await connection.execute(
                    delete(users).where(users.c.id.in_([admin_id, employee_id]))
                )
