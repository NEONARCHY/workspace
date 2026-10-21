"""Draft endpoints do not submit reports or acknowledge another employee's reminders."""

import asyncio
from datetime import date
from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncConnection

from yuksalish_api import repository
from yuksalish_api.auth import AuthenticatedUser
from yuksalish_api.hisobot_schemas import HisobotDraftSeenInput
from yuksalish_api.routers import hisobot
from yuksalish_api.workspace_schemas import UpdateChecklistItemRequest


def employee() -> AuthenticatedUser:
    return AuthenticatedUser(
        id=uuid4(), username="draft-owner", full_name="Draft owner",
        position_id=None, job_title=None, role="employee",
    )


def test_seen_updates_only_owner_and_preserves_first_seen(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    owner = employee()
    connection = AsyncMock(spec=AsyncConnection)
    guard = AsyncMock()
    monkeypatch.setattr(hisobot, "ensure_module_action", guard)
    monkeypatch.setattr(hisobot, "profile", AsyncMock(return_value=SimpleNamespace(
        today=date(2026, 10, 21),
    )))
    asyncio.run(hisobot.acknowledge_activity_draft(
        HisobotDraftSeenInput(report_date=date(2026, 10, 21)), owner, connection,
    ))
    guard.assert_awaited_once_with(connection, owner, "ai_hisobot", "view")
    statement = connection.execute.await_args.args[0]
    assert owner.id in statement.compile().params.values()
    assert date(2026, 10, 21) in statement.compile().params.values()
    assert "coalesce(hisobot_activity_drafts.seen_at" in str(statement)
    assert "workspace_notifications" not in str(statement)
    assert "hisobot_live_reports" not in str(statement)
    connection.execute.assert_awaited_once()


def test_old_day_and_disabled_module_cannot_acknowledge(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    owner = employee()
    connection = AsyncMock(spec=AsyncConnection)
    guard = AsyncMock()
    monkeypatch.setattr(hisobot, "ensure_module_action", guard)
    profile = AsyncMock(return_value=SimpleNamespace(today=date(2026, 10, 21)))
    monkeypatch.setattr(hisobot, "profile", profile)
    with pytest.raises(HTTPException) as error:
        asyncio.run(hisobot.acknowledge_activity_draft(
            HisobotDraftSeenInput(report_date=date(2026, 10, 20)), owner, connection,
        ))
    assert error.value.status_code == 409
    connection.execute.assert_not_awaited()
    profile.reset_mock()
    guard.side_effect = HTTPException(403, "No access")
    with pytest.raises(HTTPException) as denied:
        asyncio.run(hisobot.get_my_activity_draft(owner, connection))
    assert denied.value.status_code == 403
    profile.assert_not_awaited()
    connection.execute.assert_not_awaited()


@pytest.mark.parametrize("completed", [False, True])
def test_checklist_retry_keeps_original_completion_evidence(
    monkeypatch: pytest.MonkeyPatch, completed: bool,
) -> None:
    owner = employee()
    connection = AsyncMock(spec=AsyncConnection)
    connection.scalar.return_value = completed
    task_id = uuid4()
    monkeypatch.setattr(repository, "_task_access_row", AsyncMock())
    response = AsyncMock(return_value="existing-task")
    monkeypatch.setattr(repository, "_task_response", response)
    assert asyncio.run(repository.update_task_checklist_item(
        connection, owner, task_id, uuid4(),
        UpdateChecklistItemRequest(is_completed=completed),
    )) == "existing-task"
    assert "FOR UPDATE" in str(connection.scalar.await_args.args[0])
    connection.execute.assert_not_awaited()
    response.assert_awaited_once_with(connection, task_id)
