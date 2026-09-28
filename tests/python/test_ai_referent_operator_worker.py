"""Administrator correction must not ask for approval or silently send a letter."""

import hashlib
import importlib
import json
import sys
import threading
import time
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


def test_failed_bootstrap_keeps_polling_and_checks_docx_without_delivery(
    modules, tmp_path, monkeypatch
):
    monkeypatch.setitem(
        sys.modules,
        "src.outgoing.telegram_bot",
        SimpleNamespace(
            PollingResult=lambda *args: args,
        ),
    )
    controller, worker, bot = Mock(), Mock(), Mock()
    failed = threading.Event()
    checked = threading.Event()
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
    worker.check_documents.side_effect = checked.set
    bot._status_log.side_effect = status
    polls = []

    def poll(**_kwargs):
        assert failed.wait(2), "Bootstrap was not scheduled in the background"
        assert checked.wait(2), "DOCX checks must not wait for the archive bootstrap"
        polls.append(len(polls) + 1)
        return {"result": [{"update_id": polls[-1], "message": {"text": "/start"}}]}

    bot.client.get_updates.side_effect = poll
    controller.notifications.side_effect = RuntimeError("notifications temporarily unavailable")
    monkeypatch.setattr(modules.shared_bot, "WorkspaceClient", Mock())
    monkeypatch.setattr(modules.shared_bot, "OfflineCoordinator", Mock())
    monkeypatch.setattr(modules.shared_bot, "SharedBot", Mock(return_value=controller))
    monkeypatch.setattr(modules.shared_bot, "DeliveryWorker", Mock(return_value=worker))
    monkeypatch.setattr(modules.shared_bot, "connection_path", lambda: tmp_path / "connection")
    result = modules.shared_bot._run_shared(bot, max_updates=2)
    assert result[:3] == ("stopped", 2, 2)
    assert polls == [1, 2] and controller.handle.call_count == 2
    assert bootstrap_threads == ["workspace-executor"]
    assert worker.check_documents.called
    worker.tick.assert_not_called()
    worker.sync.run.assert_not_called()
    assert modules.sync.MAX_ARCHIVE_FILE_BYTES == 200 * 1024 * 1024


def test_document_check_runs_while_archive_bootstrap_is_still_busy(
    modules, tmp_path, monkeypatch
):
    monkeypatch.setitem(
        sys.modules,
        "src.outgoing.telegram_bot",
        SimpleNamespace(PollingResult=lambda *args: args),
    )
    worker, bot = Mock(), Mock()
    entered, release, checked = threading.Event(), threading.Event(), threading.Event()

    def bootstrap():
        entered.set()
        assert release.wait(3), "The test must release archive reconciliation"

    worker.bootstrap.side_effect = bootstrap
    worker.check_documents.side_effect = checked.set

    def poll(**_kwargs):
        try:
            assert entered.wait(2)
            assert checked.wait(2), "Preflight was blocked by the archive reconciliation"
        finally:
            release.set()
        return {"result": [{"update_id": 1}]}

    bot.client.get_updates.side_effect = poll
    monkeypatch.setattr(modules.shared_bot, "WorkspaceClient", Mock())
    monkeypatch.setattr(modules.shared_bot, "OfflineCoordinator", Mock())
    monkeypatch.setattr(modules.shared_bot, "SharedBot", Mock())
    monkeypatch.setattr(modules.shared_bot, "DeliveryWorker", Mock(return_value=worker))
    monkeypatch.setattr(modules.shared_bot, "connection_path", lambda: tmp_path / "connection")
    result = modules.shared_bot._run_shared(bot, max_updates=1)
    assert result[:3] == ("stopped", 1, 1)
    worker.check_documents.assert_called()


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


