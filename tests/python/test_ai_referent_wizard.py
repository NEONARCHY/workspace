"""Guided Telegram flow, backed by the same revisioned records as Workspace."""

from copy import deepcopy
from types import SimpleNamespace
from unittest.mock import Mock
from urllib.parse import parse_qs, urlsplit
from uuid import uuid4

import pytest

from test_ai_referent_shared_adapter import modules as modules


@pytest.fixture
def wizard(modules, tmp_path):
    telegram = Mock()
    message_ids = iter(range(1000, 9000))
    telegram.send_message.side_effect = lambda *args, **kwargs: {
        "ok": True,
        "result": {"message_id": next(message_ids)},
    }
    telegram.delete_message.return_value = {"ok": True}
    telegram.get_file.return_value = {"result": {"file_path": "safe-document"}}
    telegram.download_file.side_effect = lambda _remote, path: path.write_bytes(b"docx fixture")
    api = Mock()
    records = {}
    reviewers = [
        {"key": key, "userId": str(uuid4()), "fullName": key, "canApprove": True}
        for key in ("askar", "bobur", "umid", "davronbek")
    ]
    requests = []

    def request(path, payload=None, **kwargs):
        requests.append((path, deepcopy(payload), kwargs))
        clean = urlsplit(path).path.removeprefix("/ai-referent/agent")
        if clean == "/reviewers":
            return {"reviewers": reviewers}
        if clean == "/recipients":
            return {
                "entries": [
                    {
                        "id": "org",
                        "name": "Example ministry",
                        "addresses": ["ministry@exat.uz"],
                        "route": "exat",
                    }
                ],
                "totalCount": 20,
                "updatedAt": "2026-09-24",
            }
        if clean == "/letters" and kwargs.get("method") == "POST":
            letter_id = str(uuid4())
            records[letter_id] = {
                "id": letter_id,
                "subject": "",
                "note": "",
                "recipientOrganization": "",
                "recipientAddress": "",
                "reviewerUserId": None,
                "finalReviewerUserId": None,
                "status": "draft",
                "revision": 1,
                "canEdit": True,
                "attachments": [],
                "availableActions": [],
                "events": [],
                **payload,
            }
            return deepcopy(records[letter_id])
        if clean == "/letters":
            return {"letters": list(records.values())}
        letter_id = clean.split("/")[2]
        letter = records[letter_id]
        if kwargs.get("method") in {"PATCH", "POST"}:
            if payload["expectedRevision"] != letter["revision"]:
                raise modules.client.WorkspaceError("Stale revision", 409)
            if kwargs["method"] == "PATCH":
                letter.update(
                    {
                        k: v
                        for k, v in payload.items()
                        if k not in {"expectedRevision", "operationId"}
                    }
                )
            else:
                assert payload["action"] == "submit"
                assert any(item["documentRole"] == "primary" for item in letter["attachments"])
                assert letter["reviewerUserId"] is not None
                if letter["workflowKind"] == "delivery":
                    assert letter["recipientAddress"]
                letter.update(status="pending_review", canEdit=False)
            letter["revision"] += 1
        return deepcopy(letter)

    def transfer(path, content, **kwargs):
        query = parse_qs(urlsplit(path).query)
        letter_id = urlsplit(path).path.split("/")[-2]
        letter = records[letter_id]
        assert int(query["expectedRevision"][0]) == letter["revision"]
        assert kwargs["telegram_id"] == "123"
        assert content == b"docx fixture"
        letter["attachments"].append({"id": str(uuid4()), "documentRole": query["role"][0]})
        if query["role"][0] == "primary":
            letter["documentCheck"] = {
                "id": str(uuid4()), "status": "pending", "reviewerKeys": [], "detail": ""
            }
        letter["revision"] += 1

    api.request.side_effect = request
    api.transfer.side_effect = transfer
    state = modules.state.State(tmp_path / "wizard.sqlite")
    bot = modules.shared_bot.SharedBot(telegram, api, state)
    actor, chat = {"id": 123}, {"id": 123, "type": "private"}
    counter = iter(range(1, 1000))

    def message(text="", document=False):
        bot.handle(
            {
                "update_id": next(counter),
                "message": {
                    "from": actor,
                    "chat": chat,
                    "text": text,
                    **(
                        {
                            "document": {
                                "file_name": "letter.docx",
                                "file_id": "file",
                                "file_size": 12,
                            }
                        }
                        if document
                        else {}
                    ),
                },
            }
        )

    def data(label):
        current = state.get("system:123:wizard")
        rows = current["rows"] if current else telegram.send_message.call_args.kwargs[
            "reply_markup"
        ]["inline_keyboard"]
        return next(item["callback_data"] for row in rows for item in row if label in item["text"])

    def click(label=None, raw=None):
        bot.handle(
            {
                "update_id": next(counter),
                "callback_query": {
                    "id": "query",
                    "from": actor,
                    "message": {"chat": chat},
                    "data": raw or data(label),
                },
            }
        )

    return SimpleNamespace(
        bot=bot,
        state=state,
        telegram=telegram,
        api=api,
        records=records,
        reviewers=reviewers,
        requests=requests,
        message=message,
        click=click,
        data=data,
        letter=lambda: next(reversed(records.values())),
    )


