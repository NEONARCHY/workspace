"""Real HTTP/SQL assignment, access, snapshots, retries and the task review cycle."""

import asyncio
import os
from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import delete, func, insert, select, update
from sqlalchemy.ext.asyncio import create_async_engine

from yuksalish_api.ai_referent_files_service import store_packet_file
from yuksalish_api.ai_referent_incoming_service import sync_incoming_letters
from yuksalish_api.ai_referent_schemas import (
    AIReferentIncomingSyncItem,
    AIReferentIncomingSyncRequest,
)
from yuksalish_api.auth import issue_access_token, load_authenticated_user
from yuksalish_api.events import WorkspaceEventBus
from yuksalish_api.incoming_document_tables import incoming_document_executions as executions
from yuksalish_api.main import create_app
from yuksalish_api.object_storage import InMemoryObjectStorage, ObjectStorageError
from yuksalish_api.repository import delete_task
from yuksalish_api.settings import Settings
from yuksalish_api.tables import (
    ai_referent_agents,
    ai_referent_files,
    attachments,
    audit_events,
    module_access_rules,
    tasks,
    users,
)
from yuksalish_api.tables import (
    ai_referent_incoming_letters as incoming,
)

pytestmark = [pytest.mark.anyio, pytest.mark.postgres]


@pytest.fixture
def anyio_backend():
    return "asyncio"


class SnapshotStorage(InMemoryObjectStorage):
    fail_copy = False

    async def copy(self, source_key: str, target_key: str) -> None:
        await super().copy(source_key, target_key)
        if self.fail_copy:
            raise ObjectStorageError("Synthetic copy failure")


@pytest.fixture
async def scenario():
    database_url = os.environ.get("YUKSALISH_TEST_DATABASE_URL")
    if not database_url:
        pytest.skip("YUKSALISH_TEST_DATABASE_URL is not configured")
    settings = Settings(environment="test", database_url=database_url, seed_demo_data=False)
    engine = create_async_engine(database_url)
    app = create_app(settings)
    app.state.database_engine = engine
    app.state.event_bus = WorkspaceEventBus()
    storage = SnapshotStorage()
    app.state.object_storage = storage
    ids = {name: uuid4() for name in ("author", "assignee", "co", "stranger")}
    agent = f"documents-{uuid4().hex}"
    source_id = uuid4()
    now = datetime.now(UTC)
    async with engine.begin() as connection:
        await connection.execute(insert(users), [{
            "id": user_id, "username": f"doc-{user_id.hex}", "full_name": f"Document QA {name}",
            "job_title": "QA", "role": "admin" if name == "author" else "employee",
            "status": "active", "created_at": now, "updated_at": now,
        } for name, user_id in ids.items()])
        await sync_incoming_letters(connection, AIReferentIncomingSyncRequest(
            agent_id=agent, agent_name="Document QA", letters=[AIReferentIncomingSyncItem(
                external_id=str(source_id), sequence_number="QA-1", subject="Synthetic incoming",
                sender_organization="Synthetic organization", has_attachments=True,
                attachments_count=1, status="platform_submitted", source="exat",
            )],
        ))
        source_id = await connection.scalar(select(incoming.c.id).where(
            incoming.c.agent_id == agent,
        ))
        file = await store_packet_file(connection, storage, kind="incoming", owner_id=source_id,
                                       name="original.pdf", content=b"%PDF-synthetic-original",
                                       content_type="application/pdf")
        await store_packet_file(connection, storage, kind="incoming", owner_id=source_id,
                                name="incoming-metadata.json", content=b'{"internal":true}',
                                content_type="application/json")
    def headers(name):
        token = issue_access_token(ids[name], settings.auth_signing_key)
        return {"Authorization": "Bearer " + token}

    payload = {
        "operationId": str(uuid4()), "expectedRevision": 1, "instruction": "Prepare the reply",
        "assigneeId": str(ids["assignee"]), "coAssigneeIds": [str(ids["co"])],
        "fileIds": [file["id"]],
        "dueAt": (now + timedelta(days=2)).isoformat(),
    }
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        try:
            yield client, engine, storage, ids, source_id, file, headers, payload, agent
        finally:
            async with engine.begin() as connection:
                linked = (await connection.execute(select(executions.c.task_id).where(
                    executions.c.source_id.in_(select(incoming.c.id).where(
                        incoming.c.agent_id == agent,
                    )),
                ))).scalars().all()
                await connection.execute(delete(executions).where(
                    executions.c.task_id.in_(linked),
                ))
                author = await load_authenticated_user(connection, ids["author"])
                for task_id in linked:
                    await delete_task(connection, author, task_id)
                await connection.execute(delete(ai_referent_files).where(
                    ai_referent_files.c.owner_id.in_(select(incoming.c.id).where(
                        incoming.c.agent_id == agent,
                    )),
                ))
                await connection.execute(delete(incoming).where(incoming.c.agent_id == agent))
                await connection.execute(delete(ai_referent_agents).where(
                    ai_referent_agents.c.agent_id == agent,
                ))
                await connection.execute(delete(module_access_rules).where(
                    module_access_rules.c.subject_key.in_([str(value) for value in ids.values()]),
                ))
                await connection.execute(delete(audit_events).where(
                    audit_events.c.actor_user_id.in_(ids.values()),
                ))
                await connection.execute(delete(users).where(users.c.id.in_(ids.values())))
            await engine.dispose()


