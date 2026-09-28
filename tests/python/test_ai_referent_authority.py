"""Fail-closed write fencing without activating the protocol in production."""

import os
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
from fastapi import HTTPException
from sqlalchemy import delete, update
from sqlalchemy.dialects import postgresql
from sqlalchemy.ext.asyncio import create_async_engine

import yuksalish_api.ai_referent_authority as authority
from yuksalish_api.routers import ai_referent, ai_referent_shared, workspace
from yuksalish_api.tables import ai_referent_authority, ai_referent_configuration


class _Result:
    def __init__(self, row):
        self.row = row

    def mappings(self):
        return self

    def first(self):
        return self.row


class _Connection:
    def __init__(self, row):
        self.row = row
        self.queries = []

    async def execute(self, statement):
        query = str(statement.compile(dialect=postgresql.dialect()))
        self.queries.append(query)
        return _Result(self.row)


@pytest.fixture
def anyio_backend():
    return "asyncio"


def test_all_online_referent_writes_have_server_guard():
    expected = {
        ("PUT", "/ai-referent/configuration"),
        ("POST", "/ai-referent/letters"),
        ("PATCH", "/ai-referent/letters/{letter_id}"),
        ("POST", "/ai-referent/letters/{letter_id}/actions"),
        ("DELETE", "/ai-referent/letters/{letter_id}"),
        ("PUT", "/ai-referent/letters/{letter_id}/comment-audio"),
        ("PUT", "/ai-referent/document-checks"),
        ("POST", "/ai-referent/telegram-link"),
        ("DELETE", "/ai-referent/telegram-link"),
        ("POST", "/ai-referent/agent/document-checks/claim"),
        ("POST", "/ai-referent/agent/document-checks/{check_id}/heartbeat"),
        ("POST", "/ai-referent/agent/document-checks/{check_id}/result"),
        ("PUT", "/ai-referent/agent/recipients"),
        ("POST", "/ai-referent/recipients/manual"),
        ("DELETE", "/ai-referent/recipients/manual/{recipient_id}"),
        ("POST", "/ai-referent/agent/telegram-link"),
        ("POST", "/ai-referent/agent/letters"),
        ("PATCH", "/ai-referent/agent/letters/{letter_id}"),
        ("POST", "/ai-referent/agent/letters/{letter_id}/actions"),
        ("DELETE", "/ai-referent/agent/letters/{letter_id}"),
        ("PUT", "/ai-referent/agent/letters/{letter_id}/attachment"),
        ("PUT", "/ai-referent/agent/letters/{letter_id}/comment-audio"),
        ("PUT", "/ai-referent/agent/files/{kind}/{owner_id}"),
        ("POST", "/ai-referent/agent/jobs/claim"),
        ("POST", "/ai-referent/agent/jobs/{job_id}/heartbeat"),
        ("POST", "/ai-referent/agent/jobs/{job_id}/result"),
        ("GET", "/ai-referent/agent/jobs/{job_id}/files/{file_id}"),
        ("POST", "/ai-referent/agent/ready"),
        ("POST", "/ai-referent/agent/notifications/claim"),
        ("POST", "/ai-referent/agent/notifications/{notification_id}/ack"),
        ("PUT", "/ai-referent/agent/archive"),
        ("POST", "/ai-referent/agent/configuration:ack"),
        ("POST", "/ai-referent/agent/incoming:sync"),
        ("PUT", "/ai-referent/agent/journal"),
    }
    found = set()
    for router in (ai_referent.router, ai_referent_shared.router):
        for route in router.routes:
            for method in route.methods or ():
                key = (method, route.path)
                if key in expected:
                    assert any(
                        dependency.call is authority.require_workspace_write
                        for dependency in route.dependant.dependencies
                    ), key
                    found.add(key)
    assert found == expected
    offline_protocol = {
        ("POST", "/ai-referent/agent/offline/authority:start"),
        ("POST", "/ai-referent/agent/offline/authority:heartbeat"),
        ("POST", "/ai-referent/agent/offline/authority:retire"),
        ("POST", "/ai-referent/agent/offline/rights"),
        ("PUT", "/ai-referent/agent/offline/blobs/{sha256}"),
        ("POST", "/ai-referent/agent/offline/number-reservations"),
    }
    for route in ai_referent_shared.router.routes:
        if not any((method, route.path) in offline_protocol for method in route.methods or ()):
            continue
        assert not any(
            dependency.call is authority.require_workspace_write
            for dependency in route.dependant.dependencies
        ), route.path
    attachment = next(
        route for route in workspace.router.routes
        if route.path == "/attachments/{owner_type}/{owner_id}" and "PUT" in route.methods
    )
    assert any(
        dependency.call is workspace.require_attachment_write
        for dependency in attachment.dependant.dependencies
    )