def test_failed_check_keeps_sender_before_attachments_and_deletes_only_system_prompts(wizard):
    w = wizard
    w.message("/new")
    w.click("Пропустить")
    w.message(document=True)
    checking_message = w.state.get("system:123:wizard")["id"]
    assert "проверяет" in w.telegram.send_message.call_args.args[1]
    assert w.telegram.send_message.call_count == 3
    assert w.telegram.edit_message_text.call_args.args[1] == checking_message
    assert all(
        "Проверить состояние" not in item["text"]
        for row in w.state.get("system:123:wizard")["rows"] for item in row
    )
    w.letter()["documentCheck"]["status"] = "failed"
    w.bot.wizard.poll_checks()
    assert "IT-специалисту" in w.telegram.edit_message_text.call_args.args[2]
    assert w.telegram.send_message.call_count == 3
    assert w.state.get("wizard:123")["step"] == "checking"
    assert all(call.args[1] >= 1000 for call in w.telegram.delete_message.call_args_list)
    w.bot.wizard.poll_checks()
    assert w.telegram.edit_message_text.call_count == 2
    w.click("Назад")
    w.message(document=True)
    w.letter()["documentCheck"].update(status="passed", reviewerKeys=["askar"])
    w.bot.wizard.poll_checks()
    assert w.state.get("wizard:123")["step"] == "attachments"
    w.click("Назад")
    assert w.state.get("wizard:123")["step"] == "document"


def test_old_telegram_system_message_loses_controls_when_deletion_is_forbidden(wizard):
    w = wizard
    w.bot.system("123", "test", "Old", [])
    w.telegram.delete_message.return_value = {"ok": False}
    w.telegram.edit_message_text.return_value = {"ok": True}
    w.bot.system("123", "test", "New", [])
    assert w.telegram.edit_message_text.call_args.kwargs["reply_markup"] == {"inline_keyboard": []}
    assert w.state.get("system:123:test")["id"] == 1001


def test_check_status_falls_back_to_new_message_if_telegram_cannot_edit(wizard):
    w = wizard
    rows = [[{"text": "Назад", "callback_data": "back"}]]
    w.bot.system("123", "test", "Проверка идёт", rows)
    previous = w.state.get("system:123:test")["id"]
    w.telegram.edit_message_text.return_value = {"ok": False}
    w.bot.system("123", "test", "Проверка завершена", rows, edit_existing=True)
    assert w.telegram.send_message.call_count == 2
    w.telegram.delete_message.assert_called_once_with("123", previous)
    assert w.state.get("system:123:test")["id"] != previous


