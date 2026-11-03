"""Terminal refusal over HTTP on the explicitly configured disposable test database."""

import os
from datetime import UTC, datetime
from uuid import UUID, uuid4

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import func, insert, select
from sqlalchemy.ext.asyncio import create_async_engine

from test_zoom_postgres import zoom_settings
from yuksalish_api.auth import issue_access_token
from yuksalish_api.main import create_app
from yuksalish_api.repository import find_active_user_by_username
from yuksalish_api.tables import (
    ai_referent_delivery_commands,
    ai_referent_events,
    ai_referent_letters,
    ai_referent_telegram_outbox,
    audit_events,
    workspace_notifications,
)


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.mark.anyio
@pytest.mark.postgres
@pytest.mark.parametrize("kind", ["delivery", "sign_only"])
async def test_reject_http_is_terminal_audited_notified_and_idempotent(kind):
    url = os.environ.get("YUKSALISH_TEST_DATABASE_URL")
    if not url:
        pytest.skip("YUKSALISH_TEST_DATABASE_URL is not configured")
    settings = zoom_settings(url)
    settings.seed_demo_data = True
    engine = create_async_engine(url)
    app = create_app(settings)
    base = "/api/v1/ai-referent"
    letter_id = uuid4()
    now = datetime.now(UTC)
    try:
        async with (
            app.router.lifespan_context(app),
            AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client,
        ):
            async with engine.connect() as connection:
                people = {name: await find_active_user_by_username(connection, name)
                          for name in ("dilshod", "aziza", "baxtiyor", "malika")}

            def auth(name):
                return {"Authorization": "Bearer " + issue_access_token(
                    people[name]["id"], settings.auth_signing_key,
                )}

            admin = auth("malika")
            config = (await client.get(base + "/configuration", headers=admin)).json()
            configured = await client.put(base + "/configuration", headers=admin, json={
                "expectedRevision": config["revision"], "reviewers": [
                    {"key": key, "username": name, "enabled": bool(name), "telegramId": None}
                    for key, name in [("askar", "aziza"), ("bobur", "baxtiyor"),
                                      ("umid", ""), ("davronbek", "")]
                ],
            })
            assert configured.status_code == 200, configured.text
            async with engine.begin() as connection:
                await connection.execute(insert(ai_referent_letters).values(
                    id=letter_id, subject="Synthetic final refusal", recipient_organization="QA",
                    recipient_address="office@example.test", route="webmail", note="",
                    status="pending_review", workflow_kind=kind, source="workspace",
                    created_by_user_id=people["dilshod"]["id"],
                    reviewer_user_id=people["baxtiyor"]["id"], reviewer_key="bobur",
                    initial_reviewer_user_id=people["aziza"]["id"] if kind == "delivery" else None,
                    initial_reviewer_key="askar" if kind == "delivery" else None,
                    final_reviewer_user_id=people["baxtiyor"]["id"] if kind == "delivery" else None,
                    final_reviewer_key="bobur" if kind == "delivery" else None,
                    revision=1, created_at=now, updated_at=now,
                ))
            path = f"{base}/letters/{letter_id}"
            operation_id = str(uuid4())
            reason = "This synthetic letter is no longer relevant"
            payload = {"action": "reject", "expectedRevision": 1,
                       "operationId": operation_id, "comment": reason}
            for name in ("dilshod", "aziza", "malika"):
                denied = await client.post(path + "/actions", headers=auth(name), json=payload)
                assert denied.status_code == 403, denied.text
            for changes, code in (({"comment": "  "}, 422), ({"expectedRevision": 2}, 409)):
                denied = await client.post(path + "/actions", headers=auth("baxtiyor"),
                                           json={**payload, **changes})
                assert denied.status_code == code, denied.text
            for _ in range(2):
                result = await client.post(path + "/actions", headers=auth("baxtiyor"),
                                           json=payload)
                assert result.status_code == 200, result.text
                body = result.json()
                assert body["status"] == "rejected"
                assert body["revision"] == 2
                assert body["availableActions"] == []
                assert not body["canEdit"]
                assert body["outgoingNumber"] is None
                assert body["reviewerUserId"] == str(people["baxtiyor"]["id"])
                assert [event["comment"] for event in body["events"]] == [reason]
            for action, name in (("approve", "baxtiyor"), ("reject", "baxtiyor"),
                                 ("submit", "dilshod"), ("cancel", "dilshod")):
                denied = await client.post(path + "/actions", headers=auth(name), json={
                    **payload, "action": action, "expectedRevision": 2,
                    "operationId": str(uuid4()),
                })
                assert denied.status_code in {403, 409}, denied.text
            async with engine.connect() as connection:
                for table in (ai_referent_delivery_commands,):
                    assert await connection.scalar(select(func.count()).select_from(table).where(
                        table.c.letter_id == letter_id,
                    )) == 0
                assert await connection.scalar(select(func.count()).select_from(
                    ai_referent_events,
                ).where(ai_referent_events.c.letter_id == letter_id)) == 1
                assert await connection.scalar(select(func.count()).select_from(
                    audit_events,
                ).where(audit_events.c.target_id == letter_id,
                        audit_events.c.action == "ai_referent.reject")) == 1
                notifications = (await connection.execute(select(workspace_notifications).where(
                    workspace_notifications.c.entity_id == letter_id,
                ))).mappings().all()
                assert {item["user_id"] for item in notifications} == {
                    people["dilshod"]["id"], people["baxtiyor"]["id"],
                }
                assert all(reason in item["body"] and not item["requires_action"]
                           for item in notifications)
                assert await connection.scalar(select(func.count()).select_from(
                    ai_referent_telegram_outbox,
                ).where(ai_referent_telegram_outbox.c.letter_id == UUID(str(letter_id)))) == 2
    finally:
        await engine.dispose()
