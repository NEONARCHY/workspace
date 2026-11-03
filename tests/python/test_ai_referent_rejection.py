"""Reviewer refusal terminates approval without preparing or sending a letter."""

from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
from fastapi import HTTPException
from sqlalchemy.sql import Insert, Update

from yuksalish_api import ai_referent_service as letters
from yuksalish_api.ai_referent_schemas import AIReferentActionRequest
from yuksalish_api.ai_referent_shared_service import notify_letter
from yuksalish_api.auth import AuthenticatedUser


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.fixture
def context(monkeypatch):
    reviewer = AuthenticatedUser(
        id=uuid4(), username="reviewer", full_name="Test reviewer", role="manager",
        position_id=None, job_title="Reviewer",
    )
    row = {
        "id": uuid4(), "revision": 3, "status": "pending_review",
        "workflow_kind": "delivery", "created_by_user_id": uuid4(),
        "reviewer_user_id": reviewer.id, "initial_reviewer_user_id": uuid4(),
        "initial_reviewer_key": "umid", "final_reviewer_user_id": reviewer.id,
        "outgoing_number": None,
    }
    connection = SimpleNamespace(execute=AsyncMock(), scalar=AsyncMock())
    for name, result in (
        ("_letter_row", row), ("ensure_module_action", None),
        ("_validate_reviewer", "bobur"), ("operation_replay", None),
        ("remember_operation", None), ("_event", None),
        ("notify_letter", None), ("_response", row),
    ):
        monkeypatch.setattr(letters, name, AsyncMock(return_value=result))
    return reviewer, row, connection


@pytest.mark.anyio
@pytest.mark.parametrize("kind", ["delivery", "sign_only"])
async def test_rejection_preserves_route_records_reason_and_never_queues(context, kind):
    reviewer, row, connection = context
    row["workflow_kind"] = kind
    await letters.act_on_letter(connection, reviewer, row["id"], AIReferentActionRequest(
        action="reject", expectedRevision=3, comment="No longer relevant",
        operationId=uuid4(),
    ))
    mutations = [call.args[0] for call in connection.execute.call_args_list
                 if isinstance(call.args[0], Update)]
    values = mutations[0].compile().params
    assert values["status"] == "rejected"
    assert values["revision"] == 4
    assert "reviewer_user_id" not in values
    assert "outgoing_number" not in values
    assert not any(isinstance(call.args[0], Insert)
                   and call.args[0].table.name == "ai_referent_delivery_commands"
                   for call in connection.execute.call_args_list)
    audit = next(call.args[0] for call in connection.execute.call_args_list
                 if isinstance(call.args[0], Insert)
                 and call.args[0].table.name == letters.audit_events.name)
    assert audit.compile().params["action"] == "ai_referent.reject"
    assert audit.compile().params["details"]["toStatus"] == "rejected"
    assert letters._event.call_args.kwargs["comment"] == "No longer relevant"
    letters.notify_letter.assert_awaited_once_with(
        connection, row, "Письмо отклонено согласующим", "No longer relevant"
    )
    letters.remember_operation.assert_awaited_once()


@pytest.mark.anyio
@pytest.mark.parametrize("status", [
    "draft", "needs_revision", "queued", "sending", "sent", "failed",
    "awaiting_final_send", "delivery_unknown", "rejected", "cancelled", "signed",
])
async def test_rejection_only_at_active_approval_stage(context, status):
    reviewer, row, connection = context
    row["status"] = status
    with pytest.raises(letters.AIReferentServiceError) as error:
        await letters.act_on_letter(connection, reviewer, row["id"], AIReferentActionRequest(
            action="reject", expectedRevision=3, comment="No longer relevant",
        ))
    assert error.value.status_code == 409
    letters._event.assert_not_awaited()


@pytest.mark.anyio
@pytest.mark.parametrize("case,code", [("unassigned", 403), ("reason", 422), ("stale", 409)])
async def test_rejection_guards(context, case, code):
    reviewer, row, connection = context
    if case == "unassigned":
        row["reviewer_user_id"] = uuid4()
    with pytest.raises(letters.AIReferentServiceError) as error:
        await letters.act_on_letter(connection, reviewer, row["id"], AIReferentActionRequest(
            action="reject", expectedRevision=2 if case == "stale" else 3,
            comment="  " if case == "reason" else "No longer relevant",
        ))
    assert error.value.status_code == code
    letters.notify_letter.assert_not_awaited()


@pytest.mark.anyio
async def test_rejection_requires_server_approval_right(context, monkeypatch):
    reviewer, row, connection = context
    monkeypatch.setattr(letters, "ensure_module_action", AsyncMock(
        side_effect=HTTPException(403, "Forbidden")
    ))
    with pytest.raises(HTTPException) as error:
        await letters.act_on_letter(connection, reviewer, row["id"], AIReferentActionRequest(
            action="reject", expectedRevision=3, comment="No longer relevant",
        ))
    assert error.value.status_code == 403
    letters._event.assert_not_awaited()


@pytest.mark.anyio
async def test_rejection_retry_replays_without_second_mutation(context, monkeypatch):
    reviewer, row, connection = context
    row["status"] = "rejected"
    monkeypatch.setattr(letters, "operation_replay", AsyncMock(return_value=row["id"]))
    load = AsyncMock(return_value=row)
    monkeypatch.setattr(letters, "load_letter", load)
    assert await letters.act_on_letter(
        connection, reviewer, row["id"], AIReferentActionRequest(
            action="reject", expectedRevision=3, comment="No longer relevant", operationId=uuid4(),
        )
    ) == row
    letters._letter_row.assert_not_awaited()
    letters.notify_letter.assert_not_awaited()


@pytest.mark.parametrize("kind", ["delivery", "sign_only"])
def test_rejected_letter_has_no_editing_or_followup_actions(context, kind):
    reviewer, row, _ = context
    row.update(status="rejected", workflow_kind=kind, created_by_user_id=reviewer.id)
    actions, editable = letters._available_actions(
        row, reviewer, may_approve=True, may_operate=True, attachment_count=1,
    )
    assert actions == []
    assert not editable


@pytest.mark.anyio
async def test_rejection_notification_includes_reason_and_resolves_old_actions(context):
    _, row, connection = context
    row.update(status="rejected", subject="Test letter", note="")
    await notify_letter(connection, row, "Rejected", "No longer relevant")
    notifications = [call.args[0].compile().params
                     for call in connection.execute.call_args_list
                     if isinstance(call.args[0], Insert)
                     and call.args[0].table.name == "workspace_notifications"]
    assert {item["user_id"] for item in notifications} == {
        row["created_by_user_id"], row["reviewer_user_id"],
    }
    assert all(not item["requires_action"] for item in notifications)
    assert all("No longer relevant" in item["body"] for item in notifications)
    updates = [call.args[0].compile().params for call in connection.execute.call_args_list
               if isinstance(call.args[0], Update)]
    assert updates[0]["requires_action"] is False
    assert updates[0]["resolved_at"] is not None
