"""Multipart boundary checks; persistence/rollback are covered by real grant PostgreSQL tests."""

from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import AsyncConnection

from yuksalish_api.auth import AuthenticatedUser, require_user
from yuksalish_api.database import get_connection
from yuksalish_api.grant_files_service import (
    MAX_INITIAL_TOTAL_BYTES,
    GrantInitialFile,
    validated_files,
)
from yuksalish_api.grant_schemas import GrantCreate, GrantDetail
from yuksalish_api.object_storage import InMemoryObjectStorage, ObjectStorageError
from yuksalish_api.routers import grants as endpoint


@pytest.fixture
def upload_api(monkeypatch):
    user = AuthenticatedUser(id=uuid4(), username="qa", full_name="Grant QA",
                             role="employee", position_id=None, job_title=None)
    payload = GrantCreate(request_id=uuid4(), title="Grant source materials",
                          assignee_id=uuid4(), due_at=datetime.now(UTC) + timedelta(days=10))
    result = GrantDetail(
        id=str(payload.request_id), title=payload.title, description="", author_user_id=None,
        initiator_user_id=str(user.id), workflow_version=2, launch_approved_at=None,
        launch_approved_by_user_id=None, assignee_id=str(payload.assignee_id), co_assignee_ids=[],
        leader_user_id=str(uuid4()), chair_user_id=str(uuid4()), due_at=payload.due_at,
        status="launch_review", revision=3, checklist=[], result_text="", chat_id=str(uuid4()),
        created_at=datetime.now(UTC), updated_at=datetime.now(UTC), allowed_actions=["edit"],
        attachments=[], events=[],
    )
    connection = AsyncMock(spec=AsyncConnection)
    guard = AsyncMock()
    create = AsyncMock(return_value=result)
    publish = AsyncMock()
    monkeypatch.setattr(endpoint, "ensure_module_action", guard)
    monkeypatch.setattr(endpoint, "create_with_files", create)
    app = FastAPI()
    app.include_router(endpoint.router, prefix="/api/v1")
    app.state.settings = SimpleNamespace(attachment_max_bytes=25 * 1024 * 1024)
    app.state.object_storage = InMemoryObjectStorage()
    app.state.event_bus = SimpleNamespace(publish=publish)
    app.dependency_overrides[require_user] = lambda: user

    async def connected():
        yield connection

    app.dependency_overrides[get_connection] = connected
    with TestClient(app) as client:
        yield client, payload, connection, create, guard, app, publish


def test_multipart_keeps_all_files_and_commits_before_publishing(upload_api):
    client, payload, connection, create, guard, _app, publish = upload_api
    order = []
    connection.commit.side_effect = lambda: order.append("commit")
    publish.side_effect = lambda *args, **kwargs: order.append("publish")
    response = client.post("/api/v1/grants/with-files",
        data={"payload": payload.model_dump_json(by_alias=True)}, files=[
            ("files", ("terms.txt", b"terms", "text/plain")),
            ("files", ("budget.csv", b"amount,100", "text/csv")),
        ])
    assert response.status_code == 201
    assert response.json()["id"] == str(payload.request_id)
    guard.assert_awaited_once()
    assert create.call_args.args[2] == payload
    assert [item.content for item in create.call_args.args[4]] == [b"terms", b"amount,100"]
    connection.commit.assert_awaited_once()
    assert publish.await_count > 0
    assert order[0] == "commit"
    assert set(order[1:]) == {"publish"}


def test_parser_rejects_invalid_metadata_and_oversized_file_before_creating(upload_api):
    client, payload, connection, create, _guard, app, publish = upload_api
    assert client.post("/api/v1/grants/with-files", data={"payload": "not-json"},
                       files={"files": ("terms.txt", b"ok")}).status_code == 422
    app.state.settings.attachment_max_bytes = 3
    response = client.post("/api/v1/grants/with-files",
        data={"payload": payload.model_dump_json(by_alias=True)},
        files={"files": ("terms.txt", b"four")})
    assert response.status_code == 413
    create.assert_not_awaited()
    connection.commit.assert_not_awaited()
    publish.assert_not_awaited()


def test_access_and_request_size_are_checked_before_parsing(upload_api):
    client, _payload, connection, create, guard, _app, _publish = upload_api
    guard.side_effect = HTTPException(403, "No grant creation access")
    assert client.post("/api/v1/grants/with-files", content=b"invalid").status_code == 403
    guard.side_effect = None
    assert client.post("/api/v1/grants/with-files", content=b"",
        headers={"Content-Length": str(MAX_INITIAL_TOTAL_BYTES + 2 * 1024 * 1024)}
    ).status_code == 413
    assert client.post("/api/v1/grants/with-files", content=b"invalid",
                       headers={"Transfer-Encoding": "chunked"}).status_code == 411
    create.assert_not_awaited()
    connection.commit.assert_not_awaited()


def test_storage_failure_is_not_reported_as_success(upload_api):
    client, payload, connection, create, _guard, _app, publish = upload_api
    create.side_effect = ObjectStorageError("Synthetic storage failure")
    response = client.post("/api/v1/grants/with-files",
        data={"payload": payload.model_dump_json(by_alias=True)},
        files={"files": ("terms.txt", b"terms")})
    assert response.status_code == 503
    connection.commit.assert_not_awaited()
    publish.assert_not_awaited()


@pytest.mark.parametrize("files", [[], [GrantInitialFile("empty.txt", "text/plain", b"")],
    [GrantInitialFile("x", "text/plain", b"x")] * 21,
    [GrantInitialFile("bad\nname", "text/plain", b"x")]])
def test_invalid_source_files_are_rejected(files):
    from yuksalish_api.errors import WorkspaceRepositoryError

    with pytest.raises(WorkspaceRepositoryError):
        validated_files(files, 25 * 1024 * 1024)