def test_delivery_optional_subject_document_first_catalog_and_single_reviewer(wizard):
    w = wizard
    w.message("📤 Отправить письмо")
    w.click("Пропустить")
    assert w.state.get("wizard:123")["step"] == "document"
    assert w.letter()["subject"] == ""
    w.message(document=True)
    assert w.state.get("wizard:123")["step"] == "checking"
    w.letter()["documentCheck"].update(status="passed", reviewerKeys=["askar", "bobur"])
    w.bot.wizard.poll_checks()
    w.click("Без приложений")
    w.click("Справочник")
    old_organization = w.data("Example ministry")
    w.click("Следующие")
    w.click(raw=old_organization)  # immutable payload, not a new page's index
    w.click("ministry@exat.uz")
    w.click("askar")
    assert w.state.get("wizard:123")["step"] == "confirm"
    w.click("Отправить на согласование")
    assert w.letter()["status"] == "pending_review"
    assert w.letter()["finalReviewerUserId"] is None
    assert not w.state.get("wizard:123")
    assert w.letter()["route"] == "exat"


@pytest.mark.parametrize(
    "address,route", [("custom@example.org", "webmail"), ("Office@EXAT.UZ", "exat")]
)
def test_custom_address_bobur_preliminary_route_and_custom_subject(wizard, address, route):
    w = wizard
    w.message("/new")
    w.message("Моя точная тема")
    w.message(document=True)
    w.letter()["documentCheck"].update(status="passed", reviewerKeys=["askar", "bobur"])
    w.bot.wizard.poll_checks()
    w.message(document=True)  # optional additional attachment
    w.click("Далее")
    w.click("Свой адрес")
    w.message("invalid")
    assert w.state.get("wizard:123")["step"] == "custom"
    w.message(address)
    w.click("bobur")
    assert w.state.get("wizard:123")["step"] == "preliminary"
    w.click("umid")
    w.click("Отправить на согласование")
    assert w.letter()["subject"] == "Моя точная тема"
    assert w.letter()["route"] == route
    assert w.letter()["reviewerUserId"] == w.reviewers[2]["userId"]
    assert w.letter()["finalReviewerUserId"] == w.reviewers[1]["userId"]


def test_sign_only_has_one_reviewer_and_never_asks_for_recipient(wizard):
    w = wizard
    w.message("✍️ Только подпись")
    w.click("Пропустить")
    w.message(document=True)
    w.letter()["documentCheck"].update(status="passed", reviewerKeys=["bobur"])
    w.bot.wizard.poll_checks()
    w.click("bobur")
    w.click("Отправить на согласование")
    assert w.letter()["workflowKind"] == "sign_only"
    assert w.letter()["status"] == "pending_review"
    assert w.letter()["finalReviewerUserId"] is None
    assert not any("/recipients" in path for path, *_ in w.requests)


def test_back_menu_search_and_resume_from_workspace(wizard):
    w = wizard
    w.message("/new")
    w.message("Тема")
    w.click("Назад")
    assert w.state.get("wizard:123")["step"] == "subject"
    w.click("Пропустить")
    w.message(document=True)
    w.letter()["documentCheck"].update(status="passed", reviewerKeys=["askar", "bobur"])
    w.bot.wizard.poll_checks()
    w.click("Без приложений")
    w.click("Поиск")
    w.message("Министерство")
    assert any("query=%D0%9C" in path for path, *_ in w.requests)
    old = w.data("Example ministry")
    w.message("/start")
    assert not w.state.get("wizard:123")
    assert w.letter()["status"] == "draft"
    w.click(raw=old)  # opens the original draft, not another letter
    assert w.state.get("wizard:123")["letterId"] == w.letter()["id"]
    w.message("📬 Согласование")
    assert any("activeOnly=true" in path for path, *_ in w.requests)


def test_stale_workspace_revision_cannot_be_overwritten_by_telegram(wizard):
    w = wizard
    w.message("/new")
    old = w.data("Пропустить")
    w.letter().update(subject="New subject from Workspace", revision=2)
    w.click(raw=old)
    assert w.letter()["subject"] == "New subject from Workspace"
    assert w.letter()["revision"] == 2
    assert "изменилось" in w.telegram.send_message.call_args.args[1]


def test_old_catalog_buttons_reopen_current_letter_without_legacy_error(wizard):
    w = wizard
    w.message("/new")
    w.click(raw="c:ministries")
    assert w.state.get("wizard:123")["letterId"] == w.letter()["id"]
    assert not any(
        "прежнего режима" in call.args[1] for call in w.telegram.send_message.call_args_list
    )
