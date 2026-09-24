"""Administrator correction must not ask for approval or silently send a letter."""

import importlib
import json
import sys
import threading
from types import SimpleNamespace
from unittest.mock import MagicMock, Mock
from uuid import uuid4

import pytest

from test_ai_referent_shared_adapter import modules as modules


@pytest.mark.parametrize("extension", ["docx", "pdf"])
def test_operator_replacement_preserves_number_and_requires_explicit_send(
    modules,
    tmp_path,
    monkeypatch,
    extension,
):
    monkeypatch.setitem(
        sys.modules,
        "src.outgoing.service",
        SimpleNamespace(
            OutgoingReviewDecision=lambda *args: args,
        ),
    )
    letter_id, job_id = str(uuid4()), str(uuid4())
    draft = tmp_path / f"correction.{extension}"
    draft.write_bytes(b"%PDF-1.4 corrected" if extension == "pdf" else b"PK corrected")
    signed = tmp_path / "generated.pdf"
    signed.write_bytes(b"%PDF-1.4 signed")
    row = {
        "id": 7,
        "outgoing_number": 77,
        "year_suffix": "26",
        "status": "operator_revision",
        "dry_run_json": json.dumps({"workspace_letter_id": letter_id}),
    }
    service = MagicMock(archive_root=str(tmp_path))
    service.outgoing_settings = {"exat_send": {"allow_real_send": True}}
    service.database.list_outgoing_letters.return_value = [row]
    service.database.get_outgoing_letter.return_value = {"signed_file_path": str(draft)}
    service._resolve_destination_entry.return_value = SimpleNamespace(
        route="webmail",
        organization="Partner",
        primary_address="partner@example.org",
    )
    service.handle_review.return_value = {"signed_file_path": str(signed)}
    worker = modules.worker.DeliveryWorker(
        service,
        Mock(agent_id="test"),
        modules.state.State(tmp_path / "state.sqlite"),
    )
    monkeypatch.setattr(worker, "download", Mock(return_value=draft))
    upload = Mock()
    monkeypatch.setattr(worker.sync, "upload", upload)
    prepare = Mock(return_value=None)
    monkeypatch.setattr(modules.worker, "prepare_compose", prepare)
    job = {
        "id": job_id,
        "letterId": letter_id,
        "kind": "reprepare",
        "leaseToken": str(uuid4()),
        "outgoingNumber": 77,
        "yearSuffix": "26",
        "subject": "Sender's exact subject",
        "files": [{"id": str(uuid4()), "name": draft.name, "role": "primary"}],
        "recipientAddress": "partner@example.org",
        "recipientOrganization": "Partner",
        "route": "webmail",
        "senderTelegramId": "123",
        "senderName": "Author",
        "reviewerTelegramId": "456",
        "reviewerName": "Approved signer",
    }
    result = worker.prepare(job)
    assert result["outcome"] == "prepared" and result["autoSend"] is False
    service.database.insert_outgoing_letter.assert_not_called()
    sql, values = (
        service.database.connect.return_value.__enter__.return_value.execute.call_args.args
    )
    assert sql.startswith("UPDATE outgoing_letters")
    assert values[:3] == (77, "26", "Sender's exact subject") and values[-1] == 7
    assert worker.state.get("letter:" + letter_id) == 7
    assert upload.call_args.args[3] == f"signed/{job_id}.pdf"
    if extension == "pdf":
        service.handle_review.assert_not_called()
        assert upload.call_args.args[2] == draft
    else:
        service.handle_review.assert_called_once_with((7, "approve"), defer_send=True)
        assert upload.call_args.args[2] == signed
    prepare.assert_called_once_with(service, 7)
    service.confirm_manual_send.assert_not_called()


def test_failed_bootstrap_keeps_polling_but_never_ticks(modules, tmp_path, monkeypatch):
    monkeypatch.setitem(
        sys.modules,
        "src.outgoing.telegram_bot",
        SimpleNamespace(
            PollingResult=lambda *args: args,
        ),
    )
    controller, worker, bot = Mock(), Mock(), Mock()
    failed = threading.Event()
    bootstrap_threads = []

    def bootstrap():
        bootstrap_threads.append(threading.current_thread().name)
        raise RuntimeError("archive unavailable")

    def status(event, **detail):
        if event == "workspace_bootstrap_failed":
            assert detail == {
                "error": "RuntimeError",
                "detail": "archive unavailable",
                "attempts": 1,
            }
            failed.set()

    worker.bootstrap.side_effect = bootstrap
    bot._status_log.side_effect = status
    polls = []

    def poll(**_kwargs):
        assert failed.wait(2), "Bootstrap was not scheduled in the background"
        polls.append(len(polls) + 1)
        return {"result": [{"update_id": polls[-1], "message": {"text": "/start"}}]}

    bot.client.get_updates.side_effect = poll
    controller.notifications.side_effect = RuntimeError("notifications temporarily unavailable")
    monkeypatch.setattr(modules.shared_bot, "WorkspaceClient", Mock())
    monkeypatch.setattr(modules.shared_bot, "SharedBot", Mock(return_value=controller))
    monkeypatch.setattr(modules.shared_bot, "DeliveryWorker", Mock(return_value=worker))
    monkeypatch.setattr(modules.shared_bot, "connection_path", lambda: tmp_path / "connection")
    result = modules.shared_bot._run_shared(bot, max_updates=2)
    assert result[:3] == ("stopped", 2, 2)
    assert polls == [1, 2] and controller.handle.call_count == 2
    assert bootstrap_threads == ["workspace-executor"]
    worker.tick.assert_not_called()
    worker.sync.run.assert_not_called()
    assert modules.sync.MAX_ARCHIVE_FILE_BYTES == 200 * 1024 * 1024


