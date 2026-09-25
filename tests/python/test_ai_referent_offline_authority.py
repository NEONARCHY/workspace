"""Offline writes require a server lease, conservative wait and durable fence."""

import hashlib
import json
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
from integrations.exat.workspace_integration.client import WorkspaceClient
from integrations.exat.workspace_integration.offline_authority import OfflineAuthorityGate
from integrations.exat.workspace_integration.offline_journal import OfflineJournal


def lease(epoch: str, *, mode: str = "online") -> dict[str, object]:
    now = datetime.now(UTC)
    return {
        "epoch": epoch,
        "mode": mode,
        "serverTime": now.isoformat(),
        "leaseUntil": (now + timedelta(seconds=45)).isoformat(),
        "leaseSeconds": 45,
    }


def test_offline_transition_waits_for_server_fence_and_survives_restart(tmp_path):
    journal = OfflineJournal(tmp_path)
    ticks = [100.0]
    epoch = str(uuid4())
    gate = OfflineAuthorityGate(journal, "referent-pc", clock=lambda: ticks[0])
    assert not gate.may_write_offline()
    gate.accept_lease(lease(epoch))
    assert journal.authority_state()["phase"] == "online"
    ticks[0] = 149.9
    assert not gate.may_write_offline()
    assert not OfflineAuthorityGate(
        OfflineJournal(tmp_path), "referent-pc", clock=lambda: 10_000.0
    ).may_write_offline()
    ticks[0] = 150.0
    assert gate.may_write_offline()
    assert OfflineAuthorityGate(OfflineJournal(tmp_path), "referent-pc").may_write_offline()
    assert not OfflineAuthorityGate(OfflineJournal(tmp_path), "other-agent").may_write_offline()
    with pytest.raises(ValueError, match="сверки журнала"):
        gate.accept_lease(lease(epoch))


def test_replay_required_stops_offline_writes(tmp_path):
    journal = OfflineJournal(tmp_path)
    ticks = [0.0]
    epoch = str(uuid4())
    gate = OfflineAuthorityGate(journal, "referent-pc", clock=lambda: ticks[0])
    gate.accept_lease(lease(epoch))
    ticks[0] = 51.0
    assert gate.may_write_offline()
    gate.accept_lease(lease(epoch, mode="replay_required"))
    assert journal.authority_state()["phase"] == "replay"
    assert not gate.may_write_offline()
    with pytest.raises(ValueError, match="эпохе"):
        gate.accept_lease(lease(str(uuid4()), mode="replay_required"))


def test_invalid_or_unconfirmed_lease_does_not_create_authority(tmp_path):
    journal = OfflineJournal(tmp_path)
    gate = OfflineAuthorityGate(journal, "referent-pc")
    response = lease(str(uuid4()))
    response["serverTime"] = "2026-09-25T12:00:00"
    with pytest.raises(ValueError, match="недействительную аренду"):
        gate.accept_lease(response)
    assert journal.authority_state() is None
    with pytest.raises(ValueError, match="без подтверждённой аренды"):
        gate.accept_lease(lease(str(uuid4()), mode="replay_required"))


def test_client_uses_agent_token_routes_for_lease(monkeypatch):
    client = WorkspaceClient.__new__(WorkspaceClient)
    client.agent_id = "referent-pc"
    calls = []

    def request(path, payload=None, *, method="GET"):
        calls.append((path, payload, method))
        return {"ok": True}

    monkeypatch.setattr(client, "request", request)
    epoch = str(uuid4())
    assert client.start_offline_authority() == {"ok": True}
    assert client.heartbeat_offline_authority(epoch) == {"ok": True}
    assert client.offline_rights(epoch) == {"ok": True}
    assert calls == [
        ("/ai-referent/agent/offline/authority:start?agentId=referent-pc", {}, "POST"),
        ("/ai-referent/agent/offline/authority:heartbeat",
         {"agentId": "referent-pc", "epoch": epoch}, "POST"),
        (f"/ai-referent/agent/offline/rights?agentId=referent-pc&epoch={epoch}",
         None, "GET"),
    ]


def test_last_verified_rights_replace_revoked_ids_atomically(tmp_path):
    journal = OfflineJournal(tmp_path)
    epoch = str(uuid4())
    journal.set_authority_phase("referent-pc", epoch, "online")

    def response(actor_ids, stamp):
        actors = [{"telegramId": value, "userId": str(uuid4()),
                   "fullName": "Сотрудник", "role": "employee", "reviewerKeys": []}
                  for value in actor_ids]
        canonical = json.dumps(actors, ensure_ascii=False, sort_keys=True,
                               separators=(",", ":"))
        return {"epoch": epoch, "actors": actors, "verifiedAt": stamp,
                "contentSha256": hashlib.sha256(canonical.encode()).hexdigest()}

    first = response(["123"], "2026-09-25T12:00:00Z")
    journal.save_offline_rights(first)
    assert journal.offline_actor("123")["telegramId"] == "123"
    later = response(["456"], "2026-09-25T12:00:01Z")
    journal.save_offline_rights(later)
    assert journal.offline_actor("123") is None
    assert journal.offline_actor("456")["telegramId"] == "456"
    with pytest.raises(ValueError, match="старой"):
        journal.save_offline_rights(first)
    damaged = dict(later, contentSha256="0" * 64)
    with pytest.raises(ValueError, match="сумма"):
        journal.save_offline_rights(damaged)
    assert journal.offline_actor("456") is not None
