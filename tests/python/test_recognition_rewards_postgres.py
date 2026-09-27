import os
from datetime import UTC, datetime
from uuid import UUID, uuid4

import pytest
from httpx import ASGITransport, AsyncClient
from pydantic import SecretStr
from sqlalchemy import delete, insert

from yuksalish_api.auth import issue_access_token
from yuksalish_api.main import create_app
from yuksalish_api.recognition_service import REWARD_CATALOG
from yuksalish_api.settings import Settings
from yuksalish_api.tables import audit_events, employee_rewards, users


@pytest.mark.anyio
@pytest.mark.postgres
async def test_any_employee_can_repeat_preset_rewards_with_optional_context() -> None:
    database_url = os.environ.get("YUKSALISH_TEST_DATABASE_URL")
    if not database_url:
        pytest.skip("YUKSALISH_TEST_DATABASE_URL is not configured")
    signing_key = SecretStr("reward-test-signing-key")
    app = create_app(
        Settings(
            environment="test",
            database_url=database_url,
            auth_signing_key=signing_key,
            auth_encryption_key=SecretStr("reward-test-encryption-key"),
            seed_demo_data=False,
        )
    )
    actor_id, recipient_id = uuid4(), uuid4()
    reward_ids: list[UUID] = []
    async with (
        app.router.lifespan_context(app),
        AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client,
    ):
        try:
            now = datetime.now(UTC)
            async with app.state.database_engine.begin() as connection:
                await connection.execute(insert(users), [
                    {
                        "id": actor_id,
                        "username": f"reward-actor-{actor_id.hex[:12]}",
                        "full_name": "Тестовый сотрудник",
                        "role": "employee",
                        "status": "active",
                        "created_at": now,
                        "updated_at": now,
                    },
                    {
                        "id": recipient_id,
                        "username": f"reward-recipient-{recipient_id.hex[:12]}",
                        "full_name": "Тестовый получатель",
                        "role": "employee",
                        "status": "active",
                        "created_at": now,
                        "updated_at": now,
                    },
                ])
            headers = {
                "Authorization": f"Bearer {issue_access_token(actor_id, signing_key)}"
            }
            profile = await client.get(
                f"/api/v1/recognition/profiles/{recipient_id}", headers=headers
            )
            assert profile.status_code == 200
            assert profile.json()["canIssueReward"] is True
            assert len(profile.json()["rewardCatalog"]) == 9

            for context in ("После запуска проекта", "После сложной задачи"):
                response = await client.post(
                    f"/api/v1/recognition/profiles/{recipient_id}/rewards",
                    headers=headers,
                    json={
                        "iconKey": "teamwork",
                        "contextNote": context,
                        "title": "Подменённое название",
                        "description": "Подменённое описание",
                    },
                )
                assert response.status_code == 201
                result = response.json()
                reward_ids.append(UUID(result["id"]))
                assert result["title"] == "Командная работа"
                assert result["description"] == REWARD_CATALOG["teamwork"][1]
                assert result["contextNote"] == context

            profile_after = await client.get(
                f"/api/v1/recognition/profiles/{recipient_id}", headers=headers
            )
            assert profile_after.status_code == 200
            saved = [
                reward for reward in profile_after.json()["rewards"]
                if UUID(reward["id"]) in reward_ids
            ]
            assert len(saved) == 2
            assert {item["issuerName"] for item in saved} == {"Тестовый сотрудник"}

            self_award = await client.post(
                f"/api/v1/recognition/profiles/{actor_id}/rewards",
                headers=headers,
                json={"iconKey": "mastery"},
            )
            assert self_award.status_code == 422
            for _ in range(10):
                extra = await client.post(
                    f"/api/v1/recognition/profiles/{recipient_id}/rewards",
                    headers=headers,
                    json={"iconKey": "teamwork"},
                )
                assert extra.status_code == 201
            over_limit = await client.post(
                f"/api/v1/recognition/profiles/{recipient_id}/rewards",
                headers=headers,
                json={"iconKey": "teamwork"},
            )
            assert over_limit.status_code == 429
        finally:
            async with app.state.database_engine.begin() as connection:
                await connection.execute(
                    delete(employee_rewards).where(
                        employee_rewards.c.issuer_user_id == actor_id,
                        employee_rewards.c.recipient_user_id == recipient_id,
                    )
                )
                await connection.execute(
                    delete(audit_events).where(audit_events.c.actor_user_id == actor_id)
                )
                await connection.execute(
                    delete(users).where(users.c.id.in_([actor_id, recipient_id]))
                )
