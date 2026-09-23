"""Cross-channel workflow, immutable files, fenced delivery and identity over HTTP."""

import hashlib
import os
from datetime import UTC, datetime, timedelta
from io import BytesIO
from uuid import UUID, uuid4
from zipfile import ZipFile

import pytest
from httpx import ASGITransport, AsyncClient
from pydantic import SecretStr
from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import create_async_engine

from test_zoom_postgres import zoom_settings
from yuksalish_api.auth import issue_access_token
from yuksalish_api.main import create_app
from yuksalish_api.repository import find_active_user_by_username
from yuksalish_api.tables import (
    ai_referent_configuration,
    ai_referent_delivery_commands,
    ai_referent_letters,
    ai_referent_telegram_links,
    ai_referent_telegram_outbox,
    workspace_notifications,
)


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.mark.anyio
@pytest.mark.postgres
async def test_shared_workflow_round_trip_and_uncertain_delivery():
    url = os.environ.get("YUKSALISH_TEST_DATABASE_URL")
    if not url:
        pytest.skip("YUKSALISH_TEST_DATABASE_URL is not configured")
    settings = zoom_settings(url)
    settings.seed_demo_data = True
    settings.ai_referent_agent_token = SecretStr("shared-test-agent")
    engine = create_async_engine(url)
    async with engine.begin() as connection:
        await connection.execute(delete(ai_referent_delivery_commands))
        await connection.execute(delete(ai_referent_telegram_links))
        await connection.execute(delete(ai_referent_telegram_outbox))
        await connection.execute(update(ai_referent_configuration).values(execution_agent_id=None))
    app = create_app(settings)
    base = "/api/v1/ai-referent"
    agent = {"X-AI-Referent-Agent-Token": "shared-test-agent"}
    async with (
        app.router.lifespan_context(app),
        AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client,
    ):
        async with engine.connect() as connection:
            users = {
                name: await find_active_user_by_username(connection, name)
                for name in ("dilshod", "aziza", "baxtiyor", "malika")
            }

        def auth(name):
            return {
                "Authorization": "Bearer "
                + issue_access_token(users[name]["id"], settings.auth_signing_key)
            }

        def telegram(identity):
            return {**agent, "X-AI-Referent-Telegram-Id": identity}

        async def call(method, path, headers=None, expected=200, **kwargs):
            response = await client.request(method, base + path, headers=headers or agent, **kwargs)
            assert response.status_code == expected, response.text
            return response.json() if response.content and expected != 204 else None

        admin, author = auth("malika"), auth("dilshod")
        config = await call("GET", "/configuration", admin)
        bindings = [
            {"key": key, "username": name, "telegramId": identity, "enabled": bool(name)}
            for key, name, identity in [
                ("askar", "aziza", "910001"),
                ("bobur", "baxtiyor", "910002"),
                ("umid", "", None),
                ("davronbek", "", None),
            ]
        ]
        await call(
            "PUT",
            "/configuration",
            admin,
            json={"expectedRevision": config["revision"], "reviewers": bindings},
        )
        for headers, identity in [(author, "910003"), (admin, "910004")]:
            code = await call("POST", "/telegram-link", headers)
            await call(
                "POST",
                "/agent/telegram-link",
                expected=204,
                json={"telegramId": identity, "code": code["code"]},
            )
            await call(
                "POST",
                "/agent/telegram-link",
                expected=422,
                json={"telegramId": identity, "code": code["code"]},
            )
            assert (await call("GET", "/telegram-link", headers))["telegramId"] == identity
        await call("GET", "/agent/letters", telegram("910099"), expected=403)
        await call("GET", "/agent/letters", {"X-AI-Referent-Telegram-Id": "910003"}, expected=401)
        visible_config = await call("GET", "/agent/reviewers", telegram("910003"))
        assert all(item["telegramId"] is None for item in visible_config["reviewers"])

        # Register old numbers before enabling any new allocation.
        archive = await call(
            "PUT",
            "/agent/archive?agentId=referent-test",
            json={
                "externalId": "old-42",
                "outgoingNumber": 420,
                "yearSuffix": datetime.now(UTC).strftime("%y"),
                "displayNumber": "0420/26-AI",
                "subject": "Archived letter",
                "senderName": "Author",
                "recipientOrganization": "Partner",
                "route": "exat",
                "status": "exat_sent",
            },
        )
        await call("POST", "/agent/ready?agentId=referent-test", expected=204)
        await call("POST", "/agent/ready?agentId=other-pc", expected=409)
        payload = {
            "subject": "Shared letter",
            "recipientOrganization": "Partner",
            "recipientAddress": "partner@example.test",
            "route": "webmail",
            "reviewerUserId": str(users["aziza"]["id"]),
            "finalReviewerUserId": str(users["baxtiyor"]["id"]),
            "operationId": str(uuid4()),
        }
        letter = await call("POST", "/letters", author, expected=201, json=payload)
        replay = await call("POST", "/letters", author, expected=201, json=payload)
        assert replay["id"] == letter["id"]
        await call("POST", "/letters", author, expected=409, json={**payload, "subject": "Changed"})
        path = "/letters/" + letter["id"]

        async def action(name, actor, expected=200, comment="", revision=None):
            nonlocal letter
            agent_path = "/agent" if "X-AI-Referent-Telegram-Id" in actor else ""
            result = await call(
                "POST",
                agent_path + path + "/actions",
                actor,
                expected,
                json={
                    "action": name,
                    "expectedRevision": revision or letter["revision"],
                    "comment": comment,
                    "operationId": str(uuid4()),
                },
            )
            if expected == 200:
                letter = result
            return result

        await action("submit", author, 422)
        data = b"PK safe DOCX fixture"
        file = await call(
            "PUT",
            "/agent" + path + "/attachment?fileName=letter.docx&role=primary",
            telegram("910003"),
            201,
            content=data,
        )
        duplicate = await call(
            "PUT",
            "/agent" + path + "/attachment?fileName=letter.docx&role=primary",
            telegram("910003"),
            201,
            content=data,
        )
        assert duplicate["id"] == file["id"]
        letter = await call("GET", path, author)
        assert len(letter["attachments"]) == 1
        await action("submit", author)
        await action("approve", telegram("910002"), 403)
        await action("return_for_revision", telegram("910001"), comment="Please correct the draft")
        assert letter["status"] == "needs_revision"
        notifications = await call("POST", "/agent/notifications/claim")
        assert any(
            item["telegramId"] == "910003" and "Please correct" in item["text"]
            for item in notifications["notifications"]
        )
        for item in notifications["notifications"]:
            await call(
                "POST",
                f"/agent/notifications/{item['id']}/ack",
                expected=204,
                json={"leaseToken": item["leaseToken"], "delivered": True},
            )
        await action("submit", telegram("910003"))
        stale = letter["revision"]
        await action("approve", telegram("910001"))
        assert letter["reviewerUserId"] == str(users["baxtiyor"]["id"])
        await action("approve", telegram("910001"), 409, revision=stale)
        await action("approve", telegram("910002"))
        assert letter["status"] == "approved" and int(letter["displayNumber"].split("/")[0]) > 420
        await action("queue_delivery", telegram("910002"))
        job = (await call("POST", "/agent/jobs/claim?agentId=referent-test"))["job"]
        assert job["letterId"] == letter["id"] and job["kind"] == "prepare"
        assert (await call("POST", "/agent/jobs/claim?agentId=referent-test"))["job"] is None
        lease = {"agentId": "referent-test", "leaseToken": job["leaseToken"]}
        await call("POST", f"/agent/jobs/{job['id']}/heartbeat", expected=204, json=lease)
        await call(
            "POST",
            f"/agent/jobs/{job['id']}/result",
            expected=422,
            json={**lease, "outcome": "prepared"},
        )
        source = await client.get(
            base + f"/agent/jobs/{job['id']}/files/{file['id']}", headers=agent, params=lease
        )
        assert source.status_code == 200 and source.content == data
        signed = b"%PDF-1.4 signed fixture"
        params = {**lease, "jobId": job["id"], "name": f"signed/{job['id']}.pdf"}
        await call("PUT", f"/agent/files/outgoing/{letter['id']}", params=params, content=signed)
        completion = {**lease, "outcome": "prepared", "detail": "Prepared only"}
        await call("POST", f"/agent/jobs/{job['id']}/result", expected=204, json=completion)
        await call("POST", f"/agent/jobs/{job['id']}/result", expected=204, json=completion)
        letter = await call("GET", path, author)
        assert letter["status"] == "awaiting_final_send"
        packet = await call("GET", f"/agent/packets/outgoing/{letter['id']}", telegram("910002"))
        assert len(packet["files"]) == 2
        response = await client.get(base + f"/packets/outgoing/{letter['id']}/zip", headers=author)
        assert response.status_code == 200, response.text
        with ZipFile(BytesIO(response.content)) as bundle:
            assert len(bundle.namelist()) == 2
        pdf = next(item for item in packet["files"] if item["source"] == "packet")
        response = await client.get(
            base + f"/agent/packets/outgoing/{letter['id']}/files/{pdf['id']}",
            headers=telegram("910002"),
        )
        assert hashlib.sha256(response.content).hexdigest() == hashlib.sha256(signed).hexdigest()
        await action("release_delivery", telegram("910002"))
        await action("send", author, 403)
        await action("send", telegram("910004"))
        send_job = (await call("POST", "/agent/jobs/claim?agentId=referent-test"))["job"]
        assert send_job["kind"] == "send" and send_job["signedFile"]["sha256"] == pdf["sha256"]
        # A crash after a possible external click must not silently queue a retry.
        async with engine.begin() as connection:
            await connection.execute(
                update(ai_referent_delivery_commands)
                .where(ai_referent_delivery_commands.c.id == UUID(send_job["id"]))
                .values(lease_until=datetime.now(UTC) - timedelta(seconds=1))
            )
        assert (await call("POST", "/agent/jobs/claim?agentId=referent-test"))["job"] is None
        letter = await call("GET", path, admin)
        assert letter["status"] == "delivery_unknown"
        await action("retry_delivery", telegram("910002"), 409)
        await action("confirm_sent", admin, 422)
        await action("confirm_sent", admin, comment="Verified in the external sent mailbox")
        assert letter["status"] == "sent" and letter["sentAt"]
        async with engine.connect() as connection:
            alerts = (
                (
                    await connection.execute(
                        select(workspace_notifications).where(
                            workspace_notifications.c.entity_id == UUID(letter["id"]),
                            workspace_notifications.c.section == "ai_referent",
                        )
                    )
                )
                .mappings()
                .all()
            )
        assert any("Please correct" in row["body"] for row in alerts)
        assert any(row["user_id"] == users["dilshod"]["id"] for row in alerts)
        # Archived copies remain downloadable, without exposing Windows filesystem paths.
        archive_id = archive["id"]
        await call(
            "PUT",
            f"/agent/files/archive/{archive_id}",
            content=b"archive content",
            params={"agentId": "referent-test", "name": "attachments/document.txt"},
        )
        await call(
            "PUT",
            f"/agent/files/archive/{archive_id}",
            expected=422,
            content=b"bad",
            params={"agentId": "referent-test", "name": "../private.txt"},
        )
        archived = await call("GET", "/archive?query=Archived", author)
        assert any(item["id"] == archive_id for item in archived["letters"])
        assert (await call("GET", f"/packets/archive/{archive_id}", author))["files"]
        await call("DELETE", "/telegram-link", author, 204)
        await call("GET", "/agent/letters", telegram("910003"), 403)
    async with engine.begin() as connection:
        await connection.execute(delete(ai_referent_telegram_links))
        await connection.execute(
            delete(ai_referent_letters).where(ai_referent_letters.c.id == UUID(letter["id"]))
        )
    await engine.dispose()
