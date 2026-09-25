from __future__ import annotations

from uuid import uuid4

import pytest
from integrations.exat.workspace_integration.client import WorkspaceError
from integrations.exat.workspace_integration.offline_journal import OfflineJournal
from integrations.exat.workspace_integration.shared_bot import SharedBot
from integrations.exat.workspace_integration.state import State


def test_operation_and_blob_survive_reopen(tmp_path):
    journal = OfflineJournal(tmp_path / "offline")
    digest = journal.put_blob(b"private DOCX bytes")
    operation_id = str(uuid4())
    letter_id = str(uuid4())
    sequence = journal.append(
        operation_id=operation_id,
        actor_id="123456",
        letter_id=letter_id,
        kind="attachment.upload",
        payload={"fileName": "letter.docx"},
        blob_sha256=digest,
    )

    reopened = OfflineJournal(tmp_path / "offline")
    assert reopened.read_blob(digest) == b"private DOCX bytes"
    assert reopened.pending()[0]["sequence"] == sequence
    assert reopened.pending()[0]["payload"] == {"fileName": "letter.docx"}
    assert reopened.append(
        operation_id=operation_id,
        actor_id="123456",
        letter_id=letter_id,
        kind="attachment.upload",
        payload={"fileName": "letter.docx"},
        blob_sha256=digest,
    ) == sequence


def test_operation_id_cannot_be_reused_with_different_payload(tmp_path):
    journal = OfflineJournal(tmp_path)
    operation_id = str(uuid4())
    journal.append(operation_id=operation_id, actor_id="123", kind="create", payload={"x": 1})
    with pytest.raises(ValueError, match="другие данные"):
        journal.append(operation_id=operation_id, actor_id="123", kind="create", payload={"x": 2})


def test_missing_or_tampered_blob_is_rejected(tmp_path):
    journal = OfflineJournal(tmp_path)
    with pytest.raises(FileNotFoundError):
        journal.append(
            operation_id=str(uuid4()), actor_id="123", kind="upload",
            payload={}, blob_sha256="0" * 64,
        )
    digest = journal.put_blob(b"original")
    (tmp_path / "blobs" / digest).write_bytes(b"tampered")
    with pytest.raises(ValueError, match="Контрольная сумма"):
        journal.read_blob(digest)


def test_replay_is_strictly_ordered_and_stops_at_conflict(tmp_path):
    journal = OfflineJournal(tmp_path)
    first = journal.append(
        operation_id=str(uuid4()), actor_id="123", kind="create", payload={}
    )
    second = journal.append(
        operation_id=str(uuid4()), actor_id="123", kind="submit", payload={}
    )
    with pytest.raises(ValueError, match="по порядку"):
        journal.finish(second, accepted=True, result={"ok": True})
    journal.finish(first, accepted=False, result={"conflict": True})
    assert journal.pending() == []
    with pytest.raises(ValueError, match="уже зафиксирован"):
        journal.finish(first, accepted=True, result={"ok": True})


def test_snapshots_are_isolated_by_telegram_actor(tmp_path):
    journal = OfflineJournal(tmp_path)
    journal.cache("123", "/letters?sentOnly=true", {"letters": [{"id": "secret"}]})
    assert journal.snapshot("123", "/letters?sentOnly=true")["payload"]["letters"]
    assert journal.snapshot("456", "/letters?sentOnly=true") is None


def test_external_send_is_never_replayed_after_crash(tmp_path):
    effect_id = str(uuid4())
    letter_id = str(uuid4())
    journal = OfflineJournal(tmp_path)
    assert journal.begin_external_effect(effect_id, letter_id, "exat_send")
    reopened = OfflineJournal(tmp_path)
    assert not reopened.begin_external_effect(effect_id, letter_id, "exat_send")
    assert reopened.external_effect(effect_id)["outcome"] == "unknown"
    reopened.resolve_external_effect(effect_id, sent=True, evidence="Проверено в E-XAT")
    assert reopened.external_effect(effect_id)["outcome"] == "confirmed"
    assert not reopened.begin_external_effect(effect_id, letter_id, "exat_send")


