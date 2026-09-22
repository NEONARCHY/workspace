"""The shared outgoing-letter register over HTTP."""

import os

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import delete
from sqlalchemy.ext.asyncio import create_async_engine

from test_zoom_postgres import zoom_settings
from yuksalish_api.auth import issue_access_token
from yuksalish_api.main import create_app
from yuksalish_api.repository import find_active_user_by_username
from yuksalish_api.tables import (
    ai_referent_delivery_commands,
    ai_referent_events,
    ai_referent_letters,
    ai_referent_number_counters,
    attachments,
)


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"


@pytest.mark.anyio
@pytest.mark.postgres
async def test_ai_referent_draft_review_number_and_delivery_queue() -> None:
    database_url = os.environ.get("YUKSALISH_TEST_DATABASE_URL")
    if not database_url:
        pytest.skip("YUKSALISH_TEST_DATABASE_URL is not configured")
    engine = create_async_engine(database_url)
    async with engine.begin() as connection:
        await connection.execute(
            delete(attachments).where(attachments.c.owner_type == "ai_referent_letter")
        )
        await connection.execute(delete(ai_referent_delivery_commands))
        await connection.execute(delete(ai_referent_events))
        await connection.execute(delete(ai_referent_letters))
        await connection.execute(delete(ai_referent_number_counters))
    await engine.dispose()

    settings = zoom_settings(database_url)
    settings.seed_demo_data = True
    app = create_app(settings)
    async with (
        app.router.lifespan_context(app),
        AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client,
    ):
        auth_engine = create_async_engine(database_url)
        async with auth_engine.connect() as connection:
            records = {
                username: await find_active_user_by_username(connection, username)
                for username in ("dilshod", "aziza", "baxtiyor")
            }
        await auth_engine.dispose()
        assert all(record is not None for record in records.values())

        def headers(username: str) -> dict[str, str]:
            record = records[username]
            assert record is not None
            token = issue_access_token(record["id"], settings.auth_signing_key)
            return {"Authorization": f"Bearer {token}"}

        author = headers("dilshod")
        reviewer = headers("aziza")
        another_manager = headers("baxtiyor")
        bootstrap = await client.get("/api/v1/workspace/bootstrap", headers=author)
        people = {person["username"]: person["id"] for person in bootstrap.json()["people"]}

        created = await client.post(
            "/api/v1/ai-referent/letters",
            headers=author,
            json={
                "subject": "Ответ партнёру",
                "recipientOrganization": "Организация-получатель",
                "recipientAddress": "Канцелярия",
                "route": "exat",
                "note": "Проверить приложение",
                "reviewerUserId": people["aziza"],
            },
        )
        assert created.status_code == 201, created.text
        letter = created.json()
        assert letter["status"] == "draft"
        assert "submit" not in letter["availableActions"]
        assert letter["displayNumber"] is None

        uploaded = await client.put(
            f"/api/v1/attachments/ai_referent_letter/{letter['id']}",
            headers={**author, "Content-Type": "application/pdf"},
            params={"fileName": "letter.pdf", "documentRole": "primary"},
            content=b"%PDF-1.4 outgoing letter",
        )
        assert uploaded.status_code == 201, uploaded.text

        current = await client.get(
            f"/api/v1/ai-referent/letters/{letter['id']}", headers=author
        )
        letter = current.json()
        submitted = await client.post(
            f"/api/v1/ai-referent/letters/{letter['id']}/actions",
            headers=author,
            json={"action": "submit", "comment": "", "expectedRevision": letter["revision"]},
        )
        assert submitted.status_code == 200, submitted.text
        letter = submitted.json()
        assert letter["status"] == "pending_review"

        forbidden = await client.post(
            f"/api/v1/ai-referent/letters/{letter['id']}/actions",
            headers=another_manager,
            json={"action": "approve", "comment": "", "expectedRevision": letter["revision"]},
        )
        assert forbidden.status_code == 403

        approved = await client.post(
            f"/api/v1/ai-referent/letters/{letter['id']}/actions",
            headers=reviewer,
            json={
                "action": "approve",
                "comment": "Согласовано",
                "expectedRevision": letter["revision"],
            },
        )
        assert approved.status_code == 200, approved.text
        letter = approved.json()
        assert letter["status"] == "approved"
        assert letter["displayNumber"].endswith("-AI")

        queued = await client.post(
            f"/api/v1/ai-referent/letters/{letter['id']}/actions",
            headers=reviewer,
            json={
                "action": "queue_delivery",
                "comment": "Передать агенту",
                "expectedRevision": letter["revision"],
            },
        )
        assert queued.status_code == 200, queued.text
        assert queued.json()["status"] == "queued"

        registry = await client.get("/api/v1/ai-referent/letters", headers=author)
        assert registry.status_code == 200
        assert registry.json()["totalCount"] == 1
        assert registry.json()["readyCount"] == 1