@pytest.mark.parametrize("route", ["exat", "webmail"])
def test_offline_send_calls_durable_fence_at_click_without_workspace(
    modules, tmp_path, monkeypatch, route,
):
    delivery = importlib.import_module("workspace_integration.delivery")
    worker_module = importlib.import_module("workspace_integration.worker")
    signed = tmp_path / "signed.pdf"
    signed.write_bytes(b"%PDF-1.7 checked")
    digest = hashlib.sha256(signed.read_bytes()).hexdigest()
    letter_id = str(uuid4())
    row = {"id": 7, "status": "approved", "destination_route": route,
           "signed_file_path": str(signed)}
    prepared = {**row, "status": "webmail_dry_run_prepared" if route == "webmail"
                else "exat_compose_prepared"}
    sent = {**row, "status": "webmail_sent" if route == "webmail" else "exat_sent"}
    service = Mock(archive_root=tmp_path)
    service.database.get_outgoing_letter.side_effect = [row, prepared, sent]
    client = Mock(agent_id="referent-pc")
    state = modules.shared_bot.State(tmp_path / "worker-state.sqlite")
    state.put("letter:" + letter_id, 7)
    worker = worker_module.DeliveryWorker(service, client, state)
    monkeypatch.setattr(delivery, "prepared_open", Mock(return_value=True))
    monkeypatch.setattr(worker_module, "prepared_open", Mock(return_value=True))
    fence = Mock()
    adapter = service.webmail_sender if route == "webmail" else service.exat_compose
    service.confirm_manual_send.side_effect = lambda local_id: (
        adapter.click_prepared_send(local_id)
    )
    result = worker.send(
        {"id": str(uuid4()), "letterId": letter_id, "leaseToken": "offline-only",
         "signedFile": {"sha256": digest}},
        threading.Event(), offline_fence=fence,
    )
    assert result["outcome"] == "sent"
    fence.assert_called_once_with()
    adapter.click_prepared_send.assert_called_once_with(7)
    client.request.assert_not_called()


def test_offline_send_does_not_reuse_prior_online_sent_receipt(modules, tmp_path):
    worker_module = importlib.import_module("workspace_integration.worker")
    letter_id = str(uuid4())
    service = Mock(archive_root=tmp_path)
    service.database.get_outgoing_letter.return_value = {
        "id": 7, "status": "exat_sent", "destination_route": "exat",
    }
    client = Mock(agent_id="referent-pc")
    state = modules.shared_bot.State(tmp_path / "worker-state.sqlite")
    state.put("letter:" + letter_id, 7)
    fence = Mock()
    worker = worker_module.DeliveryWorker(service, client, state)
    with pytest.raises(modules.client.WorkspaceError, match="Сверьте E-XAT/Webmail"):
        worker.send(
            {"id": str(uuid4()), "letterId": letter_id, "leaseToken": "offline-only"},
            threading.Event(), offline_fence=fence,
        )
    fence.assert_called_once_with()
    service.confirm_manual_send.assert_not_called()
    client.request.assert_not_called()


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

    targets = {}

    def thread(*, target, name, **_kwargs):
        targets[name] = target
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
        targets["workspace-executor"]()
        return {"result": [{"update_id": 1}]}

    bot.client.get_updates.side_effect = poll
    monkeypatch.setattr(modules.shared_bot, "threading", SimpleNamespace(Event=Stop, Thread=thread))
    monkeypatch.setattr(modules.shared_bot, "time", SimpleNamespace(monotonic=lambda: now[0]))
    monkeypatch.setattr(modules.shared_bot, "WorkspaceClient", Mock())
    authority = Mock()
    authority.tick.return_value = "legacy"
    monkeypatch.setattr(
        modules.shared_bot, "OfflineCoordinator", Mock(return_value=authority)
    )
    monkeypatch.setattr(modules.shared_bot, "SharedBot", Mock())
    monkeypatch.setattr(modules.shared_bot, "DeliveryWorker", Mock(return_value=worker))
    monkeypatch.setattr(modules.shared_bot, "connection_path", lambda: tmp_path / "connection")
    modules.shared_bot._run_shared(bot, max_updates=1)
    assert attempts == [0, 60]
    assert syncs == [120, 180]
    assert ticks and min(ticks) == 60
    bot._status_log.assert_any_call("workspace_bootstrap_completed", attempts=2)


