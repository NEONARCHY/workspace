"""Offline writes require a server lease, conservative wait and durable fence."""

import hashlib
import json
import sqlite3
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
from integrations.exat.workspace_integration.client import WorkspaceClient, WorkspaceError
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


def test_restart_waits_a_full_lease_before_offline_write(tmp_path):
    journal = OfflineJournal(tmp_path)
    epoch = str(uuid4())
    first = OfflineAuthorityGate(journal, "referent-pc", clock=lambda: 100.0)
    first.accept_lease(lease(epoch))
    assert journal.authority_state()["lease_seconds"] == 45

    ticks = [10_000.0]
    restarted = OfflineAuthorityGate(
        OfflineJournal(tmp_path), "referent-pc", clock=lambda: ticks[0]
    )
    ticks[0] = 10_049.9
    assert not restarted.may_write_offline()
    ticks[0] = 10_050.0
    assert restarted.may_write_offline()
    assert OfflineJournal(tmp_path).authority_state()["phase"] == "offline"


def test_retirement_intent_survives_restart_and_permanently_disables_offline(tmp_path):
    journal = OfflineJournal(tmp_path)
    epoch = str(uuid4())
    ticks = [100.0]
    gate = OfflineAuthorityGate(journal, "referent-pc", clock=lambda: ticks[0])
    gate.accept_lease(lease(epoch))
    manifest = journal.begin_retirement("referent-pc", epoch)
    assert manifest["operationCount"] == 0
    assert journal.authority_state()["phase"] == "retiring"
    ticks[0] = 10_000.0
    assert not gate.may_write_offline()
    restarted = OfflineJournal(tmp_path)
    assert restarted.authority_state()["phase"] == "retiring"
    restarted_gate = OfflineAuthorityGate(restarted, "referent-pc", clock=lambda: ticks[0])
    assert not restarted_gate.may_write_offline()
    with pytest.raises(ValueError):
        restarted.set_authority_phase("referent-pc", epoch, "offline")
    assert restarted.retirement_manifest() == manifest
    with pytest.raises(ValueError):
        restarted.finish_retirement(epoch, {**manifest, "operationsSha256": "0" * 64})
    restarted.finish_retirement(epoch, manifest)
    assert journal.authority_state() is None


def test_retirement_rejects_unacknowledged_journal_and_keeps_lease(tmp_path):
    journal = OfflineJournal(tmp_path)
    epoch = str(uuid4())
    journal.set_authority_phase("referent-pc", epoch, "online", lease_seconds=45)
    with journal.connect() as connection:
        connection.execute(
            "INSERT INTO operations (operation_id, actor_id, kind, payload, occurred_at) "
            "VALUES (?, '123', 'letter.create', '{}', ?)",
            (str(uuid4()), datetime.now(UTC).isoformat()),
        )
    with pytest.raises(ValueError):
        journal.begin_retirement("referent-pc", epoch)
    assert journal.authority_state()["phase"] == "online"


def test_old_authority_row_without_lease_duration_stays_fenced_on_restart(tmp_path):
    epoch = str(uuid4())
    with sqlite3.connect(tmp_path / "offline-journal.sqlite") as connection:
        connection.execute(
            "CREATE TABLE authority_state (id INTEGER PRIMARY KEY, agent_id TEXT NOT NULL, "
            "epoch TEXT NOT NULL, phase TEXT NOT NULL, updated_at TEXT NOT NULL)"
        )
        connection.execute(
            "INSERT INTO authority_state VALUES (1, 'referent-pc', ?, 'online', 'old')",
            (epoch,),
        )
    journal = OfflineJournal(tmp_path)
    assert journal.authority_state()["lease_seconds"] is None
    gate = OfflineAuthorityGate(journal, "referent-pc", clock=lambda: 1_000_000.0)
    assert not gate.may_write_offline()


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
    manifest = {"epoch": epoch, "operationCount": 0}
    assert client.retire_offline_authority(manifest) == {"ok": True}
    snapshot_id = str(uuid4())
    assert client.offline_rights(epoch, snapshot_id) == {"ok": True}
    assert calls == [
        ("/ai-referent/agent/offline/authority:start?agentId=referent-pc", {}, "POST"),
        ("/ai-referent/agent/offline/authority:heartbeat",
         {"agentId": "referent-pc", "epoch": epoch}, "POST"),
        ("/ai-referent/agent/offline/authority:retire?agentId=referent-pc",
         manifest, "POST"),
        (f"/ai-referent/agent/offline/rights?agentId=referent-pc&epoch={epoch}",
         {"snapshotId": snapshot_id}, "POST"),
    ]


def test_client_uses_short_control_timeout_but_keeps_file_transfer_budget():
    class Response:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def read(self, _size):
            return b"{}"

    class Opener:
        def __init__(self):
            self.timeouts = []

        def open(self, _request, *, timeout):
            self.timeouts.append(timeout)
            return Response()

    client = WorkspaceClient.__new__(WorkspaceClient)
    client.api_url = "https://workspace.example/api/v1"
    client.token = "test-token"
    client.opener = Opener()
    client.transfer("/ai-referent/agent/offline/authority:heartbeat", b"{}",
                    method="POST", content_type="application/json")
    client.transfer("/ai-referent/agent/letters", b"{}",
                    method="POST", content_type="application/json")
    client.transfer("/ai-referent/agent/offline/blobs/digest", b"file", method="PUT")
    assert client.opener.timeouts == [5, 12, 40]


