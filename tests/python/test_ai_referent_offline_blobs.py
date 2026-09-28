"""Offline files are staged immutably and never published by upload alone."""

import hashlib
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
from fastapi import HTTPException
from sqlalchemy.dialects import postgresql

from yuksalish_api.ai_referent_offline_blobs import stage_offline_blob
from yuksalish_api.object_storage import InMemoryObjectStorage
from yuksalish_api.routers import ai_referent_shared
from yuksalish_api.routers.ai_referent import require_agent_token


class Result:
    def __init__(self, row=None):
        self.row = row

    def mappings(self):
        return self

    def first(self):
        return self.row

    def one(self):
        assert self.row is not None
        return self.row


class Connection:
    def __init__(self, epoch):
        self.epoch = epoch
        self.mode = "replay_required"
        self.row = None
        self.fail_insert = False

    async def scalar(self, _statement):
        return "referent-pc"

    async def execute(self, statement):
        query = str(statement)
        if "FROM ai_referent_authority" in query:
            return Result({
                "agent_id": "referent-pc", "epoch": self.epoch,
                "mode": self.mode,
                "lease_until": datetime.now(UTC) + timedelta(seconds=30),
            })
        if "ai_referent_offline_blobs" in query:
            if query.startswith("INSERT"):
                if self.fail_insert:
                    self.fail_insert = False
                    raise RuntimeError("simulated DB failure after object-store write")
                if self.row is None:
                    self.row = statement.compile(dialect=postgresql.dialect()).params
            return Result(self.row)
        raise AssertionError(query)


@pytest.fixture
def anyio_backend():
    return "asyncio"


def test_stage_endpoint_requires_agent_token():
    route = next(
        item for item in ai_referent_shared.router.routes
        if item.path == "/ai-referent/agent/offline/blobs/{sha256}"
    )
    assert "PUT" in route.methods
    assert any(item.call is require_agent_token for item in route.dependant.dependencies)


@pytest.mark.anyio
async def test_identical_retry_repairs_failed_database_write_without_duplicate():
    epoch = uuid4()
    connection = Connection(epoch)
    storage = InMemoryObjectStorage()
    content = b"offline DOCX or audio bytes"
    digest = hashlib.sha256(content).hexdigest()
    connection.fail_insert = True
    with pytest.raises(RuntimeError, match="simulated DB failure"):
        await stage_offline_blob(
            connection, storage, agent_id="referent-pc", epoch=epoch,
            sha256=digest, content=content, enabled=True,
        )
    assert connection.row is None
    receipt = await stage_offline_blob(
        connection, storage, agent_id="referent-pc", epoch=epoch,
        sha256=digest, content=content, enabled=True,
    )
    retry = await stage_offline_blob(
        connection, storage, agent_id="referent-pc", epoch=epoch,
        sha256=digest, content=content, enabled=True,
    )
    assert retry == receipt
    assert receipt.sha256 == digest
    assert receipt.byte_size == len(content)
    assert await storage.get(connection.row["storage_key"]) == content


@pytest.mark.anyio
async def test_stage_rejects_bad_digest_epoch_and_new_staging_after_disable():
    epoch = uuid4()
    connection = Connection(epoch)
    storage = InMemoryObjectStorage()
    content = b"important document"
    digest = hashlib.sha256(content).hexdigest()
    for requested_epoch, requested_digest, enabled, status in (
        (epoch, "0" * 64, True, 422),
        (uuid4(), digest, True, 409),
    ):
        with pytest.raises(HTTPException) as error:
            await stage_offline_blob(
                connection, storage, agent_id="referent-pc", epoch=requested_epoch,
                sha256=requested_digest, content=content, enabled=enabled,
            )
        assert error.value.status_code == status
    assert connection.row is None
    connection.mode = "online"
    with pytest.raises(HTTPException) as disabled:
        await stage_offline_blob(
            connection, storage, agent_id="referent-pc", epoch=epoch,
            sha256=digest, content=content, enabled=False,
        )
    assert disabled.value.status_code == 409
    connection.mode = "replay_required"
    assert (await stage_offline_blob(
        connection, storage, agent_id="referent-pc", epoch=epoch,
        sha256=digest, content=content, enabled=False,
    )).sha256 == digest


@pytest.mark.anyio
async def test_authority_change_during_upload_never_registers_blob():
    epoch = uuid4()
    connection = Connection(epoch)

    class Storage(InMemoryObjectStorage):
        async def put(self, key, content, content_type):
            await super().put(key, content, content_type)
            connection.epoch = uuid4()

    content = b"letter"
    with pytest.raises(HTTPException) as error:
        await stage_offline_blob(
            connection, Storage(), agent_id="referent-pc", epoch=epoch,
            sha256=hashlib.sha256(content).hexdigest(), content=content, enabled=True,
        )
    assert error.value.status_code == 409
    assert connection.row is None
