"""Live control-plane transitions never invent an offline write lease."""

import hashlib
import json
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
from integrations.exat.workspace_integration.client import WorkspaceError
from integrations.exat.workspace_integration.offline_coordinator import OfflineCoordinator
from integrations.exat.workspace_integration.offline_journal import OfflineJournal


def _lease(epoch, mode="online", *, retire_requested=False):
    now = datetime.now(UTC)
    return {
        "epoch": epoch, "mode": mode, "serverTime": now.isoformat(),
        "leaseUntil": (now + timedelta(seconds=20)).isoformat(), "leaseSeconds": 20,
        "retireRequested": retire_requested,
    }


class Client:
    agent_id = "referent-pc"

    def __init__(self):
        self.epoch = str(uuid4())
        self.online = True
        self.mode = "online"
        self.rights_available = True
        self.rights_calls = 0
        self.reservation_calls = 0
        self.heartbeat_conflict = False
        self.heartbeat_calls = 0
        self.retire_requested = False
        self.retire_calls = 0
        self.lose_retire_reply = False

    def _check(self):
        if not self.online:
            raise WorkspaceError("нет связи", retryable=True)

    def start_offline_authority(self):
        self._check()
        return _lease(self.epoch, self.mode, retire_requested=self.retire_requested)

    def heartbeat_offline_authority(self, epoch):
        self.heartbeat_calls += 1
        self._check()
        assert epoch == self.epoch
        if self.heartbeat_conflict:
            raise WorkspaceError("аренда истекла", 409)
        return _lease(self.epoch, self.mode, retire_requested=self.retire_requested)

    def offline_rights(self, epoch, snapshot_id):
        self._check()
        if not self.rights_available:
            raise WorkspaceError("экспорт прав недоступен", retryable=True)
        self.rights_calls += 1
        actors = [{
            "telegramId": "123", "userId": str(uuid4()), "fullName": "Отправитель",
            "role": "employee", "reviewerKeys": [], "moduleActions": ["view", "create", "edit"],
        }]
        canonical = json.dumps(actors, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        return {
            "snapshotId": snapshot_id, "epoch": epoch, "actors": actors,
            "verifiedAt": datetime.now(UTC).isoformat(),
            "contentSha256": hashlib.sha256(canonical.encode()).hexdigest(),
        }

    def reserve_offline_numbers(self, reservation_id, count, epoch):
        self._check()
        assert epoch == self.epoch and count == 20
        self.reservation_calls += 1
        now = datetime.now(UTC)
        return {
            "reservationId": reservation_id, "agentId": self.agent_id,
            "yearSuffix": now.strftime("%y"), "firstNumber": 100,
            "lastNumber": 119,
            "validUntil": datetime(now.year + 1, 1, 1, tzinfo=UTC).isoformat(),
        }

    def complete_offline_replay(self, manifest):
        self._check()
        assert manifest["epoch"] == self.epoch
        assert manifest["operationCount"] == 0
        assert manifest["operationsSha256"] == hashlib.sha256(b"[]").hexdigest()
        self.epoch = str(uuid4())
        self.mode = "online"
        return _lease(self.epoch, retire_requested=self.retire_requested)

    def retire_offline_authority(self, manifest):
        self._check()
        assert manifest["epoch"] == self.epoch
        assert manifest["operationCount"] == 0
        self.retire_calls += 1
        if self.lose_retire_reply:
            self.lose_retire_reply = False
            raise WorkspaceError("retirement reply lost", retryable=True)
        return {"epoch": manifest["epoch"], "mode": "legacy"}


def test_coordinator_failover_and_replay_are_fenced(tmp_path):
    journal = OfflineJournal(tmp_path)
    client = Client()
    ticks = [100.0]
    coordinator = OfflineCoordinator(client, journal, clock=lambda: ticks[0])
    assert coordinator.tick() == "online"
    assert journal.offline_actor("123") is not None
    assert journal.available_reserved_numbers(client.agent_id) == 20
    assert (client.rights_calls, client.reservation_calls) == (1, 1)

    client.online = False
    ticks[0] = 124.9
    assert coordinator.tick() == "waiting"
    assert journal.authority_state()["phase"] == "online"
    ticks[0] = 125.0
    assert coordinator.tick() == "offline"
    assert journal.authority_state()["phase"] == "offline"
    assert client.heartbeat_calls == 1
    assert coordinator.tick() == "offline"

    client.online = True
    client.mode = "replay_required"
    assert coordinator.tick() == "replay"
    assert journal.authority_state()["phase"] == "replay"
    assert coordinator.tick() == "replay"


def test_coordinator_waits_after_restart_and_never_offlines_without_rights(tmp_path):
    journal = OfflineJournal(tmp_path)
    client = Client()
    client.rights_available = False
    first = OfflineCoordinator(client, journal, clock=lambda: 100.0)
    assert first.tick() == "online"
    assert journal.offline_rights_evidence() is None

    ticks = [1_000.0]
    restarted = OfflineCoordinator(
        client, OfflineJournal(tmp_path), clock=lambda: ticks[0]
    )
    client.online = False
    ticks[0] = 1_050.0
    assert restarted.tick() == "waiting"
    assert journal.authority_state()["phase"] == "online"


def test_only_spendable_current_year_numbers_count(tmp_path):
    journal = OfflineJournal(tmp_path)
    client = Client()
    request_id = journal.prepare_number_reservation(client.agent_id, 20)
    journal.save_number_reservation(
        client.reserve_offline_numbers(request_id, 20, client.epoch)
    )
    assert journal.available_reserved_numbers(client.agent_id) == 20
    journal.take_reserved_number(str(uuid4()), client.agent_id)
    assert journal.available_reserved_numbers(client.agent_id) == 19
    assert journal.available_reserved_numbers("other-pc") == 0


def test_recovered_server_conflict_moves_to_replay(tmp_path):
    journal = OfflineJournal(tmp_path)
    client = Client()
    coordinator = OfflineCoordinator(client, journal, clock=lambda: 100.0)
    assert coordinator.tick() == "online"
    client.heartbeat_conflict = True
    client.mode = "replay_required"
    assert coordinator.tick() == "replay"
    assert journal.authority_state()["phase"] == "replay"


def test_empty_replay_issues_new_epoch_and_restores_online(tmp_path):
    journal = OfflineJournal(tmp_path)
    client = Client()
    coordinator = OfflineCoordinator(client, journal, clock=lambda: 100.0)
    assert coordinator.tick() == "online"
    old_epoch = client.epoch
    client.mode = "replay_required"
    client.heartbeat_conflict = True
    assert coordinator.tick() == "replay"
    assert coordinator.replay_tick() == "online"
    assert journal.authority_state()["epoch"] == client.epoch
    assert client.epoch != old_epoch


def test_disable_retires_online_authority_and_returns_to_legacy(tmp_path):
    journal = OfflineJournal(tmp_path)
    client = Client()
    ticks = [100.0]
    coordinator = OfflineCoordinator(client, journal, clock=lambda: ticks[0])
    assert coordinator.tick() == "online"
    client.retire_requested = True
    assert coordinator.tick() == "legacy"
    assert journal.authority_state() is None
    assert client.retire_calls == 1
    ticks[0] = 120.0
    assert coordinator.tick() == "legacy"


def test_lost_retirement_reply_never_regrants_offline_authority(tmp_path):
    journal = OfflineJournal(tmp_path)
    client = Client()
    ticks = [100.0]
    coordinator = OfflineCoordinator(client, journal, clock=lambda: ticks[0])
    assert coordinator.tick() == "online"
    client.retire_requested = True
    client.lose_retire_reply = True
    assert coordinator.tick() == "blocked"
    assert journal.authority_state()["phase"] == "retiring"
    ticks[0] = 10_000.0
    assert not coordinator.gate.may_write_offline()
    restarted = OfflineCoordinator(client, OfflineJournal(tmp_path), clock=lambda: ticks[0])
    assert restarted.tick() == "legacy"
    assert journal.authority_state() is None
    assert client.retire_calls == 2


def test_disable_during_offline_replays_before_retirement(tmp_path):
    journal = OfflineJournal(tmp_path)
    client = Client()
    ticks = [100.0]
    coordinator = OfflineCoordinator(client, journal, clock=lambda: ticks[0])
    assert coordinator.tick() == "online"
    client.online = False
    ticks[0] = 150.0
    assert coordinator.tick() == "offline"
    client.online = True
    client.mode = "replay_required"
    client.retire_requested = True
    assert coordinator.tick() == "replay"
    assert coordinator.replay_tick() == "legacy"
    assert journal.authority_state() is None


def test_disable_signal_during_replay_does_not_skip_manifest(tmp_path):
    journal = OfflineJournal(tmp_path)
    client = Client()
    coordinator = OfflineCoordinator(client, journal, clock=lambda: 100.0)
    assert coordinator.tick() == "online"
    client.mode = "replay_required"
    client.retire_requested = True
    assert coordinator.tick() == "replay"
    assert journal.authority_state()["phase"] == "replay"
    assert coordinator.replay_tick() == "legacy"
    assert journal.authority_state() is None


def test_expired_local_deadline_does_not_offline_a_healthy_server(tmp_path):
    journal = OfflineJournal(tmp_path)
    client = Client()
    ticks = [100.0]
    coordinator = OfflineCoordinator(client, journal, clock=lambda: ticks[0])
    assert coordinator.tick() == "online"
    ticks[0] = 130.0
    assert coordinator.tick() == "online"
    assert journal.authority_state()["phase"] == "online"
    assert client.heartbeat_calls == 1


def test_lost_completion_reply_and_expired_lease_remain_recoverable(tmp_path):
    class LostReplyClient(Client):
        def __init__(self):
            super().__init__()
            self.first_epoch = self.epoch
            self.completion_calls = 0

        def complete_offline_replay(self, manifest):
            self.completion_calls += 1
            if self.completion_calls == 1:
                assert manifest["epoch"] == self.first_epoch
                self.epoch = str(uuid4())
                raise WorkspaceError("ответ потерян", retryable=True)
            if self.completion_calls == 2:
                assert manifest["epoch"] == self.first_epoch
                return _lease(self.epoch, "replay_required")
            assert manifest["epoch"] == self.epoch
            self.epoch = str(uuid4())
            return _lease(self.epoch)

    journal = OfflineJournal(tmp_path)
    client = LostReplyClient()
    coordinator = OfflineCoordinator(client, journal, clock=lambda: 100.0)
    assert coordinator.tick() == "online"
    client.mode = "replay_required"
    client.heartbeat_conflict = True
    assert coordinator.tick() == "replay"
    with pytest.raises(WorkspaceError, match="ответ потерян"):
        coordinator.replay_tick()
    assert journal.authority_state()["epoch"] == client.first_epoch
    assert coordinator.replay_tick() == "replay"
    assert journal.authority_state()["epoch"] == client.epoch
    assert journal.authority_state()["phase"] == "replay"
    assert coordinator.replay_tick() == "online"
    assert journal.authority_state()["phase"] == "online"


def test_disabled_server_authority_is_retried_without_polling_every_tick(tmp_path):
    class DisabledClient(Client):
        def __init__(self):
            super().__init__()
            self.start_calls = 0

        def start_offline_authority(self):
            self.start_calls += 1
            raise WorkspaceError("Автономный режим AI Referent пока не включён на сервере.", 409)

    client = DisabledClient()
    now = [100.0]
    coordinator = OfflineCoordinator(client, OfflineJournal(tmp_path), clock=lambda: now[0])
    assert coordinator.tick() == "legacy"
    now[0] = 130.0
    assert coordinator.tick() == "legacy"
    assert client.start_calls == 1
    now[0] = 160.0
    assert coordinator.tick() == "legacy"
    assert client.start_calls == 2
