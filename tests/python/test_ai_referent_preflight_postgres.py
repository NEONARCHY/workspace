"""Preflight fencing, private voice decisions, mandatory route and safe deletion."""

import os
from datetime import UTC, datetime, timedelta
from io import BytesIO
from uuid import uuid4
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
    ai_referent_document_checks,
    ai_referent_letters,
    audit_events,
)


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.mark.anyio
@pytest.mark.postgres
async def test_preflight_voice_and_deletion_across_shared_workflow():
    url = os.environ.get("YUKSALISH_TEST_DATABASE_URL")
    if not url:
        pytest.skip("YUKSALISH_TEST_DATABASE_URL is not configured")
    settings = zoom_settings(url)
    settings.seed_demo_data = True
    settings.ai_referent_agent_token = SecretStr("preflight-test-secret")
    engine = create_async_engine(url)
    app = create_app(settings)
    base = "/api/v1/ai-referent"
    agent = {"X-AI-Referent-Agent-Token": "preflight-test-secret"}
    async with (
        app.router.lifespan_context(app),
        AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client,
    ):
        async with engine.begin() as connection:
            await connection.execute(delete(ai_referent_delivery_commands))
            await connection.execute(delete(ai_referent_document_checks))
            await connection.execute(
                update(ai_referent_configuration).values(execution_agent_id="preflight-test")
            )
            people = {
                name: await find_active_user_by_username(connection, name)
                for name in ("dilshod", "aziza", "baxtiyor", "malika")
            }

        def auth(name):
            return {
                "Authorization": "Bearer "
                + issue_access_token(people[name]["id"], settings.auth_signing_key)
            }

        async def call(method, path, headers=None, expected=200, **kwargs):
            response = await client.request(method, base + path, headers=headers or agent, **kwargs)
            assert response.status_code == expected, response.text
            return response

        author, reviewer, _bobur, admin = [auth(name) for name in people]
        config = (await call("GET", "/configuration", admin)).json()
        await call(
            "PUT",
            "/configuration",
            admin,
            json={
                "expectedRevision": config["revision"],
                "reviewers": [
                    {"key": key, "username": name, "telegramId": None, "enabled": bool(name)}
                    for key, name in [
                        ("askar", "aziza"),
                        ("bobur", "baxtiyor"),
                        ("umid", ""),
                        ("davronbek", ""),
                    ]
                ],
            },
        )
        raw = BytesIO()
        with ZipFile(raw, "w") as archive:
            archive.writestr("word/document.xml", "<document>Preflight test</document>")
        content = raw.getvalue()
        check_path = "/document-checks?fileName=test.docx"
        await call("PUT", check_path, author, expected=422, content=b"invalid")
        check = (await call("PUT", check_path, author, content=content)).json()
        await call("GET", "/document-checks/" + check["id"], reviewer, expected=404)
        await call("POST", "/agent/document-checks/claim?agentId=wrong", expected=409)
        claimed = (
            await call("POST", "/agent/document-checks/claim?agentId=preflight-test")
        ).json()["check"]
        assert claimed["id"] == check["id"]
        lease = {"agentId": "preflight-test", "leaseToken": claimed["leaseToken"]}
        route = "/agent/document-checks/" + check["id"]
        assert (await call("GET", route + "/file", params=lease)).content == content
        await call("POST", route + "/heartbeat", json=lease)
        await call(
            "POST",
            route + "/result",
            expected=409,
            json={**lease, "leaseToken": str(uuid4()), "reviewerKeys": ["askar"]},
        )
        await call(
            "POST", route + "/result", expected=422, json={**lease, "reviewerKeys": ["unknown"]}
        )
        await call("POST", route + "/result", json={**lease, "reviewerKeys": []})
        failed = (await call("GET", "/document-checks/" + check["id"], author)).json()
        assert failed["status"] == "failed" and "IT" in failed["detail"]
        assert (await call("PUT", check_path, author, content=content)).json()[
            "status"
        ] == "pending"
        claimed = (
            await call("POST", "/agent/document-checks/claim?agentId=preflight-test")
        ).json()["check"]
        lease["leaseToken"] = claimed["leaseToken"]
        async with engine.begin() as connection:
            await connection.execute(
                update(ai_referent_document_checks)
                .where(ai_referent_document_checks.c.id == check["id"])
                .values(lease_until=datetime.now(UTC) - timedelta(seconds=1))
            )
        await call(
            "POST", route + "/result", expected=409, json={**lease, "reviewerKeys": ["askar"]}
        )
        await call("POST", "/agent/document-checks/claim?agentId=preflight-test")
        await call("PUT", check_path, author, content=content)
        claimed = (
            await call("POST", "/agent/document-checks/claim?agentId=preflight-test")
        ).json()["check"]
        lease["leaseToken"] = claimed["leaseToken"]
        for _ in range(2):
            await call(
                "POST", route + "/result", json={**lease, "reviewerKeys": ["askar", "bobur"]}
            )
        letter = (
            await call(
                "POST",
                "/letters",
                author,
                expected=201,
                json={
                    "subject": "Voice decision",
                    "recipientOrganization": "Test",
                    "route": "webmail",
                    "recipientAddress": "safe@example.test",
                    "reviewerUserId": str(people["baxtiyor"]["id"]),
                    "operationId": str(uuid4()),
                },
            )
        ).json()
        path = "/letters/" + letter["id"]
        # Shared upload uses the same content-bound check (without a second Office run).
        response = await client.put(
            f"/api/v1/attachments/ai_referent_letter/{letter['id']}",
            headers=author,
            params={"fileName": "test.docx", "documentRole": "primary"},
            content=content,
        )
        assert response.status_code in {200, 201}, response.text
        letter = (await call("GET", path, author)).json()

        async def action(name, identity, expected=200, **extra):
            nonlocal letter
            result = await call(
                "POST",
                path + "/actions",
                identity,
                expected=expected,
                json={
                    "action": name,
                    "expectedRevision": letter["revision"],
                    "operationId": str(uuid4()),
                    **extra,
                },
            )
            if expected == 200:
                letter = result.json()
            return result

        await action("submit", author, 422)  # Bobur alone is not a delivery route.
        letter = (
            await call(
                "PATCH",
                path,
                author,
                json={
                    "route": "webmail",
                    "recipientAddress": "safe@example.test",
                    "recipientOrganization": "Test",
                    "expectedRevision": letter["revision"],
                    "operationId": str(uuid4()),
                    "reviewerUserId": str(people["aziza"]["id"]),
                    "finalReviewerUserId": str(people["baxtiyor"]["id"]),
                },
            )
        ).json()
        await action("submit", author)
        voice_url = path + f"/comment-audio?expectedRevision={letter['revision']}&durationMs=2000"
        ogg = b"OggS" + b"\0" * 24 + b"OpusHead" + b"safe test bytes"
        await call(
            "PUT", voice_url, {**author, "Content-Type": "audio/ogg"}, expected=403, content=ogg
        )
        await call(
            "PUT",
            voice_url,
            {**reviewer, "Content-Type": "audio/ogg"},
            expected=422,
            content=b"bad",
        )
        audio = (
            await call("PUT", voice_url, {**reviewer, "Content-Type": "audio/ogg"}, content=ogg)
        ).json()
        audio_path = "/comment-audio/" + audio["id"]
        await call("GET", audio_path, author, expected=404)  # unpublished recording
        await action("return_for_revision", reviewer, commentAudioId=audio["id"])
        assert letter["status"] == "needs_revision"
        assert (
            next(event for event in letter["events"] if event.get("audio"))["audio"]["id"]
            == audio["id"]
        )
        assert (await call("GET", audio_path, author)).content == ogg
        await action("submit", author)
        await action("return_for_revision", reviewer, 422, commentAudioId=audio["id"])
        # A sender cannot erase an in-flight or already delivered letter.
        for status in ("queued", "sending", "sent", "delivery_unknown"):
            async with engine.begin() as connection:
                await connection.execute(
                    update(ai_referent_letters)
                    .where(ai_referent_letters.c.id == letter["id"])
                    .values(status=status)
                )
            await call(
                "DELETE", path + f"?expectedRevision={letter['revision']}", author, expected=409
            )
        async with engine.begin() as connection:
            await connection.execute(
                update(ai_referent_letters)
                .where(ai_referent_letters.c.id == letter["id"])
                .values(status="needs_revision")
            )
        await call(
            "DELETE", path + f"?expectedRevision={letter['revision']}", reviewer, expected=403
        )
        await call("DELETE", path + f"?expectedRevision={letter['revision']}", author)
        await call("GET", path, author, expected=404)
        await call("GET", audio_path, author, expected=404)
        async with engine.connect() as connection:
            assert await connection.scalar(
                select(audit_events.c.id).where(
                    audit_events.c.target_id == letter["id"],
                    audit_events.c.action == "ai_referent.delete",
                )
            )
    await engine.dispose()


