"""Immutable, content-addressed staging for a bot's offline letter files.

Staging does not publish a document or mutate a letter. A later replay step
must verify the recorded digest again before attaching it to a letter.
"""

# ruff: noqa: RUF001

import hashlib
from datetime import UTC, datetime
from uuid import NAMESPACE_URL, UUID, uuid5

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncConnection

from .ai_referent_schemas import OfflineBlobReceipt
from .object_storage import ObjectStorage
from .tables import ai_referent_authority, ai_referent_configuration, ai_referent_offline_blobs


async def _require_staging_authority(
    connection: AsyncConnection, agent_id: str, epoch: UUID, *, lock: bool
) -> None:
    config_query = select(ai_referent_configuration.c.execution_agent_id)
    authority_query = select(ai_referent_authority)
    if lock:
        config_query = config_query.with_for_update(read=True)
        authority_query = authority_query.with_for_update(read=True)
    assigned = await connection.scalar(config_query)
    if assigned != agent_id:
        raise HTTPException(403, "Этот компьютер не назначен агентом отправки.")
    authority = (await connection.execute(authority_query)).mappings().first()
    if (
        authority is None or authority["agent_id"] != agent_id
        or authority["epoch"] != epoch
        or authority["mode"] not in {"online", "replay_required"}
        or (authority["mode"] == "online" and authority["lease_until"] <= datetime.now(UTC))
    ):
        raise HTTPException(409, "Эпоха робота не подтверждена для передачи файлов.")


async def stage_offline_blob(
    connection: AsyncConnection,
    storage: ObjectStorage,
    *,
    agent_id: str,
    epoch: UUID,
    sha256: str,
    content: bytes,
    enabled: bool,
) -> OfflineBlobReceipt:
    if not enabled:
        raise HTTPException(409, "Автономный режим AI Referent пока не включён на сервере.")
    if not content or hashlib.sha256(content).hexdigest() != sha256:
        raise HTTPException(422, "Контрольная сумма автономного файла не совпала.")
    await _require_staging_authority(connection, agent_id, epoch, lock=False)
    blob_id = uuid5(NAMESPACE_URL, f"ai-offline-blob:{agent_id}:{epoch}:{sha256}")
    key = f"ai-referent/offline/{agent_id}/{epoch}/{sha256}"
    # Same key can only receive identical bytes because its digest is checked.
    # Re-uploading repairs an object written before a failed DB transaction.
    await storage.put(key, content, "application/octet-stream")
    await _require_staging_authority(connection, agent_id, epoch, lock=True)
    await connection.execute(
        pg_insert(ai_referent_offline_blobs)
        .values(
            id=blob_id, agent_id=agent_id, epoch=epoch, sha256=sha256,
            byte_size=len(content), storage_key=key, created_at=datetime.now(UTC),
        )
        .on_conflict_do_nothing(index_elements=[ai_referent_offline_blobs.c.id])
    )
    row = (
        await connection.execute(
            select(ai_referent_offline_blobs)
            .where(ai_referent_offline_blobs.c.id == blob_id)
            .with_for_update(read=True)
        )
    ).mappings().one()
    if (
        row["agent_id"] != agent_id or row["epoch"] != epoch
        or row["sha256"] != sha256 or row["byte_size"] != len(content)
        or row["storage_key"] != key
    ):
        raise HTTPException(500, "Сохранённый автономный файл не совпал с запросом.")
    return OfflineBlobReceipt(id=blob_id, epoch=epoch, sha256=sha256, byte_size=len(content))
