"""HTTP authorization, optimistic config writes and live letter reassignment."""

import os
from datetime import UTC, datetime
from uuid import UUID, uuid4

import pytest
from httpx import ASGITransport, AsyncClient
from pydantic import SecretStr
from sqlalchemy import delete, insert, select, update
from sqlalchemy.ext.asyncio import create_async_engine

from test_zoom_postgres import zoom_settings
from yuksalish_api.auth import issue_access_token
from yuksalish_api.main import create_app
from yuksalish_api.repository import find_active_user_by_username
from yuksalish_api.tables import (
    ai_referent_agents,
    ai_referent_letters,
    module_access_rules,
    users,
)


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.mark.anyio
@pytest.mark.postgres
async def test_shared_reviewer_configuration_access_conflicts_reassignment_and_ack():
    database_url = os.environ.get("YUKSALISH_TEST_DATABASE_URL")
    if not database_url:
        pytest.skip("YUKSALISH_TEST_DATABASE_URL is not configured")
    settings = zoom_settings(database_url)
    settings.seed_demo_data = True
    settings.ai_referent_agent_token = SecretStr("test-reviewer-agent-token-very-long-value")
    app = create_app(settings)
    base = "/api/v1/ai-referent"
    agent = {"X-AI-Referent-Agent-Token": settings.ai_referent_agent_token.get_secret_value()}
    async with (
        app.router.lifespan_context(app),
        AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client,
    ):
        engine = create_async_engine(database_url)
        async with engine.begin() as connection:
            records = {
                username: await find_active_user_by_username(connection, username)
                for username in ("malika", "aziza", "dilshod", "baxtiyor")
            }
            await connection.execute(
                delete(module_access_rules).where(
                    module_access_rules.c.module_key == "ai_referent",
                )
            )

        def auth(username):
            return {
                "Authorization": "Bearer "
                + issue_access_token(
                    records[username]["id"],
                    settings.auth_signing_key,
                )
            }

        admin, old, new = auth("malika"), auth("aziza"), auth("dilshod")
        assert (await client.get(base + "/configuration", headers=old)).status_code == 403
        assert (await client.get(base + "/configuration", headers=agent)).status_code == 401
        assert (await client.get(base + "/agent/configuration")).status_code == 401
        config = (await client.get(base + "/configuration", headers=admin)).json()
        initial = {
            "expectedRevision": config["revision"],
            "reviewers": [
                {
                    "key": key,
                    "username": "aziza" if key == "askar" else "",
                    "telegramId": "90001" if key == "askar" else None,
                    "enabled": key == "askar",
                }
                for key in ("askar", "bobur", "umid", "davronbek")
            ],
        }
        assert (
            await client.put(base + "/configuration", headers=old, json=initial)
        ).status_code == 403
        assert (
            await client.put(base + "/configuration", headers=agent, json=initial)
        ).status_code == 401
        saved = await client.put(base + "/configuration", headers=admin, json=initial)
        assert saved.status_code == 200, saved.text
        saved_config = saved.json()
        assert saved_config["revision"] == config["revision"] + 1
        assert saved_config["reviewers"][0]["username"] == "aziza"
        choices = (await client.get(base + "/reviewers", headers=new)).json()
        assert len(choices["reviewers"]) == 1
        assert choices["reviewers"][0]["telegramId"] is None
        assert choices["runtimes"] == []
        assert (
            await client.put(base + "/configuration", headers=admin, json=initial)
        ).status_code == 409

        letter = await client.post(
            base + "/letters",
            headers=new,
            json={
                "subject": "Account-bound approval",
                "recipientOrganization": "Partner",
                "route": "exat",
                "reviewerUserId": str(records["aziza"]["id"]),
            },
        )
        assert letter.status_code == 201, letter.text
        letter_id = UUID(letter.json()["id"])
        async with engine.begin() as connection:
            # This test targets reassignment rather than attachment upload (covered separately).
            await connection.execute(
                update(ai_referent_letters)
                .where(
                    ai_referent_letters.c.id == letter_id,
                )
                .values(status="pending_review")
            )

        initial["expectedRevision"] = saved_config["revision"]
        initial["reviewers"][0].update(username="dilshod", telegramId="90002")
        replacement = await client.put(base + "/configuration", headers=admin, json=initial)
        assert replacement.status_code == 200, replacement.text
        current = (await client.get(base + "/letters/" + str(letter_id), headers=new)).json()
        assert current["reviewerUserId"] == str(records["dilshod"]["id"])
        assert current["revision"] == 2
        assert "approve" in current["availableActions"]  # Employee by account, not position/role.
        assert any(event["eventType"] == "reviewer.reassigned" for event in current["events"])
        denied = await client.post(
            base + f"/letters/{letter_id}/actions",
            headers=old,
            json={
                "action": "approve",
                "expectedRevision": current["revision"],
            },
        )
        assert denied.status_code == 403
        approved = await client.post(
            base + f"/letters/{letter_id}/actions",
            headers=new,
            json={
                "action": "approve",
                "expectedRevision": current["revision"],
            },
        )
        assert approved.status_code == 200, approved.text

        remote = await client.get(base + "/agent/configuration", headers=agent)
        assert remote.status_code == 200
        revision = remote.json()["revision"]
        for seen, expected in ((revision + 1, 409), (revision, 204), (revision - 1, 204)):
            ack = await client.post(
                base + "/agent/configuration:ack",
                headers=agent,
                json={
                    "agentId": "configuration-test",
                    "agentName": "Isolated test",
                    "revision": seen,
                },
            )
            assert ack.status_code == expected, ack.text
        async with engine.connect() as connection:
            assert (
                await connection.scalar(
                    select(ai_referent_agents.c.configuration_revision).where(
                        ai_referent_agents.c.agent_id == "configuration-test",
                    )
                )
                == revision
            )

        # An approved-but-unsent letter follows the current role without losing its decision.
        initial["expectedRevision"] = revision
        initial["reviewers"][0]["enabled"] = False
        disabled = await client.put(base + "/configuration", headers=admin, json=initial)
        assert disabled.status_code == 200
        async with engine.connect() as connection:
            approved_row = (
                (
                    await connection.execute(
                        select(ai_referent_letters).where(
                            ai_referent_letters.c.id == letter_id,
                        )
                    )
                )
                .mappings()
                .one()
            )
            assert approved_row["reviewer_user_id"] is None
            assert approved_row["status"] == "queued"
        audit = (await client.get(base + f"/letters/{letter_id}", headers=admin)).json()
        assert any(event["eventType"] == "letter.approve" for event in audit["events"])
        initial["expectedRevision"] = disabled.json()["revision"]
        initial["reviewers"][0]["enabled"] = True
        reenabled = await client.put(base + "/configuration", headers=admin, json=initial)
        assert reenabled.status_code == 200
        async with engine.begin() as connection:
            assert (
                await connection.scalar(
                    select(ai_referent_letters.c.reviewer_user_id).where(
                        ai_referent_letters.c.id == letter_id,
                    )
                )
                == records["dilshod"]["id"]
            )
            await connection.execute(
                update(ai_referent_letters)
                .where(
                    ai_referent_letters.c.id == letter_id,
                )
                .values(status="sent")
            )
        initial["expectedRevision"] = reenabled.json()["revision"]
        initial["reviewers"][0]["enabled"] = False
        disabled = await client.put(base + "/configuration", headers=admin, json=initial)
        assert disabled.status_code == 200
        async with engine.connect() as connection:
            assert (
                await connection.scalar(
                    select(ai_referent_letters.c.reviewer_user_id).where(
                        ai_referent_letters.c.id == letter_id,
                    )
                )
                == records["dilshod"]["id"]
            )  # Completed correspondence keeps its identity.
        initial["expectedRevision"] = disabled.json()["revision"]
        initial["reviewers"][0]["enabled"] = True
        initial["reviewers"][1].update(username="dilshod", enabled=True)
        assert (
            await client.put(base + "/configuration", headers=admin, json=initial)
        ).status_code == 422
        initial["reviewers"][1].update(username="not_a_real_account", enabled=True)
        assert (
            await client.put(base + "/configuration", headers=admin, json=initial)
        ).status_code == 422
        initial["reviewers"][1].update(username="", enabled=False)
        restored = await client.put(base + "/configuration", headers=admin, json=initial)
        assert restored.status_code == 200
        deny_id = uuid4()
        async with engine.begin() as connection:
            await connection.execute(
                insert(module_access_rules).values(
                    id=deny_id,
                    subject_type="user",
                    subject_key=str(records["dilshod"]["id"]),
                    module_key="ai_referent",
                    permissions={"view": True, "approve": False},
                    created_by_user_id=records["malika"]["id"],
                    created_at=datetime.now(UTC),
                    updated_at=datetime.now(UTC),
                )
            )
        try:
            denied_config = (await client.get(base + "/agent/configuration", headers=agent)).json()
            assert denied_config["reviewers"][0]["accountActive"] is True
            assert denied_config["reviewers"][0]["canApprove"] is False
        finally:
            async with engine.begin() as connection:
                await connection.execute(
                    delete(module_access_rules).where(
                        module_access_rules.c.id == deny_id,
                    )
                )
        async with engine.begin() as connection:
            await connection.execute(
                update(users).where(users.c.id == records["dilshod"]["id"]).values(status="blocked")
            )
        try:
            remote = (await client.get(base + "/agent/configuration", headers=agent)).json()
            assert remote["reviewers"][0]["accountActive"] is False
            assert remote["reviewers"][0]["canApprove"] is False
        finally:
            async with engine.begin() as connection:
                await connection.execute(
                    update(users)
                    .where(users.c.id == records["dilshod"]["id"])
                    .values(status="active")
                )
            await engine.dispose()
