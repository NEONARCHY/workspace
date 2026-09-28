from __future__ import annotations

import hashlib
import json
import sqlite3
from uuid import uuid4

import pytest
from integrations.exat.workspace_integration.client import WorkspaceError
from integrations.exat.workspace_integration.offline_journal import OfflineJournal
from integrations.exat.workspace_integration.offline_replay import stage_pending_blobs
from integrations.exat.workspace_integration.shared_bot import SharedBot, poll_durable_updates
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
    with pytest.raises(ValueError, match="без подтверждённых прав"):
        reopened.pending_authorized()


def test_authorized_operation_carries_immutable_rights_evidence(tmp_path):
    journal = OfflineJournal(tmp_path)
    epoch = str(uuid4())
    journal.set_authority_phase("referent-pc", epoch, "online")
    snapshot_id = journal.prepare_offline_rights(epoch)
    actors = [{
        "telegramId": "123", "userId": str(uuid4()), "fullName": "Отправитель",
        "role": "employee", "reviewerKeys": [],
        "moduleActions": ["view", "create", "edit"],
    }]
    payload = json.dumps(actors, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    digest = hashlib.sha256(payload.encode()).hexdigest()
    journal.save_offline_rights({
        "snapshotId": snapshot_id, "epoch": epoch, "actors": actors,
        "verifiedAt": "2026-09-28T12:00:00Z", "contentSha256": digest,
    })
    operation_id = str(uuid4())
    args = {
        "operation_id": operation_id, "actor_id": "123", "kind": "letter.create",
        "payload": {"subject": "Письмо"}, "required_action": "create",
    }
    with pytest.raises(ValueError, match="автономной эпохи"):
        journal.append_with_rights_evidence(**args)
    journal.set_authority_phase("referent-pc", epoch, "offline")
    sequence = journal.append_with_rights_evidence(**args)
    saved = OfflineJournal(tmp_path).pending_authorized()[0]
    assert saved["sequence"] == sequence
    assert saved["authority_epoch"] == epoch
    assert saved["rights_snapshot_id"] == snapshot_id
    assert saved["rights_content_sha256"] == digest
    assert saved["required_action"] == "create"
    with pytest.raises(ValueError, match="подтверждённого права"):
        journal.append_with_rights_evidence(**{**args, "operation_id": str(uuid4()),
                                    "required_action": "approve"})
    journal.set_authority_phase("referent-pc", epoch, "replay")
    assert journal.append_with_rights_evidence(**args) == sequence
    with pytest.raises(ValueError, match="автономной эпохи"):
        journal.append_with_rights_evidence(**{**args, "operation_id": str(uuid4())})


def test_old_local_operations_are_migrated_without_inventing_rights(tmp_path):
    with sqlite3.connect(tmp_path / "offline-journal.sqlite") as connection:
        connection.execute(
            "CREATE TABLE operations (sequence INTEGER PRIMARY KEY AUTOINCREMENT, "
            "operation_id TEXT NOT NULL UNIQUE, actor_id TEXT NOT NULL, letter_id TEXT, "
            "kind TEXT NOT NULL, payload TEXT NOT NULL, blob_sha256 TEXT, "
            "occurred_at TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', result TEXT)"
        )
        connection.execute(
            "INSERT INTO operations (operation_id, actor_id, kind, payload, occurred_at) "
            "VALUES (?, '123', 'create', '{}', '2026-09-28T12:00:00+00:00')",
            (str(uuid4()),),
        )
    journal = OfflineJournal(tmp_path)
    assert journal.pending()[0]["rights_snapshot_id"] is None
    with pytest.raises(ValueError, match="без подтверждённых прав"):
        journal.pending_authorized()


def test_staging_only_pending_referenced_blobs_is_retry_safe(tmp_path):
    journal = OfflineJournal(tmp_path)
    first = journal.put_blob(b"letter")
    orphan = journal.put_blob(b"unreferenced")
    second = journal.put_blob(b"voice")
    for digest in (first, first, second):
        journal.append(
            operation_id=str(uuid4()), actor_id="123", kind="upload",
            payload={}, blob_sha256=digest,
        )
    assert orphan not in journal.pending_blob_hashes()
    assert journal.pending_blob_hashes() == [first, second]
    epoch = str(uuid4())

    class Client:
        def __init__(self):
            self.calls = []

        def upload_offline_blob(self, received_epoch, digest, content):
            self.calls.append((received_epoch, digest, content))
            return {"id": str(uuid4()), "epoch": received_epoch,
                    "sha256": digest, "byteSize": len(content)}

    client = Client()
    assert stage_pending_blobs(journal, client, epoch) == [first, second]
    assert stage_pending_blobs(OfflineJournal(tmp_path), client, epoch) == [first, second]
    assert [item[1] for item in client.calls] == [first, second, first, second]
    assert all(item[0] == epoch for item in client.calls)


def test_mismatched_staging_receipt_keeps_local_operation_pending(tmp_path):
    journal = OfflineJournal(tmp_path)
    digest = journal.put_blob(b"letter")
    journal.append(
        operation_id=str(uuid4()), actor_id="123", kind="upload",
        payload={}, blob_sha256=digest,
    )

    class Client:
        def upload_offline_blob(self, epoch, sha256, content):
            return {"id": str(uuid4()), "epoch": epoch,
                    "sha256": "0" * 64, "byteSize": len(content)}

    with pytest.raises(ValueError, match="другой автономный файл"):
        stage_pending_blobs(journal, Client(), str(uuid4()))
    assert len(journal.pending()) == 1


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
    assert not reopened.begin_external_effect(str(uuid4()), letter_id, "exat_send")
    assert not reopened.begin_external_effect(str(uuid4()), letter_id, "webmail_send")
    with pytest.raises(ValueError, match="другому письму"):
        reopened.begin_external_effect(effect_id, str(uuid4()), "exat_send")


def test_replay_manifest_requires_all_receipts_and_new_epoch(tmp_path):
    journal = OfflineJournal(tmp_path)
    old_epoch, new_epoch = str(uuid4()), str(uuid4())
    journal.set_authority_phase("referent-pc", old_epoch, "online")
    operation_id = str(uuid4())
    sequence = journal.append(
        operation_id=operation_id, actor_id="123", kind="letter.create", payload={}
    )
    with journal.connect() as connection:
        connection.execute(
            "UPDATE operations SET authority_epoch = ? WHERE sequence = ?",
            (old_epoch, sequence),
        )
    journal.set_authority_phase("referent-pc", old_epoch, "replay")
    with pytest.raises(ValueError, match="без подтверждения"):
        journal.replay_manifest()
    receipt = {"operationId": operation_id, "sequence": sequence}
    journal.finish(sequence, accepted=True, result=receipt)
    manifest = journal.replay_manifest()
    assert manifest == {
        "epoch": old_epoch, "operationCount": 1,
        "lastSequence": sequence,
        "operationsSha256": hashlib.sha256(
            json.dumps([[sequence, operation_id]], separators=(",", ":")).encode()
        ).hexdigest(),
        "externalEffectCount": 0,
    }
    with pytest.raises(ValueError, match="Журнал изменился"):
        journal.finish_replay(old_epoch, new_epoch, 45, {**manifest, "operationCount": 0})
    journal.finish_replay(old_epoch, new_epoch, 45, manifest)
    assert OfflineJournal(tmp_path).authority_state()["epoch"] == new_epoch
    assert journal.authority_state()["phase"] == "online"


def test_replay_cannot_finish_with_unknown_external_effect(tmp_path):
    journal = OfflineJournal(tmp_path)
    epoch = str(uuid4())
    journal.set_authority_phase("referent-pc", epoch, "online")
    journal.begin_external_effect(str(uuid4()), str(uuid4()), "exat_send")
    journal.set_authority_phase("referent-pc", epoch, "replay")
    with pytest.raises(ValueError, match="Внешние отправки"):
        journal.replay_manifest()


def test_expired_replay_receipt_advances_epoch_without_enabling_writes(tmp_path):
    journal = OfflineJournal(tmp_path)
    old_epoch, new_epoch = str(uuid4()), str(uuid4())
    journal.set_authority_phase("referent-pc", old_epoch, "online")
    journal.set_authority_phase("referent-pc", old_epoch, "replay")
    manifest = journal.replay_manifest()
    journal.finish_replay(old_epoch, new_epoch, 45, manifest, next_phase="replay")
    assert journal.authority_state()["phase"] == "replay"
    assert journal.replay_manifest()["epoch"] == new_epoch


def test_telegram_update_is_durable_before_offset_advances(tmp_path):
    journal = OfflineJournal(tmp_path)
    assert journal.initialize_telegram_offset(15) == 15
    updates = [{"update_id": 17, "message": {"text": "/new"}},
               {"update_id": 16, "message": {"text": "/history"}}]
    assert journal.receive_telegram_updates(updates) == 18
    reopened = OfflineJournal(tmp_path)
    assert reopened.initialize_telegram_offset(999) == 18  # Migration never rewinds.
    assert [item["update_id"] for item in reopened.pending_telegram_updates()] == [16, 17]
    reopened.mark_telegram_update_handled(16)
    pending = OfflineJournal(tmp_path).pending_telegram_updates()
    assert [item["update_id"] for item in pending] == [17]
    assert reopened.receive_telegram_updates(updates) == 18
    with pytest.raises(ValueError, match="другие данные"):
        reopened.receive_telegram_updates([{"update_id": 17, "message": {"text": "changed"}}])
    with pytest.raises(ValueError, match="вне журнала"):
        reopened.receive_telegram_updates([{"update_id": 15}])
    assert reopened.telegram_offset() == 18


def test_telegram_inbox_batch_rolls_back_with_cursor(tmp_path):
    journal = OfflineJournal(tmp_path)
    journal.initialize_telegram_offset(None)
    with pytest.raises(ValueError, match="повторный update_id"):
        journal.receive_telegram_updates([{"update_id": 1}, {"update_id": 1}])
    assert journal.telegram_offset() == 0
    assert journal.pending_telegram_updates() == []
    with pytest.raises(ValueError, match="корректного ID"):
        journal.receive_telegram_updates([{"update_id": True}])


def test_poll_replays_saved_update_before_fetching_more(tmp_path):
    journal = OfflineJournal(tmp_path)
    journal.initialize_telegram_offset(5)
    fetched = []
    handled = []

    class Telegram:
        def get_updates(self, *, offset):
            fetched.append(offset)
            return {"result": [{"update_id": 5, "message": {"text": "/new"}}]}

    class Controller:
        def handle(self, update):
            assert OfflineJournal(tmp_path).telegram_offset() == 6
            assert OfflineJournal(tmp_path).pending_telegram_updates() == [update]
            handled.append(update["update_id"])
            if len(handled) == 1:
                raise RuntimeError("Process stopped after receiving the update")

    with pytest.raises(RuntimeError, match="Process stopped"):
        poll_durable_updates(Telegram(), Controller(), journal)
    assert fetched == [5]
    assert poll_durable_updates(Telegram(), Controller(), OfflineJournal(tmp_path)) == 1
    assert fetched == [5]  # Replay came from disk, not Telegram.
    assert handled == [5, 5]
    assert journal.pending_telegram_updates() == []


def test_retryable_workspace_failure_keeps_telegram_action_until_recovery(tmp_path):
    update = {
        "update_id": 42,
        "message": {
            "from": {"id": 123},
            "chat": {"id": 123, "type": "private"},
            "text": "/pending",
        },
    }

    class Telegram:
        def __init__(self):
            self.sent = []
            self.deleted = []

        def get_updates(self, *, offset):
            assert offset == 0
            return {"result": [update]}

        def send_message(self, actor, message, *, reply_markup):
            self.sent.append((actor, message, reply_markup))
            return {"ok": True, "result": {"message_id": len(self.sent)}}

        def delete_message(self, actor, message_id):
            self.deleted.append((actor, message_id))
            return {"ok": True}

    class API:
        online = False

        def request(self, path, payload=None, *, method="GET", telegram_id=""):
            if not self.online:
                raise WorkspaceError("нет сети", retryable=True)
            assert telegram_id == "123"
            assert path in {
                "/ai-referent/agent/letters?offset=0&limit=10&activeOnly=true",
                "/ai-referent/agent/letters/progress?offset=0&limit=10",
            }
            return {"letters": []}

    journal = OfflineJournal(tmp_path / "offline")
    journal.initialize_telegram_offset(None)
    telegram = Telegram()
    api = API()
    bot = SharedBot(telegram, api, State(tmp_path / "state.sqlite"), journal)

    with pytest.raises(WorkspaceError, match="ещё не сохранено"):
        poll_durable_updates(telegram, bot, journal)
    assert journal.pending_telegram_updates() == [update]
    assert len(telegram.sent) == 1

    with pytest.raises(WorkspaceError, match="ещё не сохранено"):
        poll_durable_updates(telegram, bot, journal)
    assert journal.pending_telegram_updates() == [update]
    assert len(telegram.sent) == 1

    api.online = True
    assert poll_durable_updates(telegram, bot, journal) == 1
    assert journal.pending_telegram_updates() == []
    assert telegram.deleted == [("123", 1)]


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
