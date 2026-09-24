"""Safety tests with fake Telegram/Office: never sends a real message or letter."""

import asyncio
import hashlib
import importlib
import sys
import threading
from io import BytesIO
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock
from uuid import uuid4
from zipfile import ZipFile

import pytest
from fastapi import HTTPException

from yuksalish_api.ai_referent_files_service import read_limited_packet, safe_relative_path
from yuksalish_api.settings import Settings

ROOT = Path(__file__).resolve().parents[2]


@pytest.fixture
def modules(monkeypatch):
    monkeypatch.syspath_prepend(str(ROOT / "integrations/exat"))
    return SimpleNamespace(
        **{
            name: importlib.import_module("workspace_integration." + name)
            for name in (
                "state", "worker", "sync", "shared_bot", "client", "authority", "sign_only"
            )
        }
    )


@pytest.mark.parametrize(
    "name", ["../x", "/x", "a\\b", "C:/x", "a/../b", "a//b", "a/", "a\nx", "."]
)
def test_packet_paths_reject_escape_and_ambiguous_names(name):
    with pytest.raises(HTTPException) as error:
        safe_relative_path(name)
    assert error.value.status_code == 422
    assert safe_relative_path("attachments/document.pdf") == "attachments/document.pdf"


def test_packet_upload_limit_accepts_boundary_and_rejects_next_byte():
    assert Settings(_env_file=None).ai_referent_packet_max_bytes == 200 * 1024 * 1024

    async def chunks(*parts: bytes):
        for part in parts:
            yield part

    assert asyncio.run(read_limited_packet(chunks(b"ab", b"cd"), 4)) == b"abcd"
    with pytest.raises(HTTPException) as error:
        asyncio.run(read_limited_packet(chunks(b"ab", b"cde"), 4))
    assert error.value.status_code == 413
    with pytest.raises(HTTPException) as empty_error:
        asyncio.run(read_limited_packet(chunks(), 4))
    assert empty_error.value.status_code == 422


def test_receipts_survive_restart_and_instance_lock_releases(modules, tmp_path):
    path = tmp_path / "state.sqlite"
    state = modules.state.State(path)
    assert state.claim("started:1", {"job": 1})
    restarted = modules.state.State(path)
    assert not restarted.claim("started:1", {"job": 2})
    assert restarted.get("started:1") == {"job": 1}
    restarted.put("result:1", {"outcome": "sent"})
    assert restarted.pending("result:") == [("result:1", {"outcome": "sent"})]
    restarted.remove("result:1")
    assert not restarted.pending("result:")
    with (modules.state.single_instance(tmp_path / "bot.lock"),
          pytest.raises(modules.client.WorkspaceError),
          modules.state.single_instance(tmp_path / "bot.lock")):
        pytest.fail("Second worker acquired the same lock")
    with modules.state.single_instance(tmp_path / "bot.lock"):
        pass


def test_telegram_sign_command_creates_one_reviewer_without_delivery(modules, tmp_path):
    telegram = Mock()
    telegram.send_message.return_value = {"ok": True}
    api = Mock()
    letter_id = str(uuid4())

    def request(path, payload=None, **_kwargs):
        if path.endswith("/reviewers"):
            return {"reviewers": [
                {"key": "bobur", "userId": str(uuid4()), "fullName": "Reviewer",
                 "canApprove": True},
            ]}
        if path.endswith("/letters"):
            assert payload["workflowKind"] == "sign_only"
            assert payload["finalReviewerUserId"] is None
            assert payload["recipientOrganization"] == "Подписание без отправки"
            return {"id": letter_id}
        raise AssertionError(path)

    api.request.side_effect = request
    state = modules.state.State(tmp_path / "state.sqlite")
    bot = modules.shared_bot.SharedBot(telegram, api, state)
    actor = {"id": 123}
    chat = {"id": 123, "type": "private"}
    bot.handle({"update_id": 1, "message": {"from": actor, "chat": chat, "text": "/sign"}})
    bot.handle({"update_id": 2, "message": {"from": actor, "chat": chat, "text": "Пакет"}})
    bot.handle({"update_id": 3, "callback_query": {
        "id": "callback", "from": actor, "message": {"chat": chat}, "data": "q:bobur",
    }})
    assert state.get("conversation:123") == {
        "step": "upload", "role": "primary", "letterId": letter_id,
    }
    assert any(call.args[0] == "/ai-referent/agent/letters" for call in api.request.call_args_list)


