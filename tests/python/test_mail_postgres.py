"""Real transactions and object boundaries with a synthetic Google HTTP endpoint."""

import asyncio
import base64
import os
from contextlib import asynccontextmanager
from datetime import UTC, datetime, timedelta
from urllib.parse import parse_qs, urlsplit
from uuid import UUID, uuid4

import httpx
import pytest
from sqlalchemy import delete, func, insert, select, update
from sqlalchemy.ext.asyncio import create_async_engine

from test_mail_transport import mail_settings, raw_message
from yuksalish_api import mail_connection_service as connections
from yuksalish_api import mail_delivery, mail_service, mail_task_service
from yuksalish_api.auth import AuthenticatedUser
from yuksalish_api.errors import WorkspaceRepositoryError
from yuksalish_api.gmail_client import GMAIL_SCOPES, GmailClient
from yuksalish_api.mail_schemas import MailDraftWrite, MailSend, MailTaskExport
from yuksalish_api.mail_tables import (
    mail_accounts,
    mail_drafts,
    mail_files,
    mail_oauth_requests,
    mail_task_exports,
)
from yuksalish_api.object_storage import InMemoryObjectStorage
from yuksalish_api.repository import delete_task
from yuksalish_api.seed import seed_demo_data
from yuksalish_api.tables import (
    audit_events,
    module_access_rules,
    tasks,
    users,
    workspace_notifications,
)


class Provider:
    def __init__(self):
        self.email = f"{uuid4().hex}@gmail.com"
        self.send_mode = "ok"
        self.send_count = 0
        self.raw_sent = b""
        self.reconcile_id = "<source@example.com>"
        self.reconcile_found = False

    def handle(self, request):
        path = request.url.path
        if path == "/token":
            return httpx.Response(
                200,
                json={
                    "access_token": "test-access",
                    "refresh_token": "test-refresh",
                    "scope": " ".join(GMAIL_SCOPES),
                    "expires_in": 3600,
                },
            )
        if path.endswith("/profile"):
            return httpx.Response(200, json={"emailAddress": self.email})
        if path == "/revoke":
            return httpx.Response(200)
        if path.endswith("/messages/send"):
            self.send_count += 1
            import json

            self.raw_sent = base64.urlsafe_b64decode(json.loads(request.content)["raw"])
            if self.send_mode == "unknown":
                raise httpx.ReadTimeout("synthetic unknown delivery", request=request)
            if self.send_mode == "refused":
                return httpx.Response(403, text="private provider response")
            return httpx.Response(200, json={"id": "sent-message"})
        if path.endswith("/messages"):
            return httpx.Response(
                200, json={"messages": [{"id": "m1"}] if self.reconcile_found else []}
            )
        if "/attachments/" in path:
            return httpx.Response(200, json={"data": "ZmlsZQ"})
        if "/messages/" in path:
            message = raw_message("m1")
            message["payload"]["headers"].append({"name": "Message-ID", "value": self.reconcile_id})
            message["payload"]["parts"] = [
                {
                    "filename": "source.txt",
                    "mimeType": "text/plain",
                    "body": {"attachmentId": "file-1", "size": 4},
                }
            ]
            return httpx.Response(200, json=message)
        raise AssertionError(path)


