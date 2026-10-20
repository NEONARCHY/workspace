"""Sender decisions and administrator cleanup share the real transactional database."""

import os
from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import insert, select, update
from sqlalchemy.ext.asyncio import create_async_engine

from test_zoom_postgres import zoom_settings
from yuksalish_api import ai_referent_agent_service as agent
from yuksalish_api.auth import issue_access_token
from yuksalish_api.main import create_app
from yuksalish_api.repository import find_active_user_by_username
from yuksalish_api.tables import (
    ai_referent_configuration,
)
from yuksalish_api.tables import (
    ai_referent_delivery_commands as commands,
)
from yuksalish_api.tables import (
    ai_referent_letters as letters,
)


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.mark.anyio
@pytest.mark.postgres
@pytest.mark.parametrize("status", [
    "pending_review", "awaiting_final_send", "sent", "signed", "queued", "sending",
])
async def test_administrator_deletes_foreign_letter_at_every_stage(status):
    url = os.environ.get("YUKSALISH_TEST_DATABASE_URL")
    if not url:
        pytest.skip("YUKSALISH_TEST_DATABASE_URL is not configured")
    settings = zoom_settings(url)
    settings.seed_demo_data = True
    app, engine = create_app(settings), create_async_engine(url)
    base = "/api/v1/ai-referent/letters"
    async with (
        app.router.lifespan_context(app),
        AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client,
    ):
        async with engine.begin() as connection:
            people = {name: await find_active_user_by_username(connection, name)
                      for name in ("dilshod", "malika", "aziza")}
            await connection.execute(update(ai_referent_configuration).values(
                execution_agent_id="cleanup-test"
            ))

        def auth(name):
            return {"Authorization": "Bearer " + issue_access_token(
                people[name]["id"], settings.auth_signing_key
            )}

        response = await client.post(base, headers=auth("dilshod"), json={
            "subject": "Cleanup test", "recipientOrganization": "Test partner",
            "recipientAddress": "test@example.org", "route": "webmail",
            "reviewerUserId": str(people["aziza"]["id"]),
        })
        assert response.status_code == 201, response.text
        letter_id = UUID(response.json()["id"])
        now, job_id, lease = datetime.now(UTC), uuid4(), uuid4()
        async with engine.begin() as connection:
            await connection.execute(update(letters).where(letters.c.id == letter_id).values(
                status=status, outgoing_number=98765, year_suffix="26"
            ))
            if status in {"queued", "sending"}:
                await connection.execute(insert(commands).values(
                    id=job_id, letter_id=letter_id, route="webmail", kind="prepare",
                    status="claimed" if status == "sending" else "pending",
                    claimed_by="cleanup-test" if status == "sending" else None,
                    lease_token=lease if status == "sending" else None,
                    lease_until=now + timedelta(minutes=3),
                    idempotency_key=str(job_id), attempt_count=0, last_error="",
                    created_at=now, updated_at=now,
                ))
        path = f"{base}/{letter_id}"
        view = await client.get(path, headers=auth("malika"))
        assert view.status_code == 200 and view.json()["canDelete"]
        denied = await client.delete(path + "?expectedRevision=1", headers=auth("aziza"))
        assert denied.status_code == 403
        stale = await client.delete(path + "?expectedRevision=2", headers=auth("malika"))
        assert stale.status_code == 409
        deleted = await client.delete(path + "?expectedRevision=1", headers=auth("malika"))
        assert deleted.status_code == 200 and deleted.json() == {"queued": True}
        async with engine.begin() as connection:
            if status == "sending":
                # The claimed preparation may report after the deletion request;
                # its result must never enqueue a send or revive a decision.
                await agent.complete_job(
                    connection, job_id, lease, "cleanup-test", "failed", "Test completion"
                )
            pending = (await connection.execute(select(commands).where(
                commands.c.letter_id == letter_id, commands.c.status == "pending"
            ))).mappings().all()
            assert [job["kind"] for job in pending] == ["delete"]
            job = await agent.claim_job(connection, "cleanup-test")
            assert job is not None and job["kind"] == "delete"
            await agent.complete_job(
                connection, UUID(str(job["id"])), UUID(str(job["leaseToken"])),
                "cleanup-test", "deleted", "Local registry cleaned",
            )
            assert await connection.scalar(select(letters.c.id).where(
                letters.c.id == letter_id
            )) is None
            assert await connection.scalar(select(commands.c.id).where(
                commands.c.letter_id == letter_id
            )) is None
        assert (await client.get(path, headers=auth("dilshod"))).status_code == 404
    await engine.dispose()