def test_bot_menu_catalog_address_and_reviewer_buttons(modules, tmp_path):
    telegram = Mock()
    telegram.send_message.return_value = {"ok": True}
    api = Mock()
    letter_id = str(uuid4())
    reviewer_id = str(uuid4())

    def request(path, payload=None, **_kwargs):
        if path.endswith("/reviewers"):
            return {"reviewers": [
                {"key": "askar", "userId": reviewer_id, "fullName": "Askar",
                 "canApprove": True},
            ]}
        if "/recipients?" in path:
            return {"entries": [{
                "id": "org-1", "name": "Example Ministry", "categoryKey": "ministries",
                "addresses": ["EX-01"], "route": "exat",
            }], "totalCount": 1, "updatedAt": "2026-09-24T00:00:00Z"}
        if path.endswith("/letters"):
            assert payload["recipientOrganization"] == "Example Ministry"
            assert payload["recipientAddress"] == "EX-01"
            assert payload["route"] == "exat"
            assert payload["reviewerUserId"] == reviewer_id
            return {"id": letter_id}
        raise AssertionError(path)

    api.request.side_effect = request
    state = modules.state.State(tmp_path / "state.sqlite")
    bot = modules.shared_bot.SharedBot(telegram, api, state)
    actor = {"id": 123}
    chat = {"id": 123, "type": "private"}

    def message(number, text):
        bot.handle({"update_id": number, "message": {
            "from": actor, "chat": chat, "text": text,
        }})

    def callback(number, data):
        bot.handle({"update_id": number, "callback_query": {
            "id": str(number), "from": actor, "message": {"chat": chat}, "data": data,
        }})

    message(1, "/start")
    menu = telegram.send_message.call_args.kwargs["reply_markup"]["keyboard"]
    assert any("Только подпись" in item["text"] for row in menu for item in row)
    message(2, "📤 Отправить письмо")
    assert state.get("conversation:123")["step"] == "subject"
    message(3, "Тема письма")
    assert state.get("conversation:123")["step"] == "recipient"
    assert "X-AI-Referent-Telegram-Id" not in str(api.request.call_args_list)
    callback(4, "u:0")
    callback(5, "b:0")
    assert state.get("conversation:123")["step"] == "reviewer"
    callback(6, "r:askar")
    callback(7, "z:none")
    assert state.get("conversation:123")["step"] == "upload"
    assert api.request.call_args_list[-1].kwargs["telegram_id"] == "123"


def test_bot_custom_address_search_and_stale_menu_not_used_as_recipient(modules, tmp_path):
    telegram = Mock()
    telegram.send_message.return_value = {"ok": True}
    api = Mock()
    api.request.side_effect = lambda path, *_args, **_kwargs: (
        {"reviewers": []} if path.endswith("/reviewers")
        else {"entries": [], "totalCount": 0, "updatedAt": None}
    )
    state = modules.state.State(tmp_path / "state.sqlite")
    bot = modules.shared_bot.SharedBot(telegram, api, state)
    actor = {"id": 123}
    chat = {"id": 123, "type": "private"}

    def message(number, text):
        bot.handle({"update_id": number, "message": {
            "from": actor, "chat": chat, "text": text,
        }})

    def callback(number, data):
        bot.handle({"update_id": number, "callback_query": {
            "id": str(number), "from": actor, "message": {"chat": chat}, "data": data,
        }})

    message(1, "Новое письмо")
    message(2, "Тема")
    message(3, "📩 Открыть очередь")
    assert state.get("conversation:123")["step"] == "recipient"
    callback(4, "h:search")
    message(5, "Министерство")
    assert "query=%D0%9C" in api.request.call_args.args[0]
    callback(6, "m:organization")
    message(7, "Новая организация")
    message(8, "не адрес")
    assert state.get("conversation:123")["step"] == "custom_address"
    message(9, "custom@example.org")
    context = state.get("conversation:123")
    assert context["route"] == "webmail"
    assert context["recipientAddress"] == "custom@example.org"
    message(10, "✍️ Только подпись")
    assert state.get("conversation:123")["step"] == "sign_subject"


def test_legacy_mutations_are_blocked_only_in_connected_mode(modules, monkeypatch):
    monkeypatch.setattr(
        modules.authority, "connection_settings", lambda: {"shared_workflow": "true"}
    )
    with pytest.raises(modules.client.WorkspaceError):
        modules.authority.guard_legacy_mutation()
    token = modules.authority.executing_server_job.set(True)
    try:
        modules.authority.guard_legacy_mutation()
    finally:
        modules.authority.executing_server_job.reset(token)
    monkeypatch.setattr(modules.authority, "connection_settings", lambda: {})
    modules.authority.guard_legacy_mutation()


