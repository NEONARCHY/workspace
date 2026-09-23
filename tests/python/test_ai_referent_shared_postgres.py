"""Cross-channel workflow, immutable files, fenced delivery and identity over HTTP."""

import hashlib
import os
from datetime import UTC, datetime, timedelta
from io import BytesIO
from uuid import NAMESPACE_URL, UUID, uuid4, uuid5
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
        await call("GET", "/recipients", agent, expected=401)
        await call("PUT", "/agent/recipients", author, expected=401, json={
            "agentId": "referent-test", "entries": [],
        })
        await call("PUT", "/agent/recipients", json={
            "agentId": "referent-test",
            "entries": [{"id": "ministry-1", "name": "Министерство финансов",
                         "categoryKey": "ministries", "addresses": ["FIN-01"],
                         "route": "exat", "addressBookOrganization": "Минфин"}],
        })
        recipients = await call("GET", "/recipients?query=finans", author)
        assert recipients["totalCount"] == 1
        assert recipients["entries"][0]["addresses"] == ["FIN-01"]
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
            content=data,
        )
        duplicate = await call(
            "PUT",
            "/agent" + path + "/attachment?fileName=letter.docx&role=primary",
            telegram("910003"),
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
        # Final review comments restart the original route, not just its last step.
        await action("return_for_revision", telegram("910002"), comment="Update the subject")
        assert letter["reviewerUserId"] == str(users["aziza"]["id"])
        await action("submit", author)
        await action("approve", telegram("910002"), 403)
        await action("approve", telegram("910001"))
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
        assert "Shared%20letter.zip" in response.headers["content-disposition"]
        assert letter["id"] not in response.headers["content-disposition"]
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


@pytest.mark.anyio
@pytest.mark.postgres
async def test_reassignment_failed_preparation_and_operator_delivery():
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
            accounts = {
                name: await find_active_user_by_username(connection, name)
                for name in ("dilshod", "aziza", "baxtiyor", "malika")
            }

        def auth(name):
            return {
                "Authorization": "Bearer "
                + issue_access_token(accounts[name]["id"], settings.auth_signing_key)
            }

        def tg(identity):
            return {**agent, "X-AI-Referent-Telegram-Id": identity}

        async def call(method, path, headers=None, expected=200, **kwargs):
            response = await client.request(method, base + path, headers=headers or agent, **kwargs)
            assert response.status_code == expected, response.text
            return response.json() if response.content and expected != 204 else None

        admin, author = auth("malika"), auth("dilshod")
        bindings = [
            {"key": key, "username": name, "telegramId": tid, "enabled": bool(name)}
            for key, name, tid in [
                ("askar", "aziza", "920001"),
                ("bobur", "baxtiyor", "920002"),
                ("umid", "", None),
                ("davronbek", "", None),
            ]
        ]

        async def configure():
            current = await call("GET", "/configuration", admin)
            return await call(
                "PUT",
                "/configuration",
                admin,
                json={
                    "expectedRevision": current["revision"],
                    "reviewers": bindings,
                },
            )

        await configure()
        code = await call("POST", "/telegram-link", author)
        await call(
            "POST",
            "/agent/telegram-link",
            expected=409,
            json={
                "telegramId": "920001",
                "code": code["code"],
            },
        )
        await call(
            "POST",
            "/agent/telegram-link",
            expected=204,
            json={
                "telegramId": "920003",
                "code": code["code"],
            },
        )
        # Old personal identity must not override a newly configured reviewer identity.
        code = await call("POST", "/telegram-link", auth("aziza"))
        await call(
            "POST",
            "/agent/telegram-link",
            expected=204,
            json={
                "telegramId": "920001",
                "code": code["code"],
            },
        )
        payload = {
            "subject": "Recovery scenario",
            "recipientOrganization": "Recipient",
            "recipientAddress": "office@example.test",
            "route": "webmail",
            "reviewerUserId": str(accounts["aziza"]["id"]),
            "finalReviewerUserId": str(accounts["baxtiyor"]["id"]),
            "operationId": str(uuid4()),
        }
        letter = await call("POST", "/agent/letters", tg("920003"), json=payload)
        path = f"/letters/{letter['id']}"
        edit = {
            **payload,
            "subject": "Updated recovery scenario",
            "expectedRevision": letter["revision"],
            "operationId": str(uuid4()),
        }
        letter = await call("PATCH", "/agent" + path, tg("920003"), json=edit)
        assert (await call("PATCH", "/agent" + path, tg("920003"), json=edit))[
            "revision"
        ] == letter["revision"]
        await call(
            "PATCH", "/agent" + path, tg("920003"), 409, json={**edit, "operationId": str(uuid4())}
        )
        await call("GET", f"/packets/outgoing/{uuid4()}", author, 404)
        await call("GET", f"/packets/archive/{uuid4()}", author, 404)
        await call("GET", f"/packets/journal/{uuid4()}", author, 404)
        await call(
            "PUT",
            "/agent" + path + "/attachment?fileName=source.docx&role=primary",
            tg("920003"),
            content=b"PK fixture",
        )

        async def action(name, headers=admin, expected=200, comment=""):
            current = await call("GET", path, admin)
            return await call(
                "POST",
                path + "/actions",
                headers,
                expected,
                json={
                    "action": name,
                    "expectedRevision": current["revision"],
                    "operationId": str(uuid4()),
                    "comment": comment,
                },
            )

        await action("submit", author)
        bindings[1] = {**bindings[1], "enabled": False}
        await configure()
        await action("approve", auth("aziza"), 409)
        bindings[1] = {**bindings[1], "enabled": True}
        bindings[0] = {**bindings[0], "telegramId": "920011"}
        await configure()
        await call("GET", "/agent/letters", tg("920001"), 403)
        await call("GET", "/agent/letters", tg("920011"))
        await action("approve", auth("aziza"))
        await action("approve", auth("baxtiyor"), 409)  # Archive not reconciled yet.
        await call("POST", "/agent/ready?agentId=referent-test", expected=204)
        await action("approve", auth("baxtiyor"))
        await action("queue_delivery", auth("baxtiyor"))
        await call("POST", "/agent/jobs/claim?agentId=wrong-robot", expected=409)
        job = (await call("POST", "/agent/jobs/claim?agentId=referent-test"))["job"]
        lease = {"agentId": "referent-test", "leaseToken": job["leaseToken"]}
        await call(
            "POST",
            f"/agent/jobs/{job['id']}/heartbeat",
            expected=409,
            json={**lease, "leaseToken": str(uuid4())},
        )
        await call(
            "POST",
            f"/agent/jobs/{job['id']}/result",
            expected=409,
            json={**lease, "agentId": "other-robot", "outcome": "failed"},
        )
        await call(
            "POST",
            f"/agent/jobs/{job['id']}/result",
            expected=422,
            json={**lease, "outcome": "sent", "detail": "Wrong job kind"},
        )
        await call(
            "POST",
            f"/agent/jobs/{job['id']}/result",
            expected=204,
            json={**lease, "outcome": "failed", "detail": "Conversion unavailable"},
        )
        current = await call("GET", path, admin)
        assert current["status"] == "failed" and "retry_delivery" in current["availableActions"]
        await action("return_for_revision", auth("baxtiyor"), comment="Replace source document")
        # Revisions preserve the allocated number while repeating the entire route.
        await action("submit", author)
        await action("approve", auth("aziza"))
        again = await action("approve", auth("baxtiyor"))
        assert again["displayNumber"] == current["displayNumber"]
        await action("queue_delivery", auth("baxtiyor"))
        job = (await call("POST", "/agent/jobs/claim?agentId=referent-test"))["job"]
        lease = {"agentId": "referent-test", "leaseToken": job["leaseToken"]}
        params = {**lease, "jobId": job["id"], "name": f"signed/{job['id']}.pdf"}
        await call(
            "PUT",
            f"/agent/files/outgoing/{letter['id']}",
            expected=422,
            params=params,
            content=b"not PDF",
        )
        await call(
            "PUT",
            f"/agent/files/outgoing/{uuid4()}",
            expected=403,
            params=params,
            content=b"%PDF-1.4",
        )
        await call(
            "PUT", f"/agent/files/outgoing/{letter['id']}", params=params, content=b"%PDF-1.4"
        )
        await call(
            "POST",
            f"/agent/jobs/{job['id']}/result",
            expected=204,
            json={**lease, "outcome": "prepared"},
        )
        await action("release_delivery", auth("baxtiyor"))
        await action("send")
        job = (await call("POST", "/agent/jobs/claim?agentId=referent-test"))["job"]
        lease = {"agentId": "referent-test", "leaseToken": job["leaseToken"]}
        await call(
            "POST",
            f"/agent/jobs/{job['id']}/result",
            expected=204,
            json={**lease, "outcome": "unknown", "detail": "Transport disconnected"},
        )
        await action("confirm_not_sent", comment="Verified no sent record")
        await action("send")
        job = (await call("POST", "/agent/jobs/claim?agentId=referent-test"))["job"]
        lease = {"agentId": "referent-test", "leaseToken": job["leaseToken"]}
        await call(
            "POST",
            f"/agent/jobs/{job['id']}/result",
            expected=422,
            json={**lease, "outcome": "sent"},
        )
        await call(
            "POST",
            f"/agent/jobs/{job['id']}/result",
            expected=204,
            json={**lease, "outcome": "sent", "detail": "External record verified"},
        )
        assert (await call("GET", path, author))["status"] == "sent"
        searched = await call("GET", "/letters", author, params={"query": again["displayNumber"]})
        assert searched["totalCount"] == 1 and searched["letters"][0]["id"] == letter["id"]
        # Versioned journals are shared files, not local paths exposed over HTTP.
        journal_id = uuid5(NAMESPACE_URL, "ai-journal:referent-test")
        await call(
            "PUT",
            f"/agent/files/journal/{uuid4()}",
            expected=403,
            params={"agentId": "referent-test", "name": "register.xlsx"},
            content=b"PK",
        )
        journal = await call(
            "PUT",
            f"/agent/files/journal/{journal_id}",
            params={"agentId": "referent-test", "name": "register.xlsx"},
            content=b"PK journal",
        )
        assert len((await call("GET", f"/packets/journal/{journal_id}", author))["files"]) == 1
        response = await client.get(
            base + f"/packets/journal/{journal_id}/files/{journal['id']}", headers=author
        )
        assert response.content == b"PK journal"
    await engine.dispose()