@asynccontextmanager
async def scenario():
    url = os.environ.get("YUKSALISH_TEST_DATABASE_URL")
    if not url:
        pytest.skip("YUKSALISH_TEST_DATABASE_URL is not configured")
    engine = create_async_engine(url)
    await seed_demo_data(engine)
    settings = mail_settings(database_url=url, gmail_sending_enabled=True)
    provider = Provider()
    actors = []
    async with httpx.AsyncClient(transport=httpx.MockTransport(provider.handle)) as http:
        client = GmailClient(settings, http)
        async with engine.connect() as connection:
            try:
                for role in ("employee", "employee", "superadmin"):
                    identifier = uuid4()
                    username = f"mail-{identifier.hex[:12]}"
                    await connection.execute(
                        insert(users).values(
                            id=identifier,
                            username=username,
                            full_name="Mail Test",
                            role=role,
                            status="active",
                            created_at=datetime.now(UTC),
                            updated_at=datetime.now(UTC),
                        )
                    )
                    actors.append(
                        AuthenticatedUser(
                            id=identifier,
                            username=username,
                            full_name="Mail Test",
                            role=role,
                            position_id=None,
                            job_title=None,
                        )
                    )
                await connection.commit()
                yield connection, engine, settings, provider, client, actors
            finally:
                await connection.rollback()
                ids = [item.id for item in actors]
                owned = (
                    (
                        await connection.execute(
                            select(tasks.c.id).where(tasks.c.author_user_id.in_(ids))
                        )
                    )
                    .scalars()
                    .all()
                )
                if actors:
                    for task_id in owned:
                        await delete_task(connection, actors[-1], task_id)
                await connection.execute(
                    delete(mail_accounts).where(mail_accounts.c.owner_user_id.in_(ids))
                )
                await connection.execute(
                    delete(mail_oauth_requests).where(mail_oauth_requests.c.owner_user_id.in_(ids))
                )
                await connection.execute(
                    delete(mail_task_exports).where(mail_task_exports.c.owner_user_id.in_(ids))
                )
                await connection.execute(
                    delete(module_access_rules).where(
                        module_access_rules.c.subject_type == "user",
                        module_access_rules.c.subject_key.in_([str(item) for item in ids]),
                    )
                )
                await connection.execute(
                    delete(workspace_notifications).where(
                        workspace_notifications.c.user_id.in_(ids)
                    )
                )
                await connection.execute(
                    delete(audit_events).where(audit_events.c.actor_user_id.in_(ids))
                )
                await connection.execute(delete(users).where(users.c.id.in_(ids)))
                await connection.commit()
    await engine.dispose()


async def connect(connection, actor, settings, client, provider):
    provider.email = f"{actor.id.hex}@gmail.com"
    started = await connections.start_oauth(connection, actor, settings, client)
    await connection.commit()
    state = parse_qs(urlsplit(started.authorization_url).query)["state"][0]
    await connections.complete_oauth(
        connection, settings, client, state=state, code="test-code", denied=False
    )
    return started, state


def draft(**changes):
    return MailDraftWrite.model_validate(
        {
            "requestId": str(uuid4()),
            "to": ["recipient@example.com"],
            "subject": "Reviewed subject",
            "body": "Private draft body",
            **changes,
        }
    )


def test_mail_oauth_state_single_use_owner_binding_expiry_and_disconnect():
    async def check():
        async with scenario() as (connection, _, settings, _, client, actors):
            actor, other, _ = actors
            provider = Provider()
            # The client above is bound to its own provider; only identity uniqueness matters.
            started = await connections.start_oauth(connection, actor, settings, client)
            await connection.commit()
            state = parse_qs(urlsplit(started.authorization_url).query)["state"][0]
            with pytest.raises(WorkspaceRepositoryError):
                await connections.oauth_status(connection, other, UUID(started.request_id))
            await connection.rollback()
            with pytest.raises(WorkspaceRepositoryError):
                await connections.complete_oauth(
                    connection, settings, client, state="wrong" * 10, code="test-code", denied=False
                )
            await connection.rollback()
            await connections.complete_oauth(
                connection, settings, client, state=state, code="test-code", denied=False
            )
            assert (await connections.connection_info(connection, actor, settings)).email
            assert not (await connections.connection_info(connection, other, settings)).email
            row = (
                (
                    await connection.execute(
                        select(mail_accounts).where(mail_accounts.c.owner_user_id == actor.id)
                    )
                )
                .mappings()
                .one()
            )
            assert "test-refresh" not in row["refresh_cipher"]
            with pytest.raises(WorkspaceRepositoryError):
                await connections.complete_oauth(
                    connection, settings, client, state=state, code="test-code", denied=False
                )
            await connection.rollback()
            later = await connections.start_oauth(connection, actor, settings, client)
            await connection.execute(
                update(mail_oauth_requests)
                .where(mail_oauth_requests.c.id == UUID(later.request_id))
                .values(expires_at=datetime.now(UTC) - timedelta(seconds=1))
            )
            await connection.commit()
            assert (
                await connections.oauth_status(connection, actor, UUID(later.request_id))
            ).status == "expired"
            assert await connections.disconnect(connection, actor, settings, client)
            assert not (await connections.connection_info(connection, actor, settings)).account_id
            assert provider.send_count == 0

    asyncio.run(check())


