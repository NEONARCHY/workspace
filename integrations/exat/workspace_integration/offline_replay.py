"""Small, retry-safe steps toward replaying autonomous AI Referent activity.

Draft changes, voice comments, decisions and signed PDFs can be acknowledged. Do not resume
Workspace writes until every operation kind and the final reconciliation protocol are implemented.
"""

from __future__ import annotations

from uuid import UUID

from .client import WorkspaceClient
from .offline_journal import OfflineJournal


def stage_pending_blobs(
    journal: OfflineJournal, client: WorkspaceClient, epoch: str, *, limit: int = 100
) -> list[str]:
    """Upload referenced files; a lost response merely causes a safe retry."""
    epoch = str(UUID(epoch))
    staged: list[str] = []
    for digest in journal.pending_blob_hashes(limit):
        _stage_blob(journal, client, epoch, digest)
        staged.append(digest)
    return staged


def _stage_blob(
    journal: OfflineJournal, client: WorkspaceClient, epoch: str, digest: str
) -> None:
    content = journal.read_blob(digest)
    receipt = client.upload_offline_blob(epoch, digest, content)
    if (
        str(UUID(str(receipt["epoch"]))) != epoch
        or receipt["sha256"] != digest
        or receipt["byteSize"] != len(content)
    ):
        raise ValueError("Сервер подтвердил другой автономный файл.")
    UUID(str(receipt["id"]))


def replay_one_draft_operation(journal: OfflineJournal, client: WorkspaceClient) -> bool:
    """Replay the earliest operation once, with a stable ID across lost responses.

    Return False for an empty journal. Unsupported operations stop the stream
    without acknowledging anything, so a later version can replay them safely.
    """
    pending = journal.pending_authorized(1)
    if not pending:
        return False
    operation = pending[0]
    if operation["kind"] not in {
        "letter.create", "letter.update", "letter.attachment", "letter.document_check",
        "letter.comment_audio", "letter.action",
        "letter.prepared", "letter.signed", "letter.dispatched",
    }:
        raise ValueError("Следующая автономная операция ещё не поддерживается сервером.")
    expected_revision = 1
    if operation["kind"] != "letter.create":
        revision_field = (
            "revision" if operation["kind"] == "letter.comment_audio" else "expectedRevision"
        )
        prior_revision = operation["payload"].get(revision_field)
        if type(prior_revision) is not int or prior_revision < 1:
            raise ValueError("Автономная операция не содержит ожидаемую версию письма.")
        expected_revision = prior_revision + (
            operation["kind"] not in {"letter.document_check", "letter.comment_audio"}
        )
    epoch = str(UUID(str(operation["authority_epoch"])))
    state = journal.authority_state()
    if state is None or state["epoch"] != epoch or state["phase"] != "replay":
        raise ValueError("Воспроизведение разрешено только после подтверждения эпохи.")
    if operation["kind"] in {
        "letter.attachment", "letter.document_check", "letter.comment_audio",
        "letter.prepared", "letter.signed",
    }:
        digest = operation["blob_sha256"]
        if not isinstance(digest, str):
            raise ValueError("Автономное вложение не содержит файл.")
        _stage_blob(journal, client, epoch, digest)
    request = {
        "operationId": operation["operation_id"],
        "sequence": operation["sequence"],
        "actorId": operation["actor_id"],
        "letterId": operation["letter_id"],
        "kind": operation["kind"],
        "payload": operation["payload"],
        "blobSha256": operation["blob_sha256"],
        "authorityEpoch": epoch,
        "rightsSnapshotId": operation["rights_snapshot_id"],
        "rightsContentSha256": operation["rights_content_sha256"],
        "requiredAction": operation["required_action"],
        "occurredAt": operation["occurred_at"],
    }
    receipt = client.replay_offline_operation(epoch, request)
    if (
        str(UUID(str(receipt["operationId"]))) != operation["operation_id"]
        or int(receipt["sequence"]) != operation["sequence"]
        or str(UUID(str(receipt["letterId"]))) != operation["letter_id"]
        or int(receipt["resultRevision"]) != expected_revision
    ):
        raise ValueError("Сервер подтвердил другую автономную операцию.")
    journal.finish(operation["sequence"], accepted=True, result=receipt)
    return True
