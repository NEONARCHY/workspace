"""The bot receives only currently verified, active AI Referent actors."""

import hashlib
import json
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import HTTPException
from integrations.exat.workspace_integration.offline_journal import OfflineJournal

import yuksalish_api.ai_referent_offline_rights as rights
from yuksalish_api.auth import AuthenticatedUser
from yuksalish_api.routers import ai_referent_shared
from yuksalish_api.routers.ai_referent import require_agent_token


class Result:
    def __init__(self, *, row=None, ids=None):
        self.row = row
        self.ids = ids or []

    def mappings(self):
        return self

    def scalars(self):
        return self

    def first(self):
        return self.row

    def all(self):
        return self.ids


class Connection:
    def __init__(self, epoch):
        self.epoch = epoch

    async def scalar(self, _statement):
        return "referent-pc"

    async def execute(self, statement):
        query = str(statement)
        if "ai_referent_authority" in query:
            return Result(row={
                "agent_id": "referent-pc", "epoch": self.epoch,
                "mode": "online", "lease_until": datetime.now(UTC) + timedelta(seconds=30),
            })
        return Result(ids=["123", "456"])


@pytest.fixture
def anyio_backend():
    return "asyncio"


def test_export_endpoint_requires_agent_token():
    route = next(
        item for item in ai_referent_shared.router.routes
        if item.path == "/ai-referent/agent/offline/rights" and "GET" in item.methods
    )
    assert any(
        dependency.call is require_agent_token
        for dependency in route.dependant.dependencies
    )


@pytest.mark.anyio
async def test_export_excludes_revoked_actor_and_hashes_verified_copy(monkeypatch, tmp_path):
    epoch = uuid4()
    user_id = uuid4()

    async def configuration(_connection):
        return SimpleNamespace(revision=7, reviewers=[
            SimpleNamespace(key="askar", user_id=str(user_id), can_approve=True),
        ])

    async def actor(_connection, telegram_id):
        if telegram_id == "456":
            raise HTTPException(403, "Доступ отозван")
        return AuthenticatedUser(
            id=user_id, username="askar", full_name="Аскар", role="employee",
            position_id=None, department_id=None, job_title=None,
        )

    monkeypatch.setattr(rights, "read_configuration", configuration)
    monkeypatch.setattr(rights, "telegram_actor", actor)
    snapshot = await rights.export_offline_rights(
        Connection(epoch), agent_id="referent-pc", epoch=epoch, enabled=True
    )
    assert snapshot.reviewer_revision == 7
    assert [item.telegram_id for item in snapshot.actors] == ["123"]
    assert snapshot.actors[0].reviewer_keys == ["askar"]
    encoded = json.dumps(
        [item.model_dump(mode="json", by_alias=True) for item in snapshot.actors],
        ensure_ascii=False, sort_keys=True, separators=(",", ":"),
    ).encode("utf-8")
    assert snapshot.content_sha256 == hashlib.sha256(encoded).hexdigest()
    journal = OfflineJournal(tmp_path)
    journal.set_authority_phase("referent-pc", str(epoch), "online")
    journal.save_offline_rights(snapshot.model_dump(mode="json", by_alias=True))
    assert journal.offline_actor("123")["reviewerKeys"] == ["askar"]
    assert journal.offline_actor("456") is None


@pytest.mark.anyio
async def test_export_requires_enabled_matching_live_epoch():
    epoch = uuid4()
    for enabled, agent, requested_epoch in (
        (False, "referent-pc", epoch),
        (True, "other-agent", epoch),
        (True, "referent-pc", uuid4()),
    ):
        with pytest.raises(HTTPException):
            await rights.export_offline_rights(
                Connection(epoch), agent_id=agent, epoch=requested_epoch, enabled=enabled
            )
