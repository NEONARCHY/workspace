"""Draft-only local reducer checks; this is not the live failover switch."""

from __future__ import annotations

import hashlib
import json
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
from integrations.exat.workspace_integration.client import WorkspaceError
from integrations.exat.workspace_integration.offline_journal import OfflineJournal
from integrations.exat.workspace_integration.offline_workflow import OfflineWorkflow


def _offline_journal(tmp_path):
    journal = OfflineJournal(tmp_path)
    epoch = str(uuid4())
    creator = str(uuid4())
    stranger = str(uuid4())
    reviewer = str(uuid4())
    bobur = str(uuid4())
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
    assert (
        reopened.attach(
            "123",
            letter["id"],
            str(uuid4()),
            file_name="letter.docx",
            content=b"first document",
            role="primary",
            expected_revision=1,
        )
        == primary
    )
    assert len(journal.pending_authorized()) == 2
    assert journal.read_blob(primary["sha256"]) == b"first document"
    second = reopened.attach(
        "123",
        letter["id"],
        str(uuid4()),
        file_name="revised.docx",
        content=b"second document",
        role="primary",
        expected_revision=1,
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
        expected_revision=1,
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
        expected_revision=1,
    )
    assert submitted["status"] == "pending_review"
    assert submitted["revision"] == 2
    assert "approve" in workflow.read("789", letter["id"])["availableActions"]
    decision_id = str(uuid4())
    with pytest.raises(WorkspaceError, match="резерва"):
        workflow.act(
            "789",
            letter["id"],
            decision_id,
            action="approve",
            expected_revision=2,
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
        expected_revision=2,
    )
    assert approved["status"] == "queued"
    assert approved["outgoingNumber"] == 439
    assert approved["displayNumber"].startswith("0439/")
    assert journal.available_reserved_numbers("referent-pc") == 0
    assert OfflineWorkflow(OfflineJournal(tmp_path)).read("123", letter["id"])["status"] == "queued"


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
    workflow.act("123", letter["id"], str(uuid4()), action="submit", expected_revision=1)
    with pytest.raises(WorkspaceError) as missing_comment:
        workflow.act(
            "789",
            letter["id"],
            str(uuid4()),
            action="return_for_revision",
            expected_revision=2,
        )
    assert missing_comment.value.status == 422
    returned = workflow.act(
        "789",
        letter["id"],
        str(uuid4()),
        action="return_for_revision",
        expected_revision=2,
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
    workflow.act("123", letter["id"], str(uuid4()), action="submit", expected_revision=1)
    first = workflow.act("789", letter["id"], str(uuid4()), action="approve", expected_revision=2)
    assert first["status"] == "pending_review"
    assert first["reviewerUserId"] == bobur
    assert first["revision"] == 3
    assert "approve" not in workflow.read("789", letter["id"])["availableActions"]
    assert "approve" in workflow.read("999", letter["id"])["availableActions"]
