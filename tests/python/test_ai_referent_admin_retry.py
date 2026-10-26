"""An administrative retry preserves approval but cannot replay an uncertain send."""

from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock
from uuid import uuid4

import pytest
from fastapi import HTTPException
from sqlalchemy.sql import Insert, Update

from yuksalish_api import ai_referent_agent_service as agent
from yuksalish_api import ai_referent_service as letters
from yuksalish_api.ai_referent_retry import failed_delivery_retry_plan
from yuksalish_api.ai_referent_schemas import AIReferentActionRequest
from yuksalish_api.auth import AuthenticatedUser


@pytest.fixture
def anyio_backend():
    return "asyncio"


def records(items):
    return SimpleNamespace(mappings=lambda: SimpleNamespace(all=lambda: items))


def fixture():
    now = datetime.now(UTC)
    row = {
        "id": uuid4(), "workflow_kind": "delivery", "status": "failed", "revision": 7,
        "outgoing_number": 487, "year_suffix": "26", "route": "webmail", "sent_at": None,
        "final_pdf_file_id": None, "created_by_user_id": uuid4(), "reviewer_user_id": uuid4(),
    }
    history = [{
        "event_type": "letter.approve", "to_status": "queued", "created_at": now,
    }]
    jobs = [{"id": uuid4(), "kind": "prepare", "status": "completed",
             "result": {"outcome": "failed"}}]
    return row, history, jobs


@pytest.mark.anyio
@pytest.mark.parametrize("pdf", [False, True])
async def test_safe_plan_reuses_signed_pdf_or_prepares_for_operator(pdf):
    row, history, jobs = fixture()
    if pdf:
        row["final_pdf_file_id"] = uuid4()
    connection = SimpleNamespace(
        execute=AsyncMock(side_effect=[records(history), records(jobs)]),
        scalar=AsyncMock(return_value=row["final_pdf_file_id"]),
    )
    assert await failed_delivery_retry_plan(connection, row) == (
        "dispatch" if pdf else "reprepare", ""
    )


@pytest.mark.anyio
@pytest.mark.parametrize("case", [
    "sent_at", "sent_event", "sent_result", "pending_job", "claimed_job", "missing_job",
    "lost_lease", "unknown_result", "send_job", "record_sent_job", "delete_job", "unknown_event",
    "unapproved", "no_number", "returned", "edited", "missing_pdf", "signed_only", "sent_status",
])
async def test_plan_fails_closed_for_incomplete_or_contradictory_evidence(case):
    row, history, jobs = fixture()
    now = history[0]["created_at"]
    if case == "sent_at":
        row["sent_at"] = now
    elif case == "sent_event":
        history.append({"to_status": "sent"})
    elif case == "sent_result":
        jobs[0]["result"] = {"outcome": "sent"}
    elif case in {"pending_job", "claimed_job"}:
        jobs[0]["status"] = case.removesuffix("_job")
    elif case == "missing_job":
        jobs.clear()
    elif case == "lost_lease":
        jobs[0].update(status="failed", result=None)
    elif case == "unknown_result":
        jobs[0]["result"] = {"outcome": "unknown"}
    elif case in {"send_job", "record_sent_job", "delete_job"}:
        jobs.append({"kind": case.removesuffix("_job"), "status": "completed", "result": {}})
    elif case == "unknown_event":
        history.append({"event_type": "agent.unknown", "to_status": "delivery_unknown",
                        "created_at": now + timedelta(seconds=1)})
    elif case == "unapproved":
        history.clear()
    elif case == "no_number":
        row["outgoing_number"] = None
    elif case in {"returned", "edited"}:
        history.insert(0, {"event_type": "letter.updated" if case == "edited" else "letter.return",
                           "to_status": "needs_revision", "created_at": now + timedelta(seconds=1)})
    elif case == "missing_pdf":
        row["final_pdf_file_id"] = uuid4()
    elif case == "signed_only":
        row["workflow_kind"] = "sign_only"
    elif case == "sent_status":
        row["status"] = "sent"
    connection = SimpleNamespace(
        execute=AsyncMock(side_effect=[records(history), records(jobs)]),
        scalar=AsyncMock(return_value=None),
    )
    kind, reason = await failed_delivery_retry_plan(connection, row)
    assert kind == "" and reason