def test_client_uploads_only_verified_local_blob(monkeypatch):
    client = WorkspaceClient.__new__(WorkspaceClient)
    client.agent_id = "referent-pc"
    calls = []

    def transfer(path, body, *, method):
        calls.append((path, body, method))
        return b'{"id":"00000000-0000-0000-0000-000000000001"}'

    monkeypatch.setattr(client, "transfer", transfer)
    epoch = str(uuid4())
    digest = hashlib.sha256(b"document").hexdigest()
    assert client.upload_offline_blob(epoch, digest, b"document")["id"].endswith("1")
    assert calls == [
        (f"/ai-referent/agent/offline/blobs/{digest}?agentId=referent-pc&epoch={epoch}",
         b"document", "PUT")
    ]
    with pytest.raises(WorkspaceError, match="Контрольная сумма"):
        client.upload_offline_blob(epoch, digest, b"other bytes")
    assert len(calls) == 1


def test_last_verified_rights_replace_revoked_ids_atomically(tmp_path):
    journal = OfflineJournal(tmp_path)
    epoch = str(uuid4())
    journal.set_authority_phase("referent-pc", epoch, "online")

    def response(actor_ids, stamp, snapshot_id):
        actors = [{"telegramId": value, "userId": str(uuid4()),
                   "fullName": "Сотрудник", "role": "employee", "reviewerKeys": [],
                   "moduleActions": ["view", "create", "edit"]}
                  for value in actor_ids]
        canonical = json.dumps(actors, ensure_ascii=False, sort_keys=True,
                               separators=(",", ":"))
        return {"snapshotId": snapshot_id, "epoch": epoch,
                "actors": actors, "verifiedAt": stamp,
                "contentSha256": hashlib.sha256(canonical.encode()).hexdigest()}

    first_id = journal.prepare_offline_rights(epoch)
    assert OfflineJournal(tmp_path).prepare_offline_rights(epoch) == first_id
    first = response(["123"], "2026-09-25T12:00:00Z", first_id)
    journal.save_offline_rights(first)
    journal.save_offline_rights(first)
    assert journal.offline_actor("123")["telegramId"] == "123"
    later_id = journal.prepare_offline_rights(epoch)
    assert later_id != first_id
    later = response(["456"], "2026-09-25T12:00:01Z", later_id)
    journal.save_offline_rights(later)
    assert journal.offline_actor("123") is None
    assert journal.offline_actor("456")["telegramId"] == "456"
    unrequested = response(["789"], "2026-09-25T12:00:02Z", str(uuid4()))
    with pytest.raises(ValueError, match="сохранённому запросу"):
        journal.save_offline_rights(unrequested)
    with pytest.raises(ValueError, match="старой"):
        journal.save_offline_rights(first)
    damaged = dict(later, contentSha256="0" * 64)
    with pytest.raises(ValueError, match="сумма"):
        journal.save_offline_rights(damaged)
    assert journal.offline_actor("456") is not None
    with journal.connect() as connection:
        connection.execute(
            "UPDATE rights_snapshot SET epoch = ? WHERE id = 1", (str(uuid4()),)
        )
    assert journal.offline_actor("456") is None


def test_older_local_rights_table_is_upgraded_without_claiming_replay_evidence(tmp_path):
    with sqlite3.connect(tmp_path / "offline-journal.sqlite") as connection:
        connection.execute(
            "CREATE TABLE rights_snapshot (id INTEGER PRIMARY KEY, epoch TEXT NOT NULL, "
            "payload TEXT NOT NULL, verified_at TEXT NOT NULL, content_sha256 TEXT NOT NULL)"
        )
        connection.execute(
            "INSERT INTO rights_snapshot VALUES (1, ?, '[]', ?, ?)",
            (str(uuid4()), "2026-09-25T12:00:00+00:00", hashlib.sha256(b"[]").hexdigest()),
        )
    journal = OfflineJournal(tmp_path)
    assert journal.offline_rights_evidence() is None


def test_incompatible_rights_request_can_be_rejected_and_replaced(tmp_path):
    epoch = str(uuid4())
    with sqlite3.connect(tmp_path / "offline-journal.sqlite") as connection:
        connection.execute(
            "CREATE TABLE rights_requests (snapshot_id TEXT PRIMARY KEY, epoch TEXT NOT NULL, "
            "created_at TEXT NOT NULL, completed_at TEXT)"
        )
    journal = OfflineJournal(tmp_path)
    journal.set_authority_phase("referent-pc", epoch, "online")
    old_id = journal.prepare_offline_rights(epoch)
    old_actors = [{"telegramId": "123", "userId": str(uuid4()),
                   "fullName": "Сотрудник", "role": "employee", "reviewerKeys": []}]
    old_payload = json.dumps(old_actors, ensure_ascii=False, sort_keys=True,
                             separators=(",", ":"))
    with pytest.raises(ValueError, match="неверные ID или права"):
        journal.save_offline_rights({
            "snapshotId": old_id, "epoch": epoch, "actors": old_actors,
            "verifiedAt": "2026-09-28T12:00:00Z",
            "contentSha256": hashlib.sha256(old_payload.encode()).hexdigest(),
        })
    assert journal.offline_rights_evidence() is None
    journal.reject_offline_rights_request(old_id, epoch, "Старый формат без действий")
    journal.reject_offline_rights_request(old_id, epoch, "Старый формат без действий")
    new_id = OfflineJournal(tmp_path).prepare_offline_rights(epoch)
    assert new_id != old_id
    assert journal.offline_rights_evidence() is None
    with pytest.raises(ValueError, match="сохранённому запросу"):
        journal.save_offline_rights({
            "snapshotId": old_id, "epoch": epoch, "actors": [],
            "verifiedAt": "2026-09-28T12:00:00Z",
            "contentSha256": hashlib.sha256(b"[]").hexdigest(),
        })
    with pytest.raises(ValueError, match="Причина отказа"):
        journal.reject_offline_rights_request(old_id, epoch, "Другая причина")