def test_mail_drafts_files_and_administrators_have_no_cross_owner_access():
    async def check():
        async with scenario() as (connection, _, settings, provider, client, actors):
            actor, other, admin = actors
            for item in actors:
                await connect(connection, item, settings, client, provider)
            created = draft(replyMessageId="m1")
            saved = await mail_service.save_draft(connection, actor, settings, client, created)
            await connection.commit()
            assert saved.reply_message_id == "m1"
            assert (
                await mail_service.save_draft(connection, actor, settings, client, created)
            ).id == saved.id
            stored = (
                (
                    await connection.execute(
                        select(mail_drafts).where(mail_drafts.c.id == UUID(saved.id))
                    )
                )
                .mappings()
                .one()
            )
            assert "Private draft body" not in stored["payload_cipher"]
            for denied in (other, admin):
                with pytest.raises(WorkspaceRepositoryError, match="Черновик не найден"):
                    await mail_service.get_draft(connection, denied, settings, UUID(saved.id))
            saved = await mail_service.add_file(
                connection,
                actor,
                settings,
                UUID(saved.id),
                saved.revision,
                "notes.txt",
                "text/plain",
                b"private file",
            )
            await connection.commit()
            file_id = UUID(saved.attachments[0].id)
            raw_file = (
                (await connection.execute(select(mail_files).where(mail_files.c.id == file_id)))
                .mappings()
                .one()
            )
            assert b"private file" not in raw_file["content_cipher"]
            assert (await mail_service.read_file(connection, actor, settings, file_id))[
                1
            ] == b"private file"
            with pytest.raises(WorkspaceRepositoryError):
                await mail_service.read_file(connection, admin, settings, file_id)
            with pytest.raises(WorkspaceRepositoryError, match="изменилось"):
                await mail_service.add_file(
                    connection, actor, settings, UUID(saved.id), 1, "second.txt", "text/plain", b"x"
                )
            saved = await mail_service.remove_file(
                connection, actor, settings, UUID(saved.id), file_id, saved.revision
            )
            assert not saved.attachments
            await connection.commit()
            await connections.disconnect(connection, actor, settings, client)
            assert not await connection.scalar(
                select(func.count())
                .select_from(mail_drafts)
                .where(mail_drafts.c.owner_user_id == actor.id)
            )

    asyncio.run(check())


@pytest.mark.parametrize("mode", ["ok", "refused", "unknown"])
def test_mail_queue_is_frozen_single_send_and_unknown_can_only_be_reconciled(mode):
    async def check():
        async with scenario() as (connection, engine, settings, provider, client, actors):
            actor = actors[0]
            await connect(connection, actor, settings, client, provider)
            saved = await mail_service.save_draft(connection, actor, settings, client, draft())
            await connection.commit()
            action = MailSend(expected_revision=saved.revision, operation_id=uuid4())
            queued = await mail_delivery.queue_send(
                connection, actor, settings, UUID(saved.id), action
            )
            await connection.commit()
            assert queued.status == "queued"
            assert (
                await mail_delivery.queue_send(connection, actor, settings, UUID(saved.id), action)
            ).status == "queued"
            await connection.commit()
            with pytest.raises(WorkspaceRepositoryError):
                await mail_service.add_file(
                    connection,
                    actor,
                    settings,
                    UUID(saved.id),
                    queued.revision,
                    "late.txt",
                    "text/plain",
                    b"late",
                )
            await connection.rollback()
            provider.send_mode = mode
            assert await mail_delivery.process_one(engine, settings, client)
            result = await mail_service.get_draft(connection, actor, settings, UUID(saved.id))
            assert result.status == {"ok": "sent", "refused": "failed", "unknown": "unknown"}[mode]
            assert provider.send_count == 1
            assert b"From:" in provider.raw_sent and provider.email.encode() in provider.raw_sent
            assert not await mail_delivery.process_one(engine, settings, client)
            assert provider.send_count == 1
            if mode == "unknown":
                row = (
                    (
                        await connection.execute(
                            select(mail_drafts).where(mail_drafts.c.id == UUID(saved.id))
                        )
                    )
                    .mappings()
                    .one()
                )
                provider.reconcile_id = row["rfc_message_id"]
                result = await mail_delivery.reconcile_send(
                    connection, actor, settings, client, UUID(saved.id)
                )
                assert result.status == "unknown"
                provider.reconcile_found = True
                result = await mail_delivery.reconcile_send(
                    connection, actor, settings, client, UUID(saved.id)
                )
                assert result.status == "sent" and provider.send_count == 1
            await connection.commit()

    asyncio.run(check())