@pytest.mark.anyio
@pytest.mark.parametrize("allowed", [True, False])
async def test_action_requires_admin_and_keeps_number_approval_and_audit(monkeypatch, allowed):
    row, _, _ = fixture()
    user = AuthenticatedUser(id=uuid4(), username="operator", full_name="Operator",
                             position_id=None, job_title="Operator", role="admin")
    connection = SimpleNamespace(execute=AsyncMock())
    monkeypatch.setattr(letters, "_letter_row", AsyncMock(return_value=row))
    monkeypatch.setattr(letters, "operation_replay", AsyncMock(return_value=None))
    monkeypatch.setattr(letters, "remember_operation", AsyncMock())
    permission = AsyncMock(side_effect=None if allowed else HTTPException(403, "Denied"))
    monkeypatch.setattr(letters, "ensure_module_action", permission)
    plan = AsyncMock(return_value=("dispatch", ""))
    monkeypatch.setattr(letters, "failed_delivery_retry_plan", plan)
    approval = AsyncMock()
    monkeypatch.setattr(letters, "_validate_reviewer", approval)
    monkeypatch.setattr(letters, "_reserve_number", AsyncMock())
    event = AsyncMock()
    monkeypatch.setattr(letters, "_event", event)
    monkeypatch.setattr(letters, "notify_letter", AsyncMock())
    monkeypatch.setattr(letters, "_response", AsyncMock(return_value=object()))
    payload = AIReferentActionRequest(action="retry_failed_delivery", expectedRevision=7,
                                     operationId=uuid4(), comment="External sent journal checked")
    if not allowed:
        with pytest.raises(HTTPException) as error:
            await letters.act_on_letter(connection, user, row["id"], payload)
        assert error.value.status_code == 403
        plan.assert_not_awaited()
        return
    await letters.act_on_letter(connection, user, row["id"], payload)
    permission.assert_awaited_once_with(connection, user, "ai_referent", "admin")
    approval.assert_not_awaited()
    letters._reserve_number.assert_not_awaited()
    updates = [call.args[0] for call in connection.execute.call_args_list
               if isinstance(call.args[0], Update)]
    params = updates[0].compile().params
    assert params["status"] == "queued" and params["revision"] == 8
    assert not {"outgoing_number", "reviewer_user_id", "final_pdf_file_id"}.intersection(params)
    queued = [call.args[0] for call in connection.execute.call_args_list
              if isinstance(call.args[0], Insert)
              and call.args[0].table.name == "ai_referent_delivery_commands"]
    assert len(queued) == 1
    assert queued[0].compile().params["kind"] == "dispatch"
    assert queued[0].compile().params["idempotency_key"] == f"letter:{row['id']}:revision:8"
    assert event.call_args.args[2] == user.id
    assert event.call_args.kwargs["comment"] == payload.comment


@pytest.mark.anyio
@pytest.mark.parametrize("reason,comment,status", [
    ("Delivery needs reconciliation", "Journal checked", 409), ("", "", 422),
])
async def test_retry_requires_verification_and_never_writes_on_guard_failure(
    monkeypatch, reason, comment, status
):
    row, _, _ = fixture()
    user = SimpleNamespace(id=uuid4())
    connection = SimpleNamespace(execute=AsyncMock())
    monkeypatch.setattr(letters, "_letter_row", AsyncMock(return_value=row))
    monkeypatch.setattr(letters, "operation_replay", AsyncMock(return_value=None))
    monkeypatch.setattr(letters, "ensure_module_action", AsyncMock())
    monkeypatch.setattr(letters, "failed_delivery_retry_plan", AsyncMock(return_value=("", reason)))
    with pytest.raises(letters.AIReferentServiceError) as error:
        await letters.act_on_letter(connection, user, row["id"], AIReferentActionRequest(
            action="retry_failed_delivery", expectedRevision=7, comment=comment,
        ))
    assert error.value.status_code == status
    assert not any(isinstance(call.args[0], (Insert, Update))
                   for call in connection.execute.call_args_list)


@pytest.mark.anyio
async def test_dispatch_local_delivery_conflict_requires_reconciliation(monkeypatch):
    letter_id, job_id, lease = uuid4(), uuid4(), uuid4()
    job = {"id": job_id, "letter_id": letter_id, "lease_token": lease,
           "claimed_by": "test", "status": "claimed", "kind": "dispatch", "result": None,
           "lease_until": datetime.now(UTC) + timedelta(minutes=2)}
    mapped = Mock()
    mapped.mappings.return_value.one_or_none.return_value = job
    connection = SimpleNamespace(execute=AsyncMock(side_effect=[Mock(), mapped, Mock(), Mock()]),
                                 scalar=AsyncMock(return_value=None))
    row = {"id": letter_id, "status": "sending", "workflow_kind": "delivery", "revision": 5,
           "sent_at": None, "final_pdf_file_id": uuid4()}
    monkeypatch.setattr(agent, "_letter_row", AsyncMock(return_value=row))
    monkeypatch.setattr(agent, "_event", AsyncMock())
    monkeypatch.setattr(agent, "notify_letter", AsyncMock())
    await agent.complete_job(connection, job_id, lease, "test", "unknown", "Local journal sent")
    updates = [call.args[0] for call in connection.execute.call_args_list
               if isinstance(call.args[0], Update)]
    assert updates[-1].compile().params["status"] == "delivery_unknown"