def test_worker_does_not_repeat_started_job_and_retains_rejected_ack(modules, tmp_path):
    job = {"id": str(uuid4()), "letterId": str(uuid4()), "leaseToken": str(uuid4()), "kind": "send"}
    state = modules.state.State(tmp_path / "state.sqlite")
    api = Mock(agent_id="test")
    api.configuration.return_value = {"revision": 7}
    api.request.return_value = {"job": job}
    service = Mock(archive_root=str(tmp_path))
    worker = modules.worker.DeliveryWorker(service, api, state)
    state.claim("started:" + job["id"], job)
    worker.tick()
    service.retry_outgoing_send.assert_not_called()
    sent_result = api.request.call_args.args[1]
    assert sent_result["outcome"] == "unknown"
    api.acknowledge.assert_called_once_with(7)
    state.put("result:" + job["id"], sent_result)
    api.request.side_effect = modules.client.WorkspaceError("Expired lease", 409)
    worker.flush_results()
    assert state.get("unconfirmed:result:" + job["id"]) == sent_result
    assert state.get("result:" + job["id"]) is None


def test_worker_verifies_pdf_and_lease_before_external_send(modules, tmp_path):
    state = modules.state.State(tmp_path / "state.sqlite")
    pdf = tmp_path / "signed.pdf"
    pdf.write_bytes(b"%PDF signed")
    row = {"status": "signed", "signed_file_path": str(pdf)}
    service = Mock(archive_root=str(tmp_path))
    service.database.get_outgoing_letter.return_value = row
    api = Mock(agent_id="test")
    worker = modules.worker.DeliveryWorker(service, api, state)
    job = {
        "id": str(uuid4()),
        "letterId": str(uuid4()),
        "leaseToken": str(uuid4()),
        "signedFile": {"sha256": "incorrect"},
    }
    state.put("letter:" + job["letterId"], 42)
    with pytest.raises(modules.client.WorkspaceError):
        worker.send(job, threading.Event())
    service.retry_outgoing_send.assert_not_called()
    job["signedFile"]["sha256"] = hashlib.sha256(pdf.read_bytes()).hexdigest()
    api.request.side_effect = modules.client.WorkspaceError("Expired lease", 409)
    with pytest.raises(modules.client.WorkspaceError):
        worker.send(job, threading.Event())
    service.retry_outgoing_send.assert_not_called()
    api.request.side_effect = None
    service.database.get_outgoing_letter.side_effect = [
        row,
        {"status": "webmail_dry_run_prepared"},
        {"status": "webmail_sent"},
    ]
    result = worker.send(job, threading.Event())
    assert result["outcome"] == "sent"
    service.retry_outgoing_send.assert_called_once_with(42)
    service.confirm_manual_send.assert_called_once_with(42)
    assert api.request.call_count == 3  # rejected lease, then pre-compose and pre-send fences


def test_sync_versions_files_and_never_accepts_partial_excel(modules, tmp_path):
    api = Mock(agent_id="test")
    state = modules.state.State(tmp_path / "state.sqlite")
    sync = modules.sync.ArchiveSync(Mock(), api, state)
    file = tmp_path / "journal.xlsx"
    file.write_bytes(b"partial workbook")
    with pytest.raises(modules.client.WorkspaceError):
        sync.upload("journal", "owner", file, file.name)
    api.transfer.assert_not_called()
    buffer = BytesIO()
    with ZipFile(buffer, "w") as archive:
        archive.writestr("xl/workbook.xml", "<workbook/>")
    file.write_bytes(buffer.getvalue())
    sync.upload("journal", "owner", file, file.name)
    sync.upload("journal", "owner", file, file.name)
    api.transfer.assert_called_once()
    with pytest.raises(modules.client.WorkspaceError):
        sync.folder("archive", "owner", tmp_path, [tmp_path])
    with pytest.raises(modules.client.WorkspaceError):
        sync.folder("archive", "owner", tmp_path.parent, [tmp_path])


