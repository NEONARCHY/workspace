"""HTTP recovery on a disposable PostgreSQL, with no external mail transport."""

import asyncio
import os
from uuid import UUID, uuid4

import pytest
from httpx import ASGITransport, AsyncClient
from pydantic import SecretStr
from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import create_async_engine

from ai_referent_test_support import pass_preflight
from test_zoom_postgres import zoom_settings
from yuksalish_api.auth import issue_access_token
from yuksalish_api.main import create_app
from yuksalish_api.repository import find_active_user_by_username
from yuksalish_api.tables import (
    ai_referent_configuration,
    ai_referent_delivery_commands,
    ai_referent_events,
    ai_referent_letters,
    audit_events,
)


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.mark.anyio
@pytest.mark.postgres
@pytest.mark.parametrize("existing_pdf", [False, True])
async def test_admin_retry_http_preserves_approval_permissions_and_single_job(existing_pdf):
    url = os.environ.get("YUKSALISH_TEST_DATABASE_URL")
    if not url:
        pytest.skip("YUKSALISH_TEST_DATABASE_URL is not configured")
    settings = zoom_settings(url)
    settings.seed_demo_data = True
    settings.ai_referent_agent_token = SecretStr("admin-retry-test-agent")
    engine = create_async_engine(url)
    app = create_app(settings)
    base = "/api/v1/ai-referent"
    agent = {"X-AI-Referent-Agent-Token": "admin-retry-test-agent"}
    async with (
        app.router.lifespan_context(app),
        AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client,
    ):
        async with engine.begin() as connection:
            # The executor has one physical lane. Isolate this fixture from an
            # interrupted test run's uncompleted compose window (test DB only).
            await connection.execute(delete(ai_referent_delivery_commands))
            await connection.execute(delete(ai_referent_letters))
            await connection.execute(update(ai_referent_configuration).values(
                execution_agent_id="retry-test",
            ))
            people = {name: await find_active_user_by_username(connection, name)
                      for name in ("dilshod", "aziza", "baxtiyor", "malika")}

        def auth(name):
            return {"Authorization": "Bearer " + issue_access_token(
                people[name]["id"], settings.auth_signing_key,
            )}

        async def call(method, path, headers=None, expected=200, **kwargs):
            result = await client.request(method, base + path, headers=headers or agent, **kwargs)
            assert result.status_code == expected, result.text
            return result.json() if result.content else None

        author, preliminary, chairman, admin = [auth(name) for name in people]
        config = await call("GET", "/configuration", admin)
        await call("PUT", "/configuration", admin, json={
            "expectedRevision": config["revision"], "reviewers": [
                {"key": key, "username": name, "enabled": bool(name), "telegramId": None}
                for key, name in [("askar", "aziza"), ("bobur", "baxtiyor"),
                                  ("umid", ""), ("davronbek", "")]
            ],
        })
        letter = await call("POST", "/letters", author, expected=201, json={
            "subject": "Synthetic retry acceptance", "recipientOrganization": "Test recipient",
            "recipientAddress": "office@example.test", "route": "webmail",
            "reviewerUserId": str(people["aziza"]["id"]),
            "finalReviewerUserId": str(people["baxtiyor"]["id"]),
        })
        path = f"/letters/{letter['id']}"
        uploaded = await client.put(
            f"/api/v1/attachments/ai_referent_letter/{letter['id']}", headers=author,
            params={"fileName": "test.docx", "documentRole": "primary"}, content=b"PK test",
        )
        assert uploaded.status_code == 201, uploaded.text
        await pass_preflight(client, engine, letter["id"], author, "admin-retry-test-agent")

        async def action(name, headers, **extra):
            current = await call("GET", path, admin)
            return await call("POST", path + "/actions", headers, json={
                "action": name, "expectedRevision": current["revision"],
                "operationId": str(uuid4()), **extra,
            })

        async def claim():
            job = (await call("POST", "/agent/jobs/claim?agentId=retry-test"))["job"]
            assert job is not None and job["letterId"] == letter["id"]
            return job

        async def complete(job, outcome, **extra):
            await call("POST", f"/agent/jobs/{job['id']}/result", expected=204, json={
                "agentId": "retry-test", "leaseToken": job["leaseToken"],
                "outcome": outcome, **extra,
            })

        async def upload_pdf(job):
            await call("PUT", f"/agent/files/outgoing/{letter['id']}", params={
                "agentId": "retry-test", "leaseToken": job["leaseToken"], "jobId": job["id"],
                "name": f"signed/{job['id']}.pdf",
            }, content=b"%PDF-1.4 synthetic approved letter")

        await action("submit", author)
        await action("approve", preliminary)
        approved = await action("approve", chairman)
        job = await claim()
        if existing_pdf:
            await upload_pdf(job)
            await complete(job, "prepared")
            await action("release_delivery", author)
            job = await claim()
            assert job["kind"] == "dispatch"
        await complete(job, "failed", detail="Synthetic pre-send failure")
        failed = await call("GET", path, admin)
        assert failed["status"] == "failed"
        assert "retry_failed_delivery" in failed["availableActions"]
        for headers in (author, chairman):
            denied = await call("GET", path, headers)
            assert "retry_failed_delivery" not in denied["availableActions"]
            await call("POST", path + "/actions", headers, expected=403, json={
                "action": "retry_failed_delivery", "expectedRevision": failed["revision"],
                "comment": "External journal verified not sent",
            })
        await call("POST", path + "/actions", admin, expected=422, json={
            "action": "retry_failed_delivery", "expectedRevision": failed["revision"],
            "comment": "",
        })
        payload = {"action": "retry_failed_delivery", "expectedRevision": failed["revision"],
                   "operationId": str(uuid4()), "comment": "External journal verified not sent"}
        attempts = [{**payload, "operationId": str(uuid4())} for _ in range(2)]
        results = await asyncio.gather(*[
            client.post(base + path + "/actions", headers=admin, json=attempt)
            for attempt in attempts
        ])
        assert sorted(response.status_code for response in results) == [200, 409]
        winner = next(response for response in results if response.status_code == 200).json()
        accepted = next(attempt for attempt, response in zip(attempts, results, strict=True)
                        if response.status_code == 200)
        replay = await call("POST", path + "/actions", admin, json=accepted)
        assert replay["revision"] == winner["revision"]
        for key in ("displayNumber", "outgoingNumber", "yearSuffix", "reviewerUserId",
                    "finalReviewerUserId", "initialReviewerUserId", "createdByUserId"):
            assert winner[key] == approved[key]
        assert winner["finalPdfFileId"] == failed["finalPdfFileId"]
        assert sum(event["eventType"] == "letter.approve" for event in winner["events"]) == 2
        retry_event = next(event for event in winner["events"]
                           if event["eventType"] == "letter.retry_failed_delivery")
        assert retry_event["actorUserId"] == str(people["malika"]["id"])
        async with engine.connect() as connection:
            commands = (await connection.execute(select(ai_referent_delivery_commands).where(
                ai_referent_delivery_commands.c.letter_id == UUID(letter["id"]),
                ai_referent_delivery_commands.c.status == "pending",
            ))).mappings().all()
            assert len(commands) == 1
            assert commands[0]["kind"] == ("dispatch" if existing_pdf else "reprepare")
            audit = (await connection.execute(select(audit_events).where(
                audit_events.c.target_id == UUID(letter["id"]),
                audit_events.c.action == "ai_referent.retry_failed_delivery",
            ))).mappings().all()
            assert len(audit) == 1 and audit[0]["actor_user_id"] == people["malika"]["id"]
            assert audit[0]["details"]["verification"] == payload["comment"]
            assert audit[0]["details"]["approvalPreserved"] is True
            assert (await connection.execute(select(ai_referent_events).where(
                ai_referent_events.c.letter_id == UUID(letter["id"]),
                ai_referent_events.c.event_type == "letter.retry_failed_delivery",
            ))).mappings().one()["comment"] == payload["comment"]
        job = await claim()
        if existing_pdf:
            assert job["signedFile"]["id"] == failed["finalPdfFileId"]
            await complete(job, "ready", autoSend=False)
        else:
            assert job["requiresFinalCheck"] is False
            await upload_pdf(job)
            await complete(job, "prepared", autoSend=True)
        recovered = await call("GET", path, admin)
        assert recovered["status"] == "referent_review_pending"
        assert "send" in recovered["availableActions"]
        assert "retry_failed_delivery" not in recovered["availableActions"]
        await action("send", admin)
        job = await claim()
        await complete(job, "unknown", detail="Synthetic transport disconnect")
        unknown = await call("GET", path, admin)
        assert unknown["status"] == "delivery_unknown"
        assert "retry_failed_delivery" not in unknown["availableActions"]
        await call("POST", path + "/actions", admin, expected=409, json={
            **payload, "operationId": str(uuid4()), "expectedRevision": unknown["revision"],
        })
        await action("confirm_not_sent", admin, comment="Synthetic external journal: not sent")
        await action("send", admin)
        job = await claim()
        await complete(job, "sent", detail="Synthetic provider sent receipt")
        sent = await call("GET", path, admin)
        assert sent["status"] == "sent" and sent["sentAt"]
        assert "retry_failed_delivery" not in sent["availableActions"]
        await call("POST", path + "/actions", admin, expected=409, json={
            **payload, "operationId": str(uuid4()), "expectedRevision": sent["revision"],
        })
    await engine.dispose()