def test_mail_task_export_is_reviewed_idempotent_and_does_not_share_mailbox():
    async def check():
        async with scenario() as (connection, _, settings, provider, client, actors):
            actor, assignee, _ = actors
            await connect(connection, actor, settings, client, provider)
            storage = InMemoryObjectStorage()
            payload = MailTaskExport.model_validate(
                {
                    "operationId": str(uuid4()),
                    "messageId": "m1",
                    "attachmentIds": ["file-1"],
                    "task": {
                        "title": "Prepare reply",
                        "description": "Only selected text",
                        "assigneeId": str(assignee.id),
                        "checklist": [{"title": "Check figures"}],
                    },
                }
            )
            created = await mail_task_service.export_task(
                connection, actor, settings, client, storage, payload
            )
            repeated = await mail_task_service.export_task(
                connection, actor, settings, client, storage, payload
            )
            assert created.id == repeated.id and created.author_id == str(actor.id)
            assert (
                created.description == "Only selected text"
                and created.checklist[0].title == "Check figures"
            )
            count = await connection.scalar(
                select(func.count()).select_from(tasks).where(tasks.c.author_user_id == actor.id)
            )
            assert count == 1
            with pytest.raises(WorkspaceRepositoryError):
                await mail_task_service.export_task(
                    connection, assignee, settings, client, storage, payload
                )
            bad = payload.model_copy(
                update={"operation_id": uuid4(), "attachment_ids": ["other-message-file"]}
            )
            with pytest.raises(WorkspaceRepositoryError):
                await mail_task_service.export_task(
                    connection, actor, settings, client, storage, bad
                )

    asyncio.run(check())