@pytest.mark.anyio
@pytest.mark.postgres
async def test_numbered_deletion_waits_for_robot_and_accepts_identical_receipt():
    url = os.environ.get("YUKSALISH_TEST_DATABASE_URL")
    if not url:
        pytest.skip("YUKSALISH_TEST_DATABASE_URL is not configured")
    settings = zoom_settings(url)
    settings.seed_demo_data = True
    settings.ai_referent_agent_token = SecretStr("delete-test-secret")
    engine = create_async_engine(url)
    app = create_app(settings)
    base = "/api/v1/ai-referent"
    agent = {"X-AI-Referent-Agent-Token": "delete-test-secret"}
    async with (
        app.router.lifespan_context(app),
        AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client,
    ):
        async with engine.begin() as connection:
            await connection.execute(delete(ai_referent_delivery_commands))
            await connection.execute(
                update(ai_referent_configuration).values(execution_agent_id="delete-test")
            )
            author = await find_active_user_by_username(connection, "dilshod")
        auth = {
            "Authorization": "Bearer "
            + issue_access_token(author["id"], settings.auth_signing_key)
        }
        response = await client.post(
            base + "/letters", headers=auth,
            json={"subject": "Withdrawal test", "route": "webmail",
                  "recipientOrganization": "Test", "recipientAddress": "safe@example.test",
                  "operationId": str(uuid4())},
        )
        assert response.status_code == 201, response.text
        letter = response.json()
        async with engine.begin() as connection:
            await connection.execute(
                update(ai_referent_letters)
                .where(ai_referent_letters.c.id == letter["id"])
                .values(
                    outgoing_number=1000000 + uuid4().int % 1000000000,
                    year_suffix="26", status="needs_revision",
                )
            )
        path = base + "/letters/" + letter["id"]
        response = await client.delete(
            path, headers=auth, params={"expectedRevision": letter["revision"]}
        )
        assert response.status_code == 200, response.text
        assert response.json()["queued"] is True
        assert (await client.get(path, headers=auth)).json()["status"] == "queued"
        job = (await client.post(
            base + "/agent/jobs/claim?agentId=delete-test", headers=agent
        )).json()["job"]
        assert job["kind"] == "delete"
        receipt = {
            "agentId": "delete-test", "leaseToken": job["leaseToken"], "outcome": "deleted"
        }
        result_path = base + "/agent/jobs/" + job["id"] + "/result"
        for _ in range(2):
            response = await client.post(result_path, headers=agent, json=receipt)
            assert response.status_code == 204, response.text
        assert (await client.get(path, headers=auth)).status_code == 404
        for wrong in (
            {**receipt, "leaseToken": str(uuid4())},
            {**receipt, "agentId": "another-robot"},
            {**receipt, "outcome": "sent", "detail": "This must never be accepted"},
        ):
            assert (await client.post(
                result_path, headers=agent, json=wrong
            )).status_code == 409
    await engine.dispose()
