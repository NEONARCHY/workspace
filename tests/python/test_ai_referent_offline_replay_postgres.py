"""Offline draft replay is ordered, authorized and atomic on PostgreSQL."""

import hashlib
import json
import os
from datetime import UTC, datetime, timedelta
from io import BytesIO
from uuid import NAMESPACE_URL, uuid4, uuid5
from zipfile import ZipFile

import pytest
from fastapi import HTTPException
from sqlalchemy import delete, insert, select, update
from sqlalchemy.ext.asyncio import create_async_engine

from yuksalish_api.ai_referent_authority import start_authority
from yuksalish_api.ai_referent_offline_blobs import stage_offline_blob
from yuksalish_api.ai_referent_offline_replay import replay_offline_operation
from yuksalish_api.ai_referent_schemas import OfflineReplayOperation
from yuksalish_api.object_storage import InMemoryObjectStorage
from yuksalish_api.tables import (
    ai_referent_authority,
    ai_referent_comment_audio,
    ai_referent_configuration,
    ai_referent_document_checks,
    ai_referent_events,
    ai_referent_letters,
    ai_referent_offline_operation_receipts,
    ai_referent_offline_rights_snapshots,
    ai_referent_reviewers,
    attachments,
    users,
)


@pytest.fixture
def anyio_backend():
    return "asyncio"


def _operation(
    epoch, snapshot_id, rights_hash, actor_id, user_id,
    *, sequence=1, reviewer_user_id=None,
):
    operation_id = uuid4()
    letter_id = uuid5(NAMESPACE_URL, f"ai-offline:{epoch}:{operation_id}")
    occurred_at = datetime.now(UTC) - timedelta(minutes=2)
    return OfflineReplayOperation(
        operation_id=operation_id,
        sequence=sequence,
        actor_id=actor_id,
        letter_id=letter_id,
        kind="letter.create",
        payload={
            "letterId": str(letter_id),
            "actorUserId": str(user_id),
            "actorName": "Offline Test Employee",
            "subject": "Test letter",
            "recipientOrganization": "Test recipient",
            "recipientAddress": "example@example.test",
            "route": "webmail",
            "note": "",
            "workflowKind": "delivery",
            "reviewerUserId": str(reviewer_user_id) if reviewer_user_id else None,
            "finalReviewerUserId": None,
        },
        authority_epoch=epoch,
        rights_snapshot_id=snapshot_id,
        rights_content_sha256=rights_hash,
        required_action="create",
        occurred_at=occurred_at,
    )