@pytest.mark.anyio
async def test_legacy_mode_remains_writable_before_explicit_activation():
    connection = _Connection(None)
    guard = authority.workspace_write_guard(connection)
    await anext(guard)
    with pytest.raises(StopAsyncIteration):
        await anext(guard)
    assert "ai_referent_configuration" in connection.queries[0]
    assert "FOR UPDATE" in connection.queries[0]
    assert "ai_referent_authority" in connection.queries[1]
    assert "FOR SHARE" in connection.queries[1]


@pytest.mark.anyio
async def test_expired_lease_rejects_workspace_write():
    row = {"mode": "online", "lease_until": datetime.now(UTC) - timedelta(seconds=1)}
    guard = authority.workspace_write_guard(_Connection(row))
    with pytest.raises(HTTPException) as error:
        await anext(guard)
    assert error.value.status_code == 503


@pytest.mark.anyio
async def test_attachment_fence_affects_only_ai_referent():
    expired = {"mode": "replay_required", "lease_until": datetime.now(UTC)}
    ordinary = workspace.require_attachment_write("task", _Connection(expired))
    await anext(ordinary)
    with pytest.raises(StopAsyncIteration):
        await anext(ordinary)
    letter = workspace.require_attachment_write("ai_referent_letter", _Connection(expired))
    with pytest.raises(HTTPException) as error:
        await anext(letter)
    assert error.value.status_code == 503


@pytest.mark.anyio
async def test_write_that_outlives_lease_is_rolled_back(monkeypatch):
    start = datetime(2026, 9, 25, tzinfo=UTC)
    times = iter((start, start + timedelta(seconds=2)))

    class Clock(datetime):
        @classmethod
        def now(cls, tz=None):
            return next(times)

    monkeypatch.setattr(authority, "datetime", Clock)
    row = {"mode": "online", "lease_until": start + timedelta(seconds=1)}
    guard = authority.workspace_write_guard(_Connection(row))
    await anext(guard)
    with pytest.raises(HTTPException) as error:
        await anext(guard)
    assert error.value.status_code == 503


@pytest.mark.anyio
@pytest.mark.postgres
async def test_lease_expiry_stays_fenced_until_replay_is_finished():
    url = os.environ.get("YUKSALISH_TEST_DATABASE_URL")
    if not url:
        pytest.skip("YUKSALISH_TEST_DATABASE_URL is not configured")
    engine = create_async_engine(url)
    agent_id = f"authority-test-{uuid4().hex}"
    try:
        async with engine.connect() as connection:
            transaction = await connection.begin()
            try:
                await connection.execute(delete(ai_referent_authority))
                await connection.execute(
                    update(ai_referent_configuration).values(execution_agent_id=agent_id)
                )
                with pytest.raises(HTTPException) as disabled:
                    await authority.start_authority(
                        connection, agent_id=agent_id, enabled=False
                    )
                assert disabled.value.status_code == 409
                lease = await authority.start_authority(
                    connection, agent_id=agent_id, enabled=True
                )
                assert lease.mode == "online"
                assert (await authority.heartbeat_authority(
                    connection, agent_id=agent_id, epoch=lease.epoch
                )).mode == "online"
                await connection.execute(
                    update(ai_referent_authority).values(
                        lease_until=datetime.now(UTC) - timedelta(seconds=1)
                    )
                )
                expired = await authority.heartbeat_authority(
                    connection, agent_id=agent_id, epoch=lease.epoch
                )
                assert expired.mode == "replay_required"
                assert (await authority.heartbeat_authority(
                    connection, agent_id=agent_id, epoch=lease.epoch
                )).mode == "replay_required"
                guard = authority.workspace_write_guard(connection)
                with pytest.raises(HTTPException) as blocked:
                    await anext(guard)
                assert blocked.value.status_code == 503
            finally:
                await transaction.rollback()
    finally:
        await engine.dispose()
