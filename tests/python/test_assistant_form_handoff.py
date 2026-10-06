"""Preparation never creates business records; actual forms own the final save."""
import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest

from yuksalish_api import assistant_service as service
from yuksalish_api.auth import AuthenticatedUser
from yuksalish_api.routers.assistant import AskRequest


def test_selected_button_prepares_a_task_without_a_command_prefix(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = AuthenticatedUser(uuid4(), "test", "Test", None, None, "employee")
    connection = SimpleNamespace(scalar=AsyncMock(return_value=0), execute=AsyncMock())
    monkeypatch.setattr(service, "message_history", AsyncMock(return_value=[]))
    permissions = AsyncMock(return_value={"tasks": {"create": True}})
    monkeypatch.setattr(service, "module_permissions_for_user", permissions)
    generate = AsyncMock(return_value='{"title":"Report","assignee":"я",'
                         '"priority":"high","checklist":"One\\nTwo",'
                         '"assigneeId":"untrusted","ready":true}')
    monkeypatch.setattr(service, "generate_text", generate)
    result = asyncio.run(service.ask_assistant(
        connection, user, "key", "flash-lite", "Report for me", requested_kind="task",
    ))
    draft = result["actionDraft"]
    assert draft["ready"] is True
    assert draft["fields"]["checklist"] == "One\nTwo"
    assert "assigneeId" not in draft["fields"]
    assert "Открывай форму" in result["content"]
    statements = [str(call.args[0]) for call in connection.execute.await_args_list]
    assert len(statements) == 2
    assert all("INSERT INTO assistant_messages" in statement for statement in statements)
    permissions.return_value = {"tasks": {"create": False}}
    denied = asyncio.run(service.ask_assistant(
        connection, user, "key", "flash-lite", "Report", requested_kind="task",
    ))
    assert "actionDraft" not in denied
    generate.assert_awaited_once()


def test_project_preserves_budget_team_and_approval_order(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(service, "generate_text", AsyncMock(return_value=(
        '{"title":"Forum","code":"FORUM","manager":"я","budget":"2500000",'
        '"currency":"UZS","accessStatus":"closed",'
        '"responsibles":"First Person","approvers":"Second Person\\nFirst Person"}'
    )))
    draft = asyncio.run(service.prepare_action_draft("key", "project", "Forum", None))
    assert draft["ready"] is True
    assert draft["fields"]["budget"] == "2500000"
    assert draft["fields"]["approvers"] == "Second Person\nFirst Person"


def test_partial_day_absence_requires_precise_times_and_merges_correction(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(service, "generate_text", AsyncMock(side_effect=[
        '{"reason":"Personal","absenceKind":"personal_time",'
        '"startDate":"2030-10-01","endDate":"2030-10-01"}',
        '{"startDate":"2030-10-01T14:00","endDate":"2030-10-01T16:00"}',
    ]))
    first = asyncio.run(service.prepare_action_draft("key", "absence", "отгул", None))
    assert first["ready"] is False
    assert "точное время" in service.action_draft_answer(first)
    second = asyncio.run(service.prepare_action_draft("key", "absence", "14-16", first))
    assert second["ready"] is True
    assert second["fields"]["reason"] == "Personal"
    assert second["fields"]["absenceKind"] == "personal_time"


@pytest.mark.parametrize("value", ["-2", "2.5", "NaN", "10000000000000000000"])
def test_bad_budget_cannot_silently_become_zero(
    value: str, monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(service, "generate_text", AsyncMock(return_value=(
        '{"title":"Forum","code":"F","manager":"я","budget":"' + value + '"}'
    )))
    with pytest.raises(ValueError, match="бюджет"):
        asyncio.run(service.prepare_action_draft("key", "project", "Forum", None))


def test_budget_requires_currency_and_unknown_action_is_rejected(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(service, "generate_text", AsyncMock(return_value=(
        '{"title":"Forum","code":"F","manager":"я","budget":"100"}'
    )))
    draft = asyncio.run(service.prepare_action_draft("key", "project", "Forum", None))
    assert draft["ready"] is False
    assert "валюте" in service.action_draft_answer(draft)
    with pytest.raises(ValueError):
        AskRequest(message="test", action_kind="execute_sql")  # type: ignore[arg-type]
