"""Physical executor checks do not stamp, click Send or accept a changed PDF."""

import hashlib
import importlib
from unittest.mock import Mock
from uuid import uuid4

import pytest

from test_ai_referent_shared_adapter import modules as modules


def test_signature_preflight_only_reports_configured_safe_signers(modules, tmp_path):
    module = importlib.import_module("workspace_integration.preflight")
    facsimile = Mock(enabled=True)
    facsimile.check_signature_placements.return_value = {"First": None, "Second": "No placement"}
    reviewers = [{"key": "askar", "name": "First"}, {"key": "bobur", "name": "Second"}]
    assert module.check_document(facsimile, tmp_path / "letter.docx", reviewers, "delivery") == [
        "askar"
    ]
    facsimile.apply.assert_not_called()
    facsimile.enabled = False
    with pytest.raises(modules.client.WorkspaceError):
        module.check_document(facsimile, tmp_path / "letter.docx", reviewers, "delivery")


@pytest.mark.parametrize("automatic", [True, False])
def test_dispatch_uses_pinned_pdf_and_current_gui_send_setting(
    modules, tmp_path, monkeypatch, automatic
):
    pdf = tmp_path / "signed.pdf"
    pdf.write_bytes(b"%PDF-1.4 exact final version")
    service = Mock(
        archive_root=str(tmp_path), outgoing_settings={"exat_send": {"allow_real_send": automatic}}
    )
    service.database.get_outgoing_letter.return_value = {"signed_file_path": str(pdf)}
    state = modules.state.State(tmp_path / "state.sqlite")
    worker = modules.worker.DeliveryWorker(service, Mock(agent_id="test"), state)
    letter_id = str(uuid4())
    state.put("letter:" + letter_id, 7)
    prepare = Mock(return_value=42)
    monkeypatch.setattr(modules.worker, "prepare_compose", prepare)
    job = {
        "letterId": letter_id,
        "leaseToken": str(uuid4()),
        "signedFile": {"id": str(uuid4()), "sha256": hashlib.sha256(pdf.read_bytes()).hexdigest()},
    }
    assert worker.dispatch(job)["autoSend"] == automatic
    prepare.assert_called_once_with(service, 7)
    service.confirm_manual_send.assert_not_called()
    pdf.write_bytes(b"%PDF-1.4 tampered")
    with pytest.raises(modules.client.WorkspaceError, match="PDF"):
        worker.dispatch(job)
    assert prepare.call_count == 1


def test_delete_reconciles_missing_mapping_and_refuses_sent_local_letter(
    modules, tmp_path, monkeypatch
):
    service = Mock(archive_root=str(tmp_path))
    state = modules.state.State(tmp_path / "state.sqlite")
    worker = modules.worker.DeliveryWorker(service, Mock(agent_id="test"), state)
    job = {"letterId": str(uuid4()), "kind": "delete", "leaseToken": str(uuid4())}
    service.database.list_outgoing_letters.return_value = []
    with pytest.raises(modules.client.WorkspaceError):
        worker.finish_local(job)
    row = {
        "id": 4,
        "status": "exat_sent",
        "dry_run_json": '{"workspace_letter_id":"' + job["letterId"] + '"}',
    }
    service.database.list_outgoing_letters.return_value = [row]
    with pytest.raises(modules.client.WorkspaceError):
        worker.finish_local(job)
    service.database.delete_outgoing_letter.assert_not_called()
    row["status"] = "manual_send_pending"
    monkeypatch.setattr(modules.worker, "close_prepared", Mock())
    assert worker.finish_local(job)["outcome"] == "deleted"
    service.database.delete_outgoing_letter.assert_called_once_with(4)
    assert state.get("deleted-local:" + job["letterId"])
