"""Same submission safety and feedback in Workspace and the autonomous bot."""

from unittest.mock import Mock
from uuid import uuid4

import pytest
from integrations.exat.workspace_integration.client import WorkspaceError
from integrations.exat.workspace_integration.offline_workflow import (
    OfflineWorkflow,
    _delivery_route_error,
)
from integrations.exat.workspace_integration.shared_bot import SharedBot
from integrations.exat.workspace_integration.state import State
from pydantic import ValidationError

from yuksalish_api.ai_referent_schemas import (
    CreateAIReferentLetterRequest,
    UpdateAIReferentLetterRequest,
    delivery_route_error,
)
from yuksalish_api.ai_referent_service import _submission_block_reason


@pytest.mark.parametrize(
    ("address", "route", "valid"),
    [
        ("office@exat.uz", "exat", True),
        (" OFFICE@EXAT.UZ ", "webmail", False),
        ("office@exat.uz", "webmail", False),
        ("office@example.test", "webmail", True),
        ("office@example.test", "exat", False),
        ("office@exat.uz.example.test", "exat", False),
        ("EX-01", "exat", True),
        ("", "exat", True),
    ],
)
def test_channel_contract_matches_online_and_offline(address, route, valid):
    assert delivery_route_error(address, route) == _delivery_route_error(address, route)
    assert bool(delivery_route_error(address, route)) is not valid
    payload = {"recipientAddress": address, "route": route}
    if valid:
        CreateAIReferentLetterRequest(**payload)
        UpdateAIReferentLetterRequest(**payload, expectedRevision=1)
        OfflineWorkflow._fields(payload)
    else:
        with pytest.raises(ValidationError):
            CreateAIReferentLetterRequest(**payload)
        with pytest.raises(ValidationError):
            UpdateAIReferentLetterRequest(**payload, expectedRevision=1)
        with pytest.raises(WorkspaceError) as error:
            OfflineWorkflow._fields(payload)
        assert error.value.status == 422


def test_sign_only_does_not_interpret_unused_recipient_as_delivery():
    payload = {"workflowKind": "sign_only", "route": "exat", "recipientAddress": "a@example.test"}
    CreateAIReferentLetterRequest(**payload)
    assert OfflineWorkflow._fields(payload)["recipientAddress"] == ""


@pytest.mark.parametrize(
    ("changes", "primary", "check", "expected"),
    [
        ({}, 1, {"status": "passed", "reviewer_keys": ["umid"]}, ""),
        ({"recipient_address": ""}, 1, None, "адрес"),
        ({"route": "exat"}, 1, None, "Webmail"),
        ({"reviewer_user_id": None}, 1, None, "согласующего"),
        ({}, 0, None, "DOCX"),
        ({}, 1, None, "Дождитесь"),
        ({}, 1, {"status": "checking"}, "Дождитесь"),
        ({}, 1, {"status": "failed", "detail": "Проверка не пройдена"}, "не пройдена"),
        ({}, 1, {"status": "passed", "reviewer_keys": ["askar"]}, "выбранного руководителя"),
        ({"reviewer_key": "bobur"}, 1, None, "предварительного"),
        (
            {"reviewer_key": "askar", "final_reviewer_key": "bobur",
             "final_reviewer_user_id": uuid4()},
            1, {"status": "passed", "reviewer_keys": ["bobur"]}, "",
        ),
    ],
)
def test_submission_block_explains_missing_requirement(changes, primary, check, expected):
    row = {
        "workflow_kind": "delivery", "recipient_organization": "Partner",
        "recipient_address": "office@example.test", "route": "webmail",
        "reviewer_user_id": uuid4(), "reviewer_key": "umid", **changes,
    }
    reason = _submission_block_reason(row, primary, check)
    assert expected in reason if expected else reason == ""


def test_telegram_ready_draft_submits_directly_and_includes_address(tmp_path):
    api, telegram = Mock(), Mock()
    telegram.send_message.return_value = {"ok": True}
    letter_id = uuid4()
    letter = {
        "id": str(letter_id), "revision": 4, "status": "draft",
        "subject": "Test", "recipientOrganization": "Partner",
        "recipientAddress": "office@example.test", "reviewerName": "Reviewer",
        "availableActions": ["submit", "cancel"], "canEdit": True,
        "submissionBlockReason": "",
    }
    api.request.return_value = letter
    bot = SharedBot(telegram, api, State(tmp_path / "state.sqlite"))
    bot.show("123", str(letter_id))
    call = telegram.send_message.call_args
    assert "office@example.test" in call.args[1]
    rows = call.kwargs["reply_markup"]["inline_keyboard"]
    buttons = [button for row in rows for button in row]
    submit = next(
        button for button in buttons
        if button["text"] == "✅ На согласование"  # noqa: RUF001
    )
    assert submit["callback_data"] == f"a:s:{letter_id.hex}:4"
    assert not any("Продолжить письмо" in button["text"] for button in buttons)
    api.request.reset_mock()
    api.request.return_value = {
        **letter, "status": "pending_review", "canEdit": False,
        "availableActions": [], "revision": 5,
    }
    bot.handle({
        "update_id": 1,
        "callback_query": {
            "id": "submit", "from": {"id": 123},
            "message": {"chat": {"type": "private", "id": 123}},
            "data": submit["callback_data"],
        },
    })
    request = api.request.call_args_list[0]
    assert request.args[0].endswith("/actions")
    assert request.args[1]["action"] == "submit"
    assert request.args[1]["expectedRevision"] == 4
    assert not bot.state.get("wizard:123")


def test_telegram_incomplete_draft_explains_block_without_fake_submit(tmp_path):
    api, telegram = Mock(), Mock()
    telegram.send_message.return_value = {"ok": True}
    letter_id = uuid4()
    api.request.return_value = {
        "id": str(letter_id), "revision": 1, "status": "draft", "subject": "",
        "recipientOrganization": "", "availableActions": [], "canEdit": True,
        "submissionBlockReason": "Выберите согласующего.",
    }
    bot = SharedBot(telegram, api, State(tmp_path / "state.sqlite"))
    bot.show("123", str(letter_id))
    call = telegram.send_message.call_args
    assert "Выберите согласующего." in call.args[1]
    buttons = [button for row in call.kwargs["reply_markup"]["inline_keyboard"] for button in row]
    assert not any(button["callback_data"].startswith("a:s:") for button in buttons)
    assert any(button["text"] == "📝 Изменить реквизиты" for button in buttons)
