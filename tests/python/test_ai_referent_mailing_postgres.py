"""Exercise the official mailing workflow without opening an external mailbox."""

import asyncio
import os
from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

import pytest
from httpx import ASGITransport, AsyncClient
from pydantic import SecretStr
from sqlalchemy import delete, select, update

from ai_referent_test_support import pass_preflight
from test_ai_referent_admin_retry_postgres import retry_engine as retry_engine
from test_zoom_postgres import zoom_settings
from yuksalish_api.auth import issue_access_token
from yuksalish_api.main import create_app
from yuksalish_api.repository import find_active_user_by_username
from yuksalish_api.tables import (
    ai_referent_configuration,
    ai_referent_delivery_commands,
    ai_referent_letters,
    ai_referent_mailing_recipients,
    users,
)


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.mark.anyio
@pytest.mark.postgres
@pytest.mark.parametrize("reconcile", [False, True])
async def test_mailing_http_shared_approval_and_independent_delivery(retry_engine, reconcile):
    settings = zoom_settings(os.environ["YUKSALISH_TEST_DATABASE_URL"])
    settings.seed_demo_data = True
    settings.ai_referent_mailing_enabled = True
    settings.ai_referent_agent_token = SecretStr("mailing-test-agent")
    app = create_app(settings)
    agent = {"X-AI-Referent-Agent-Token": "mailing-test-agent"}
    base = "/api/v1/ai-referent"
    async with (
        app.router.lifespan_context(app),
        AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client,
    ):
        async with retry_engine.begin() as connection:
            await connection.execute(delete(ai_referent_delivery_commands))
            await connection.execute(delete(ai_referent_letters))
            await connection.execute(update(ai_referent_configuration).values(
                execution_agent_id="mailing-test",
            ))
            people = {name: await find_active_user_by_username(connection, name)
                      for name in ("dilshod", "aziza", "malika")}

        def auth(name):
            return {"Authorization": "Bearer " + issue_access_token(
                people[name]["id"], settings.auth_signing_key,
            )}

        async def call(method, path, headers=None, expected=200, **kwargs):
            response = await client.request(method, base + path, headers=headers or agent, **kwargs)
            assert response.status_code == expected, response.text
            return response.json() if response.content else None

        author, reviewer, operator = (auth(name) for name in people)
        config = await call("GET", "/configuration", operator)
        await call("PUT", "/configuration", operator, json={
            "expectedRevision": config["revision"], "reviewers": [
                {"key": key, "username": name, "enabled": bool(name), "telegramId": None}
                for key, name in [("askar", "aziza"), ("bobur", ""),
                                  ("umid", ""), ("davronbek", "")]
            ],
        })
        entries = [
            {"organization": "First office", "address": "first@exat.uz"},
            {"organization": "Second office", "address": "second@example.test"},
            {"organization": "Third office", "address": "third@exat.uz.example.test"},
        ]
        create = {
            "subject": "Synthetic mailing", "route": "exat",
            "reviewerUserId": str(people["aziza"]["id"]),
            "mailingRecipients": entries, "operationId": str(uuid4()),
        }
        settings.ai_referent_mailing_enabled = False
        await call("POST", "/letters", author, expected=409, json=create)
        settings.ai_referent_mailing_enabled = True
        await call("POST", "/letters", author, expected=422, json={
            **create, "mailingRecipients": [entries[0], {
                "organization": "Duplicate", "address": "FIRST@EXAT.UZ",
            }],
        })
        await call("POST", "/letters", author, expected=422, json={
            **create, "mailingRecipients": [entries[0], {
                "organization": "Invalid", "address": "broken@address",
            }],
        })
        drafts = await asyncio.gather(*(
            call("POST", "/letters", author, expected=201, json=create) for _ in range(2)
        ))
        letter = drafts[0]
        assert drafts[1]["id"] == letter["id"]
        assert [item["route"] for item in letter["mailingRecipients"]] == [
            "exat", "webmail", "webmail",
        ]
        path = f"/letters/{letter['id']}"
        upload = await client.put(
            f"/api/v1/attachments/ai_referent_letter/{letter['id']}", headers=author,
            params={"fileName": "mailing.docx", "documentRole": "primary"}, content=b"PK mailing",
        )
        assert upload.status_code == 201, upload.text
        await pass_preflight(client, retry_engine, letter["id"], author, "mailing-test-agent")

        async def action(name, headers, expected=200, **fields):
            current = await call("GET", path, operator)
            return await call("POST", path + "/actions", headers, expected=expected, json={
                "action": name, "expectedRevision": current["revision"],
                "operationId": str(uuid4()), "mailing": True, **fields,
            })

        async def claim(version=1):
            return (await call(
                "POST", f"/agent/jobs/claim?agentId=mailing-test&mailingVersion={version}",
            ))["job"]

        async def complete(job, outcome, expected=204, **fields):
            return await call("POST", f"/agent/jobs/{job['id']}/result", expected=expected, json={
                "agentId": "mailing-test", "leaseToken": job["leaseToken"],
                "outcome": outcome, "detail": "Synthetic external journal evidence", **fields,
            })

        await action("submit", author)
        await action("approve", reviewer, expected=403, mailing=None)
        approved = await action("approve", reviewer)
        await call("PATCH", path, author, expected=409, json={
            **create, "expectedRevision": approved["revision"], "operationId": str(uuid4()),
        })
        assert await claim(version=0) is None
        prep = await claim()
        assert prep["kind"] == "prepare" and prep["mailing"]
        await call("PUT", f"/agent/files/outgoing/{letter['id']}", params={
            "agentId": "mailing-test", "leaseToken": prep["leaseToken"], "jobId": prep["id"],
            "name": f"signed/{prep['id']}.pdf",
        }, content=b"%PDF-1.4 synthetic approved mailing")
        await complete(prep, "prepared", autoSend=True)
        assert await claim() is None
        await action("send", operator, expected=409)
        await action("release_delivery", author)
        await action("send", author, expected=403)
        before = await call("GET", path, operator)
        request = {"action": "send", "mailing": True,
                   "expectedRevision": before["revision"], "operationId": str(uuid4())}
        first = await call("POST", path + "/actions", operator, json=request)
        replay = await call("POST", path + "/actions", operator, json=request)
        assert first["revision"] == replay["revision"]
        assert await claim(version=0) is None
        job = await claim()
        assert job["route"] == "exat"
        assert job["signedFile"]["id"] == before["finalPdfFileId"]
        assert job["outgoingNumber"] == approved["outgoingNumber"]
        await complete(job, "sent")
        await complete(job, "sent")

        second = await claim()
        assert second["route"] == "webmail"
        assert second["signedFile"] == job["signedFile"]
        if reconcile:
            async with retry_engine.begin() as connection:
                await connection.execute(update(ai_referent_delivery_commands).where(
                    ai_referent_delivery_commands.c.id == UUID(second["id"]),
                ).values(lease_until=datetime.now(UTC) - timedelta(minutes=1)))
            assert await claim() is None
            await complete(second, "sent", expected=409)
            await action(
                "retry_recipient", operator, expected=409, recipientId=second["recipientId"],
            )
            await action(
                "confirm_recipient_not_sent", operator, recipientId=second["recipientId"],
                comment="Checked the external sent folder",
            )
            stopped = await action("stop_mailing", author)
            assert [item["status"] for item in stopped["mailingRecipients"]] == [
                "sent", "failed", "stopped",
            ]
            await action("retry_recipient", operator, recipientId=second["recipientId"],
                         comment="External sent folder verified")
            retried = await claim()
            assert retried["id"] != second["id"]
            assert retried["recipientId"] == second["recipientId"]
            async with retry_engine.begin() as connection:
                await connection.execute(update(users).where(
                    users.c.id == people["malika"]["id"],
                ).values(status="blocked"))
            try:
                await call("POST", f"/agent/jobs/{retried['id']}/heartbeat", expected=409, json={
                    "agentId": "mailing-test", "leaseToken": retried["leaseToken"],
                })
            finally:
                async with retry_engine.begin() as connection:
                    await connection.execute(update(users).where(
                        users.c.id == people["malika"]["id"],
                    ).values(status="active"))
            await complete(retried, "sent")
        else:
            await complete(second, "sent")
            await complete(await claim(), "sent")
        assert await claim() is None
        result = await call("GET", path, author)
        assert result["displayNumber"] == approved["displayNumber"]
        assert result["status"] == ("failed" if reconcile else "sent")
        assert [item["attempts"] for item in result["mailingRecipients"]] == (
            [1, 2, 0] if reconcile else [1, 1, 1]
        )
        async with retry_engine.begin() as connection:
            assert len((await connection.execute(
                select(ai_referent_mailing_recipients.c.id).where(
                    ai_referent_mailing_recipients.c.letter_id == UUID(letter["id"]),
                )
            )).all()) == 3
            await connection.execute(delete(ai_referent_letters).where(
                ai_referent_letters.c.id == UUID(letter["id"]),
            ))
