"""Fail-closed, transactional replay of autonomous AI Referent operations.

Only draft creation and editing are accepted so far. Later operation kinds must be added
before this protocol can be connected to the live bot or unfence Workspace.
"""

# ruff: noqa: RUF001

import hashlib
import json
from datetime import UTC, datetime, timedelta
from io import BytesIO
from pathlib import PurePath
from uuid import NAMESPACE_URL, UUID, uuid5
from zipfile import BadZipFile, ZipFile

from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import func, insert, select, update
from sqlalchemy.engine import RowMapping
from sqlalchemy.ext.asyncio import AsyncConnection

from .ai_referent_preflight import ensure_check
from .ai_referent_schemas import (
    CreateAIReferentLetterRequest,
    OfflineReplayOperation,
    OfflineReplayReceipt,
    UpdateAIReferentLetterRequest,
)
from .ai_referent_service import _normalize_review_route, _validate_reviewer
from .object_storage import ObjectStorage
from .tables import (
    ai_referent_authority,
    ai_referent_configuration,
    ai_referent_document_checks,
    ai_referent_events,
    ai_referent_letters,
    ai_referent_offline_blobs,
    ai_referent_offline_operation_receipts,
    ai_referent_offline_rights_snapshots,
    ai_referent_reviewers,
    attachments,
    audit_events,
)


