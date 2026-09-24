# ruff: noqa: RUF001
"""The shared outgoing-letter register over HTTP."""

import os
from io import BytesIO
from uuid import UUID
from zipfile import ZipFile

import pytest
from httpx import ASGITransport, AsyncClient
from pydantic import SecretStr
from sqlalchemy import delete, update
from sqlalchemy.ext.asyncio import create_async_engine

from test_zoom_postgres import zoom_settings
from yuksalish_api.auth import issue_access_token
from yuksalish_api.main import create_app
from yuksalish_api.repository import find_active_user_by_username
from yuksalish_api.tables import (
    ai_referent_agents,
    ai_referent_delivery_commands,
    ai_referent_events,
    ai_referent_incoming_letters,
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
    settings.ai_referent_agent_token = SecretStr("test-referent-agent-token")
    app = create_app(settings)
    async with (
        app.router.lifespan_context(app),
        AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client,
    ):
        auth_engine = create_async_engine(database_url)
        async with auth_engine.connect() as connection:
            records = {
                username: await find_active_user_by_username(connection, username)
                for username in ("dilshod", "aziza", "baxtiyor", "malika")
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
        administrator = headers("malika")
        ready = await client.post(
            "/api/v1/ai-referent/agent/ready?agentId=referent-test",
            headers={"X-AI-Referent-Agent-Token": "test-referent-agent-token"},
        )
        assert ready.status_code == 204, ready.text
        configuration = (
            await client.get(
                "/api/v1/ai-referent/configuration",
                headers=administrator,
            )
        ).json()
        configured = await client.put(
            "/api/v1/ai-referent/configuration",
            headers=administrator,
            json={
                "expectedRevision": configuration["revision"],
                "reviewers": [
                    {
                        "key": key,
                        "username": "aziza" if key == "askar" else "",
                        "enabled": key == "askar",
                    }
                    for key in ("askar", "bobur", "umid", "davronbek")
                ],
            },
        )
        assert configured.status_code == 200, configured.text
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
            headers={
                **author,
                "Content-Type": (
                    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                ),
            },
            params={"fileName": "letter.docx", "documentRole": "primary"},
            content=b"PK outgoing letter test fixture",
        )
        assert uploaded.status_code == 201, uploaded.text

        current = await client.get(f"/api/v1/ai-referent/letters/{letter['id']}", headers=author)
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
        assert letter["status"] == "queued"
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
        # Final approval already enqueued preparation; an old button cannot enqueue it twice.
        assert queued.status_code == 409, queued.text

        registry = await client.get("/api/v1/ai-referent/letters", headers=author)
        assert registry.status_code == 200
        assert registry.json()["totalCount"] == 1
        assert registry.json()["readyCount"] == 1

        invalid_reviewer = await client.post(
            "/api/v1/ai-referent/letters",
            headers=author,
            json={
                "subject": "Письмо с недоступным согласующим",
                "recipientOrganization": "Адресат",
                "route": "webmail",
                "reviewerUserId": "00000000-0000-0000-0000-000000000001",
            },
        )
        assert invalid_reviewer.status_code == 422

        editable = await client.post(
            "/api/v1/ai-referent/letters",
            headers=author,
            json={
                "subject": "  Черновик для доработки  ",
                "recipientOrganization": "  Второй адресат  ",
                "recipientAddress": "  Приёмная  ",
                "route": "webmail",
                "note": "  Черновая заметка  ",
            },
        )
        assert editable.status_code == 201, editable.text
        editable_letter = editable.json()
        assert editable_letter["subject"] == "Черновик для доработки"

        hidden = await client.get(
            f"/api/v1/ai-referent/letters/{editable_letter['id']}",
            headers=another_manager,
        )
        assert hidden.status_code == 404

        submit_without_reviewer = await client.post(
            f"/api/v1/ai-referent/letters/{editable_letter['id']}/actions",
            headers=author,
            json={
                "action": "submit",
                "comment": "",
                "expectedRevision": editable_letter["revision"],
            },
        )
        assert submit_without_reviewer.status_code == 422

        patched = await client.patch(
            f"/api/v1/ai-referent/letters/{editable_letter['id']}",
            headers=author,
            json={
                "subject": "Обновлённый черновик",
                "recipientOrganization": "Второй адресат",
                "recipientAddress": "Приёмная",
                "route": "webmail",
                "note": "Готово к проверке",
                "reviewerUserId": people["aziza"],
                "expectedRevision": editable_letter["revision"],
            },
        )
        assert patched.status_code == 200, patched.text
        editable_letter = patched.json()
        assert editable_letter["revision"] == 2

        stale_patch = await client.patch(
            f"/api/v1/ai-referent/letters/{editable_letter['id']}",
            headers=author,
            json={
                "subject": "Устаревшая версия",
                "recipientOrganization": "Второй адресат",
                "recipientAddress": "",
                "route": "webmail",
                "note": "",
                "reviewerUserId": people["aziza"],
                "expectedRevision": 1,
            },
        )
        assert stale_patch.status_code == 409

        forbidden_patch = await client.patch(
            f"/api/v1/ai-referent/letters/{editable_letter['id']}",
            headers=another_manager,
            json={
                "subject": "Чужое изменение",
                "recipientOrganization": "Второй адресат",
                "recipientAddress": "",
                "route": "webmail",
                "note": "",
                "reviewerUserId": people["aziza"],
                "expectedRevision": editable_letter["revision"],
            },
        )
        assert forbidden_patch.status_code == 403

        submit_without_file = await client.post(
            f"/api/v1/ai-referent/letters/{editable_letter['id']}/actions",
            headers=author,
            json={
                "action": "submit",
                "comment": "",
                "expectedRevision": editable_letter["revision"],
            },
        )
        assert submit_without_file.status_code == 422

        second_upload = await client.put(
            f"/api/v1/attachments/ai_referent_letter/{editable_letter['id']}",
            headers={**author, "Content-Type": "application/pdf"},
            params={"fileName": "revised-letter.docx", "documentRole": "primary"},
            content=b"%PDF-1.4 revised outgoing letter",
        )
        assert second_upload.status_code == 201, second_upload.text
        editable_letter = (
            await client.get(
                f"/api/v1/ai-referent/letters/{editable_letter['id']}",
                headers=author,
            )
        ).json()

        second_submit = await client.post(
            f"/api/v1/ai-referent/letters/{editable_letter['id']}/actions",
            headers=author,
            json={
                "action": "submit",
                "comment": "На согласование",
                "expectedRevision": editable_letter["revision"],
            },
        )
        assert second_submit.status_code == 200, second_submit.text
        editable_letter = second_submit.json()

        short_return = await client.post(
            f"/api/v1/ai-referent/letters/{editable_letter['id']}/actions",
            headers=reviewer,
            json={
                "action": "return_for_revision",
                "comment": "x",
                "expectedRevision": editable_letter["revision"],
            },
        )
        assert short_return.status_code == 422

        returned = await client.post(
            f"/api/v1/ai-referent/letters/{editable_letter['id']}/actions",
            headers=reviewer,
            json={
                "action": "return_for_revision",
                "comment": "Уточните адрес получателя",
                "expectedRevision": editable_letter["revision"],
            },
        )
        assert returned.status_code == 200, returned.text
        editable_letter = returned.json()
        assert editable_letter["status"] == "needs_revision"

        admin_patch = await client.patch(
            f"/api/v1/ai-referent/letters/{editable_letter['id']}",
            headers=administrator,
            json={
                "subject": "Исправленное письмо",
                "recipientOrganization": "Второй адресат",
                "recipientAddress": "Канцелярия",
                "route": "webmail",
                "note": "Адрес уточнён",
                "reviewerUserId": people["aziza"],
                "expectedRevision": editable_letter["revision"],
            },
        )
        assert admin_patch.status_code == 200, admin_patch.text
        editable_letter = admin_patch.json()

        resubmitted = await client.post(
            f"/api/v1/ai-referent/letters/{editable_letter['id']}/actions",
            headers=author,
            json={
                "action": "submit",
                "comment": "Исправлено",
                "expectedRevision": editable_letter["revision"],
            },
        )
        assert resubmitted.status_code == 200, resubmitted.text
        editable_letter = resubmitted.json()

        second_approved = await client.post(
            f"/api/v1/ai-referent/letters/{editable_letter['id']}/actions",
            headers=administrator,
            json={
                "action": "approve",
                "comment": "Проверено администратором",
                "expectedRevision": editable_letter["revision"],
            },
        )
        assert second_approved.status_code == 200, second_approved.text
        editable_letter = second_approved.json()

        approve_again = await client.post(
            f"/api/v1/ai-referent/letters/{editable_letter['id']}/actions",
            headers=reviewer,
            json={
                "action": "approve",
                "comment": "Повтор",
                "expectedRevision": editable_letter["revision"],
            },
        )
        assert approve_again.status_code == 409

        second_queued = await client.post(
            f"/api/v1/ai-referent/letters/{editable_letter['id']}/actions",
            headers=reviewer,
            json={
                "action": "queue_delivery",
                "comment": "Отправить",
                "expectedRevision": editable_letter["revision"],
            },
        )
        assert second_queued.status_code == 409, second_queued.text

        queue_again = await client.post(
            f"/api/v1/ai-referent/letters/{editable_letter['id']}/actions",
            headers=reviewer,
            json={
                "action": "queue_delivery",
                "comment": "Повтор",
                "expectedRevision": editable_letter["revision"],
            },
        )
        assert queue_again.status_code == 409

        state_engine = create_async_engine(database_url)
        async with state_engine.begin() as connection:
            await connection.execute(
                update(ai_referent_letters)
                .where(ai_referent_letters.c.id == UUID(editable_letter["id"]))
                .values(status="failed", revision=editable_letter["revision"] + 1)
            )
        await state_engine.dispose()

        failed_letter = await client.get(
            f"/api/v1/ai-referent/letters/{editable_letter['id']}", headers=reviewer
        )
        assert failed_letter.status_code == 200
        editable_letter = failed_letter.json()
        assert "retry_delivery" in editable_letter["availableActions"]
        retried = await client.post(
            f"/api/v1/ai-referent/letters/{editable_letter['id']}/actions",
            headers=reviewer,
            json={
                "action": "retry_delivery",
                "comment": "Повторить отправку",
                "expectedRevision": editable_letter["revision"],
            },
        )
        assert retried.status_code == 200, retried.text
        assert retried.json()["status"] == "queued"

        cancellable = await client.post(
            "/api/v1/ai-referent/letters",
            headers=author,
            json={
                "subject": "Отменяемое письмо",
                "recipientOrganization": "Третий адресат",
                "route": "exat",
                "reviewerUserId": people["aziza"],
            },
        )
        assert cancellable.status_code == 201, cancellable.text
        cancelled_letter = cancellable.json()

        forbidden_cancel = await client.post(
            f"/api/v1/ai-referent/letters/{cancelled_letter['id']}/actions",
            headers=another_manager,
            json={
                "action": "cancel",
                "comment": "",
                "expectedRevision": cancelled_letter["revision"],
            },
        )
        assert forbidden_cancel.status_code == 403

        cancelled = await client.post(
            f"/api/v1/ai-referent/letters/{cancelled_letter['id']}/actions",
            headers=author,
            json={
                "action": "cancel",
                "comment": "Больше не требуется",
                "expectedRevision": cancelled_letter["revision"],
            },
        )
        assert cancelled.status_code == 200, cancelled.text
        cancelled_letter = cancelled.json()
        assert cancelled_letter["status"] == "cancelled"

        cancel_again = await client.post(
            f"/api/v1/ai-referent/letters/{cancelled_letter['id']}/actions",
            headers=author,
            json={
                "action": "cancel",
                "comment": "Повтор",
                "expectedRevision": cancelled_letter["revision"],
            },
        )
        assert cancel_again.status_code == 403

        filtered = await client.get(
            "/api/v1/ai-referent/letters",
            headers=administrator,
            params={"query": "Отменяемое", "status": "cancelled"},
        )
        assert filtered.status_code == 200
        assert filtered.json()["totalCount"] == 1

        missing = await client.get(
            "/api/v1/ai-referent/letters/00000000-0000-0000-0000-000000000002",
            headers=administrator,
        )
        assert missing.status_code == 404


@pytest.mark.anyio
@pytest.mark.postgres
async def test_ai_referent_agent_syncs_incoming_registry_and_excel_journal() -> None:
    database_url = os.environ.get("YUKSALISH_TEST_DATABASE_URL")
    if not database_url:
        pytest.skip("YUKSALISH_TEST_DATABASE_URL is not configured")
    engine = create_async_engine(database_url)
    async with engine.begin() as connection:
        await connection.execute(delete(ai_referent_incoming_letters))
        await connection.execute(delete(ai_referent_agents))
    await engine.dispose()

    settings = zoom_settings(database_url)
    settings.seed_demo_data = True
    settings.ai_referent_agent_token = SecretStr("robot-secret")
    app = create_app(settings)
    async with (
        app.router.lifespan_context(app),
        AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client,
    ):
        auth_engine = create_async_engine(database_url)
        async with auth_engine.connect() as connection:
            administrator = await find_active_user_by_username(connection, "malika")
        await auth_engine.dispose()
        assert administrator is not None
        access_token = issue_access_token(administrator["id"], settings.auth_signing_key)
        admin_headers = {"Authorization": f"Bearer {access_token}"}
        sync_payload = {
            "agentId": "referent-pc",
            "agentName": "ПК референта",
            "letters": [
                {
                    "externalId": "42",
                    "sequenceNumber": "000042",
                    "platformIncomingNumber": "0042/26/AI",
                    "senderLetterNumber": "17-04/88",
                    "receivedAt": "2026-09-22T06:20:00Z",
                    "processedAt": "2026-09-22T06:22:00Z",
                    "registeredAt": "2026-09-22T06:25:00Z",
                    "senderOrganization": "Тестовая организация",
                    "senderPerson": "Канцелярия",
                    "subject": "Письмо о рабочей встрече",
                    "responsibleExternalId": "bobur",
                    "responsibleDisplayName": "Бобур",
                    "urgency": "normal",
                    "hasAttachments": True,
                    "attachmentsCount": 2,
                    "mainDocumentFilename": "letter.pdf",
                    "platformRecordId": "platform-42",
                    "status": "platform_submitted",
                    "source": "exat",
                }
            ],
        }
        unauthorized = await client.post(
            "/api/v1/ai-referent/agent/incoming:sync", json=sync_payload
        )
        assert unauthorized.status_code == 401

        agent_headers = {"X-AI-Referent-Agent-Token": "robot-secret"}
        created = await client.post(
            "/api/v1/ai-referent/agent/incoming:sync",
            headers=agent_headers,
            json=sync_payload,
        )
        assert created.status_code == 200, created.text
        assert created.json()["createdCount"] == 1

        unchanged = await client.post(
            "/api/v1/ai-referent/agent/incoming:sync",
            headers=agent_headers,
            json=sync_payload,
        )
        assert unchanged.status_code == 200, unchanged.text
        assert unchanged.json()["unchangedCount"] == 1

        sync_payload["letters"][0]["status"] = "completed_with_errors"
        sync_payload["letters"][0]["errorMessage"] = "Проверить карточку на платформе"
        updated = await client.post(
            "/api/v1/ai-referent/agent/incoming:sync",
            headers=agent_headers,
            json=sync_payload,
        )
        assert updated.status_code == 200, updated.text
        assert updated.json()["updatedCount"] == 1

        journal_buffer = BytesIO()
        with ZipFile(journal_buffer, "w") as workbook:
            workbook.writestr("[Content_Types].xml", "<Types />")
            workbook.writestr("xl/workbook.xml", "<workbook />")
        journal_content = journal_buffer.getvalue()
        journal = await client.put(
            "/api/v1/ai-referent/agent/journal",
            headers={
                **agent_headers,
                "Content-Type": (
                    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                ),
            },
            params={
                "agentId": "referent-pc",
                "agentName": "ПК референта",
                "fileName": "register.xlsx",
                "updatedAt": "2026-09-22T06:30:00Z",
            },
            content=journal_content,
        )
        assert journal.status_code == 200, journal.text
        assert journal.json()["available"] is True

        registry = await client.get("/api/v1/ai-referent/incoming", headers=admin_headers)
        assert registry.status_code == 200, registry.text
        payload = registry.json()
        assert payload["totalCount"] == 1
        assert payload["attentionCount"] == 1
        assert payload["withAttachmentsCount"] == 1
        assert payload["letters"][0]["responsibleDisplayName"] == "Бобур"
        assert payload["letters"][0]["responsibleUserId"] is None
        assert payload["journal"]["fileName"] == "register.xlsx"

        downloaded = await client.get("/api/v1/ai-referent/journal/latest", headers=admin_headers)
        assert downloaded.status_code == 200
        assert downloaded.content == journal_content
