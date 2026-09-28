"""Background read-model seeding never widens Telegram access or writes after failover."""

from __future__ import annotations

import hashlib
import json
from unittest.mock import Mock
from uuid import uuid4

import pytest
from integrations.exat.workspace_integration.client import WorkspaceError
from integrations.exat.workspace_integration.offline_journal import OfflineJournal
from integrations.exat.workspace_integration.offline_prefetch import OfflineSnapshotSeeder
from integrations.exat.workspace_integration.offline_workflow import OfflineWorkflow
from integrations.exat.workspace_integration.shared_bot import SharedBot
from integrations.exat.workspace_integration.state import State


def _journal(tmp_path, *, admin=False):
    journal = OfflineJournal(tmp_path)
    epoch = str(uuid4())
    journal.set_authority_phase("referent-pc", epoch, "online", lease_seconds=30)
    snapshot_id = journal.prepare_offline_rights(epoch)
    actors = [{
        "telegramId": "123", "userId": str(uuid4()), "fullName": "Сотрудник",
        "moduleActions": ["view", "create", "edit"] + (["admin"] if admin else []),
        "reviewerKeys": [],
        "role": "employee",
    }]
    encoded = json.dumps(actors, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    journal.save_offline_rights({
        "snapshotId": snapshot_id, "epoch": epoch, "actors": actors,
        "verifiedAt": "2026-09-28T10:00:00Z",
        "contentSha256": hashlib.sha256(encoded.encode()).hexdigest(),
    })
    return journal, epoch


def test_prefetch_seeds_actor_scoped_pages_without_blocking_heartbeat(tmp_path):
    journal, _ = _journal(tmp_path)
    ids = [str(uuid4()), str(uuid4())]
    client = Mock()

    def request(path, *, telegram_id):
        assert telegram_id == "123"
        if path.endswith("/reviewers"):
            return {"reviewers": [{"key": "askar"}]}
        if "/recipients?" in path:
            return {"entries": [], "totalCount": 0}
        if "/letters/" in path and "/letters/progress" not in path:
            return {"id": path.rsplit("/", 1)[-1], "events": []}
        if "activeOnly" in path and "offset=0" in path:
            return {"letters": [{"id": ids[0]}], "totalCount": 101}
        if "activeOnly" in path:
            return {"letters": [{"id": ids[1]}], "totalCount": 101}
        return {"letters": [], "totalCount": 0}

    client.request.side_effect = request
    seeder = OfflineSnapshotSeeder(client, journal, clock=lambda: 100.0)
    assert [seeder.tick() for _ in range(10)] == [True] * 10
    assert journal.snapshot("123", "/reviewers")["payload"]["reviewers"][0]["key"] == "askar"
    assert journal.cached_letter_ids("123") == sorted(ids)
    assert all(call.kwargs["telegram_id"] == "123" for call in client.request.call_args_list)
    assert seeder.tick() is False


def test_prefetch_discards_response_when_authority_turns_offline(tmp_path):
    journal, epoch = _journal(tmp_path)
    client = Mock()

    def disconnect(_path, *, telegram_id):
        assert telegram_id == "123"
        journal.set_authority_phase("referent-pc", epoch, "offline")
        return {"reviewers": [{"key": "askar"}]}

    client.request.side_effect = disconnect
    seeder = OfflineSnapshotSeeder(client, journal)
    assert seeder.tick() is False
    assert journal.snapshot("123", "/reviewers") is None
    assert seeder.tick() is False
    assert client.request.call_count == 1


def test_prefetch_guard_rejects_write_after_phase_changes(tmp_path):
    journal, epoch = _journal(tmp_path)
    rights_hash = journal.offline_rights_evidence()["content_sha256"]
    journal.set_authority_phase("referent-pc", epoch, "offline")
    assert journal.cache(
        "123", "/reviewers", {"reviewers": []},
        expected_epoch=epoch, expected_rights_hash=rights_hash,
    ) is False
    assert journal.snapshot("123", "/reviewers") is None


def test_offline_admin_sees_only_cached_foreign_stage(tmp_path):
    journal, epoch = _journal(tmp_path, admin=True)
    letter_id = str(uuid4())
    stage = {
        "id": letter_id, "status": "pending_review", "displayNumber": None,
        "createdByName": "Другой сотрудник", "createdAt": "2026-09-28T10:00:00Z",
        "subject": "Закрытая тема письма",
    }
    client = Mock()

    def request(path, *, telegram_id):
        assert telegram_id == "123"
        if "/letters/progress?" in path:
            return {"letters": [stage], "totalCount": 1}
        if path.endswith("/reviewers"):
            return {"reviewers": []}
        if "/recipients?" in path:
            return {"entries": [], "totalCount": 0}
        return {"letters": [], "totalCount": 0}

    client.request.side_effect = request
    seeder = OfflineSnapshotSeeder(client, journal)
    assert all(seeder.tick() for _ in range(6))
    journal.set_authority_phase("referent-pc", epoch, "offline")
    workflow = OfflineWorkflow(journal)
    assert workflow.progress_list("123", offset=0, limit=10)["letters"] == [stage]
    assert workflow.progress_item("123", letter_id) == stage
    with pytest.raises(WorkspaceError) as error:
        workflow.read("123", letter_id)
    assert error.value.status == 404

    telegram = Mock()
    telegram.send_message.return_value = {"ok": True, "result": {"message_id": 1}}
    bot = SharedBot(telegram, client, State(tmp_path / "state.sqlite"), journal)
    bot.history("123", "pending", 0)
    markup = telegram.send_message.call_args.kwargs["reply_markup"]["inline_keyboard"]
    assert markup[0][0]["callback_data"] == "g:" + letter_id.replace("-", "")
    assert "Закрытая тема" not in telegram.send_message.call_args.args[1]
    bot.show_progress("123", letter_id)
    message = telegram.send_message.call_args.args[1]
    assert "Последний сохранённый этап" in message
    assert "Закрытая тема" not in message
    markup = telegram.send_message.call_args.kwargs["reply_markup"]["inline_keyboard"]
    assert all("Обновить этап" not in button["text"] for row in markup for button in row)


def test_offline_non_admin_cannot_read_foreign_progress(tmp_path):
    journal, epoch = _journal(tmp_path)
    letter_id = str(uuid4())
    journal.cache("123", "/letters/progress?offset=0&limit=100", {
        "letters": [{"id": letter_id, "status": "pending_review"}],
    })
    journal.set_authority_phase("referent-pc", epoch, "offline")
    workflow = OfflineWorkflow(journal)
    assert workflow.progress_list("123", offset=0, limit=10)["letters"] == []
    with pytest.raises(WorkspaceError) as error:
        workflow.progress_item("123", letter_id)
    assert error.value.status == 404


def test_prefetch_hydrates_old_letter_files_for_offline_download(tmp_path):
    journal, epoch = _journal(tmp_path)
    actor = journal.offline_actor("123")
    letter_id, file_id, signed_id = str(uuid4()), str(uuid4()), str(uuid4())
    draft, signed = b"saved DOCX from Workspace", b"%PDF-saved signed copy"
    draft_hash, signed_hash = hashlib.sha256(draft).hexdigest(), hashlib.sha256(signed).hexdigest()
    letter = {
        "id": letter_id, "status": "pending_review", "revision": 3,
        "updatedAt": "2026-09-28T10:00:00Z", "createdAt": "2026-09-28T09:00:00Z",
        "createdByUserId": actor["userId"], "createdByName": "Сотрудник",
        "reviewerUserId": str(uuid4()), "reviewerName": "Руководитель",
        "finalReviewerUserId": None, "initialReviewerUserId": None,
        "subject": "Письмо", "recipientOrganization": "Организация",
        "recipientAddress": "office@example.uz", "route": "webmail", "note": "",
        "workflowKind": "delivery", "attachments": [], "events": [],
    }
    files = [
        {"id": file_id, "name": f"original/{file_id}/letter.docx", "source": "attachment",
         "sha256": draft_hash, "byteSize": len(draft), "createdAt": letter["createdAt"]},
        {"id": signed_id, "name": "signed/result.pdf", "source": "packet",
         "sha256": signed_hash, "byteSize": len(signed), "createdAt": letter["createdAt"]},
    ]
    client = Mock()

    def request(path, *, telegram_id):
        assert telegram_id == "123"
        if path.endswith("/reviewers"):
            return {"reviewers": []}
        if "/recipients?" in path:
            return {"entries": [], "totalCount": 0}
        if "/packets/outgoing/" in path:
            return {"files": files}
        if "/letters/" in path:
            return letter
        if "activeOnly" in path:
            return {"letters": [letter], "totalCount": 1}
        return {"letters": [], "totalCount": 0}

    def transfer(path, *, telegram_id):
        assert telegram_id == "123"
        return draft if file_id in path else signed

    client.request.side_effect = request
    client.transfer.side_effect = transfer
    seeder = OfflineSnapshotSeeder(client, journal, clock=lambda: 100.0)
    assert [seeder.tick() for _ in range(9)] == [True] * 9
    assert seeder.tick() is False
    journal.set_authority_phase("referent-pc", epoch, "offline")
    bot = SharedBot(None, client, State(tmp_path / "state.sqlite"), journal)
    assert bot.download_packet_file("123", "outgoing", letter_id, file_id, "attachment") == draft
    assert bot.download_packet_file("123", "outgoing", letter_id, signed_id, "packet") == signed
    with pytest.raises(WorkspaceError) as error:
        bot.download_packet_file("456", "outgoing", letter_id, file_id, "attachment")
    assert error.value.status == 403
    assert client.transfer.call_count == 2


def test_prefetch_hydrates_old_letter_history_and_private_voice(tmp_path):
    journal, epoch = _journal(tmp_path)
    actor = journal.offline_actor("123")
    letter_id, audio_id = str(uuid4()), str(uuid4())
    voice = b"OggS saved voice note"
    letter = {
        "id": letter_id, "status": "needs_revision", "revision": 3,
        "updatedAt": "2026-09-28T10:00:00Z", "createdAt": "2026-09-28T09:00:00Z",
        "createdByUserId": actor["userId"], "createdByName": "Сотрудник",
        "reviewerUserId": str(uuid4()), "reviewerName": "Руководитель",
        "finalReviewerUserId": None, "initialReviewerUserId": None,
        "subject": "Письмо", "recipientOrganization": "Организация",
        "recipientAddress": "office@example.uz", "route": "webmail", "note": "",
        "workflowKind": "delivery", "attachments": [], "events": [{
            "id": str(uuid4()), "eventType": "letter.return_for_revision",
            "actorUserId": str(uuid4()), "actorName": "Руководитель",
            "fromStatus": "pending_review", "toStatus": "needs_revision",
            "comment": "Голосовое замечание", "createdAt": "2026-09-28T10:00:00Z",
            "audio": {"id": audio_id, "contentType": "audio/ogg",
                      "byteSize": len(voice), "durationMs": 1500},
        }],
    }
    client = Mock()

    def request(path, *, telegram_id):
        assert telegram_id == "123"
        if path.endswith("/reviewers"):
            return {"reviewers": []}
        if "/recipients?" in path:
            return {"entries": [], "totalCount": 0}
        if path == "/ai-referent/agent/letters/" + letter_id:
            return letter
        if "/packets/outgoing/" in path:
            return {"files": []}
        if "activeOnly" in path:
            return {"letters": [letter], "totalCount": 1}
        return {"letters": [], "totalCount": 0}

    def transfer(path, *, telegram_id):
        assert path.endswith("/comment-audio/" + audio_id)
        assert telegram_id == "123"
        return voice

    client.request.side_effect = request
    client.transfer.side_effect = transfer
    seeder = OfflineSnapshotSeeder(client, journal, clock=lambda: 100.0)
    assert all(seeder.tick() for _ in range(8))
    assert seeder.tick() is False
    journal.set_authority_phase("referent-pc", epoch, "offline")
    workflow = OfflineWorkflow(journal)
    assert workflow.read("123", letter_id)["events"][0]["audio"]["id"] == audio_id
    assert workflow.comment_audio_file("123", letter_id, audio_id) == voice
    with pytest.raises(WorkspaceError) as forbidden:
        workflow.comment_audio_file("456", letter_id, audio_id)
    assert forbidden.value.status == 403
    assert client.transfer.call_count == 1


def test_prefetch_rejects_file_with_wrong_hash(tmp_path):
    journal, epoch = _journal(tmp_path)
    expected = hashlib.sha256(b"correct").hexdigest()
    client = Mock()
    client.transfer.return_value = b"wrongee"
    seeder = OfflineSnapshotSeeder(client, journal)
    seeder._file_jobs.append(("123", str(uuid4()), str(uuid4()), expected, 7, "attachment"))
    with pytest.raises(WorkspaceError, match="Контрольная сумма"):
        seeder._fetch_file(epoch, journal.offline_rights_evidence()["content_sha256"])
    assert not journal.blob_available(expected, 7)
