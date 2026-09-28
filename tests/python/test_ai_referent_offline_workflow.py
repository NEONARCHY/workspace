"""Draft-only local reducer checks; this is not the live failover switch."""

from __future__ import annotations

import hashlib
import json
from datetime import UTC, datetime, timedelta
from unittest.mock import Mock
from uuid import NAMESPACE_URL, uuid4, uuid5

import pytest
from integrations.exat.workspace_integration.client import WorkspaceError
from integrations.exat.workspace_integration.offline_journal import OfflineJournal
from integrations.exat.workspace_integration.offline_prepare import OfflinePreparationWorker
from integrations.exat.workspace_integration.offline_replay import replay_one_draft_operation
from integrations.exat.workspace_integration.offline_workflow import OfflineWorkflow
from integrations.exat.workspace_integration.shared_bot import SharedBot
from integrations.exat.workspace_integration.state import State


def _offline_journal(tmp_path):
    journal = OfflineJournal(tmp_path)
    epoch = str(uuid4())
    creator = str(uuid4())
    stranger = str(uuid4())
    reviewer = str(uuid4())
    bobur = str(uuid4())
    operator = str(uuid4())
    journal.set_authority_phase("referent-pc", epoch, "online", lease_seconds=30)
    snapshot_id = journal.prepare_offline_rights(epoch)
    actors = [
        {
            "telegramId": telegram_id,
            "userId": user_id,
            "fullName": name,
            "moduleActions": actions,
            "reviewerKeys": (
                ["askar"] if telegram_id == "789" else ["bobur"] if telegram_id == "999" else []
            ),
            "role": "employee",
        }
        for telegram_id, user_id, name, actions in (
            ("123", creator, "Автор", ["view", "create", "edit"]),
            ("456", stranger, "Другой", ["view", "create", "edit"]),
            ("789", reviewer, "Согласующий", ["view", "approve"]),
            ("999", bobur, "Бобур", ["view", "approve"]),
            ("321", operator, "Референт", ["view", "admin"]),
        )
    ]
    encoded = json.dumps(actors, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    journal.save_offline_rights(
        {
            "snapshotId": snapshot_id,
            "epoch": epoch,
            "actors": actors,
            "verifiedAt": "2026-09-25T12:00:00Z",
            "contentSha256": hashlib.sha256(encoded.encode()).hexdigest(),
        }
    )
    journal.cache(
        "123",
        "/reviewers",
        {
            "reviewers": [
                {"userId": reviewer, "fullName": "Согласующий", "key": "askar", "canApprove": True},
                {"userId": bobur, "fullName": "Бобур", "key": "bobur", "canApprove": True},
            ]
        },
    )
    journal.set_authority_phase("referent-pc", epoch, "offline")
    return journal, creator, reviewer


def _draft(reviewer):
    return {
        "subject": "Письмо",
        "recipientOrganization": "Организация",
        "recipientAddress": "address@example.uz",
        "route": "exat",
        "note": "",
        "workflowKind": "delivery",
        "reviewerUserId": reviewer,
        "finalReviewerUserId": None,
    }


def test_draft_survives_restart_and_repeated_create(tmp_path):
    journal, creator, reviewer = _offline_journal(tmp_path)
    operation_id = str(uuid4())
    first = OfflineWorkflow(journal).create("123", operation_id, _draft(reviewer))
    after_restart = OfflineWorkflow(OfflineJournal(tmp_path))
    second = after_restart.create("123", operation_id, _draft(reviewer))
    assert second == first
    assert first["createdByUserId"] == creator
    assert first["reviewerName"] == "Согласующий"
    assert first["events"][0]["eventType"] == "letter.created"
    assert journal.offline_created_letter_ids() == [first["id"]]
    assert len(journal.pending_authorized()) == 1


def test_offline_list_includes_local_drafts_without_disclosing_them_to_strangers(tmp_path):
    journal, _, reviewer = _offline_journal(tmp_path)
    workflow = OfflineWorkflow(journal)
    draft = workflow.create("123", str(uuid4()), _draft(reviewer))
    own = workflow.list_letters("123", offset=0, limit=10, active_only=True)
    assert [letter["id"] for letter in own["letters"]] == [draft["id"]]
    assert own["totalCount"] == 1
    assert own["offlinePartial"] is True
    assert workflow.list_letters("456", offset=0, limit=10)["letters"] == []
    assert workflow.list_letters("789", offset=0, limit=10)["letters"][0]["id"] == draft["id"]
    assert workflow.list_letters("123", offset=0, limit=10, sent_only=True)["letters"] == []


def test_sent_history_does_not_leak_to_former_reviewer(tmp_path):
    journal, creator, reviewer = _offline_journal(tmp_path)
    letter_id = str(uuid4())
    sent = {
        **_draft(reviewer), "id": letter_id, "status": "sent",
        "createdByUserId": creator, "reviewerUserId": reviewer,
        "initialReviewerUserId": reviewer, "revision": 4,
        "updatedAt": "2026-09-25T12:00:00Z", "attachments": [], "events": [],
    }
    for actor in ("123", "789"):
        journal.cache(actor, "/letters/" + letter_id, sent)
    workflow = OfflineWorkflow(journal)
    assert workflow.read("123", letter_id)["status"] == "sent"
    with pytest.raises(WorkspaceError) as denied:
        workflow.read("789", letter_id)
    assert denied.value.status == 403
    assert workflow.list_letters("789", offset=0, limit=10, sent_only=True)["letters"] == []


def test_shared_bot_routes_offline_letter_actions_without_contacting_server(tmp_path):
    journal, _, reviewer = _offline_journal(tmp_path)
    api = Mock()
    api.request.side_effect = AssertionError("offline action contacted Workspace")
    bot = SharedBot(None, api, State(tmp_path / "bot.sqlite"), journal)
    letter = bot.request(
        "123", "/letters", {**_draft(reviewer), "operationId": str(uuid4())}, "POST"
    )
    assert bot.request("123", f"/letters/{letter['id']}")["id"] == letter["id"]
    assert bot.request("123", "/letters?offset=0&limit=10&activeOnly=true")[
        "letters"
    ][0]["id"] == letter["id"]
    assert bot.request("123", "/reviewers")["reviewers"][0]["key"] == "askar"
    with pytest.raises(WorkspaceError) as denied:
        bot.request("456", f"/letters/{letter['id']}")
    assert denied.value.status == 403
    with pytest.raises(WorkspaceError) as unsupported:
        bot.request("123", f"/letters/{letter['id']}/delete", {"operationId": str(uuid4())},
                    "POST")
    assert unsupported.value.status == 503
    api.request.assert_not_called()


def test_shared_bot_checks_uploaded_docx_before_reviewer_selection(tmp_path, monkeypatch):
    journal, _, _ = _offline_journal(tmp_path)
    api = Mock()
    api.request.side_effect = AssertionError("offline action contacted Workspace")
    bot = SharedBot(None, api, State(tmp_path / "bot.sqlite"), journal)
    letter = bot.request("123", "/letters", {
        **_draft(None), "operationId": str(uuid4()),
    }, "POST")
    bot.upload_attachment(
        "123", letter["id"], str(uuid4()), file_name="letter.docx",
        content=b"safe test docx", role="primary", expected_revision=1,
    )
    packet = bot.request("123", "/packets/outgoing/" + letter["id"])
    assert len(packet["files"]) == 1
    attachment = packet["files"][0]
    assert bot.download_packet_file(
        "123", "outgoing", letter["id"], attachment["id"], "attachment"
    ) == b"safe test docx"
    with pytest.raises(WorkspaceError) as denied:
        bot.download_packet_file(
            "456", "outgoing", letter["id"], attachment["id"], "attachment"
        )
    assert denied.value.status == 403
    from integrations.exat.workspace_integration import preflight

    checks = []

    def fake_check(_facsimile, draft, reviewers, kind):
        checks.append((draft.read_bytes(), reviewers, kind))
        return ["askar"]

    monkeypatch.setattr(preflight, "check_document", fake_check)
    assert bot.check_offline_documents(Mock()) is True
    checked = bot.request("123", "/letters/" + letter["id"])
    assert checked["documentCheck"]["status"] == "passed"
    assert checked["documentCheck"]["reviewerKeys"] == ["askar"]
    assert checks[0][0] == b"safe test docx"
    assert bot.check_offline_documents(Mock()) is False
    api.request.assert_not_called()
    api.transfer.assert_not_called()


def test_shared_bot_never_uses_offline_writes_during_replay(tmp_path):
    journal, _, reviewer = _offline_journal(tmp_path)
    api = Mock()
    api.request.return_value = {"from": "server"}
    bot = SharedBot(None, api, State(tmp_path / "bot.sqlite"), journal)
    epoch = journal.authority_state()["epoch"]
    journal.set_authority_phase("referent-pc", epoch, "replay")
    assert bot.request("123", "/letters", {**_draft(reviewer), "operationId": str(uuid4())},
                       "POST") == {"from": "server"}
    api.request.assert_called_once()
    assert journal.pending_authorized() == []


def test_update_rejects_stale_revision_and_foreign_actor(tmp_path):
    journal, _, reviewer = _offline_journal(tmp_path)
    workflow = OfflineWorkflow(journal)
    letter = workflow.create("123", str(uuid4()), _draft(reviewer))
    with pytest.raises(WorkspaceError) as denied:
        workflow.read("456", letter["id"])
    assert denied.value.status == 403
    updated = workflow.update(
        "123",
        letter["id"],
        str(uuid4()),
        {
            **_draft(reviewer),
            "subject": "Исправлено",
            "expectedRevision": 1,
        },
    )
    assert updated["revision"] == 2
    assert updated["subject"] == "Исправлено"
    assert updated["events"][-1]["eventType"] == "letter.updated"
    with pytest.raises(WorkspaceError) as stale:
        workflow.update(
            "123",
            letter["id"],
            str(uuid4()),
            {
                **_draft(reviewer),
                "expectedRevision": 1,
            },
        )
    assert stale.value.status == 409
    assert len(journal.pending_authorized()) == 2


def test_draft_requires_verified_rights_and_offline_phase(tmp_path):
    journal, _, reviewer = _offline_journal(tmp_path)
    workflow = OfflineWorkflow(journal)
    with pytest.raises(WorkspaceError) as denied:
        workflow.create("000", str(uuid4()), _draft(reviewer))
    assert denied.value.status == 403
    journal.set_authority_phase("referent-pc", journal.authority_state()["epoch"], "replay")
    with pytest.raises(WorkspaceError) as fenced:
        workflow.create("123", str(uuid4()), _draft(reviewer))
    assert fenced.value.status == 503


def test_acknowledged_operations_are_not_applied_twice_over_server_snapshot(tmp_path):
    journal, _, reviewer = _offline_journal(tmp_path)
    workflow = OfflineWorkflow(journal)
    letter = workflow.create("123", str(uuid4()), _draft(reviewer))
    pending = journal.pending_authorized()[0]
    journal.finish(pending["sequence"], accepted=True, result={"id": letter["id"]})
    journal.cache("123", "/letters/" + letter["id"], letter)
    assert workflow.read("123", letter["id"]) == letter
    assert journal.offline_created_letter_ids() == []


def test_replay_retains_frozen_base_after_acknowledging_create(tmp_path):
    journal, _, reviewer = _offline_journal(tmp_path)
    workflow = OfflineWorkflow(journal)
    letter = workflow.create("123", str(uuid4()), _draft(reviewer))
    updated = workflow.update(
        "123", letter["id"], str(uuid4()),
        {**_draft(reviewer), "subject": "After offline edit", "expectedRevision": 1},
    )
    epoch = journal.authority_state()["epoch"]
    journal.set_authority_phase("referent-pc", epoch, "replay")

    class Client:
        def __init__(self):
            self.requests = []

        def replay_offline_operation(self, requested_epoch, operation):
            assert requested_epoch == epoch
            self.requests.append(operation)
            if len(self.requests) == 1:
                raise WorkspaceError("Ответ сервера потерян.", retryable=True)
            return {
                "operationId": operation["operationId"],
                "sequence": operation["sequence"],
                "letterId": operation["letterId"],
                "resultRevision": (
                    operation["payload"].get("expectedRevision", 0) + 1
                ),
                "acceptedAt": "2026-09-28T12:00:00Z",
            }

    client = Client()
    with pytest.raises(WorkspaceError):
        replay_one_draft_operation(journal, client)
    assert len(journal.pending_authorized()) == 2
    assert replay_one_draft_operation(journal, client)
    assert client.requests[0] == client.requests[1]
    assert len(journal.pending_authorized()) == 1
    assert journal.offline_created_letter_ids() == [letter["id"]]
    journal.cache("123", "/letters/" + letter["id"], {**letter, "subject": "Partial"})
    assert workflow.read("123", letter["id"]) == updated
    assert replay_one_draft_operation(journal, client)
    assert journal.pending_authorized() == []
    assert workflow.read("123", letter["id"]) == updated
    assert replay_one_draft_operation(journal, client) is False


def test_replay_stages_attachment_before_operation(tmp_path):
    journal, _, reviewer = _offline_journal(tmp_path)
    workflow = OfflineWorkflow(journal)
    letter = workflow.create("123", str(uuid4()), _draft(reviewer))
    content = b"locally durable attachment"
    attached = workflow.attach(
        "123", letter["id"], str(uuid4()), file_name="letter.docx",
        content=content, role="primary", expected_revision=1,
    )
    workflow.check_document(
        "123", letter["id"], str(uuid4()), lambda *_: ["askar"]
    )
    workflow.act(
        "123", letter["id"], str(uuid4()), action="submit", expected_revision=2
    )
    epoch = journal.authority_state()["epoch"]
    journal.set_authority_phase("referent-pc", epoch, "replay")

    class Client:
        def __init__(self):
            self.staged = []
            self.operations = []

        def upload_offline_blob(self, requested_epoch, digest, body):
            self.staged.append((requested_epoch, digest, body))
            return {
                "id": str(uuid4()), "epoch": requested_epoch,
                "sha256": digest, "byteSize": len(body),
            }

        def replay_offline_operation(self, requested_epoch, operation):
            assert requested_epoch == epoch
            if operation["kind"] == "letter.attachment":
                assert self.staged == [(epoch, attached["sha256"], content)]
            self.operations.append(operation)
            return {
                "operationId": operation["operationId"],
                "sequence": operation["sequence"],
                "letterId": operation["letterId"],
                "resultRevision": operation["payload"].get("expectedRevision", 0)
                + (operation["kind"] != "letter.document_check"),
                "acceptedAt": "2026-09-28T12:00:00Z",
            }

    client = Client()
    assert replay_one_draft_operation(journal, client)
    assert replay_one_draft_operation(journal, client)
    assert replay_one_draft_operation(journal, client)
    assert replay_one_draft_operation(journal, client)
    assert journal.pending_authorized() == []
    assert len(client.operations) == 4
    assert workflow.read("123", letter["id"])["revision"] == 3
    assert workflow.read("123", letter["id"])["status"] == "pending_review"
    assert workflow.read("123", letter["id"])["documentCheck"]["status"] == "passed"


def test_replay_voice_preserves_revision_and_stages_blob(tmp_path):
    journal, _, reviewer = _offline_journal(tmp_path)
    letter_id = str(uuid4())
    voice = b"OggS" + b"\0" * 8 + b"OpusHead" + b"\0" * 8
    digest = journal.put_blob(voice)
    operation_id = str(uuid4())
    journal.append_with_rights_evidence(
        operation_id=operation_id, actor_id="789", letter_id=letter_id,
        kind="letter.comment_audio", required_action="approve",
        blob_sha256=digest,
        payload={
            "revision": 7, "durationMs": 1000, "byteSize": len(voice),
            "contentType": "audio/ogg", "actorUserId": reviewer,
            "actorName": "Согласующий",
        },
    )
    epoch = journal.authority_state()["epoch"]
    journal.set_authority_phase("referent-pc", epoch, "replay")

    class Client:
        def __init__(self):
            self.staged = None

        def upload_offline_blob(self, requested_epoch, requested_digest, body):
            self.staged = (requested_epoch, requested_digest, body)
            return {
                "id": str(uuid4()), "epoch": requested_epoch,
                "sha256": requested_digest, "byteSize": len(body),
            }

        def replay_offline_operation(self, requested_epoch, operation):
            assert self.staged == (epoch, digest, voice)
            assert requested_epoch == epoch
            assert operation["kind"] == "letter.comment_audio"
            return {
                "operationId": operation_id, "sequence": operation["sequence"],
                "letterId": letter_id, "resultRevision": 7,
                "acceptedAt": "2026-09-28T12:00:00Z",
            }

    client = Client()
    assert replay_one_draft_operation(journal, client)
    assert journal.pending_authorized() == []


def test_idempotency_cannot_change_draft_payload(tmp_path):
    journal, _, reviewer = _offline_journal(tmp_path)
    workflow = OfflineWorkflow(journal)
    operation_id = str(uuid4())
    workflow.create("123", operation_id, _draft(reviewer))
    with pytest.raises(ValueError, match="другие данные"):
        workflow.create("123", operation_id, {**_draft(reviewer), "subject": "Другое"})
    assert len(journal.pending_authorized()) == 1


def test_unknown_reviewer_is_rejected_before_journaling(tmp_path):
    journal, _, reviewer = _offline_journal(tmp_path)
    workflow = OfflineWorkflow(journal)
    with pytest.raises(WorkspaceError) as invalid:
        workflow.create("123", str(uuid4()), _draft(str(uuid4())))
    assert invalid.value.status == 422
    with pytest.raises(WorkspaceError) as invalid_route:
        workflow.create(
            "123",
            str(uuid4()),
            {
                **_draft(reviewer),
                "finalReviewerUserId": reviewer,
            },
        )
    assert invalid_route.value.status == 422
    assert journal.pending_authorized() == []


def test_attachment_bytes_and_versions_survive_restart(tmp_path):
    journal, _, reviewer = _offline_journal(tmp_path)
    workflow = OfflineWorkflow(journal)
    letter = workflow.create("123", str(uuid4()), _draft(reviewer))
    operation_id = str(uuid4())
    primary = workflow.attach(
        "123",
        letter["id"],
        operation_id,
        file_name="letter.docx",
        content=b"first document",
        role="primary",
        expected_revision=1,
    )
    reopened = OfflineWorkflow(OfflineJournal(tmp_path))
    assert (
        reopened.attach(
            "123",
            letter["id"],
            operation_id,
            file_name="letter.docx",
            content=b"first document",
            role="primary",
            expected_revision=1,
        )
        == primary
    )
    with pytest.raises(WorkspaceError) as stale:
        reopened.attach(
            "123", letter["id"], str(uuid4()), file_name="letter.docx",
            content=b"first document", role="primary", expected_revision=1,
        )
    assert stale.value.status == 409
    assert len(journal.pending_authorized()) == 2
    assert journal.read_blob(primary["sha256"]) == b"first document"
    second = reopened.attach(
        "123",
        letter["id"],
        str(uuid4()),
        file_name="revised.docx",
        content=b"second document",
        role="primary",
        expected_revision=2,
    )
    attachments = reopened.read("123", letter["id"])["attachments"]
    assert [(item["id"], item["documentRole"]) for item in attachments] == [
        (primary["id"], "general"),
        (second["id"], "primary"),
    ]
    assert set(journal.pending_blob_hashes()) == {primary["sha256"], second["sha256"]}


def test_attachment_rejects_stale_or_foreign_write(tmp_path):
    journal, _, reviewer = _offline_journal(tmp_path)
    workflow = OfflineWorkflow(journal)
    letter = workflow.create("123", str(uuid4()), _draft(reviewer))
    with pytest.raises(WorkspaceError) as foreign:
        workflow.attach(
            "456",
            letter["id"],
            str(uuid4()),
            file_name="letter.docx",
            content=b"document",
            role="primary",
            expected_revision=1,
        )
    assert foreign.value.status == 403
    with pytest.raises(WorkspaceError) as invalid:
        workflow.attach(
            "123",
            letter["id"],
            str(uuid4()),
            file_name="../letter.docx",
            content=b"document",
            role="primary",
            expected_revision=1,
        )
    assert invalid.value.status == 422
    workflow.update(
        "123",
        letter["id"],
        str(uuid4()),
        {
            **_draft(reviewer),
            "expectedRevision": 1,
        },
    )
    with pytest.raises(WorkspaceError) as stale:
        workflow.attach(
            "123",
            letter["id"],
            str(uuid4()),
            file_name="letter.docx",
            content=b"document",
            role="primary",
            expected_revision=1,
        )
    assert stale.value.status == 409
    assert journal.pending_blob_hashes() == []


def test_local_preflight_is_durable_and_never_guesses_success(tmp_path):
    journal, _, reviewer = _offline_journal(tmp_path)
    workflow = OfflineWorkflow(journal)
    letter = workflow.create("123", str(uuid4()), _draft(reviewer))
    workflow.attach(
        "123",
        letter["id"],
        str(uuid4()),
        file_name="letter.docx",
        content=b"docx",
        role="primary",
        expected_revision=1,
    )
    calls = []

    def checker(path, reviewers, kind):
        calls.append((path.read_bytes(), reviewers, kind))
        return ["askar"]

    operation_id = str(uuid4())
    result = workflow.check_document("123", letter["id"], operation_id, checker)
    assert result["status"] == "passed"
    assert calls == [
        (
            b"docx",
            [
                {"key": "askar", "name": "Согласующий"},
                {"key": "bobur", "name": "Бобур"},
            ],
            "delivery",
        )
    ]
    reopened = OfflineWorkflow(OfflineJournal(tmp_path))
    assert reopened.check_document("123", letter["id"], operation_id, checker) == result
    assert len(calls) == 1
    reopened.attach(
        "123",
        letter["id"],
        str(uuid4()),
        file_name="new.docx",
        content=b"new docx",
        role="primary",
        expected_revision=2,
    )
    assert reopened.read("123", letter["id"])["documentCheck"] is None

    def crashed(path, reviewers, kind):
        raise RuntimeError("Word failed")

    failed = reopened.check_document("123", letter["id"], str(uuid4()), crashed)
    assert failed["status"] == "failed"
    assert "IT-специалисту" in failed["detail"]


def test_offline_submission_and_final_review_require_number_reserve(tmp_path):
    journal, _, reviewer = _offline_journal(tmp_path)
    workflow = OfflineWorkflow(journal)
    letter = workflow.create("123", str(uuid4()), _draft(reviewer))
    assert workflow.read("123", letter["id"])["availableActions"] == ["cancel"]
    workflow.attach(
        "123",
        letter["id"],
        str(uuid4()),
        file_name="letter.docx",
        content=b"docx",
        role="primary",
        expected_revision=1,
    )
    workflow.check_document("123", letter["id"], str(uuid4()), lambda *_: ["askar"])
    assert "submit" in workflow.read("123", letter["id"])["availableActions"]
    submitted = workflow.act(
        "123",
        letter["id"],
        str(uuid4()),
        action="submit",
        expected_revision=2,
    )
    assert submitted["status"] == "pending_review"
    assert submitted["revision"] == 3
    assert "approve" in workflow.read("789", letter["id"])["availableActions"]
    decision_id = str(uuid4())
    with pytest.raises(WorkspaceError, match="резерва"):
        workflow.act(
            "789",
            letter["id"],
            decision_id,
            action="approve",
            expected_revision=3,
        )
    assert workflow.read("789", letter["id"])["status"] == "pending_review"
    reservation_id = journal.prepare_number_reservation("referent-pc", 1)
    now = datetime.now(UTC)
    journal.save_number_reservation(
        {
            "reservationId": reservation_id,
            "agentId": "referent-pc",
            "yearSuffix": now.strftime("%y"),
            "firstNumber": 439,
            "lastNumber": 439,
            "validUntil": (now + timedelta(days=1)).isoformat(),
        }
    )
    approved = workflow.act(
        "789",
        letter["id"],
        decision_id,
        action="approve",
        expected_revision=3,
    )
    assert approved["status"] == "queued"
    assert approved["outgoingNumber"] == 439
    assert approved["displayNumber"].startswith("0439/")
    assert journal.available_reserved_numbers("referent-pc") == 0
    assert OfflineWorkflow(OfflineJournal(tmp_path)).read("123", letter["id"])["status"] == "queued"
    with pytest.raises(WorkspaceError, match="PDF"):
        workflow.record_prepared("789", letter["id"], decision_id, b"not a PDF")
    signed = b"%PDF-1.7 signed example"
    prepared = workflow.record_prepared("789", letter["id"], decision_id, signed)
    assert prepared["status"] == "referent_review_pending"
    assert prepared["revision"] == 5
    assert workflow.record_prepared("789", letter["id"], decision_id, signed) == prepared
    with pytest.raises(WorkspaceError, match="другой PDF"):
        workflow.record_prepared("789", letter["id"], decision_id, b"%PDF-different")
    packet = workflow.packet("123", letter["id"])
    assert [(item["id"], item["source"]) for item in packet["files"]] == [
        (prepared["finalPdfFileId"], "packet")
    ]
    assert workflow.packet_file("123", letter["id"], prepared["finalPdfFileId"], "packet") == signed


def test_offline_executor_reuses_local_document_and_never_contacts_workspace(tmp_path):
    journal, _, reviewer = _offline_journal(tmp_path)
    workflow = OfflineWorkflow(journal)
    letter = workflow.create("123", str(uuid4()), _draft(reviewer))
    workflow.attach(
        "123", letter["id"], str(uuid4()), file_name="letter.docx",
        content=b"original docx", role="primary", expected_revision=1,
    )
    workflow.check_document("123", letter["id"], str(uuid4()), lambda *_: ["askar"])
    workflow.act("123", letter["id"], str(uuid4()), action="submit", expected_revision=2)
    reservation_id = journal.prepare_number_reservation("referent-pc", 1)
    now = datetime.now(UTC)
    journal.save_number_reservation({
        "reservationId": reservation_id, "agentId": "referent-pc",
        "yearSuffix": now.strftime("%y"), "firstNumber": 440, "lastNumber": 440,
        "validUntil": (now + timedelta(days=1)).isoformat(),
    })
    approval_id = str(uuid4())
    workflow.act("789", letter["id"], approval_id, action="approve", expected_revision=3)
    worker = Mock()

    def prepare(job, *, file_loader, record_signed):
        assert job["outgoingNumber"] == 440
        assert job["requiresFinalCheck"] is True
        assert job["id"] == str(uuid5(NAMESPACE_URL, "ai-offline-command:" + approval_id))
        draft = file_loader(job, job["files"][0], tmp_path / "download")
        assert draft.read_bytes() == b"original docx"
        signed = tmp_path / "signed.pdf"
        signed.write_bytes(b"%PDF-1.7 locally signed")
        record_signed(signed)

    worker.prepare.side_effect = prepare
    executor = OfflinePreparationWorker(worker, journal)
    assert executor.run_once() is True
    worker.prepare.assert_called_once()
    assert executor.run_once() is False
    assert workflow.read("123", letter["id"])["status"] == "referent_review_pending"


def test_reviewer_return_requires_comment_and_preserves_author_access(tmp_path):
    journal, _, reviewer = _offline_journal(tmp_path)
    workflow = OfflineWorkflow(journal)
    letter = workflow.create("123", str(uuid4()), _draft(reviewer))
    workflow.attach(
        "123",
        letter["id"],
        str(uuid4()),
        file_name="letter.docx",
        content=b"docx",
        role="primary",
        expected_revision=1,
    )
    workflow.check_document("123", letter["id"], str(uuid4()), lambda *_: ["askar"])
    workflow.act("123", letter["id"], str(uuid4()), action="submit", expected_revision=2)
    with pytest.raises(WorkspaceError) as missing_comment:
        workflow.act(
            "789",
            letter["id"],
            str(uuid4()),
            action="return_for_revision",
            expected_revision=3,
        )
    assert missing_comment.value.status == 422
    returned = workflow.act(
        "789",
        letter["id"],
        str(uuid4()),
        action="return_for_revision",
        expected_revision=3,
        comment="Исправьте дату",
    )
    assert returned["status"] == "needs_revision"
    assert returned["events"][-1]["comment"] == "Исправьте дату"
    assert OfflineWorkflow(OfflineJournal(tmp_path)).read("123", letter["id"])["canEdit"]


def test_bobur_route_keeps_preliminary_reviewer_first(tmp_path):
    journal, _, reviewer = _offline_journal(tmp_path)
    bobur = journal.offline_actor("999")["userId"]
    workflow = OfflineWorkflow(journal)
    letter = workflow.create(
        "123",
        str(uuid4()),
        {
            **_draft(bobur),
            "finalReviewerUserId": reviewer,
        },
    )
    assert letter["reviewerUserId"] == reviewer
    assert letter["finalReviewerUserId"] == bobur
    workflow.attach(
        "123",
        letter["id"],
        str(uuid4()),
        file_name="letter.docx",
        content=b"docx",
        role="primary",
        expected_revision=1,
    )
    workflow.check_document("123", letter["id"], str(uuid4()), lambda *_: ["bobur"])
    workflow.act("123", letter["id"], str(uuid4()), action="submit", expected_revision=2)
    first = workflow.act("789", letter["id"], str(uuid4()), action="approve", expected_revision=3)
    assert first["status"] == "pending_review"
    assert first["reviewerUserId"] == bobur
    assert first["revision"] == 4
    assert "approve" not in workflow.read("789", letter["id"])["availableActions"]
    assert "approve" in workflow.read("999", letter["id"])["availableActions"]


def test_voice_return_is_bound_to_reviewer_and_revision(tmp_path):
    journal, _, reviewer = _offline_journal(tmp_path)
    workflow = OfflineWorkflow(journal)
    letter = workflow.create("123", str(uuid4()), _draft(reviewer))
    workflow.attach(
        "123",
        letter["id"],
        str(uuid4()),
        file_name="letter.docx",
        content=b"docx",
        role="primary",
        expected_revision=1,
    )
    workflow.check_document("123", letter["id"], str(uuid4()), lambda *_: ["askar"])
    workflow.act("123", letter["id"], str(uuid4()), action="submit", expected_revision=2)
    audio_bytes = b"OggS" + b"\0" * 8 + b"OpusHead" + b"\0" * 8
    audio_operation = str(uuid4())
    with pytest.raises(WorkspaceError) as invalid:
        workflow.save_comment_audio(
            "789",
            letter["id"],
            str(uuid4()),
            expected_revision=3,
            duration_ms=1000,
            content=b"not opus",
            content_type="audio/ogg",
        )
    assert invalid.value.status == 422
    audio = workflow.save_comment_audio(
        "789",
        letter["id"],
        audio_operation,
        expected_revision=3,
        duration_ms=1000,
        content=audio_bytes,
        content_type="audio/ogg",
    )
    with pytest.raises(WorkspaceError) as foreign:
        workflow.act(
            "999",
            letter["id"],
            str(uuid4()),
            action="return_for_revision",
            expected_revision=3,
            comment_audio_id=audio["id"],
        )
    assert foreign.value.status in {403, 422}
    returned = workflow.act(
        "789",
        letter["id"],
        str(uuid4()),
        action="return_for_revision",
        expected_revision=3,
        comment_audio_id=audio["id"],
    )
    assert returned["status"] == "needs_revision"
    assert returned["events"][-1]["audio"] == audio
    assert (
        OfflineWorkflow(OfflineJournal(tmp_path)).read("123", letter["id"])["events"][-1]["audio"]
        == audio
    )
    assert (
        workflow.save_comment_audio(
            "789",
            letter["id"],
            audio_operation,
            expected_revision=3,
            duration_ms=1000,
            content=audio_bytes,
            content_type="audio/ogg",
        )
        == audio
    )
    assert workflow.comment_audio_file("123", letter["id"], audio["id"]) == audio_bytes
    with pytest.raises(WorkspaceError) as private:
        workflow.comment_audio_file("789", letter["id"], audio["id"])
    assert private.value.status == 403
    api, telegram = Mock(), Mock()
    api.request.side_effect = AssertionError("offline voice contacted Workspace")
    telegram._multipart_api.return_value = {"ok": True}
    bot = SharedBot(telegram, api, State(tmp_path / "voice-bot.sqlite"), journal)
    bot.show = Mock()
    bot.offline_notifications()
    telegram._multipart_api.assert_called_once()
    bot.offline_notifications()
    telegram._multipart_api.assert_called_once()
    api.request.assert_not_called()


def test_bobur_can_return_prepared_pdf_and_offline_notice_reaches_him(tmp_path):
    journal, _, reviewer = _offline_journal(tmp_path)
    bobur = journal.offline_actor("999")["userId"]
    workflow = OfflineWorkflow(journal)
    letter = workflow.create("123", str(uuid4()), {
        **_draft(reviewer), "finalReviewerUserId": bobur,
    })
    workflow.attach(
        "123", letter["id"], str(uuid4()), file_name="letter.docx",
        content=b"docx", role="primary", expected_revision=1,
    )
    workflow.check_document(
        "123", letter["id"], str(uuid4()), lambda *_: ["askar", "bobur"]
    )
    workflow.act("123", letter["id"], str(uuid4()), action="submit", expected_revision=2)
    workflow.act("789", letter["id"], str(uuid4()), action="approve", expected_revision=3)
    reservation_id = journal.prepare_number_reservation("referent-pc", 1)
    now = datetime.now(UTC)
    journal.save_number_reservation({
        "reservationId": reservation_id, "agentId": "referent-pc",
        "yearSuffix": now.strftime("%y"), "firstNumber": 441, "lastNumber": 441,
        "validUntil": (now + timedelta(days=1)).isoformat(),
    })
    approval_id = str(uuid4())
    workflow.act("999", letter["id"], approval_id, action="approve", expected_revision=4)
    prepared = workflow.record_prepared("999", letter["id"], approval_id, b"%PDF-1.7 test")
    assert prepared["status"] == "awaiting_final_send"
    assert "return_for_revision" in prepared["availableActions"]
    assert "release_delivery" not in prepared["availableActions"]
    api, telegram = Mock(), Mock()
    api.request.side_effect = AssertionError("offline notice contacted Workspace")
    telegram.send_document.return_value = {"ok": True}
    bot = SharedBot(telegram, api, State(tmp_path / "bot.sqlite"), journal)
    bot.show = Mock()
    bot.offline_notifications()
    assert telegram.send_document.call_count == 2  # Author and Bobur receive signed PDF.
    bot.offline_notifications()
    assert telegram.send_document.call_count == 2
    api.request.assert_not_called()
    returned = workflow.act(
        "999", letter["id"], str(uuid4()), action="return_for_revision",
        expected_revision=6, comment="Исправьте дату",
    )
    assert returned["status"] == "needs_revision"
    assert returned["finalPdfFileId"] is None
    assert returned["reviewerUserId"] == reviewer
    assert workflow.read("123", letter["id"])["canEdit"]
    assert all(
        item["source"] != "packet"
        for item in workflow.packet("123", letter["id"])["files"]
    )
    assert any(
        item["name"].endswith("letter.docx")
        for item in workflow.packet("123", letter["id"])["files"]
    )
    bot.offline_notifications()
    assert bot.state.get("comment-delivered:123:" + returned["events"][-1]["id"])
    workflow.attach(
        "123", letter["id"], str(uuid4()), file_name="revised.docx",
        content=b"revised", role="primary", expected_revision=7,
    )
    workflow.check_document(
        "123", letter["id"], str(uuid4()), lambda *_: ["askar", "bobur"]
    )
    workflow.act("123", letter["id"], str(uuid4()), action="submit", expected_revision=8)
    workflow.act("789", letter["id"], str(uuid4()), action="approve", expected_revision=9)
    again = workflow.act(
        "999", letter["id"], str(uuid4()), action="approve", expected_revision=10
    )
    assert again["outgoingNumber"] == 441  # Reuse the assigned number, not another reserve.


def test_referent_can_return_prepared_letter_but_not_review_as_reviewer(tmp_path):
    journal, _, reviewer = _offline_journal(tmp_path)
    workflow = OfflineWorkflow(journal)
    letter = workflow.create("123", str(uuid4()), _draft(reviewer))
    workflow.attach(
        "123", letter["id"], str(uuid4()), file_name="letter.docx",
        content=b"docx", role="primary", expected_revision=1,
    )
    workflow.check_document("123", letter["id"], str(uuid4()), lambda *_: ["askar"])
    workflow.act("123", letter["id"], str(uuid4()), action="submit", expected_revision=2)
    with pytest.raises(WorkspaceError):
        workflow.act("321", letter["id"], str(uuid4()), action="approve", expected_revision=3)
    reservation_id = journal.prepare_number_reservation("referent-pc", 1)
    now = datetime.now(UTC)
    journal.save_number_reservation({
        "reservationId": reservation_id, "agentId": "referent-pc",
        "yearSuffix": now.strftime("%y"), "firstNumber": 442, "lastNumber": 442,
        "validUntil": (now + timedelta(days=1)).isoformat(),
    })
    approval_id = str(uuid4())
    workflow.act("789", letter["id"], approval_id, action="approve", expected_revision=3)
    workflow.record_prepared("789", letter["id"], approval_id, b"%PDF-1.7 test")
    admin_letter = workflow.read("321", letter["id"])
    assert admin_letter["availableActions"] == ["return_for_revision"]
    returned = workflow.act(
        "321", letter["id"], str(uuid4()), action="return_for_revision",
        expected_revision=5, comment="Нужна новая версия",
    )
    assert returned["status"] == "needs_revision"
    assert workflow.read("123", letter["id"])["finalPdfFileId"] is None
    assert any(
        item["name"].endswith("letter.docx")
        for item in workflow.packet("123", letter["id"])["files"]
    )
    with pytest.raises(WorkspaceError) as after_return:
        workflow.read("321", letter["id"])
    assert after_return.value.status == 403
    action = journal.letter_operations(letter["id"])[-1]
    assert action["required_action"] == "admin"


def test_sign_only_pages_are_durable_downloadable_and_notified_offline(tmp_path):
    journal, _, reviewer = _offline_journal(tmp_path)
    workflow = OfflineWorkflow(journal)
    letter = workflow.create("123", str(uuid4()), {
        **_draft(reviewer), "workflowKind": "sign_only",
        "recipientOrganization": "Подписание без отправки", "recipientAddress": "",
    })
    workflow.attach(
        "123", letter["id"], str(uuid4()), file_name="letter.docx",
        content=b"source docx", role="primary", expected_revision=1,
    )
    workflow.check_document("123", letter["id"], str(uuid4()), lambda *_: ["askar"])
    workflow.act("123", letter["id"], str(uuid4()), action="submit", expected_revision=2)
    approval_id = str(uuid4())
    workflow.act("789", letter["id"], approval_id, action="approve", expected_revision=3)
    worker = Mock()

    def sign_only(job, *, file_loader, record_signed_pages):
        assert job["kind"] == "sign_only"
        assert file_loader(job, job["files"][0], tmp_path / "source").read_bytes() == b"source docx"
        pages = []
        for index in (1, 2):
            path = tmp_path / f"{index:03d}.pdf"
            path.write_bytes(f"%PDF-1.7 page {index}".encode())
            pages.append(path)
        record_signed_pages(pages)

    worker.sign_only.side_effect = sign_only
    assert OfflinePreparationWorker(worker, journal).run_once()
    assert not OfflinePreparationWorker(worker, journal).run_once()
    signed = OfflineWorkflow(OfflineJournal(tmp_path)).read("123", letter["id"])
    assert signed["status"] == "signed"
    packet = workflow.packet("123", letter["id"])["files"]
    pages = [item for item in packet if item["source"] == "packet"]
    assert [item["name"].rsplit("/", 1)[1] for item in pages] == ["001.pdf", "002.pdf"]
    for index, page in enumerate(pages, 1):
        assert workflow.packet_file("123", letter["id"], page["id"], "packet") == (
            f"%PDF-1.7 page {index}".encode()
        )
    with pytest.raises(WorkspaceError):
        workflow.packet_file("456", letter["id"], pages[0]["id"], "packet")
    api, telegram = Mock(), Mock()
    api.request.side_effect = AssertionError("offline signed pages contacted Workspace")
    telegram.send_document.return_value = {"ok": True}
    bot = SharedBot(telegram, api, State(tmp_path / "signed-bot.sqlite"), journal)
    bot.show = Mock()
    bot.offline_notifications()
    assert telegram.send_document.call_count == 2
    bot.offline_notifications()
    assert telegram.send_document.call_count == 2
    api.request.assert_not_called()