@pytest.mark.parametrize("mode", ["offline", "replay"])
def test_runtime_fences_offline_jobs_and_replays_before_resuming(
    modules, tmp_path, monkeypatch, mode
):
    monkeypatch.setitem(
        sys.modules, "src.outgoing.telegram_bot",
        SimpleNamespace(PollingResult=lambda *args: args),
    )
    now = [0.0]

    class Stop:
        def is_set(self):
            return now[0] >= 15

        def wait(self, seconds):
            now[0] += seconds

        def set(self):
            now[0] = 15

    targets = {}

    def thread(*, target, name, **_kwargs):
        targets[name] = target
        return SimpleNamespace(start=lambda: None, join=lambda **_kwargs: None)

    journal = modules.shared_bot.OfflineJournal(tmp_path / "offline")
    journal.set_authority_phase("referent-pc", str(uuid4()), "online")
    journal.set_authority_phase("referent-pc", journal.authority_state()["epoch"], mode)
    worker, bot, controller = Mock(), Mock(), Mock()
    client = Mock(agent_id="referent-pc")
    authority = Mock()
    authority.tick.side_effect = (
        (lambda: "replay" if journal.authority_state()["phase"] == "replay" else "online")
        if mode == "replay" else (lambda: "offline")
    )
    def replay_tick():
        manifest = journal.replay_manifest()
        journal.finish_replay(manifest["epoch"], str(uuid4()), 45, manifest)
        return "online"

    authority.replay_tick.side_effect = replay_tick
    monkeypatch.setattr(modules.shared_bot, "threading", SimpleNamespace(Event=Stop, Thread=thread))
    monkeypatch.setattr(modules.shared_bot, "time", SimpleNamespace(monotonic=lambda: now[0]))
    monkeypatch.setattr(modules.shared_bot, "WorkspaceClient", Mock(return_value=client))
    monkeypatch.setattr(
        modules.shared_bot, "OfflineCoordinator", Mock(return_value=authority)
    )
    monkeypatch.setattr(modules.shared_bot, "SharedBot", Mock(return_value=controller))
    monkeypatch.setattr(modules.shared_bot, "DeliveryWorker", Mock(return_value=worker))
    monkeypatch.setattr(modules.shared_bot, "connection_path", lambda: tmp_path / "connection")

    def poll(**_kwargs):
        targets["workspace-authority" if mode == "offline" else "workspace-executor"]()
        return {"result": [{"update_id": 1}]}

    bot.client.get_updates.side_effect = poll
    result = modules.shared_bot._run_shared(bot, max_updates=1)
    assert result[:3] == ("stopped", 1, 1)
    assert authority.tick.called
    if mode == "offline":
        authority.replay_tick.assert_not_called()
        worker.bootstrap.assert_not_called()
        worker.tick.assert_not_called()
    else:
        authority.replay_tick.assert_called()
        worker.bootstrap.assert_called()
        worker.tick.assert_called()
    worker.sync.run.assert_not_called()


def test_authority_renews_while_a_server_job_is_still_running(modules, tmp_path, monkeypatch):
    monkeypatch.setitem(
        sys.modules, "src.outgoing.telegram_bot",
        SimpleNamespace(PollingResult=lambda *args: args),
    )
    client, controller, worker, bot = Mock(agent_id="referent-pc"), Mock(), Mock(), Mock()
    authority = Mock()
    authority.tick.return_value = "legacy"
    entered, release = threading.Event(), threading.Event()
    calls_at_job_start = [0]

    def long_job():
        calls_at_job_start[0] = authority.tick.call_count
        entered.set()
        assert release.wait(3)

    worker.tick.side_effect = long_job
    monkeypatch.setattr(modules.shared_bot, "WorkspaceClient", Mock(return_value=client))
    monkeypatch.setattr(
        modules.shared_bot, "OfflineCoordinator", Mock(return_value=authority)
    )
    monkeypatch.setattr(modules.shared_bot, "SharedBot", Mock(return_value=controller))
    monkeypatch.setattr(modules.shared_bot, "DeliveryWorker", Mock(return_value=worker))
    monkeypatch.setattr(modules.shared_bot, "connection_path", lambda: tmp_path / "connection")
    monkeypatch.setattr(modules.shared_bot, "_AUTHORITY_REFRESH_SECONDS", 0.02)

    def poll(**_kwargs):
        try:
            assert entered.wait(2)
            deadline = time.monotonic() + 2
            while authority.tick.call_count <= calls_at_job_start[0]:
                assert time.monotonic() < deadline, "Authority stopped renewing during the job"
                time.sleep(0.01)
        finally:
            release.set()
        return {"result": [{"update_id": 1}]}

    bot.client.get_updates.side_effect = poll
    result = modules.shared_bot._run_shared(bot, max_updates=1)
    assert result[:3] == ("stopped", 1, 1)
    assert authority.tick.call_count > calls_at_job_start[0]


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