def test_mail_cancel_blocks_callback_and_api_reuses_real_authentication():
    from yuksalish_api.auth import issue_access_token
    from yuksalish_api.main import create_app

    async def check():
        async with scenario() as (connection, engine, settings, _provider, client, actors):
            actor, other, _ = actors
            started = await connections.start_oauth(connection, actor, settings, client)
            await connection.commit()
            state = parse_qs(urlsplit(started.authorization_url).query)["state"][0]
            await connections.cancel_oauth(connection, actor, UUID(started.request_id))
            await connection.commit()
            with pytest.raises(WorkspaceRepositoryError):
                await connections.complete_oauth(
                    connection, settings, client, state=state, code="late", denied=False
                )
            await connection.rollback()
            assert not (await connections.connection_info(connection, actor, settings)).account_id
            app = create_app(settings)
            app.state.database_engine = engine
            app.state.gmail_client = client
            callback_queries = []

            @app.middleware("http")
            async def query_scope(request, call_next):
                response = await call_next(request)
                callback_queries.append(request.scope["query_string"])
                return response

            async with httpx.AsyncClient(
                transport=httpx.ASGITransport(app=app), base_url="https://workspace.example"
            ) as http:
                assert (await http.get("/api/v1/mail/connection")).status_code == 401
                started = await connections.start_oauth(connection, actor, settings, client)
                await connection.commit()
                state = parse_qs(urlsplit(started.authorization_url).query)["state"][0]
                response = await http.get(
                    "/api/v1/mail/oauth/callback", params={"code": "synthetic-code", "state": state}
                )
                assert response.status_code == 200 and "synthetic-code" not in response.text
                assert (
                    callback_queries[-1] == b"" and response.headers["cache-control"] == "no-store"
                )
                assert (
                    await http.get(
                        "/api/v1/mail/oauth/callback", params={"code": "again", "state": state}
                    )
                ).status_code == 400
                headers = {
                    "Authorization": "Bearer "
                    + issue_access_token(actor.id, settings.auth_signing_key)
                }
                response = await http.get("/api/v1/mail/connection", headers=headers)
                assert response.status_code == 200 and response.json()["accountId"]
                response = await http.post(
                    "/api/v1/mail/drafts",
                    headers=headers,
                    json=draft().model_dump(mode="json", by_alias=True),
                )
                assert response.status_code == 200, response.text
                draft_id = response.json()["id"]
                denied = {
                    "Authorization": "Bearer "
                    + issue_access_token(other.id, settings.auth_signing_key)
                }
                assert (
                    await http.get(f"/api/v1/mail/drafts/{draft_id}", headers=denied)
                ).status_code in {404, 409}
                assert (
                    await http.post(
                        "/api/v1/mail/messages/search",
                        json={"query": "private term"},
                        headers=headers,
                    )
                ).status_code == 200

    asyncio.run(check())


def test_mail_worker_rechecks_disabled_employee_and_recovers_crash_without_resend():
    async def check():
        async with scenario() as (connection, engine, settings, provider, client, actors):
            actor = actors[0]
            await connect(connection, actor, settings, client, provider)
            saved = await mail_service.save_draft(connection, actor, settings, client, draft())
            await mail_delivery.queue_send(
                connection,
                actor,
                settings,
                UUID(saved.id),
                MailSend(expected_revision=saved.revision, operation_id=uuid4()),
            )
            await connection.execute(
                update(users).where(users.c.id == actor.id).values(status="blocked")
            )
            await connection.commit()
            assert await mail_delivery.process_one(engine, settings, client)
            assert provider.send_count == 0
            assert (
                await mail_service.get_draft(connection, actor, settings, UUID(saved.id))
            ).status == "failed"
            await connection.execute(
                update(users).where(users.c.id == actor.id).values(status="active")
            )
            await connection.execute(
                update(mail_drafts)
                .where(mail_drafts.c.id == UUID(saved.id))
                .values(status="sending", updated_at=datetime.now(UTC) - timedelta(minutes=5))
            )
            await connection.commit()
            with pytest.raises(WorkspaceRepositoryError):
                await connections.disconnect(connection, actor, settings, client)
            await connection.rollback()
            assert not await mail_delivery.process_one(engine, settings, client)
            assert (
                await mail_service.get_draft(connection, actor, settings, UUID(saved.id))
            ).status == "unknown"
            assert provider.send_count == 0

    asyncio.run(check())


def test_mail_task_failed_storage_rolls_back_task_and_export_claim():
    from yuksalish_api.object_storage import ObjectStorageError

    class FailedStorage(InMemoryObjectStorage):
        async def put(self, key, content, content_type):
            raise ObjectStorageError("synthetic failure")

    async def check():
        async with scenario() as (connection, _, settings, provider, client, actors):
            actor, assignee, _ = actors
            await connect(connection, actor, settings, client, provider)
            payload = MailTaskExport.model_validate(
                {
                    "operationId": str(uuid4()),
                    "messageId": "m1",
                    "attachmentIds": ["file-1"],
                    "task": {"title": "Selected mail", "assigneeId": str(assignee.id)},
                }
            )
            with pytest.raises(ObjectStorageError):
                await mail_task_service.export_task(
                    connection, actor, settings, client, FailedStorage(), payload
                )
            assert (
                await connection.scalar(
                    select(func.count())
                    .select_from(tasks)
                    .where(tasks.c.author_user_id == actor.id)
                )
                == 0
            )
            assert (
                await connection.scalar(
                    select(mail_task_exports.c.id).where(
                        mail_task_exports.c.id == payload.operation_id
                    )
                )
                is None
            )
            created = await mail_task_service.export_task(
                connection, actor, settings, client, InMemoryObjectStorage(), payload
            )
            assert created.title == "Selected mail"

    asyncio.run(check())


