"""Small, retry-safe steps toward replaying autonomous AI Referent activity.

Only file staging is implemented here. Do not acknowledge local operations or
resume Workspace writes until the complete replay protocol is implemented.
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
        content = journal.read_blob(digest)
        receipt = client.upload_offline_blob(epoch, digest, content)
        if (
            str(UUID(str(receipt["epoch"]))) != epoch
            or receipt["sha256"] != digest
            or receipt["byteSize"] != len(content)
        ):
            raise ValueError("Сервер подтвердил другой автономный файл.")
        UUID(str(receipt["id"]))
        staged.append(digest)
    return staged