def test_recipient_catalog_uses_bot_source_and_retries_for_server_restore(
    modules, monkeypatch, tmp_path
):
    entry = SimpleNamespace(
        id="org-1", name="Example", category_key="other", addresses=("EX-01",),
        route="exat", address_book_organization="Example in address book",
    )
    catalog = SimpleNamespace(entries=[entry])
    source = SimpleNamespace(
        OrganizationCatalog=SimpleNamespace(from_project=Mock(return_value=catalog))
    )
    monkeypatch.setitem(sys.modules, "src.outgoing.organization_catalog", source)
    service = SimpleNamespace(project_root=tmp_path, outgoing_settings={}, address_book=Mock())
    api = Mock(agent_id="test-agent")
    sync = modules.sync.ArchiveSync(
        service, api, modules.state.State(tmp_path / "state.sqlite")
    )
    sync.recipients()
    sync.recipients()
    assert api.request.call_count == 2
    api.request.assert_called_with(
        "/ai-referent/agent/recipients",
        {"agentId": "test-agent", "entries": [{
            "id": "org-1", "name": "Example", "categoryKey": "other",
            "addresses": ["EX-01"], "route": "exat",
            "addressBookOrganization": "Example in address book",
        }]}, method="PUT",
    )
    catalog.entries = []
    with pytest.raises(modules.client.WorkspaceError):
        sync.recipients()


def test_sync_rejects_old_pending_work_and_keeps_shared_rows(modules, tmp_path):
    service = Mock()
    service.database.list_outgoing_review_requests.return_value = []
    service.database.list_outgoing_letters.return_value = [
        {"status": "waiting_review", "dry_run_json": "{}"}
    ]
    sync = modules.sync.ArchiveSync(service, Mock(), modules.state.State(tmp_path / "state.sqlite"))
    with pytest.raises(modules.client.WorkspaceError):
        sync.assert_no_legacy_pending()
    service.database.list_outgoing_letters.return_value = [
        {"status": "waiting_review", "dry_run_json": '{"workspace_letter_id":"test"}'},
        {"status": "exat_sent", "dry_run_json": "{}"},
    ]
    sync.assert_no_legacy_pending()


def test_bot_uses_real_private_actor_and_server_revision(modules, tmp_path):
    api, telegram = Mock(), Mock()
    telegram.send_message.return_value = {"ok": True}
    state = modules.state.State(tmp_path / "state.sqlite")
    bot = modules.shared_bot.SharedBot(telegram, api, state)
    letter_id = uuid4()
    letter = {
        "id": str(letter_id),
        "revision": 9,
        "subject": "Test",
        "status": "approved",
        "recipientOrganization": "Partner",
        "availableActions": [],
        "canEdit": False,
    }
    api.request.return_value = letter
    callback = {
        "update_id": 1,
        "callback_query": {
            "id": "query",
            "from": {"id": 123},
            "message": {"chat": {"type": "group", "id": 456}},
            "data": f"a:a:{letter_id.hex}:8",
        },
    }
    bot.handle(callback)
    api.request.assert_not_called()
    callback["callback_query"]["message"]["chat"] = {"type": "private", "id": 123}
    bot.handle(callback)
    action_call = api.request.call_args_list[0]
    assert action_call.kwargs["telegram_id"] == "123"
    assert action_call.args[1]["expectedRevision"] == 8
    assert action_call.args[1]["action"] == "approve"
    # Old callback cannot approve locally when the server rejects it.
    api.request.side_effect = modules.client.WorkspaceError("Stale revision", 409)
    bot.handle(callback)
    assert "Stale revision" in telegram.send_message.call_args.args[1]


def test_sign_only_worker_uploads_one_pdf_per_page_without_send(modules, monkeypatch, tmp_path):
    service = Mock(archive_root=str(tmp_path))
    api = Mock(agent_id="referent")
    state = modules.state.State(tmp_path / "state.sqlite")
    worker = modules.worker.DeliveryWorker(service, api, state)
    draft = tmp_path / "letters.docx"
    draft.write_bytes(b"test")
    monkeypatch.setattr(worker, "download", Mock(return_value=draft))
    produced = []
    for page in range(1, 8):
        pdf = tmp_path / f"{page:03d}.pdf"
        pdf.write_bytes(b"%PDF-test")
        produced.append(pdf)
    signer = Mock(return_value=produced)
    monkeypatch.setattr(modules.sign_only, "sign_document_pages", signer)
    upload = Mock()
    monkeypatch.setattr(worker.sync, "upload", upload)
    job = {
        "id": str(uuid4()), "letterId": str(uuid4()),
        "leaseToken": str(uuid4()), "reviewerName": "Approver",
        "files": [{"id": str(uuid4()), "name": "letters.docx", "role": "primary"}],
    }
    receipt = worker.sign_only(job)
    assert receipt["outcome"] == "prepared"
    assert receipt["signedPages"] == 7
    assert upload.call_count == 7
    assert [call.args[3] for call in upload.call_args_list] == [
        f"signed/{job['id']}/{page:03d}.pdf" for page in range(1, 8)
    ]
    service.handle_review.assert_not_called()
    service.retry_outgoing_send.assert_not_called()