@pytest.mark.anyio
@pytest.mark.postgres
async def test_draft_replay_retries_same_receipt_and_preserves_original_time():
    url = os.environ.get("YUKSALISH_TEST_DATABASE_URL")
    if not url:
        pytest.skip("YUKSALISH_TEST_DATABASE_URL is not configured")
    engine = create_async_engine(url)
    user_id, reviewer_id, snapshot_id = uuid4(), uuid4(), uuid4()
    agent_id = f"offline-replay-{uuid4().hex}"
    actor_id = "98765432101"
    storage = InMemoryObjectStorage()
    reviewer_actor_id = "98765432102"
    actors = [{
        "telegramId": actor_id,
        "userId": str(user_id),
        "fullName": "Offline Test Employee",
        "role": "employee",
        "reviewerKeys": [],
        "moduleActions": ["view", "create", "edit"],
    }, {
        "telegramId": reviewer_actor_id,
        "userId": str(reviewer_id),
        "fullName": "Offline Test Reviewer",
        "role": "superadmin",
        "reviewerKeys": ["askar"],
        "moduleActions": ["view", "approve"],
    }]
    rights_hash = hashlib.sha256(json.dumps(
        actors, ensure_ascii=False, sort_keys=True, separators=(",", ":")
    ).encode()).hexdigest()
    try:
        async with engine.connect() as connection:
            transaction = await connection.begin()
            try:
                await connection.execute(insert(users).values(
                    id=user_id, username=f"offline-{user_id.hex[:12]}",
                    full_name="Offline Test Employee", role="employee", status="active",
                    created_at=datetime.now(UTC), updated_at=datetime.now(UTC),
                ))
                await connection.execute(insert(users).values(
                    id=reviewer_id, username=f"reviewer-{reviewer_id.hex[:12]}",
                    full_name="Offline Test Reviewer", role="superadmin", status="active",
                    created_at=datetime.now(UTC), updated_at=datetime.now(UTC),
                ))
                await connection.execute(update(ai_referent_reviewers).where(
                    ai_referent_reviewers.c.key == "askar"
                ).values(user_id=reviewer_id, enabled=True))
                await connection.execute(delete(ai_referent_authority))
                await connection.execute(
                    update(ai_referent_configuration).values(execution_agent_id=agent_id)
                )
                epoch = (await start_authority(
                    connection, agent_id=agent_id, enabled=True
                )).epoch
                await connection.execute(
                    update(ai_referent_authority).values(mode="replay_required")
                )
                await connection.execute(insert(ai_referent_offline_rights_snapshots).values(
                    id=snapshot_id, agent_id=agent_id, epoch=epoch,
                    reviewer_revision=1, actors=actors, content_sha256=rights_hash,
                    verified_at=datetime.now(UTC) - timedelta(minutes=5),
                ))
                operation = _operation(
                    epoch, snapshot_id, rights_hash, actor_id, user_id,
                    sequence=37,
                    reviewer_user_id=reviewer_id,
                )
                receipt = await replay_offline_operation(
                    connection, agent_id=agent_id, epoch=epoch,
                    operation=operation, enabled=True,
                )
                assert receipt.operation_id == operation.operation_id
                assert receipt.letter_id == operation.letter_id
                assert receipt.result_revision == 1
                assert await replay_offline_operation(
                    connection, agent_id=agent_id, epoch=epoch,
                    operation=operation, enabled=True,
                ) == receipt
                await connection.execute(update(ai_referent_authority).values(mode="online"))
                assert await replay_offline_operation(
                    connection, agent_id=agent_id, epoch=epoch,
                    operation=operation, enabled=True,
                ) == receipt
                await connection.execute(
                    update(ai_referent_authority).values(mode="replay_required")
                )
                letter = (
                    await connection.execute(select(ai_referent_letters).where(
                        ai_referent_letters.c.id == operation.letter_id
                    ))
                ).mappings().one()
                assert letter["created_at"] == operation.occurred_at
                assert letter["created_by_user_id"] == user_id
                assert letter["source"] == "telegram"
                assert await connection.scalar(select(ai_referent_events.c.created_at).where(
                    ai_referent_events.c.letter_id == operation.letter_id
                )) == operation.occurred_at
                assert await connection.scalar(select(ai_referent_offline_operation_receipts)
                    .with_only_columns(
                        ai_referent_offline_operation_receipts.c.operation_id
                    ).where(
                        ai_referent_offline_operation_receipts.c.operation_id
                        == operation.operation_id
                    )) == operation.operation_id
                different = operation.model_copy(deep=True)
                different.payload["subject"] = "Changed after crash"
                with pytest.raises(HTTPException) as changed:
                    await replay_offline_operation(
                        connection, agent_id=agent_id, epoch=epoch,
                        operation=different, enabled=True,
                    )
                assert changed.value.status_code == 409
                skipped = _operation(
                    epoch, snapshot_id, rights_hash, actor_id, user_id, sequence=39
                )
                with pytest.raises(HTTPException) as order:
                    await replay_offline_operation(
                        connection, agent_id=agent_id, epoch=epoch,
                        operation=skipped, enabled=True,
                    )
                assert order.value.status_code == 409
                unauthorized = _operation(
                    epoch, snapshot_id, rights_hash, "12345678999", user_id, sequence=38
                )
                with pytest.raises(HTTPException) as denied:
                    await replay_offline_operation(
                        connection, agent_id=agent_id, epoch=epoch,
                        operation=unauthorized, enabled=True,
                    )
                assert denied.value.status_code == 403
                unsupported = _operation(
                    epoch, snapshot_id, rights_hash, actor_id, user_id, sequence=38
                ).model_copy(update={"kind": "letter.update", "required_action": "edit"})
                with pytest.raises(HTTPException) as not_ready:
                    await replay_offline_operation(
                        connection, agent_id=agent_id, epoch=epoch,
                        operation=unsupported, enabled=True,
                    )
                assert not_ready.value.status_code == 422
                revised_payload = dict(operation.payload)
                revised_payload.pop("letterId")
                revised_payload["subject"] = "Edited during outage"
                revised_payload["expectedRevision"] = 1
                revision = OfflineReplayOperation(
                    operation_id=uuid4(), sequence=38, actor_id=actor_id,
                    letter_id=operation.letter_id, kind="letter.update",
                    payload=revised_payload, authority_epoch=epoch,
                    rights_snapshot_id=snapshot_id,
                    rights_content_sha256=rights_hash, required_action="edit",
                    occurred_at=operation.occurred_at + timedelta(seconds=20),
                )
                update_receipt = await replay_offline_operation(
                    connection, agent_id=agent_id, epoch=epoch,
                    operation=revision, enabled=True,
                )
                assert update_receipt.result_revision == 2
                assert await replay_offline_operation(
                    connection, agent_id=agent_id, epoch=epoch,
                    operation=revision, enabled=True,
                ) == update_receipt
                updated = (
                    await connection.execute(select(ai_referent_letters).where(
                        ai_referent_letters.c.id == operation.letter_id
                    ))
                ).mappings().one()
                assert updated["subject"] == "Edited during outage"
                assert updated["revision"] == 2
                assert updated["updated_at"] == revision.occurred_at
                buffer = BytesIO()
                with ZipFile(buffer, "w") as package:
                    package.writestr("word/document.xml", "<w:document/>")
                content = buffer.getvalue()
                digest = hashlib.sha256(content).hexdigest()
                staged = await stage_offline_blob(
                    connection, storage, agent_id=agent_id, epoch=epoch,
                    sha256=digest, content=content, enabled=True,
                )
                assert staged.byte_size == len(content)
                file_operation = OfflineReplayOperation(
                    operation_id=uuid4(), sequence=39, actor_id=actor_id,
                    letter_id=operation.letter_id, kind="letter.attachment",
                    payload={
                        "fileName": "letter.docx", "role": "primary",
                        "byteSize": len(content), "expectedRevision": 2,
                        "actorUserId": str(user_id),
                        "actorName": "Offline Test Employee",
                    },
                    blob_sha256=digest, authority_epoch=epoch,
                    rights_snapshot_id=snapshot_id,
                    rights_content_sha256=rights_hash, required_action="edit",
                    occurred_at=revision.occurred_at + timedelta(seconds=20),
                )
                file_receipt = await replay_offline_operation(
                    connection, agent_id=agent_id, epoch=epoch,
                    operation=file_operation, enabled=True, storage=storage,
                )
                assert file_receipt.result_revision == 3
                assert await replay_offline_operation(
                    connection, agent_id=agent_id, epoch=epoch,
                    operation=file_operation, enabled=True, storage=storage,
                ) == file_receipt
                file_row = (
                    await connection.execute(select(attachments).where(
                        attachments.c.owner_id == operation.letter_id
                    ))
                ).mappings().one()
                assert file_row["id"] == uuid5(
                    NAMESPACE_URL, "ai-offline-attachment:" + str(file_operation.operation_id)
                )
                assert await storage.get(file_row["storage_key"]) == content
                assert await connection.scalar(select(ai_referent_letters.c.revision).where(
                    ai_referent_letters.c.id == operation.letter_id
                )) == 3
                check_operation = OfflineReplayOperation(
                    operation_id=uuid4(), sequence=40, actor_id=actor_id,
                    letter_id=operation.letter_id, kind="letter.document_check",
                    payload={
                        "status": "passed", "reviewerKeys": ["askar"], "detail": "",
                        "expectedRevision": 3, "actorUserId": str(user_id),
                        "actorName": "Offline Test Employee",
                    },
                    blob_sha256=digest, authority_epoch=epoch,
                    rights_snapshot_id=snapshot_id, rights_content_sha256=rights_hash,
                    required_action="edit",
                    occurred_at=file_operation.occurred_at + timedelta(seconds=20),
                )
                check_receipt = await replay_offline_operation(
                    connection, agent_id=agent_id, epoch=epoch,
                    operation=check_operation, enabled=True,
                )
                assert check_receipt.result_revision == 3
                assert await replay_offline_operation(
                    connection, agent_id=agent_id, epoch=epoch,
                    operation=check_operation, enabled=True,
                ) == check_receipt
                check = (
                    await connection.execute(select(ai_referent_document_checks).where(
                        ai_referent_document_checks.c.user_id == user_id,
                        ai_referent_document_checks.c.sha256 == digest,
                    ))
                ).mappings().one()
                assert check["status"] == "passed"
                assert check["reviewer_keys"] == ["askar"]
                await connection.execute(update(ai_referent_letters).where(
                    ai_referent_letters.c.id == operation.letter_id
                ).values(status="pending_review"))
                voice = b"OggS" + b"\0" * 12 + b"OpusHead" + b"\0" * 20
                voice_digest = hashlib.sha256(voice).hexdigest()
                await stage_offline_blob(
                    connection, storage, agent_id=agent_id, epoch=epoch,
                    sha256=voice_digest, content=voice, enabled=True,
                )
                audio_operation = OfflineReplayOperation(
                    operation_id=uuid4(), sequence=41, actor_id=reviewer_actor_id,
                    letter_id=operation.letter_id, kind="letter.comment_audio",
                    payload={
                        "revision": 3, "durationMs": 1400,
                        "byteSize": len(voice), "contentType": "audio/ogg",
                        "actorUserId": str(reviewer_id),
                        "actorName": "Offline Test Reviewer",
                    },
                    blob_sha256=voice_digest, authority_epoch=epoch,
                    rights_snapshot_id=snapshot_id, rights_content_sha256=rights_hash,
                    required_action="approve",
                    occurred_at=check_operation.occurred_at + timedelta(seconds=20),
                )
                voice_receipt = await replay_offline_operation(
                    connection, agent_id=agent_id, epoch=epoch,
                    operation=audio_operation, enabled=True, storage=storage,
                )
                assert voice_receipt.result_revision == 3
                assert await replay_offline_operation(
                    connection, agent_id=agent_id, epoch=epoch,
                    operation=audio_operation, enabled=True, storage=storage,
                ) == voice_receipt
                voice_row = (
                    await connection.execute(select(ai_referent_comment_audio).where(
                        ai_referent_comment_audio.c.letter_id == operation.letter_id
                    ))
                ).mappings().one()
                assert voice_row["id"] == uuid5(
                    NAMESPACE_URL, "ai-offline-audio:" + str(audio_operation.operation_id)
                )
                assert voice_row["created_at"] == audio_operation.occurred_at
                assert await storage.get(voice_row["storage_key"]) == voice
                invalid_voice = audio_operation.model_copy(update={
                    "operation_id": uuid4(), "sequence": 42,
                    "payload": {**audio_operation.payload, "contentType": "audio/webm"},
                })
                with pytest.raises(HTTPException) as bad_voice:
                    await replay_offline_operation(
                        connection, agent_id=agent_id, epoch=epoch,
                        operation=invalid_voice, enabled=True, storage=storage,
                    )
                assert bad_voice.value.status_code == 422
                assert await connection.scalar(select(ai_referent_comment_audio.c.id).where(
                    ai_referent_comment_audio.c.id == uuid5(
                        NAMESPACE_URL,
                        "ai-offline-audio:" + str(invalid_voice.operation_id),
                    )
                )) is None
            finally:
                await transaction.rollback()
    finally:
        await engine.dispose()
