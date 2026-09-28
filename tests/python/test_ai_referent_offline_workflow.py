"""Draft-only local reducer checks; this is not the live failover switch."""

from __future__ import annotations

import hashlib
import json
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
    journal.set_authority_phase("referent-pc", epoch, "online", lease_seconds=30)
    snapshot_id = journal.prepare_offline_rights(epoch)
    actors = [
        {
            "telegramId": telegram_id,
            "userId": user_id,
            "fullName": name,
            "moduleActions": actions,
            "reviewerKeys": ["askar"] if telegram_id == "789" else [],
            "role": "employee",
        }
        for telegram_id, user_id, name, actions in (
            ("123", creator, "Автор", ["view", "create", "edit"]),
            ("456", stranger, "Другой", ["view", "create", "edit"]),
            ("789", reviewer, "Согласующий", ["view", "approve"]),
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
                {"userId": reviewer, "fullName": "Согласующий", "key": "askar", "canApprove": True}
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