def test_send_guard_checks_identity_and_lease_at_actual_adapter_call(modules, monkeypatch):
    delivery = importlib.import_module("workspace_integration.delivery")
    service = Mock()
    row = {"id": 7, "destination_route": "webmail"}
    original = service.webmail_sender.click_prepared_send
    fence = Mock()
    monkeypatch.setattr(delivery, "prepared_open", Mock(return_value=False))
    with (
        delivery.guarded_send(service, row, None, fence),
        pytest.raises(modules.client.WorkspaceError),
    ):
        service.webmail_sender.click_prepared_send(7, logs_root="test")
    original.assert_not_called()
    fence.assert_not_called()
    assert service.webmail_sender.click_prepared_send is original
    monkeypatch.setattr(delivery, "prepared_open", Mock(return_value=True))
    fence.side_effect = modules.client.WorkspaceError("lease expired")
    with (
        delivery.guarded_send(service, row, None, fence),
        pytest.raises(modules.client.WorkspaceError),
    ):
        service.webmail_sender.click_prepared_send(7, logs_root="test")
    original.assert_not_called()
    fence.side_effect = None
    with delivery.guarded_send(service, row, None, fence):
        service.webmail_sender.click_prepared_send(7, logs_root="test")
    original.assert_called_once_with(7, logs_root="test")


def test_bootstrap_recovers_and_failed_archive_retries_are_throttled(
    modules, tmp_path, monkeypatch
):
    monkeypatch.setitem(
        sys.modules,
        "src.outgoing.telegram_bot",
        SimpleNamespace(
            PollingResult=lambda *args: args,
        ),
    )
    now = [0.0]

    class Stop:
        def is_set(self):
            return now[0] >= 200

        def wait(self, seconds):
            now[0] += seconds

        def set(self):
            now[0] = 200

    targets = []

    def thread(*, target, **_kwargs):
        targets.append(target)
        return SimpleNamespace(start=lambda: None, join=lambda **_kwargs: None)

    worker, bot = Mock(), Mock()
    attempts, syncs, ticks = [], [], []

    def bootstrap():
        attempts.append(now[0])
        if len(attempts) == 1:
            raise RuntimeError("initial archive failure")

    def sync():
        syncs.append(now[0])
        raise RuntimeError("archive failure after recovery")

    worker.bootstrap.side_effect = bootstrap
    worker.sync.run.side_effect = sync
    worker.tick.side_effect = lambda: ticks.append(now[0])

    def poll(**_kwargs):
        targets[0]()
        return {"result": [{"update_id": 1}]}

    bot.client.get_updates.side_effect = poll
    monkeypatch.setattr(modules.shared_bot, "threading", SimpleNamespace(Event=Stop, Thread=thread))
    monkeypatch.setattr(modules.shared_bot, "time", SimpleNamespace(monotonic=lambda: now[0]))
    monkeypatch.setattr(modules.shared_bot, "WorkspaceClient", Mock())
    monkeypatch.setattr(modules.shared_bot, "SharedBot", Mock())
    monkeypatch.setattr(modules.shared_bot, "DeliveryWorker", Mock(return_value=worker))
    monkeypatch.setattr(modules.shared_bot, "connection_path", lambda: tmp_path / "connection")
    modules.shared_bot._run_shared(bot, max_updates=1)
    assert attempts == [0, 60]
    assert syncs == [120, 180]
    assert ticks and min(ticks) == 60
    bot._status_log.assert_any_call("workspace_bootstrap_completed", attempts=2)


def test_notifications_attach_only_current_version_after_admin_replacement(modules):
    letter = {
        "status": "referent_review_pending",
        "attachments": [
            {"id": "old", "documentRole": "general"},
            {"id": "new", "documentRole": "primary"},
            {"id": "extra", "documentRole": "additional"},
        ],
    }
    files = [
        {"id": name, "source": "attachment", "name": name + ".docx"}
        for name in ("old", "new", "extra")
    ] + [
        {
            "id": "signed-old",
            "source": "packet",
            "name": "signed/old.pdf",
            "createdAt": "2026-09-23",
        },
        {
            "id": "signed-new",
            "source": "packet",
            "name": "signed/new.pdf",
            "createdAt": "2026-09-24",
        },
    ]
    assert [
        item["id"] for item in modules.shared_bot.SharedBot.current_documents(letter, files)
    ] == [
        "signed-new",
        "extra",
    ]
    letter["status"] = "needs_revision"
    assert [
        item["id"] for item in modules.shared_bot.SharedBot.current_documents(letter, files)
    ] == [
        "new",
        "extra",
    ]
