"""Live control-plane transitions never invent an offline write lease."""

import hashlib
import json
from datetime import UTC, datetime, timedelta
from uuid import uuid4

from integrations.exat.workspace_integration.client import WorkspaceError
from integrations.exat.workspace_integration.offline_coordinator import OfflineCoordinator
from integrations.exat.workspace_integration.offline_journal import OfflineJournal


def _lease(epoch, mode="online"):
    now = datetime.now(UTC)
    return {
        "epoch": epoch, "mode": mode, "serverTime": now.isoformat(),
        "leaseUntil": (now + timedelta(seconds=45)).isoformat(), "leaseSeconds": 45,
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

    def _check(self):
        if not self.online:
            raise WorkspaceError("нет связи", retryable=True)

    def start_offline_authority(self):
        self._check()
        return _lease(self.epoch, self.mode)

    def heartbeat_offline_authority(self, epoch):
        self._check()
        assert epoch == self.epoch
        return _lease(self.epoch, self.mode)

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
    ticks[0] = 149.9
    assert coordinator.tick() == "waiting"
    assert journal.authority_state()["phase"] == "online"
    ticks[0] = 150.0
    assert coordinator.tick() == "offline"
    assert journal.authority_state()["phase"] == "offline"
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
