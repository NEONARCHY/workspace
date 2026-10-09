import asyncio
import os
from collections.abc import AsyncIterator
from datetime import UTC, datetime
from uuid import UUID, uuid4

import httpx
import pytest
from pydantic import SecretStr
from sqlalchemy import delete, func, insert, select, update
from sqlalchemy.ext.asyncio import AsyncConnection, create_async_engine

from yuksalish_api.auth import AuthenticatedUser, require_user
from yuksalish_api.database import get_connection
from yuksalish_api.main import create_app
from yuksalish_api.object_storage import InMemoryObjectStorage
from yuksalish_api.project_hub_service import load_hub, publish_event
from yuksalish_api.project_import_schemas import (
    ImportContent,
    ImportDirection,
    ImportIssue,
    ImportItem,
    ImportProject,
    ImportPublish,
    ImportReview,
)
from yuksalish_api.project_import_service import (
    add_document,
    create_import,
    process_next_import,
    publish_import,
    queue_analysis,
    require_import,
    save_review,
)
from yuksalish_api.repository import WorkspaceRepositoryError
from yuksalish_api.settings import Settings
from yuksalish_api.tables import (
    calendar_events,
    project_document_imports,
    project_hub_projects,
    users,
)


@pytest.mark.anyio
@pytest.mark.postgres
async def test_worker_claims_once_and_recovers_expired_leases(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from unittest.mock import AsyncMock

    from yuksalish_api import project_import_service as service

    engine = create_async_engine(database_url())
    storage = InMemoryObjectStorage()
    user_id: UUID | None = None
    import_id: UUID | None = None
    analyzer = AsyncMock(return_value=ImportContent(project=ImportProject(title="Generated")))
    monkeypatch.setattr(service, "analyze_documents", analyzer)
    try:
        async with engine.begin() as connection:
            manager = await actor(connection)
            user_id = manager.id
            draft = await create_import(connection, manager)
            import_id = UUID(draft.id)
            draft = await add_document(
                connection, manager, import_id, draft.revision, "concept.txt", b"test", storage,
            )
            await queue_analysis(connection, manager, import_id, draft.revision)
        claims = await asyncio.gather(
            process_next_import(engine, storage, "test-key"),
            process_next_import(engine, storage, "test-key"),
        )
        assert sorted(claims) == [False, True]
        assert analyzer.await_count == 1
        async with engine.begin() as connection:
            row = await require_import(connection, manager, import_id)
            assert row["state"] == "ready" and row["lease_id"] is None
            await connection.execute(update(project_document_imports).where(
                project_document_imports.c.id == import_id,
            ).values(
                state="processing", lease_id=uuid4(),
                lease_until=datetime(2000, 1, 1, tzinfo=UTC),
            ))
        assert await process_next_import(engine, storage, "test-key")
        assert analyzer.await_count == 2
        async with engine.begin() as connection:
            await connection.execute(update(project_document_imports).where(
                project_document_imports.c.id == import_id,
            ).values(state="queued"))
            await connection.execute(update(users).where(users.c.id == user_id).values(
                role="employee",
            ))
        assert await process_next_import(engine, storage, "test-key")
        assert analyzer.await_count == 2  # No external disclosure after permission revocation.
        async with engine.begin() as connection:
            row = (await connection.execute(select(project_document_imports).where(
                project_document_imports.c.id == import_id,
            ))).mappings().one()
            assert row["state"] == "failed" and "test-key" not in row["error"]
    finally:
        if import_id:
            async with engine.begin() as connection:
                await connection.execute(delete(project_document_imports).where(
                    project_document_imports.c.id == import_id,
                ))
                await connection.execute(delete(users).where(users.c.id == user_id))
        await engine.dispose()


async def actor(connection: AsyncConnection, role: str = "manager") -> AuthenticatedUser:
    user_id = uuid4()
    await connection.execute(insert(users).values(
        id=user_id, username=f"import-{user_id.hex[:12]}", full_name="Import tester",
        role=role, status="active", created_at=datetime.now(UTC), updated_at=datetime.now(UTC),
    ))
    return AuthenticatedUser(
        id=user_id, username=f"import-{user_id.hex[:12]}", full_name="Import tester",
        position_id=None, job_title=None, role=role,
    )


def database_url() -> str:
    value = os.environ.get("YUKSALISH_TEST_DATABASE_URL")
    if not value:
        pytest.skip("YUKSALISH_TEST_DATABASE_URL is not configured")
    return value


@pytest.mark.anyio
@pytest.mark.postgres
async def test_review_publish_privacy_idempotency_and_unscheduled_events() -> None:
    engine = create_async_engine(database_url())
    storage = InMemoryObjectStorage()
    try:
        async with engine.connect() as connection:
            transaction = await connection.begin()
            try:
                manager = await actor(connection)
                outsider = await actor(connection, "superadmin")
                employee = await actor(connection, "employee")
                unassigned = await actor(connection, "employee")
                with pytest.raises(WorkspaceRepositoryError) as denied:
                    await create_import(connection, employee)
                assert denied.value.status_code == 403
                draft = await create_import(connection, manager)
                import_id = UUID(draft.id)
                with pytest.raises(WorkspaceRepositoryError) as private:
                    await require_import(connection, outsider, import_id)
                assert private.value.status_code == 404
                draft = await add_document(
                    connection, manager, import_id, draft.revision, "concept.txt",
                    b"Test concept", storage,
                )
                duplicate = await add_document(
                    connection, manager, import_id, draft.revision, "same.txt",
                    b"Test concept", storage,
                )
                assert duplicate.revision == draft.revision
                assert len(duplicate.documents) == 1
                assert "storage_key" not in duplicate.model_dump_json()
                queued = await queue_analysis(connection, manager, import_id, draft.revision)
                with pytest.raises(WorkspaceRepositoryError) as locked:
                    await add_document(
                        connection, manager, import_id, queued.revision,
                        "late.txt", b"late", storage,
                    )
                assert locked.value.status_code == 409
                content = ImportContent(
                    project=ImportProject(
                        title="Document project", code=f"IM-{manager.id.hex[:8]}", budget="1000",
                    ),
                    directions=[ImportDirection(title="Direction", items=[
                        ImportItem(title="Undated event", kind="event", period="M2"),
                        ImportItem(title="Task", assignee_user_ids=[str(employee.id)]),
                    ])],
                    issues=[ImportIssue(message="Budget versions conflict")],
                )
                await connection.execute(update(project_document_imports).where(
                    project_document_imports.c.id == import_id,
                ).values(state="ready", content=content.model_dump(mode="json")))
                publication = ImportPublish(
                    expected_revision=queued.revision, manager_user_id=str(manager.id),
                    reviewed=True,
                )
                with pytest.raises(WorkspaceRepositoryError) as unresolved:
                    await publish_import(connection, manager, import_id, publication)
                assert unresolved.value.status_code == 422
                assert await connection.scalar(select(func.count()).select_from(
                    project_hub_projects,
                ).where(project_hub_projects.c.created_by_user_id == manager.id)) == 0
                content.issues[0].resolution = "Use the current signed budget"
                reviewed = await save_review(connection, manager, import_id, ImportReview(
                    expected_revision=queued.revision, content=content,
                ))
                with pytest.raises(WorkspaceRepositoryError) as stale:
                    await save_review(connection, manager, import_id, ImportReview(
                        expected_revision=queued.revision, content=content,
                    ))
                assert stale.value.status_code == 409
                # Work budgets cannot silently inherit a different or unknown currency.
                content.directions[0].items[1].budget = "100"
                content.directions[0].items[1].budget_currency = "USD"
                reviewed = await save_review(connection, manager, import_id, ImportReview(
                    expected_revision=reviewed.revision, content=content,
                ))
                publication.expected_revision = reviewed.revision
                with pytest.raises(WorkspaceRepositoryError) as mixed_currency:
                    await publish_import(connection, manager, import_id, publication)
                assert mixed_currency.value.status_code == 422
                assert await connection.scalar(select(func.count()).select_from(
                    project_hub_projects,
                ).where(project_hub_projects.c.created_by_user_id == manager.id)) == 0
                content.directions[0].items[1].budget_currency = "UZS"
                reviewed = await save_review(connection, manager, import_id, ImportReview(
                    expected_revision=reviewed.revision, content=content,
                ))
                publication.expected_revision = reviewed.revision
                published = await publish_import(connection, manager, import_id, publication)
                retried = await publish_import(connection, manager, import_id, publication)
                assert retried.project_id == published.project_id
                assert published.state == "published"
                assert published.publication == publication
                with pytest.raises(WorkspaceRepositoryError) as different_retry:
                    await publish_import(connection, manager, import_id, publication.model_copy(
                        update={"access_status": "open"},
                    ))
                assert different_retry.value.status_code == 409
                hub = await load_hub(connection, manager)
                items = [value for value in hub.items if value.project_id == published.project_id]
                assert len(items) == 2
                event = next(value for value in items if value.kind == "event")
                assert event.schedule_pending and event.calendar_event_id is None
                with pytest.raises(WorkspaceRepositoryError) as not_scheduled:
                    await publish_event(
                        connection, manager, UUID(published.project_id or ""), UUID(event.id),
                    )
                assert not_scheduled.value.status_code == 409
                assert await connection.scalar(select(func.count()).select_from(
                    calendar_events,
                ).where(calendar_events.c.organizer_user_id == manager.id)) == 0
                # After publication, source access follows the ordinary closed project ACL.
                with pytest.raises(WorkspaceRepositoryError):
                    await require_import(connection, unassigned, import_id)
                assert (await require_import(connection, employee, import_id))["project_id"]
                assert (await require_import(connection, outsider, import_id))["project_id"]
            finally:
                await transaction.rollback()
    finally:
        await engine.dispose()


@pytest.mark.anyio
@pytest.mark.postgres
async def test_child_error_rolls_back_project_and_chat_as_one_transaction() -> None:
    engine = create_async_engine(database_url())
    try:
        async with engine.connect() as connection:
            transaction = await connection.begin()
            try:
                manager = await actor(connection)
                draft = await create_import(connection, manager)
                content = ImportContent(
                    project=ImportProject(
                        title="Atomic", code=f"AT-{manager.id.hex[:8]}", budget="100",
                    ),
                    directions=[ImportDirection(title="A", items=[
                        ImportItem(title="Invalid person", assignee_user_ids=[str(uuid4())]),
                    ])],
                )
                await connection.execute(update(project_document_imports).where(
                    project_document_imports.c.id == UUID(draft.id),
                ).values(state="ready", content=content.model_dump(mode="json")))
                savepoint = await connection.begin_nested()
                with pytest.raises(WorkspaceRepositoryError):
                    await publish_import(connection, manager, UUID(draft.id), ImportPublish(
                        expected_revision=draft.revision, manager_user_id=str(manager.id),
                        reviewed=True,
                    ))
                await savepoint.rollback()
                assert await connection.scalar(select(func.count()).select_from(
                    project_hub_projects,
                ).where(project_hub_projects.c.created_by_user_id == manager.id)) == 0
                row = await require_import(connection, manager, UUID(draft.id))
                assert row["state"] == "ready"
            finally:
                await transaction.rollback()
    finally:
        await engine.dispose()


@pytest.mark.anyio
@pytest.mark.postgres
async def test_http_upload_privacy_and_failed_publish_leave_no_partial_project() -> None:
    engine = create_async_engine(database_url())
    storage = InMemoryObjectStorage()
    try:
        async with engine.connect() as connection:
            transaction = await connection.begin()
            try:
                manager = await actor(connection)
                outsider = await actor(connection)
                current = manager
                app = create_app(Settings(
                    environment="test", database_url=database_url(),
                    gemini_api_key=SecretStr("test-only"),
                ))
                app.state.object_storage = storage

                async def user_dependency() -> AuthenticatedUser:
                    return current

                async def connection_dependency() -> AsyncIterator[AsyncConnection]:
                    async with connection.begin_nested():
                        yield connection

                app.dependency_overrides[require_user] = user_dependency
                app.dependency_overrides[get_connection] = connection_dependency
                async with httpx.AsyncClient(
                    transport=httpx.ASGITransport(app=app), base_url="http://test",
                ) as client:
                    created = await client.post("/api/v1/project-imports")
                    assert created.status_code == 201
                    import_id = created.json()["id"]
                    path = f"/api/v1/project-imports/{import_id}"
                    uploaded = await client.put(
                        path + "/documents?fileName=concept.txt&expectedRevision=1",
                        content=b"Test concept",
                    )
                    assert uploaded.status_code == 200
                    assert uploaded.json()["revision"] == 2
                    document_id = uploaded.json()["documents"][0]["id"]
                    current = outsider
                    assert (await client.get(path)).status_code == 404
                    assert (await client.get(path + f"/documents/{document_id}")).status_code == 404
                    current = manager
                    downloaded = await client.get(path + f"/documents/{document_id}")
                    assert downloaded.content == b"Test concept"
                    assert downloaded.headers["cache-control"] == "no-store"
                    assert "attachment;" in downloaded.headers["content-disposition"]
                    assert (await client.post(path + "/analyze", json={
                        "expectedRevision": 2,
                    })).status_code == 422  # External processing requires explicit consent.
                    assert (await client.post(path + "/analyze", json={
                        "expectedRevision": 2, "allowExternalProcessing": True,
                    })).status_code == 200
                    candidate = ImportContent(
                        project=ImportProject(
                            title="Atomic HTTP", code=f"HTTP-{manager.id.hex[:8]}", budget="1000",
                        ),
                        directions=[ImportDirection(title="Direction", items=[
                            ImportItem(title="Unknown person", assignee_user_ids=[str(uuid4())]),
                        ])],
                    )
                    await connection.execute(update(project_document_imports).where(
                        project_document_imports.c.id == UUID(import_id),
                    ).values(state="ready", content=candidate.model_dump(mode="json")))
                    failed = await client.post(path + "/publish", json={
                        "expectedRevision": 3, "managerUserId": str(manager.id),
                        "responsibleUserIds": [], "accessStatus": "closed", "reviewed": True,
                    })
                    assert failed.status_code == 422
                    assert await connection.scalar(select(func.count()).select_from(
                        project_hub_projects,
                    ).where(project_hub_projects.c.created_by_user_id == manager.id)) == 0
                    assert (await client.get(path)).json()["state"] == "ready"
            finally:
                await transaction.rollback()
    finally:
        await engine.dispose()