def _fingerprint(operation: OfflineReplayOperation) -> str:
    canonical = json.dumps(
        operation.model_dump(mode="json", by_alias=True),
        ensure_ascii=False, sort_keys=True, separators=(",", ":"),
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _receipt(row: RowMapping) -> OfflineReplayReceipt:
    return OfflineReplayReceipt(
        operation_id=row["operation_id"], sequence=row["sequence"],
        letter_id=row["letter_id"], result_revision=row["result_revision"],
        accepted_at=row["accepted_at"],
    )


async def _replay_attachment(
    connection: AsyncConnection,
    storage: ObjectStorage | None,
    *,
    agent_id: str,
    epoch: UUID,
    operation: OfflineReplayOperation,
    actor: dict[str, object],
    fingerprint: str,
    occurred_at: datetime,
    now: datetime,
) -> OfflineReplayReceipt:
    if storage is None or operation.blob_sha256 is None:
        raise HTTPException(422, "Файл автономной операции не передан на сервер.")
    values = operation.payload
    name, role = values.get("fileName"), values.get("role")
    size, revision = values.get("byteSize"), values.get("expectedRevision")
    if (
        not isinstance(name, str) or not name or len(name) > 255
        or PurePath(name).name != name
        or any(char in name for char in ("/", "\\", "\0", "\r", "\n"))
        or role not in {"primary", "additional"}
        or (role == "primary" and not name.lower().endswith(".docx"))
        or type(size) is not int or not 0 < size <= 25 * 1024 * 1024
        or type(revision) is not int or revision < 1
    ):
        raise HTTPException(422, "Поля автономного вложения недействительны.")
    staged = (
        await connection.execute(select(ai_referent_offline_blobs).where(
            ai_referent_offline_blobs.c.agent_id == agent_id,
            ai_referent_offline_blobs.c.epoch == epoch,
            ai_referent_offline_blobs.c.sha256 == operation.blob_sha256,
        ))
    ).mappings().one_or_none()
    if staged is None or staged["byte_size"] != size:
        raise HTTPException(409, "Файл автономного журнала отсутствует или изменился.")
    content = await storage.get(staged["storage_key"])
    if len(content) != size or hashlib.sha256(content).hexdigest() != operation.blob_sha256:
        raise HTTPException(409, "Контрольная сумма автономного вложения не совпала.")
    letter = (
        await connection.execute(select(ai_referent_letters).where(
            ai_referent_letters.c.id == operation.letter_id
        ).with_for_update())
    ).mappings().one_or_none()
    if letter is None or letter["created_by_user_id"] != UUID(str(actor["userId"])):
        raise HTTPException(404, "Черновик автора не найден.")
    if letter["revision"] != revision or letter["status"] not in {"draft", "needs_revision"}:
        raise HTTPException(409, "Письмо изменилось после автономной загрузки.")
    if letter["workflow_kind"] == "sign_only" and role != "primary":
        raise HTTPException(422, "Для подписи допускается только основной DOCX.")
    if role == "primary":
        try:
            with ZipFile(BytesIO(content)) as package:
                names = {item.filename.lower() for item in package.infolist()}
                if (
                    "word/document.xml" not in names
                    or sum(item.file_size for item in package.infolist()) > 100 * 1024 * 1024
                    or any("vbaproject" in item for item in names)
                    or any(
                        item.filename.lower().endswith(".rels")
                        and (
                            b'targetmode="external"' in package.read(item).lower()
                            or b"targetmode='external'" in package.read(item).lower()
                        )
                        for item in package.infolist()
                    )
                ):
                    raise HTTPException(422, "DOCX повреждён или содержит недопустимые элементы.")
        except BadZipFile as error:
            raise HTTPException(422, "Файл не является DOCX.") from error
        await ensure_check(
            connection, UUID(str(actor["userId"])), operation.blob_sha256,
            letter["workflow_kind"], name, staged["storage_key"], restart_failed=True,
        )
        await connection.execute(update(attachments).where(
            attachments.c.owner_type == "ai_referent_letter",
            attachments.c.owner_id == operation.letter_id,
            attachments.c.document_role == "primary",
        ).values(document_role="general"))
    attachment_id = uuid5(
        NAMESPACE_URL, "ai-offline-attachment:" + str(operation.operation_id)
    )
    await connection.execute(insert(attachments).values(
        id=attachment_id, owner_type="ai_referent_letter", owner_id=operation.letter_id,
        file_name=name, content_type="application/octet-stream", byte_size=size,
        sha256=operation.blob_sha256, storage_key=staged["storage_key"],
        uploaded_by_user_id=UUID(str(actor["userId"])), document_role=role,
        media_kind="file", media_duration_ms=None, media_codec=None,
        created_at=occurred_at,
    ))
    result_revision = revision + 1
    await connection.execute(update(ai_referent_letters).where(
        ai_referent_letters.c.id == operation.letter_id
    ).values(revision=result_revision, updated_at=occurred_at))
    await connection.execute(insert(audit_events).values(
        id=uuid5(NAMESPACE_URL, "ai-offline-audit:" + str(operation.operation_id)),
        actor_user_id=UUID(str(actor["userId"])), action="ai_referent.offline_attachment",
        target_type="ai_referent_letter", target_id=operation.letter_id,
        details={"agentId": agent_id, "epoch": str(epoch)}, created_at=now,
    ))
    await connection.execute(insert(ai_referent_offline_operation_receipts).values(
        operation_id=operation.operation_id, agent_id=agent_id, epoch=epoch,
        sequence=operation.sequence, letter_id=operation.letter_id,
        kind=operation.kind, fingerprint=fingerprint, result_revision=result_revision,
        occurred_at=occurred_at, accepted_at=now,
    ))
    return OfflineReplayReceipt(
        operation_id=operation.operation_id, sequence=operation.sequence,
        letter_id=operation.letter_id, result_revision=result_revision, accepted_at=now,
    )


async def _replay_document_check(
    connection: AsyncConnection,
    *,
    agent_id: str,
    epoch: UUID,
    operation: OfflineReplayOperation,
    actor: dict[str, object],
    fingerprint: str,
    occurred_at: datetime,
    now: datetime,
) -> OfflineReplayReceipt:
    values = operation.payload
    revision = values.get("expectedRevision")
    status, keys, detail = (
        values.get("status"), values.get("reviewerKeys"), values.get("detail")
    )
    if (
        operation.blob_sha256 is None
        or type(revision) is not int or revision < 1
        or status not in {"passed", "failed"}
        or not isinstance(keys, list)
        or any(not isinstance(key, str) for key in keys)
        or len(keys) != len(set(keys))
        or not isinstance(detail, str) or len(detail) > 5000
        or (status == "passed" and bool(detail))
        or (status == "failed" and not detail)
    ):
        raise HTTPException(422, "Результат автономной проверки DOCX недействителен.")
    letter = (
        await connection.execute(select(ai_referent_letters).where(
            ai_referent_letters.c.id == operation.letter_id
        ).with_for_update())
    ).mappings().one_or_none()
    if letter is None or letter["created_by_user_id"] != UUID(str(actor["userId"])):
        raise HTTPException(404, "Черновик автора не найден.")
    if letter["revision"] != revision or letter["status"] not in {"draft", "needs_revision"}:
        raise HTTPException(409, "Письмо изменилось после автономной проверки.")
    primary = (
        await connection.execute(select(attachments).where(
            attachments.c.owner_type == "ai_referent_letter",
            attachments.c.owner_id == operation.letter_id,
            attachments.c.document_role == "primary",
        ))
    ).mappings().one_or_none()
    if primary is None or primary["sha256"] != operation.blob_sha256:
        raise HTTPException(409, "Проверка относится к другому основному документу.")
    allowed_keys = set((await connection.execute(select(ai_referent_reviewers.c.key).where(
        ai_referent_reviewers.c.enabled.is_(True)
    ))).scalars().all())
    if not set(keys).issubset(allowed_keys):
        raise HTTPException(409, "Список согласующих изменился; повторите проверку DOCX.")
    selected_key = letter["final_reviewer_key"] or letter["reviewer_key"]
    if status == "passed" and (selected_key is None or selected_key not in keys):
        raise HTTPException(409, "Подпись выбранного руководителя не подтверждена.")
    check = await ensure_check(
        connection, UUID(str(actor["userId"])), operation.blob_sha256,
        letter["workflow_kind"], primary["file_name"], primary["storage_key"],
    )
    if check["status"] not in {"pending", status}:
        raise HTTPException(409, "Результат проверки DOCX уже изменился на сервере.")
    if check["status"] == status and (
        check["reviewer_keys"] != keys or check["detail"] != detail
    ):
        raise HTTPException(409, "Проверка DOCX уже записана с другим результатом.")
    await connection.execute(update(ai_referent_document_checks).where(
        ai_referent_document_checks.c.id == check["id"]
    ).values(
        status=status, reviewer_keys=keys, detail=detail,
        claimed_by=None, lease_token=None, lease_until=None,
        updated_at=occurred_at,
    ))
    await connection.execute(insert(audit_events).values(
        id=uuid5(NAMESPACE_URL, "ai-offline-audit:" + str(operation.operation_id)),
        actor_user_id=UUID(str(actor["userId"])), action="ai_referent.offline_document_check",
        target_type="ai_referent_letter", target_id=operation.letter_id,
        details={"agentId": agent_id, "epoch": str(epoch), "status": status},
        created_at=now,
    ))
    await connection.execute(insert(ai_referent_offline_operation_receipts).values(
        operation_id=operation.operation_id, agent_id=agent_id, epoch=epoch,
        sequence=operation.sequence, letter_id=operation.letter_id,
        kind=operation.kind, fingerprint=fingerprint, result_revision=revision,
        occurred_at=occurred_at, accepted_at=now,
    ))
    return OfflineReplayReceipt(
        operation_id=operation.operation_id, sequence=operation.sequence,
        letter_id=operation.letter_id, result_revision=revision, accepted_at=now,
    )


async def replay_offline_operation(
    connection: AsyncConnection,
    *,
    agent_id: str,
    epoch: UUID,
    operation: OfflineReplayOperation,
    enabled: bool,
    storage: ObjectStorage | None = None,
) -> OfflineReplayReceipt:
    """Apply one immutable operation, or return its identical committed receipt.

    The configuration row serializes this endpoint with authority transitions,
    normal letter writes and other replay requests. The receipt is inserted in
    the same transaction as the letter and its event.
    """
    if not enabled:
        raise HTTPException(409, "Автономный режим AI Referent пока не включён на сервере.")
    if operation.authority_epoch != epoch:
        raise HTTPException(409, "Операция относится к другой эпохе робота.")
    await connection.execute(select(ai_referent_configuration.c.id).with_for_update())
    assigned = await connection.scalar(select(ai_referent_configuration.c.execution_agent_id))
    if assigned != agent_id:
        raise HTTPException(403, "Этот компьютер не назначен агентом отправки.")
    authority = (
        await connection.execute(select(ai_referent_authority).with_for_update())
    ).mappings().first()
    if authority is None or authority["agent_id"] != agent_id or authority["epoch"] != epoch:
        raise HTTPException(409, "Эпоха автономного журнала больше не действует.")
    fingerprint = _fingerprint(operation)
    existing = (
        await connection.execute(
            select(ai_referent_offline_operation_receipts)
            .where(ai_referent_offline_operation_receipts.c.operation_id == operation.operation_id)
        )
    ).mappings().first()
    if existing is not None:
        if (
            existing["agent_id"] != agent_id or existing["epoch"] != epoch
            or existing["fingerprint"] != fingerprint
        ):
            raise HTTPException(409, "Повторный ID операции содержит другие данные.")
        return _receipt(existing)
    if authority["mode"] != "replay_required":
        raise HTTPException(409, "Воспроизведение доступно только после потери аренды.")
    last_sequence = await connection.scalar(
        select(func.max(ai_referent_offline_operation_receipts.c.sequence)).where(
            ai_referent_offline_operation_receipts.c.agent_id == agent_id,
        )
    )
    if operation.sequence != (last_sequence or 0) + 1:
        raise HTTPException(409, "Операции автономного журнала должны идти по порядку.")
    rights = (
        await connection.execute(
            select(ai_referent_offline_rights_snapshots).where(
                ai_referent_offline_rights_snapshots.c.id == operation.rights_snapshot_id
            )
        )
    ).mappings().first()
    if (
        rights is None or rights["agent_id"] != agent_id or rights["epoch"] != epoch
        or rights["content_sha256"] != operation.rights_content_sha256
    ):
        raise HTTPException(409, "Нет подтверждённой копии прав для операции.")
    canonical_rights = json.dumps(
        rights["actors"], ensure_ascii=False, sort_keys=True, separators=(",", ":")
    ).encode("utf-8")
    if hashlib.sha256(canonical_rights).hexdigest() != rights["content_sha256"]:
        raise HTTPException(500, "Контрольная сумма сохранённых прав не совпала.")
    actor = next(
        (item for item in rights["actors"] if item.get("telegramId") == operation.actor_id),
        None,
    )
    if actor is None or operation.required_action not in actor.get("moduleActions", []):
        raise HTTPException(403, "У автора не было проверенного права на это действие.")
    if (operation.kind, operation.required_action) not in {
        ("letter.create", "create"), ("letter.update", "edit"),
        ("letter.attachment", "edit"),
        ("letter.document_check", "edit"),
    }:
        raise HTTPException(422, "Этот вид автономной операции пока не поддерживается.")
    if (
        operation.kind not in {"letter.attachment", "letter.document_check"}
        and operation.blob_sha256 is not None
    ):
        raise HTTPException(422, "Изменение черновика не содержит файл.")
    values = operation.payload
    if (
        values.get("actorUserId") != actor["userId"]
        or values.get("actorName") != actor["fullName"]
    ):
        raise HTTPException(409, "Автор автономного черновика не совпал.")
    now = datetime.now(UTC)
    occurred_at = operation.occurred_at
    if occurred_at.tzinfo is None or occurred_at > now + timedelta(minutes=5):
        raise HTTPException(422, "Время автономной операции недействительно.")
    if occurred_at < rights["verified_at"] - timedelta(minutes=5):
        raise HTTPException(409, "Операция предшествует подтверждению прав.")
    if operation.kind == "letter.attachment":
        return await _replay_attachment(
            connection, storage, agent_id=agent_id, epoch=epoch,
            operation=operation, actor=actor, fingerprint=fingerprint,
            occurred_at=occurred_at, now=now,
        )
    if operation.kind == "letter.document_check":
        return await _replay_document_check(
            connection, agent_id=agent_id, epoch=epoch,
            operation=operation, actor=actor, fingerprint=fingerprint,
            occurred_at=occurred_at, now=now,
        )
    try:
        draft: CreateAIReferentLetterRequest | UpdateAIReferentLetterRequest
        if operation.kind == "letter.create":
            draft = CreateAIReferentLetterRequest.model_validate(values)
        else:
            draft = UpdateAIReferentLetterRequest.model_validate(values)
    except ValidationError as error:
        raise HTTPException(422, "Поля автономного черновика недействительны.") from error
    if draft.workflow_kind == "sign_only" and (
        draft.final_reviewer_user_id is not None or draft.route != "exat"
    ):
        raise HTTPException(422, "Для подписи выберите одного согласующего и канал E-XAT.")
    reviewer_key = await _validate_reviewer(connection, draft.reviewer_user_id)
    final_key = await _validate_reviewer(connection, draft.final_reviewer_user_id)
    reviewer_key, final_key = _normalize_review_route(draft, reviewer_key, final_key)
    if operation.kind == "letter.create":
        expected_letter_id = uuid5(
            NAMESPACE_URL, f"ai-offline:{epoch}:{operation.operation_id}"
        )
        if (
            operation.letter_id != expected_letter_id
            or values.get("letterId") != str(operation.letter_id)
        ):
            raise HTTPException(409, "ID автономного черновика не совпал.")
        if await connection.scalar(
            select(ai_referent_letters.c.id).where(ai_referent_letters.c.id == operation.letter_id)
        ) is not None:
            raise HTTPException(409, "ID письма уже занят другим действием.")
        await connection.execute(insert(ai_referent_letters).values(
            id=operation.letter_id,
            outgoing_number=None, year_suffix=None,
            subject=draft.subject,
            recipient_organization=(
                "Подписание без отправки" if draft.workflow_kind == "sign_only"
                else draft.recipient_organization
            ),
            recipient_address="" if draft.workflow_kind == "sign_only" else draft.recipient_address,
            route=draft.route, note=draft.note, status="draft",
            workflow_kind=draft.workflow_kind, source="telegram",
            created_by_user_id=UUID(actor["userId"]),
            reviewer_user_id=draft.reviewer_user_id, reviewer_key=reviewer_key,
            initial_reviewer_user_id=draft.reviewer_user_id, initial_reviewer_key=reviewer_key,
            final_reviewer_user_id=draft.final_reviewer_user_id, final_reviewer_key=final_key,
            delivery_error="", legacy_id=None, final_pdf_file_id=None,
            revision=1, sent_at=None, created_at=occurred_at, updated_at=occurred_at,
        ))
        result_revision = 1
        from_status = None
        event_type = "letter.created"
    else:
        if not isinstance(draft, UpdateAIReferentLetterRequest):
            raise HTTPException(500, "Вид операции не совпал с её полями.")
        current = (
            await connection.execute(select(ai_referent_letters).where(
                ai_referent_letters.c.id == operation.letter_id
            ).with_for_update())
        ).mappings().one_or_none()
        if current is None or current["created_by_user_id"] != UUID(actor["userId"]):
            raise HTTPException(404, "Черновик автора не найден.")
        if (
            current["revision"] != draft.expected_revision
            or current["status"] not in {"draft", "needs_revision"}
        ):
            raise HTTPException(409, "Письмо изменилось после автономной операции.")
        if current["workflow_kind"] != draft.workflow_kind:
            raise HTTPException(422, "Вид заявки нельзя изменить после создания.")
        result_revision = current["revision"] + 1
        from_status = current["status"]
        event_type = "letter.updated"
        await connection.execute(update(ai_referent_letters).where(
            ai_referent_letters.c.id == operation.letter_id
        ).values(
            subject=draft.subject,
            recipient_organization=(
                "Подписание без отправки" if draft.workflow_kind == "sign_only"
                else draft.recipient_organization
            ),
            recipient_address="" if draft.workflow_kind == "sign_only" else draft.recipient_address,
            route=draft.route, note=draft.note,
            reviewer_user_id=draft.reviewer_user_id, reviewer_key=reviewer_key,
            initial_reviewer_user_id=draft.reviewer_user_id, initial_reviewer_key=reviewer_key,
            final_reviewer_user_id=draft.final_reviewer_user_id, final_reviewer_key=final_key,
            revision=result_revision, updated_at=occurred_at,
        ))
    await connection.execute(insert(ai_referent_events).values(
        id=uuid5(NAMESPACE_URL, "ai-offline-event:" + str(operation.operation_id)),
        letter_id=operation.letter_id, actor_user_id=UUID(actor["userId"]),
        event_type=event_type, from_status=from_status,
        to_status=from_status or "draft",
        comment="", metadata={"offlineOperationId": str(operation.operation_id)},
        created_at=occurred_at,
    ))
    await connection.execute(insert(audit_events).values(
        id=uuid5(NAMESPACE_URL, "ai-offline-audit:" + str(operation.operation_id)),
        actor_user_id=UUID(actor["userId"]),
        action=f"ai_referent.offline_{operation.kind.removeprefix('letter.')}",
        target_type="ai_referent_letter", target_id=operation.letter_id,
        details={"agentId": agent_id, "epoch": str(epoch)}, created_at=now,
    ))
    await connection.execute(insert(ai_referent_offline_operation_receipts).values(
        operation_id=operation.operation_id, agent_id=agent_id, epoch=epoch,
        sequence=operation.sequence, letter_id=operation.letter_id,
        kind=operation.kind, fingerprint=fingerprint, result_revision=result_revision,
        occurred_at=occurred_at, accepted_at=now,
    ))
    return OfflineReplayReceipt(
        operation_id=operation.operation_id, sequence=operation.sequence,
        letter_id=operation.letter_id, result_revision=result_revision, accepted_at=now,
    )