async def test_document_assignment_and_full_review_cycle(scenario):
    client, engine, storage, _ids, source, file, headers, payload, agent = scenario
    path = f"/api/v1/incoming-documents/{source}"
    for name in ("assignee", "co", "stranger"):
        assert (await client.get(path, headers=headers(name))).status_code == 404
    assert (await client.post(path + "/execution", headers=headers("stranger"),
                              json=payload)).status_code == 404
    # A double submission creates exactly one task, one snapshot and one assignment audit.
    responses = await asyncio.gather(*[
        client.post(path + "/execution", headers=headers("author"), json=payload)
        for _ in range(2)
    ])
    assert [response.status_code for response in responses] == [200, 200]
    task_id = responses[0].json()["document"]["execution"]["taskId"]
    assert responses[1].json()["document"]["execution"]["taskId"] == task_id
    async with engine.begin() as connection:
        assert await connection.scalar(select(func.count()).select_from(executions).where(
            executions.c.source_id == source,
        )) == 1
        assert await connection.scalar(select(func.count()).select_from(audit_events).where(
            audit_events.c.action == "incoming_document.assigned",
            audit_events.c.target_id == source,
        )) == 1
        copies = (await connection.execute(select(attachments).where(
            attachments.c.owner_type == "task", attachments.c.owner_id == UUID(task_id),
        ))).mappings().all()
        assert len(copies) == 1
        assert await storage.get(copies[0]["storage_key"]) == b"%PDF-synthetic-original"
        assert copies[0]["storage_key"].startswith("incoming-execution/")
        # A source resync updates registration, never the task deadline or participants.
        external_id = await connection.scalar(select(incoming.c.external_id).where(
            incoming.c.id == source,
        ))
        await sync_incoming_letters(connection, AIReferentIncomingSyncRequest(
            agent_id=agent, agent_name="Document QA", letters=[AIReferentIncomingSyncItem(
                external_id=external_id, sequence_number="QA-1", subject="Updated registration",
                sender_organization="Synthetic organization", has_attachments=True,
                attachments_count=1, status="platform_submitted", source="exat",
            )],
        ))
    assert (await client.post(path + "/execution", headers=headers("author"),
                              json=payload)).status_code == 200
    changed = {**payload, "operationId": str(uuid4())}
    assert (await client.post(path + "/execution", headers=headers("author"),
                              json=changed)).status_code == 409
    for name in ("assignee", "co"):
        detail = await client.get(path, headers=headers(name))
        assert detail.status_code == 200
        assert detail.json()["document"]["execution"]["taskId"] == task_id
        assert (await client.get(path + f"/files/{file['id']}",
                                 headers=headers(name))).content == b"%PDF-synthetic-original"
    assert (await client.get(path, headers=headers("stranger"))).status_code == 404
    assert (await client.get(path + f"/files/{file['id']}",
                             headers=headers("stranger"))).status_code == 404
    task_path = f"/api/v1/tasks/{task_id}"
    report = await client.put(
        f"/api/v1/attachments/task/{task_id}", params={"fileName": "report.pdf"},
        headers={**headers("co"), "Content-Type": "application/pdf"},
        content=b"%PDF-synthetic-report",
    )
    assert report.status_code == 201, report.text
    report_path = "/api/v1/attachments/" + report.json()["id"]
    assert (await client.get(report_path, headers=headers("author"))).content == (
        b"%PDF-synthetic-report"
    )
    assert (await client.get(report_path, headers=headers("stranger"))).status_code == 404
    assert (await client.post(task_path + "/submit-result", headers=headers("co"),
                              json={"resultText": "Synthetic report"})).status_code == 200
    assert (await client.get(path, headers=headers("author"))).json()["document"][
        "execution"]["status"] == "awaiting_review"
    assert (await client.post(task_path + "/accept-result",
                              headers=headers("assignee"))).status_code == 403
    returned = await client.post(task_path + "/return-for-revision", headers=headers("author"),
                                 json={"reasonCode": "incomplete_result"})
    assert returned.status_code == 200
    assert returned.json()["status"] == "in_progress"
    assert (await client.post(task_path + "/submit-result", headers=headers("assignee"),
                              json={"resultText": "Corrected report"})).status_code == 200
    assert (await client.post(task_path + "/accept-result",
                              headers=headers("author"))).status_code == 200
    assert (await client.get(path, headers=headers("co"))).json()["document"][
        "execution"]["status"] == "completed"
    assert (await client.delete(task_path, headers=headers("author"))).status_code == 409


