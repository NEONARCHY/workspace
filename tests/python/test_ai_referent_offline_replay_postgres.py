"""Offline letter replay is ordered, authorized and atomic on PostgreSQL."""

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
from yuksalish_api.ai_referent_offline_numbers import reserve_offline_numbers
from yuksalish_api.ai_referent_offline_replay import replay_offline_operation
from yuksalish_api.ai_referent_schemas import OfflineReplayOperation
from yuksalish_api.object_storage import InMemoryObjectStorage
from yuksalish_api.tables import (
    ai_referent_authority,
    ai_referent_comment_audio,
    ai_referent_configuration,
    ai_referent_delivery_commands,
    ai_referent_document_checks,
    ai_referent_events,
    ai_referent_files,
    ai_referent_letters,
    ai_referent_offline_number_reservations,
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
    user_id, reviewer_id, operator_id, snapshot_id = uuid4(), uuid4(), uuid4(), uuid4()
    agent_id = f"offline-replay-{uuid4().hex}"
    actor_id = "98765432101"
    storage = InMemoryObjectStorage()
    reviewer_actor_id = "98765432102"
    operator_actor_id = "98765432103"
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
    }, {
        "telegramId": operator_actor_id,
        "userId": str(operator_id),
        "fullName": "Offline Test Operator",
        "role": "admin",
        "reviewerKeys": [],
        "moduleActions": ["view", "admin"],
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
                await connection.execute(insert(users).values(
                    id=operator_id, username=f"operator-{operator_id.hex[:12]}",
                    full_name="Offline Test Operator", role="admin", status="active",
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
                number_reservation = await reserve_offline_numbers(
                    connection, agent_id=agent_id, epoch=epoch,
                    reservation_id=uuid4(), count=2, enabled=True,
                )
                await connection.execute(update(ai_referent_offline_number_reservations).where(
                    ai_referent_offline_number_reservations.c.id
                    == number_reservation.reservation_id
                ).values(created_at=datetime.now(UTC) - timedelta(days=1)))
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
                submit = OfflineReplayOperation(
                    operation_id=uuid4(), sequence=41, actor_id=actor_id,
                    letter_id=operation.letter_id, kind="letter.action",
                    payload={
                        "action": "submit", "comment": "", "commentAudioId": None,
                        "expectedRevision": 3, "fromStatus": "draft",
                        "toStatus": "pending_review", "nextReviewerUserId": None,
                        "outgoingNumber": None, "yearSuffix": None,
                        "actorUserId": str(user_id),
                        "actorName": "Offline Test Employee",
                    },
                    authority_epoch=epoch, rights_snapshot_id=snapshot_id,
                    rights_content_sha256=rights_hash, required_action="edit",
                    occurred_at=check_operation.occurred_at + timedelta(seconds=20),
                )
                assert (await replay_offline_operation(
                    connection, agent_id=agent_id, epoch=epoch,
                    operation=submit, enabled=True,
                )).result_revision == 4
                voice = b"OggS" + b"\0" * 12 + b"OpusHead" + b"\0" * 20
                voice_digest = hashlib.sha256(voice).hexdigest()
                await stage_offline_blob(
                    connection, storage, agent_id=agent_id, epoch=epoch,
                    sha256=voice_digest, content=voice, enabled=True,
                )
                audio_operation = OfflineReplayOperation(
                    operation_id=uuid4(), sequence=42, actor_id=reviewer_actor_id,
                    letter_id=operation.letter_id, kind="letter.comment_audio",
                    payload={
                        "revision": 4, "durationMs": 1400,
                        "byteSize": len(voice), "contentType": "audio/ogg",
                        "actorUserId": str(reviewer_id),
                        "actorName": "Offline Test Reviewer",
                    },
                    blob_sha256=voice_digest, authority_epoch=epoch,
                    rights_snapshot_id=snapshot_id, rights_content_sha256=rights_hash,
                    required_action="approve",
                    occurred_at=submit.occurred_at + timedelta(seconds=20),
                )
                voice_receipt = await replay_offline_operation(
                    connection, agent_id=agent_id, epoch=epoch,
                    operation=audio_operation, enabled=True, storage=storage,
                )
                assert voice_receipt.result_revision == 4
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
                    "operation_id": uuid4(), "sequence": 43,
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
                returned = OfflineReplayOperation(
                    operation_id=uuid4(), sequence=43, actor_id=reviewer_actor_id,
                    letter_id=operation.letter_id, kind="letter.action",
                    payload={
                        "action": "return_for_revision", "comment": "", "expectedRevision": 4,
                        "commentAudioId": str(voice_row["id"]),
                        "fromStatus": "pending_review", "toStatus": "needs_revision",
                        "nextReviewerUserId": str(reviewer_id),
                        "outgoingNumber": None, "yearSuffix": None,
                        "actorUserId": str(reviewer_id),
                        "actorName": "Offline Test Reviewer",
                    },
                    authority_epoch=epoch, rights_snapshot_id=snapshot_id,
                    rights_content_sha256=rights_hash, required_action="approve",
                    occurred_at=audio_operation.occurred_at + timedelta(seconds=20),
                )
                return_receipt = await replay_offline_operation(
                    connection, agent_id=agent_id, epoch=epoch,
                    operation=returned, enabled=True,
                )
                assert return_receipt.result_revision == 5
                assert await replay_offline_operation(
                    connection, agent_id=agent_id, epoch=epoch,
                    operation=returned, enabled=True,
                ) == return_receipt
                final = (
                    await connection.execute(select(ai_referent_letters).where(
                        ai_referent_letters.c.id == operation.letter_id
                    ))
                ).mappings().one()
                assert final["status"] == "needs_revision"
                assert final["revision"] == 5
                assert await connection.scalar(select(ai_referent_delivery_commands.c.id).where(
                    ai_referent_delivery_commands.c.letter_id == operation.letter_id
                )) is None
                event = (
                    await connection.execute(select(ai_referent_events).where(
                        ai_referent_events.c.id == uuid5(
                            NAMESPACE_URL, "ai-offline-event:" + str(returned.operation_id)
                        )
                    ))
                ).mappings().one()
                assert event["metadata"]["audioId"] == str(voice_row["id"])
                assert event["created_at"] == returned.occurred_at
                submit_again = submit.model_copy(update={
                    "operation_id": uuid4(), "sequence": 44,
                    "payload": {
                        **submit.payload,
                        "expectedRevision": 5,
                        "fromStatus": "needs_revision",
                    },
                    "occurred_at": returned.occurred_at + timedelta(seconds=20),
                })
                assert (await replay_offline_operation(
                    connection, agent_id=agent_id, epoch=epoch,
                    operation=submit_again, enabled=True,
                )).result_revision == 6
                approved = OfflineReplayOperation(
                    operation_id=uuid4(), sequence=45, actor_id=reviewer_actor_id,
                    letter_id=operation.letter_id, kind="letter.action",
                    payload={
                        "action": "approve", "comment": "", "commentAudioId": None,
                        "expectedRevision": 6, "fromStatus": "pending_review",
                        "toStatus": "queued", "nextReviewerUserId": None,
                        "outgoingNumber": number_reservation.first_number,
                        "yearSuffix": number_reservation.year_suffix,
                        "actorUserId": str(reviewer_id),
                        "actorName": "Offline Test Reviewer",
                    },
                    authority_epoch=epoch, rights_snapshot_id=snapshot_id,
                    rights_content_sha256=rights_hash, required_action="approve",
                    occurred_at=submit_again.occurred_at + timedelta(seconds=20),
                )
                unreserved = approved.model_copy(update={
                    "operation_id": uuid4(),
                    "payload": {
                        **approved.payload,
                        "outgoingNumber": number_reservation.last_number + 1,
                    },
                })
                with pytest.raises(HTTPException) as bad_number:
                    await replay_offline_operation(
                        connection, agent_id=agent_id, epoch=epoch,
                        operation=unreserved, enabled=True,
                    )
                assert bad_number.value.status_code == 409
                approval_receipt = await replay_offline_operation(
                    connection, agent_id=agent_id, epoch=epoch,
                    operation=approved, enabled=True,
                )
                assert approval_receipt.result_revision == 7
                queued = (
                    await connection.execute(select(ai_referent_letters).where(
                        ai_referent_letters.c.id == operation.letter_id
                    ))
                ).mappings().one()
                assert queued["status"] == "queued"
                assert queued["outgoing_number"] == number_reservation.first_number
                command = (
                    await connection.execute(select(ai_referent_delivery_commands).where(
                        ai_referent_delivery_commands.c.letter_id == operation.letter_id
                    ))
                ).mappings().one()
                assert command["kind"] == "prepare"
                signed_pdf = b"%PDF-1.7 offline prepared document"
                signed_hash = hashlib.sha256(signed_pdf).hexdigest()
                await stage_offline_blob(
                    connection, storage, agent_id=agent_id, epoch=epoch,
                    sha256=signed_hash, content=signed_pdf, enabled=True,
                )
                prepared_id = uuid5(
                    NAMESPACE_URL, "ai-offline-prepare:" + str(approved.operation_id)
                )
                prepared = OfflineReplayOperation(
                    operation_id=prepared_id, sequence=46, actor_id=reviewer_actor_id,
                    letter_id=operation.letter_id, kind="letter.prepared",
                    payload={
                        "approvalOperationId": str(approved.operation_id),
                        "commandId": str(command["id"]), "expectedRevision": 7,
                        "fromStatus": "queued", "toStatus": "referent_review_pending",
                        "byteSize": len(signed_pdf), "actorUserId": str(reviewer_id),
                        "actorName": "Offline Test Reviewer",
                    },
                    blob_sha256=signed_hash, authority_epoch=epoch,
                    rights_snapshot_id=snapshot_id, rights_content_sha256=rights_hash,
                    required_action="approve",
                    occurred_at=approved.occurred_at + timedelta(seconds=20),
                )
                prepared_receipt = await replay_offline_operation(
                    connection, agent_id=agent_id, epoch=epoch,
                    operation=prepared, enabled=True, storage=storage,
                )
                assert prepared_receipt.result_revision == 8
                assert await replay_offline_operation(
                    connection, agent_id=agent_id, epoch=epoch,
                    operation=prepared, enabled=True, storage=storage,
                ) == prepared_receipt
                letter_after_prepare = (
                    await connection.execute(select(ai_referent_letters).where(
                        ai_referent_letters.c.id == operation.letter_id
                    ))
                ).mappings().one()
                assert letter_after_prepare["status"] == "referent_review_pending"
                assert letter_after_prepare["revision"] == 8
                signed_file = (
                    await connection.execute(select(ai_referent_files).where(
                        ai_referent_files.c.id == letter_after_prepare["final_pdf_file_id"]
                    ))
                ).mappings().one()
                assert signed_file["relative_path"] == f"signed/{command['id']}.pdf"
                assert await storage.get(signed_file["storage_key"]) == signed_pdf
                command_after_prepare = (
                    await connection.execute(select(ai_referent_delivery_commands).where(
                        ai_referent_delivery_commands.c.id == command["id"]
                    ))
                ).mappings().one()
                assert command_after_prepare["status"] == "completed"
                denied_return = OfflineReplayOperation(
                    operation_id=uuid4(), sequence=47, actor_id=reviewer_actor_id,
                    letter_id=operation.letter_id, kind="letter.action",
                    payload={
                        "action": "return_for_revision", "comment": "Нужна новая версия",
                        "commentAudioId": None, "expectedRevision": 8,
                        "fromStatus": "referent_review_pending", "toStatus": "needs_revision",
                        "nextReviewerUserId": str(reviewer_id),
                        "outgoingNumber": None, "yearSuffix": None,
                        "actorUserId": str(reviewer_id),
                        "actorName": "Offline Test Reviewer",
                        "creatorUserId": str(user_id),
                    },
                    authority_epoch=epoch, rights_snapshot_id=snapshot_id,
                    rights_content_sha256=rights_hash, required_action="approve",
                    occurred_at=prepared.occurred_at + timedelta(seconds=20),
                )
                with pytest.raises(HTTPException) as denied_operator:
                    await replay_offline_operation(
                        connection, agent_id=agent_id, epoch=epoch,
                        operation=denied_return, enabled=True,
                    )
                assert denied_operator.value.status_code == 403
                operator_return = denied_return.model_copy(update={
                    "operation_id": uuid4(), "actor_id": operator_actor_id,
                    "required_action": "admin",
                    "payload": {
                        **denied_return.payload,
                        "actorUserId": str(operator_id),
                        "actorName": "Offline Test Operator",
                    },
                })
                final_return = await replay_offline_operation(
                    connection, agent_id=agent_id, epoch=epoch,
                    operation=operator_return, enabled=True,
                )
                assert final_return.result_revision == 9
                assert await replay_offline_operation(
                    connection, agent_id=agent_id, epoch=epoch,
                    operation=operator_return, enabled=True,
                ) == final_return
                after_return = (
                    await connection.execute(select(ai_referent_letters).where(
                        ai_referent_letters.c.id == operation.letter_id
                    ))
                ).mappings().one()
                assert after_return["status"] == "needs_revision"
                assert after_return["final_pdf_file_id"] is None
                assert after_return["reviewer_user_id"] == reviewer_id
                resubmit = submit_again.model_copy(update={
                    "operation_id": uuid4(), "sequence": 48,
                    "payload": {
                        **submit_again.payload, "expectedRevision": 9,
                        "fromStatus": "needs_revision",
                    },
                    "occurred_at": operator_return.occurred_at + timedelta(seconds=20),
                })
                assert (await replay_offline_operation(
                    connection, agent_id=agent_id, epoch=epoch,
                    operation=resubmit, enabled=True,
                )).result_revision == 10
                reapprove = approved.model_copy(update={
                    "operation_id": uuid4(), "sequence": 49,
                    "payload": {**approved.payload, "expectedRevision": 10},
                    "occurred_at": resubmit.occurred_at + timedelta(seconds=20),
                })
                assert (await replay_offline_operation(
                    connection, agent_id=agent_id, epoch=epoch,
                    operation=reapprove, enabled=True,
                )).result_revision == 11
                assert await connection.scalar(select(ai_referent_letters.c.outgoing_number).where(
                    ai_referent_letters.c.id == operation.letter_id
                )) == number_reservation.first_number
                sign_create = _operation(
                    epoch, snapshot_id, rights_hash, actor_id, user_id,
                    sequence=50, reviewer_user_id=reviewer_id,
                )
                sign_create.payload.update({
                    "workflowKind": "sign_only", "route": "exat",
                    "recipientOrganization": "Подписание без отправки",
                    "recipientAddress": "",
                })
                assert (await replay_offline_operation(
                    connection, agent_id=agent_id, epoch=epoch,
                    operation=sign_create, enabled=True,
                )).result_revision == 1
                sign_attachment = file_operation.model_copy(update={
                    "operation_id": uuid4(), "sequence": 51,
                    "letter_id": sign_create.letter_id,
                    "payload": {**file_operation.payload, "expectedRevision": 1},
                    "occurred_at": sign_create.occurred_at + timedelta(seconds=10),
                })
                assert (await replay_offline_operation(
                    connection, agent_id=agent_id, epoch=epoch,
                    operation=sign_attachment, enabled=True, storage=storage,
                )).result_revision == 2
                sign_check = check_operation.model_copy(update={
                    "operation_id": uuid4(), "sequence": 52,
                    "letter_id": sign_create.letter_id,
                    "payload": {**check_operation.payload, "expectedRevision": 2},
                    "occurred_at": sign_attachment.occurred_at + timedelta(seconds=10),
                })
                assert (await replay_offline_operation(
                    connection, agent_id=agent_id, epoch=epoch,
                    operation=sign_check, enabled=True,
                )).result_revision == 2
                sign_submit = submit.model_copy(update={
                    "operation_id": uuid4(), "sequence": 53,
                    "letter_id": sign_create.letter_id,
                    "payload": {
                        **submit.payload, "expectedRevision": 2,
                        "fromStatus": "draft",
                    },
                    "occurred_at": sign_check.occurred_at + timedelta(seconds=10),
                })
                assert (await replay_offline_operation(
                    connection, agent_id=agent_id, epoch=epoch,
                    operation=sign_submit, enabled=True,
                )).result_revision == 3
                sign_approval = approved.model_copy(update={
                    "operation_id": uuid4(), "sequence": 54,
                    "letter_id": sign_create.letter_id,
                    "payload": {
                        **approved.payload, "expectedRevision": 3,
                        "outgoingNumber": None, "yearSuffix": None,
                    },
                    "occurred_at": sign_submit.occurred_at + timedelta(seconds=10),
                })
                assert (await replay_offline_operation(
                    connection, agent_id=agent_id, epoch=epoch,
                    operation=sign_approval, enabled=True,
                )).result_revision == 4
                sign_command = (
                    await connection.execute(select(ai_referent_delivery_commands).where(
                        ai_referent_delivery_commands.c.letter_id == sign_create.letter_id
                    ))
                ).mappings().one()
                assert sign_command["kind"] == "sign_only"
                page_bytes = [b"%PDF-1.7 first", b"%PDF-1.7 second"]
                bundle = BytesIO()
                with ZipFile(bundle, "w") as archive:
                    for index, page in enumerate(page_bytes, 1):
                        archive.writestr(f"{index:03d}.pdf", page)
                signed_bundle = bundle.getvalue()
                bundle_hash = hashlib.sha256(signed_bundle).hexdigest()
                await stage_offline_blob(
                    connection, storage, agent_id=agent_id, epoch=epoch,
                    sha256=bundle_hash, content=signed_bundle, enabled=True,
                )
                signed_pages_id = uuid5(
                    NAMESPACE_URL, "ai-offline-sign:" + str(sign_approval.operation_id)
                )
                signed_pages = OfflineReplayOperation(
                    operation_id=signed_pages_id, sequence=55,
                    actor_id=reviewer_actor_id, letter_id=sign_create.letter_id,
                    kind="letter.signed", payload={
                        "approvalOperationId": str(sign_approval.operation_id),
                        "commandId": str(sign_command["id"]),
                        "expectedRevision": 4, "fromStatus": "queued", "toStatus": "signed",
                        "byteSize": len(signed_bundle),
                        "pages": [
                            {"name": f"{index:03d}.pdf", "byteSize": len(page),
                             "sha256": hashlib.sha256(page).hexdigest()}
                            for index, page in enumerate(page_bytes, 1)
                        ],
                        "actorUserId": str(reviewer_id),
                        "actorName": "Offline Test Reviewer",
                    },
                    blob_sha256=bundle_hash, authority_epoch=epoch,
                    rights_snapshot_id=snapshot_id, rights_content_sha256=rights_hash,
                    required_action="approve",
                    occurred_at=sign_approval.occurred_at + timedelta(seconds=10),
                )
                wrong_hash = signed_pages.model_copy(deep=True)
                wrong_hash.payload["pages"][0]["sha256"] = "0" * 64
                with pytest.raises(HTTPException) as bad_signed:
                    await replay_offline_operation(
                        connection, agent_id=agent_id, epoch=epoch,
                        operation=wrong_hash, enabled=True, storage=storage,
                    )
                assert bad_signed.value.status_code == 422
                signed_receipt = await replay_offline_operation(
                    connection, agent_id=agent_id, epoch=epoch,
                    operation=signed_pages, enabled=True, storage=storage,
                )
                assert signed_receipt.result_revision == 5
                assert await replay_offline_operation(
                    connection, agent_id=agent_id, epoch=epoch,
                    operation=signed_pages, enabled=True, storage=storage,
                ) == signed_receipt
                signed_letter = (
                    await connection.execute(select(ai_referent_letters).where(
                        ai_referent_letters.c.id == sign_create.letter_id
                    ))
                ).mappings().one()
                assert signed_letter["status"] == "signed"
                stored_pages = (
                    await connection.execute(select(ai_referent_files).where(
                        ai_referent_files.c.owner_id == sign_create.letter_id
                    ).order_by(ai_referent_files.c.relative_path))
                ).mappings().all()
                assert [row["relative_path"] for row in stored_pages] == [
                    f"signed/{sign_command['id']}/001.pdf",
                    f"signed/{sign_command['id']}/002.pdf",
                ]
                assert [await storage.get(row["storage_key"]) for row in stored_pages] == page_bytes
            finally:
                await transaction.rollback()
    finally:
        await engine.dispose()