def test_mail_signed_copy_uses_only_published_current_sign_only_pages():
    import hashlib

    from yuksalish_api.tables import ai_referent_delivery_commands as jobs
    from yuksalish_api.tables import ai_referent_files as files
    from yuksalish_api.tables import ai_referent_letters as letters

    async def check():
        async with scenario() as (connection, _, settings, provider, client, actors):
            actor, other, _ = actors
            await connect(connection, actor, settings, client, provider)
            letter, old_job, new_job, old_file, new_file = (uuid4() for _ in range(5))
            now = datetime.now(UTC)
            content = b"%PDF-1.7\nsynthetic signed bytes"
            sha = hashlib.sha256(content).hexdigest()
            storage = InMemoryObjectStorage()
            await storage.put("synthetic-signed", content, "application/pdf")
            try:
                await connection.execute(
                    insert(letters).values(
                        id=letter,
                        subject="Signed test",
                        recipient_organization="Recipient",
                        route="webmail",
                        status="signed",
                        workflow_kind="sign_only",
                        source="workspace",
                        created_by_user_id=actor.id,
                        created_at=now,
                        updated_at=now,
                    )
                )
                for job, stamp in ((old_job, now - timedelta(days=1)), (new_job, now)):
                    await connection.execute(
                        insert(jobs).values(
                            id=job,
                            letter_id=letter,
                            route="webmail",
                            status="completed",
                            kind="sign_only",
                            idempotency_key=str(job),
                            created_at=stamp,
                            updated_at=stamp,
                            completed_at=stamp,
                        )
                    )
                for file_id, job in ((old_file, old_job), (new_file, new_job)):
                    await connection.execute(
                        insert(files).values(
                            id=file_id,
                            kind="outgoing",
                            owner_id=letter,
                            relative_path=f"signed/{job}/001.pdf",
                            storage_key="synthetic-signed",
                            sha256=sha,
                            byte_size=len(content),
                            content_type="application/pdf",
                            created_at=now,
                        )
                    )
                await connection.commit()
                listed = await mail_service.signed_files(connection, actor)
                assert [item.id for item in listed] == [str(new_file)]
                assert not await mail_service.signed_files(connection, other)
                saved = await mail_service.save_draft(connection, actor, settings, client, draft())
                with pytest.raises(WorkspaceRepositoryError):
                    await mail_service.add_signed_file(
                        connection,
                        actor,
                        settings,
                        storage,
                        UUID(saved.id),
                        old_file,
                        saved.revision,
                    )
                copied = await mail_service.add_signed_file(
                    connection, actor, settings, storage, UUID(saved.id), new_file, saved.revision
                )
                assert copied.attachments[0].signed_letter_id == str(letter)
                await connection.commit()
                await connection.execute(
                    update(letters).where(letters.c.id == letter).values(status="needs_revision")
                )
                await connection.commit()
                with pytest.raises(WorkspaceRepositoryError):
                    await mail_delivery.queue_send(
                        connection,
                        actor,
                        settings,
                        UUID(saved.id),
                        MailSend(expected_revision=copied.revision, operation_id=uuid4()),
                    )
                await connection.rollback()
                assert provider.send_count == 0
            finally:
                await connection.rollback()
                await connection.execute(delete(files).where(files.c.owner_id == letter))
                await connection.execute(delete(jobs).where(jobs.c.letter_id == letter))
                await connection.execute(delete(letters).where(letters.c.id == letter))
                await connection.commit()

    asyncio.run(check())