async def test_assignment_validation_and_storage_rollback(scenario):
    client, engine, storage, ids, source, _file, headers, payload, _agent = scenario
    path = f"/api/v1/incoming-documents/{source}/execution"
    for change, expected in [
        ({"expectedRevision": 999}, 409),
        ({"dueAt": (datetime.now(UTC) - timedelta(days=1)).isoformat()}, 422),
        ({"dueAt": "2030-01-01T12:00:00"}, 422),
        ({"coAssigneeIds": [str(ids["assignee"])]}, 422),
        ({"fileIds": []}, 409),
        ({"assigneeId": str(uuid4())}, 422),
    ]:
        response = await client.post(path, headers=headers("author"), json={**payload, **change})
        assert response.status_code == expected, response.text
    original_objects = dict(storage._objects)
    storage.fail_copy = True
    failed = await client.post(path, headers=headers("author"), json=payload)
    assert failed.status_code == 503
    assert storage._objects == original_objects
    async with engine.begin() as connection:
        assert await connection.scalar(select(func.count()).select_from(executions).where(
            executions.c.source_id == source,
        )) == 0
        assert await connection.scalar(select(func.count()).select_from(tasks).where(
            tasks.c.author_user_id == ids["author"],
        )) == 0
    storage.fail_copy = False
    assert (await client.post(path, headers=headers("author"), json=payload)).status_code == 200


async def test_document_pagination_filters_and_module_denial(scenario):
    client, engine, _storage, ids, source, _file, headers, payload, _agent = scenario
    base = "/api/v1/incoming-documents"
    hidden = await client.get(base, headers=headers("stranger"))
    assert hidden.status_code == 200 and hidden.json()["total"] == 0
    page = await client.get(base, headers=headers("author"), params={"q": "QA-1", "limit": 1})
    assert page.status_code == 200 and page.json()["limit"] == 1
    assert any(item["id"] == str(source) for item in page.json()["documents"])
    assigned = await client.post(f"{base}/{source}/execution", headers=headers("author"),
                                 json=payload)
    task_id = UUID(assigned.json()["document"]["execution"]["taskId"])
    async with engine.begin() as connection:
        await connection.execute(update(tasks).where(tasks.c.id == task_id).values(
            due_at=datetime.now(UTC) - timedelta(hours=1),
        ))
    overdue = await client.get(base, headers=headers("co"), params={"category": "overdue"})
    assert overdue.json()["total"] == 1
    assert (await client.get(base, headers=headers("co"),
                             params={"category": "unassigned"})).json()["total"] == 0
    async with engine.begin() as connection:
        await connection.execute(insert(module_access_rules).values(
            id=uuid4(), subject_type="user", subject_key=str(ids["co"]),
            module_key="incoming_letters", permissions={"view": False},
            created_by_user_id=ids["author"], created_at=datetime.now(UTC),
            updated_at=datetime.now(UTC),
        ))
    assert (await client.get(f"{base}/{source}", headers=headers("co"))).status_code == 403


async def test_source_files_are_scoped_checked_and_explicitly_reviewed(scenario):
    client, engine, storage, _ids, source, file, headers, payload, _agent = scenario
    path = f"/api/v1/incoming-documents/{source}"
    detail = (await client.get(path, headers=headers("author"))).json()
    assert [item["name"] for item in detail["files"]] == ["original.pdf"]
    async with engine.begin() as connection:
        internal = (await connection.execute(select(ai_referent_files).where(
            ai_referent_files.c.owner_id == source,
            ai_referent_files.c.relative_path == "incoming-metadata.json",
        ))).mappings().one()
        original = (await connection.execute(select(ai_referent_files).where(
            ai_referent_files.c.id == UUID(file["id"]),
        ))).mappings().one()
    assert (await client.get(path + f"/files/{internal['id']}",
                             headers=headers("author"))).status_code == 404
    assert (await client.get(path + f"/files/{uuid4()}",
                             headers=headers("author"))).status_code == 404
    await storage.put(original["storage_key"], b"tampered", "application/pdf")
    assert (await client.get(path + f"/files/{file['id']}",
                             headers=headers("author"))).status_code == 503
    await storage.put(original["storage_key"], b"%PDF-synthetic-original", "application/pdf")
    async with engine.begin() as connection:
        await store_packet_file(connection, storage, kind="incoming", owner_id=source,
                                name="appendix.pdf", content=b"%PDF-synthetic-appendix",
                                content_type="application/pdf")
    assert (await client.post(path + "/execution", headers=headers("author"),
                              json=payload)).status_code == 409
    refreshed = (await client.get(path, headers=headers("author"))).json()
    confirmed = {**payload, "fileIds": [item["id"] for item in refreshed["files"]]}
    assert (await client.post(path + "/execution", headers=headers("author"),
                              json=confirmed)).status_code == 200