def test_bot_reads_only_its_own_last_verified_server_snapshot(tmp_path):
    class API:
        def __init__(self):
            self.online = True

        def request(self, path, payload=None, *, method="GET", telegram_id=""):
            if not self.online:
                raise WorkspaceError("нет сети")
            assert path == "/ai-referent/agent/letters?sentOnly=true"
            return {"letters": [{"id": str(uuid4()), "status": "sent"}]}

    api = API()
    bot = SharedBot(None, api, State(tmp_path / "state.sqlite"), OfflineJournal(tmp_path / "cache"))
    path = "/letters?sentOnly=true"
    online = bot.request("123", path)
    api.online = False
    assert bot.request("123", path) == online
    assert bot.offline_read is True
    with pytest.raises(WorkspaceError, match="ещё не сохранено"):
        bot.request("456", path)
    with pytest.raises(WorkspaceError, match="нет сети"):
        bot.request("123", path, {"action": "approve"}, "POST")


def test_server_denial_is_not_hidden_by_cached_letter(tmp_path):
    class API:
        def request(self, path, payload=None, *, method="GET", telegram_id=""):
            raise WorkspaceError("Доступ отозван", 403)

    journal = OfflineJournal(tmp_path / "cache")
    journal.cache("123", "/letters?sentOnly=true", {"letters": []})
    bot = SharedBot(None, API(), State(tmp_path / "state.sqlite"), journal)
    with pytest.raises(WorkspaceError, match="Доступ отозван"):
        bot.request("123", "/letters?sentOnly=true")


def test_reserved_numbers_survive_restart_and_are_assigned_once(tmp_path):
    journal = OfflineJournal(tmp_path)
    request_id = journal.prepare_number_reservation("referent-test", 2)
    assert journal.prepare_number_reservation("referent-test", 2) == request_id
    from datetime import UTC, datetime

    current = datetime.now(UTC)
    response = {
        "reservationId": request_id,
        "agentId": "referent-test",
        "yearSuffix": current.strftime("%y"),
        "firstNumber": 901,
        "lastNumber": 902,
        "validUntil": datetime(current.year + 1, 1, 1, tzinfo=UTC).isoformat(),
    }
    journal.save_number_reservation(response)
    journal.save_number_reservation(response)
    letter_a, letter_b = str(uuid4()), str(uuid4())
    assert journal.take_reserved_number(letter_a, "referent-test") == (901, current.strftime("%y"))
    reopened = OfflineJournal(tmp_path)
    assert reopened.take_reserved_number(letter_a, "referent-test") == (
        901, current.strftime("%y")
    )
    assert reopened.take_reserved_number(letter_b, "referent-test") == (
        902, current.strftime("%y")
    )
    with pytest.raises(ValueError, match="Нет действующего резерва"):
        reopened.take_reserved_number(str(uuid4()), "referent-test")


def test_number_range_rejects_wrong_agent_overlap_and_changed_replay(tmp_path):
    from datetime import UTC, datetime

    journal = OfflineJournal(tmp_path)
    current = datetime.now(UTC)
    expiry = datetime(current.year + 1, 1, 1, tzinfo=UTC).isoformat()
    first = journal.prepare_number_reservation("referent-test", 2)
    response = {
        "reservationId": first, "agentId": "referent-test",
        "yearSuffix": current.strftime("%y"), "firstNumber": 100,
        "lastNumber": 101, "validUntil": expiry,
    }
    with pytest.raises(ValueError, match="не соответствует"):
        journal.save_number_reservation({**response, "agentId": "other-pc"})
    journal.save_number_reservation(response)
    with pytest.raises(ValueError, match="изменил"):
        journal.save_number_reservation({**response, "firstNumber": 101, "lastNumber": 102})
    second = journal.prepare_number_reservation("referent-test", 2)
    with pytest.raises(ValueError, match="пересекаются"):
        journal.save_number_reservation({**response, "reservationId": second})


def test_expired_or_wrong_year_reservation_never_becomes_spendable(tmp_path):
    from datetime import UTC, datetime, timedelta

    journal = OfflineJournal(tmp_path)
    request_id = journal.prepare_number_reservation("referent-test", 1)
    current = datetime.now(UTC)
    response = {
        "reservationId": request_id, "agentId": "referent-test",
        "yearSuffix": current.strftime("%y"), "firstNumber": 42,
        "lastNumber": 42,
        "validUntil": (current - timedelta(seconds=1)).isoformat(),
    }
    with pytest.raises(ValueError, match="недействительный"):
        journal.save_number_reservation(response)
    with pytest.raises(ValueError, match="недействительный"):
        journal.save_number_reservation({
            **response, "yearSuffix": f"{(current.year + 1) % 100:02d}",
            "validUntil": (current + timedelta(days=1)).isoformat(),
        })
    with pytest.raises(ValueError, match="Нет действующего резерва"):
        journal.take_reserved_number(str(uuid4()), "referent-test")
