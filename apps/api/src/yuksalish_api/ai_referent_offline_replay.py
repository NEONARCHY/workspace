"""Fail-closed, transactional replay of autonomous AI Referent operations.

Draft, preflight, voice, decisions and signed-PDF preparation can be replayed.
External delivery and its final reconciliation are not yet accepted.
"""

# ruff: noqa: RUF001

import hashlib
import json
from datetime import UTC, datetime, timedelta
from io import BytesIO
from pathlib import PurePath
from uuid import NAMESPACE_URL, UUID, uuid5
from zipfile import ZIP_STORED, BadZipFile, ZipFile

from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import func, insert, select, update
from sqlalchemy.engine import RowMapping
from sqlalchemy.ext.asyncio import AsyncConnection

from .ai_referent_audio import decision_audio
from .ai_referent_deletion import purge_letter
from .ai_referent_preflight import ensure_check, require_passed
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
    ai_referent_comment_audio,
    ai_referent_configuration,
    ai_referent_delivery_commands,
    ai_referent_document_checks,
    ai_referent_events,
    ai_referent_files,
    ai_referent_letters,
    ai_referent_offline_blobs,
    ai_referent_offline_number_reservations,
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
    # Staging is content-addressed and can be shared by several letters. The
    # attachment table requires a distinct storage key for every attachment.
    attachment_key = f"ai-referent/offline-attachments/{operation.letter_id}/{attachment_id}"
    await storage.put(attachment_key, content, "application/octet-stream")
    await connection.execute(insert(attachments).values(
        id=attachment_id, owner_type="ai_referent_letter", owner_id=operation.letter_id,
        file_name=name, content_type="application/octet-stream", byte_size=size,
        sha256=operation.blob_sha256, storage_key=attachment_key,
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
    # The DOCX is checked before Telegram asks the sender to choose a reviewer.
    # Once selected, require_passed() rechecks that exact reviewer's key at submit.
    if status == "passed" and (not keys or (selected_key is not None and selected_key not in keys)):
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


async def _replay_comment_audio(
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
    values = operation.payload
    revision, duration, size, mime = (
        values.get("revision"), values.get("durationMs"),
        values.get("byteSize"), values.get("contentType"),
    )
    if (
        storage is None or operation.blob_sha256 is None
        or type(revision) is not int or revision < 1
        or type(duration) is not int or not 1 <= duration <= 300_000
        or type(size) is not int or not 0 < size <= 10 * 1024 * 1024
        or mime not in {"audio/ogg", "audio/webm"}
    ):
        raise HTTPException(422, "Поля автономного голосового комментария недействительны.")
    staged = (
        await connection.execute(select(ai_referent_offline_blobs).where(
            ai_referent_offline_blobs.c.agent_id == agent_id,
            ai_referent_offline_blobs.c.epoch == epoch,
            ai_referent_offline_blobs.c.sha256 == operation.blob_sha256,
        ))
    ).mappings().one_or_none()
    if staged is None or staged["byte_size"] != size:
        raise HTTPException(409, "Голосовой файл автономного журнала отсутствует.")
    content = await storage.get(staged["storage_key"])
    if len(content) != size or hashlib.sha256(content).hexdigest() != operation.blob_sha256:
        raise HTTPException(409, "Контрольная сумма голосового файла не совпала.")
    ogg = content.startswith(b"OggS") and b"OpusHead" in content[:65536]
    webm = content.startswith(b"\x1a\x45\xdf\xa3") and b"OpusHead" in content[:65536]
    if not ((ogg and mime == "audio/ogg") or (webm and mime == "audio/webm")):
        raise HTTPException(422, "Нужна голосовая запись Opus в OGG или WebM.")
    letter = (
        await connection.execute(select(ai_referent_letters).where(
            ai_referent_letters.c.id == operation.letter_id
        ).with_for_update())
    ).mappings().one_or_none()
    if letter is None:
        raise HTTPException(404, "Письмо для голосового комментария не найдено.")
    operator = (
        letter["status"] == "referent_review_pending"
        and operation.required_action == "admin"
    )
    reviewer = (
        letter["status"] in {"pending_review", "awaiting_final_send"}
        and letter["reviewer_user_id"] == UUID(str(actor["userId"]))
        and operation.required_action == "approve"
        and bool(actor.get("reviewerKeys"))
    )
    if letter["revision"] != revision or not (operator or reviewer):
        raise HTTPException(409, "Голосовой комментарий не относится к текущему решению.")
    audio_id = uuid5(NAMESPACE_URL, "ai-offline-audio:" + str(operation.operation_id))
    await connection.execute(insert(ai_referent_comment_audio).values(
        id=audio_id, letter_id=operation.letter_id, user_id=UUID(str(actor["userId"])),
        revision=revision, storage_key=staged["storage_key"], content_type=mime,
        byte_size=size, duration_ms=duration, created_at=occurred_at,
    ))
    await connection.execute(insert(audit_events).values(
        id=uuid5(NAMESPACE_URL, "ai-offline-audit:" + str(operation.operation_id)),
        actor_user_id=UUID(str(actor["userId"])), action="ai_referent.offline_comment_audio",
        target_type="ai_referent_letter", target_id=operation.letter_id,
        details={"agentId": agent_id, "epoch": str(epoch)}, created_at=now,
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


async def _replay_delete(
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
    """Delete only an unnumbered author draft; never infer robot-side cleanup."""
    values = operation.payload
    revision = values.get("expectedRevision")
    if type(revision) is not int or revision < 1 or operation.blob_sha256 is not None:
        raise HTTPException(422, "Поля автономного удаления недействительны.")
    letter = (
        await connection.execute(select(ai_referent_letters).where(
            ai_referent_letters.c.id == operation.letter_id
        ).with_for_update())
    ).mappings().one_or_none()
    if letter is None:
        raise HTTPException(404, "Удаляемый черновик не найден.")
    if letter["created_by_user_id"] != UUID(str(actor["userId"])):
        raise HTTPException(403, "Удалить письмо может только автор.")
    if letter["revision"] != revision or letter["status"] not in {"draft", "needs_revision"}:
        raise HTTPException(409, "Письмо изменилось после автономного удаления.")
    if letter["outgoing_number"] is not None:
        raise HTTPException(409, "Письмо с номером требует сверки локального реестра робота.")
    await purge_letter(connection, operation.letter_id)
    await connection.execute(insert(audit_events).values(
        id=uuid5(NAMESPACE_URL, "ai-offline-audit:" + str(operation.operation_id)),
        actor_user_id=UUID(str(actor["userId"])),
        action="ai_referent.offline_delete",
        target_type="ai_referent_letter", target_id=operation.letter_id,
        details={"agentId": agent_id, "epoch": str(epoch), "fromStatus": letter["status"]},
        created_at=now,
    ))
    result_revision = revision + 1
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


async def _replay_action(
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
    action = values.get("action")
    comment = values.get("comment")
    revision = values.get("expectedRevision")
    if (
        action not in {
            "submit", "approve", "return_for_revision", "cancel", "release_delivery", "send",
        }
        or type(revision) is not int or revision < 1
        or not isinstance(comment, str) or comment != comment.strip()
        or len(comment) > 2000
        or operation.blob_sha256 is not None
    ):
        raise HTTPException(422, "Поля автономного решения недействительны.")
    audio_id_value = values.get("commentAudioId")
    if audio_id_value is not None and not isinstance(audio_id_value, str):
        raise HTTPException(422, "Голосовой комментарий имеет неверный ID.")
    try:
        audio_id = UUID(audio_id_value) if audio_id_value is not None else None
    except (TypeError, ValueError) as error:
        raise HTTPException(422, "Голосовой комментарий имеет неверный ID.") from error
    if audio_id is not None and action != "return_for_revision":
        raise HTTPException(422, "Голосовой комментарий допустим только при возврате.")
    actor_user_id = UUID(str(actor["userId"]))
    reviewer_keys = actor.get("reviewerKeys")
    if not isinstance(reviewer_keys, list):
        reviewer_keys = []
    letter = (
        await connection.execute(select(ai_referent_letters).where(
            ai_referent_letters.c.id == operation.letter_id
        ).with_for_update())
    ).mappings().one_or_none()
    if letter is None:
        raise HTTPException(404, "Письмо для решения не найдено.")
    if letter["revision"] != revision or letter["status"] != values.get("fromStatus"):
        raise HTTPException(409, "Версия или стадия письма изменилась после автономного решения.")
    if values.get("creatorUserId") not in {None, str(letter["created_by_user_id"])}:
        raise HTTPException(409, "Автор автономного письма не совпал с базой.")
    expected_right = (
        "admin" if action == "send" or (
            action == "return_for_revision"
            and letter["status"] == "referent_review_pending"
        )
        else "approve" if action in {
            "approve", "return_for_revision", "release_delivery"
        } else "edit"
    )
    if operation.required_action != expected_right:
        raise HTTPException(403, "Право не соответствует текущей стадии письма.")
    creator = letter["created_by_user_id"] == actor_user_id
    reviewer = letter["reviewer_user_id"] == actor_user_id
    next_status: str
    next_reviewer_id: UUID | None = None
    number: int | None = None
    year_suffix: str | None = None
    command_kind: str | None = None
    if action == "send":
        if (
            letter["status"] != "referent_review_pending"
            or letter["workflow_kind"] != "delivery"
            or letter["final_pdf_file_id"] is None
        ):
            raise HTTPException(409, "Письмо не ожидает отправки референтом.")
        next_status, command_kind = "queued", "send"
    elif action == "release_delivery":
        if (
            not reviewer or letter["status"] != "awaiting_final_send"
            or letter["workflow_kind"] != "delivery"
            or letter["final_pdf_file_id"] is None
            or letter["reviewer_key"] not in reviewer_keys
        ):
            raise HTTPException(409, "Итоговый PDF не ожидает подтверждения.")
        next_status, command_kind = "queued", "dispatch"
    elif action == "submit":
        if not creator or letter["status"] not in {"draft", "needs_revision"}:
            raise HTTPException(403, "Отправить черновик на согласование может его автор.")
        if letter["reviewer_user_id"] is None or letter["reviewer_key"] is None:
            raise HTTPException(422, "Согласующий не назначен.")
        if letter["workflow_kind"] == "delivery" and (
            not letter["recipient_organization"] or not letter["recipient_address"]
        ):
            raise HTTPException(422, "Получатель письма не выбран.")
        if (
            letter["workflow_kind"] == "delivery"
            and letter["reviewer_key"] == "bobur"
            and letter["final_reviewer_user_id"] is None
        ):
            raise HTTPException(422, "Перед Бобуром нужен предварительный согласующий.")
        primary = await connection.scalar(select(attachments.c.id).where(
            attachments.c.owner_type == "ai_referent_letter",
            attachments.c.owner_id == operation.letter_id,
            attachments.c.document_role == "primary",
            attachments.c.file_name.ilike("%.docx"),
        ).limit(1))
        if primary is None:
            raise HTTPException(422, "Основной DOCX не найден.")
        await require_passed(connection, letter)
        next_status = "pending_review"
    elif action == "cancel":
        if not creator or letter["status"] not in {
            "draft", "needs_revision", "pending_review"
        }:
            raise HTTPException(403, "Отменить письмо на этом этапе может только автор.")
        next_status = "cancelled"
    else:
        operator_return = (
            action == "return_for_revision"
            and letter["status"] == "referent_review_pending"
            and operation.required_action == "admin"
        )
        if not operator_return and (not reviewer or not reviewer_keys):
            raise HTTPException(403, "Решение доступно назначенному согласующему.")
        if letter["status"] not in (
            {"pending_review", "awaiting_final_send", "referent_review_pending"}
            if action == "return_for_revision" else {"pending_review"}
        ) or (letter["status"] == "referent_review_pending" and not operator_return):
            raise HTTPException(409, "Письмо не ожидает этого решения.")
        if not operator_return and letter["reviewer_key"] not in reviewer_keys:
            raise HTTPException(403, "Нет подтверждённого права этого согласующего.")
        if action == "return_for_revision":
            if len(comment) < 3 and audio_id is None:
                raise HTTPException(422, "Укажите причину возврата.")
            if audio_id is not None:
                await decision_audio(
                    connection, audio_id, operation.letter_id, actor_user_id, revision
                )
            next_status = "needs_revision"
            next_reviewer_id = letter["initial_reviewer_user_id"]
        elif (
            letter["final_reviewer_user_id"] is not None
            and letter["reviewer_user_id"] != letter["final_reviewer_user_id"]
        ):
            next_status = "pending_review"
            next_reviewer_id = letter["final_reviewer_user_id"]
            if letter["final_reviewer_key"] is None:
                raise HTTPException(409, "Итоговый согласующий больше не назначен.")
        else:
            next_status = "queued"
            command_kind = "sign_only" if letter["workflow_kind"] == "sign_only" else "prepare"
            if letter["workflow_kind"] == "delivery":
                number_value = values.get("outgoingNumber")
                year_value = values.get("yearSuffix")
                if (
                    not isinstance(number_value, int) or isinstance(number_value, bool)
                    or not 1 <= number_value <= 99999999
                    or not isinstance(year_value, str)
                ):
                    raise HTTPException(409, "Номер письма не соответствует автономному резерву.")
                number, year_suffix = number_value, year_value
                if letter["outgoing_number"] is not None:
                    if (
                        letter["outgoing_number"] != number
                        or letter["year_suffix"] != year_suffix
                    ):
                        raise HTTPException(409, "Номер письма после доработки изменился.")
                else:
                    if year_suffix != occurred_at.strftime("%y"):
                        raise HTTPException(409, "Год автономного резерва не совпал.")
                    reservation = await connection.scalar(select(
                        ai_referent_offline_number_reservations.c.id
                    ).where(
                        ai_referent_offline_number_reservations.c.agent_id == agent_id,
                        ai_referent_offline_number_reservations.c.year_suffix == year_suffix,
                        ai_referent_offline_number_reservations.c.first_number <= number,
                        ai_referent_offline_number_reservations.c.last_number >= number,
                        ai_referent_offline_number_reservations.c.created_at <= occurred_at,
                        ai_referent_offline_number_reservations.c.valid_until > occurred_at,
                    ).limit(1))
                    used = await connection.scalar(select(ai_referent_letters.c.id).where(
                        ai_referent_letters.c.year_suffix == year_suffix,
                        ai_referent_letters.c.outgoing_number == number,
                    ).limit(1))
                    if reservation is None or used is not None:
                        raise HTTPException(409, "Номер не зарезервирован или уже использован.")
    expected_next_reviewer = str(next_reviewer_id) if next_reviewer_id else None
    if (
        values.get("toStatus") != next_status
        or values.get("nextReviewerUserId") != expected_next_reviewer
        or values.get("outgoingNumber") != number
        or values.get("yearSuffix") != year_suffix
    ):
        raise HTTPException(409, "Итог автономного решения не совпал с правилами маршрута.")
    update_values: dict[str, object] = {
        "status": next_status, "revision": revision + 1, "updated_at": occurred_at,
    }
    if next_reviewer_id is not None:
        update_values["reviewer_user_id"] = next_reviewer_id
        update_values["reviewer_key"] = (
            letter["initial_reviewer_key"] if next_status == "needs_revision"
            else letter["final_reviewer_key"]
        )
    if next_status == "needs_revision":
        update_values["final_pdf_file_id"] = None
    if number is not None:
        update_values["outgoing_number"] = number
        update_values["year_suffix"] = year_suffix
    await connection.execute(update(ai_referent_letters).where(
        ai_referent_letters.c.id == operation.letter_id
    ).values(**update_values))
    if command_kind is not None:
        await connection.execute(insert(ai_referent_delivery_commands).values(
            id=uuid5(NAMESPACE_URL, "ai-offline-command:" + str(operation.operation_id)),
            letter_id=operation.letter_id, route=letter["route"], status="pending",
            idempotency_key=f"letter:{operation.letter_id}:revision:{revision + 1}",
            kind=command_kind, claimed_by=None, lease_until=None,
            attempt_count=0, last_error="", created_at=occurred_at,
            updated_at=occurred_at, completed_at=None,
        ))
    await connection.execute(insert(ai_referent_events).values(
        id=uuid5(NAMESPACE_URL, "ai-offline-event:" + str(operation.operation_id)),
        letter_id=operation.letter_id, actor_user_id=actor_user_id,
        event_type="letter." + action,
        from_status=letter["status"], to_status=next_status,
        comment=comment,
        metadata={"audioId": str(audio_id)} if audio_id is not None else {},
        created_at=occurred_at,
    ))
    await connection.execute(insert(audit_events).values(
        id=uuid5(NAMESPACE_URL, "ai-offline-audit:" + str(operation.operation_id)),
        actor_user_id=actor_user_id, action="ai_referent.offline_" + action,
        target_type="ai_referent_letter", target_id=operation.letter_id,
        details={"agentId": agent_id, "epoch": str(epoch),
                 "fromStatus": letter["status"], "toStatus": next_status},
        created_at=now,
    ))
    await connection.execute(insert(ai_referent_offline_operation_receipts).values(
        operation_id=operation.operation_id, agent_id=agent_id, epoch=epoch,
        sequence=operation.sequence, letter_id=operation.letter_id,
        kind=operation.kind, fingerprint=fingerprint, result_revision=revision + 1,
        occurred_at=occurred_at, accepted_at=now,
    ))
    return OfflineReplayReceipt(
        operation_id=operation.operation_id, sequence=operation.sequence,
        letter_id=operation.letter_id, result_revision=revision + 1, accepted_at=now,
    )


async def _replay_prepared(
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
    values = operation.payload
    try:
        approval_id = UUID(str(values["approvalOperationId"]))
        command_id = UUID(str(values["commandId"]))
    except (KeyError, TypeError, ValueError) as error:
        raise HTTPException(422, "Подготовка не связана с согласованием.") from error
    revision, size = values.get("expectedRevision"), values.get("byteSize")
    if (
        operation.operation_id != uuid5(NAMESPACE_URL, "ai-offline-prepare:" + str(approval_id))
        or command_id != uuid5(NAMESPACE_URL, "ai-offline-command:" + str(approval_id))
        or type(revision) is not int or revision < 2
        or type(size) is not int or not 0 < size <= 50 * 1024 * 1024
        or values.get("fromStatus") != "queued"
        or storage is None or operation.blob_sha256 is None
    ):
        raise HTTPException(422, "Поля автономной подготовки недействительны.")
    letter = (
        await connection.execute(select(ai_referent_letters).where(
            ai_referent_letters.c.id == operation.letter_id
        ).with_for_update())
    ).mappings().one_or_none()
    reviewer_keys = actor.get("reviewerKeys")
    if not isinstance(reviewer_keys, list):
        reviewer_keys = []
    if (
        letter is None or letter["status"] != "queued" or letter["revision"] != revision
        or letter["workflow_kind"] != "delivery"
        or letter["reviewer_user_id"] != UUID(str(actor["userId"]))
        or letter["reviewer_key"] not in reviewer_keys
    ):
        raise HTTPException(409, "Письмо не ожидает эту автономную подготовку.")
    next_status = (
        "awaiting_final_send" if letter["reviewer_key"] == "bobur"
        else "referent_review_pending"
    )
    if values.get("toStatus") != next_status:
        raise HTTPException(409, "Итог подготовки не совпал с маршрутом согласования.")
    command = (
        await connection.execute(select(ai_referent_delivery_commands).where(
            ai_referent_delivery_commands.c.id == command_id
        ).with_for_update())
    ).mappings().one_or_none()
    if (
        command is None or command["letter_id"] != operation.letter_id
        or command["kind"] != "prepare" or command["status"] != "pending"
        or command["created_at"] > occurred_at
    ):
        raise HTTPException(409, "Задание подготовки отсутствует или уже выполнялось.")
    staged = (
        await connection.execute(select(ai_referent_offline_blobs).where(
            ai_referent_offline_blobs.c.agent_id == agent_id,
            ai_referent_offline_blobs.c.epoch == epoch,
            ai_referent_offline_blobs.c.sha256 == operation.blob_sha256,
        ))
    ).mappings().one_or_none()
    if staged is None or staged["byte_size"] != size:
        raise HTTPException(409, "Подписанный PDF не передан для сверки.")
    content = await storage.get(staged["storage_key"])
    if (
        len(content) != size or hashlib.sha256(content).hexdigest() != operation.blob_sha256
        or not content.startswith(b"%PDF-")
    ):
        raise HTTPException(409, "Подписанный PDF повреждён или изменился.")
    file_id = uuid5(NAMESPACE_URL, "ai-offline-signed:" + str(operation.operation_id))
    await connection.execute(insert(ai_referent_files).values(
        id=file_id, kind="outgoing", owner_id=operation.letter_id,
        relative_path=f"signed/{command_id}.pdf", storage_key=staged["storage_key"],
        sha256=operation.blob_sha256, byte_size=size, content_type="application/pdf",
        created_at=occurred_at,
    ))
    await connection.execute(update(ai_referent_delivery_commands).where(
        ai_referent_delivery_commands.c.id == command_id
    ).values(
        status="completed", result={"outcome": "prepared", "detail": "Автономная подготовка"},
        completed_at=occurred_at, updated_at=occurred_at, last_error="",
    ))
    await connection.execute(update(ai_referent_letters).where(
        ai_referent_letters.c.id == operation.letter_id
    ).values(
        status=next_status, revision=revision + 1, updated_at=occurred_at,
        final_pdf_file_id=file_id, delivery_error="",
    ))
    await connection.execute(insert(ai_referent_events).values(
        id=uuid5(NAMESPACE_URL, "ai-offline-event:" + str(operation.operation_id)),
        letter_id=operation.letter_id, actor_user_id=None, event_type="agent.prepared",
        from_status="queued", to_status=next_status, comment="",
        metadata={"offlineOperationId": str(operation.operation_id)}, created_at=occurred_at,
    ))
    await connection.execute(insert(audit_events).values(
        id=uuid5(NAMESPACE_URL, "ai-offline-audit:" + str(operation.operation_id)),
        actor_user_id=None, action="ai_referent.offline_prepared",
        target_type="ai_referent_letter", target_id=operation.letter_id,
        details={"agentId": agent_id, "epoch": str(epoch), "commandId": str(command_id)},
        created_at=now,
    ))
    await connection.execute(insert(ai_referent_offline_operation_receipts).values(
        operation_id=operation.operation_id, agent_id=agent_id, epoch=epoch,
        sequence=operation.sequence, letter_id=operation.letter_id,
        kind=operation.kind, fingerprint=fingerprint, result_revision=revision + 1,
        occurred_at=occurred_at, accepted_at=now,
    ))
    return OfflineReplayReceipt(
        operation_id=operation.operation_id, sequence=operation.sequence,
        letter_id=operation.letter_id, result_revision=revision + 1, accepted_at=now,
    )


async def _replay_signed_pages(
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
    values = operation.payload
    try:
        approval_id = UUID(str(values["approvalOperationId"]))
        command_id = UUID(str(values["commandId"]))
    except (KeyError, TypeError, ValueError) as error:
        raise HTTPException(422, "Подписанные страницы не связаны с согласованием.") from error
    revision, size, manifest = (
        values.get("expectedRevision"), values.get("byteSize"), values.get("pages")
    )
    if (
        operation.operation_id != uuid5(NAMESPACE_URL, "ai-offline-sign:" + str(approval_id))
        or command_id != uuid5(NAMESPACE_URL, "ai-offline-command:" + str(approval_id))
        or type(revision) is not int or revision < 2
        or type(size) is not int or not 0 < size <= 50 * 1024 * 1024
        or not isinstance(manifest, list) or not 1 <= len(manifest) <= 100
        or values.get("fromStatus") != "queued" or values.get("toStatus") != "signed"
        or storage is None or operation.blob_sha256 is None
    ):
        raise HTTPException(422, "Поля автономного подписания недействительны.")
    letter = (
        await connection.execute(select(ai_referent_letters).where(
            ai_referent_letters.c.id == operation.letter_id
        ).with_for_update())
    ).mappings().one_or_none()
    reviewer_keys = actor.get("reviewerKeys")
    if not isinstance(reviewer_keys, list):
        reviewer_keys = []
    if (
        letter is None or letter["status"] != "queued" or letter["revision"] != revision
        or letter["workflow_kind"] != "sign_only"
        or letter["reviewer_user_id"] != UUID(str(actor["userId"]))
        or letter["reviewer_key"] not in reviewer_keys
    ):
        raise HTTPException(409, "Письмо не ожидает это автономное подписание.")
    command = (
        await connection.execute(select(ai_referent_delivery_commands).where(
            ai_referent_delivery_commands.c.id == command_id
        ).with_for_update())
    ).mappings().one_or_none()
    if (
        command is None or command["letter_id"] != operation.letter_id
        or command["kind"] != "sign_only" or command["status"] != "pending"
        or command["created_at"] > occurred_at
    ):
        raise HTTPException(409, "Задание подписания отсутствует или уже выполнялось.")
    staged = (
        await connection.execute(select(ai_referent_offline_blobs).where(
            ai_referent_offline_blobs.c.agent_id == agent_id,
            ai_referent_offline_blobs.c.epoch == epoch,
            ai_referent_offline_blobs.c.sha256 == operation.blob_sha256,
        ))
    ).mappings().one_or_none()
    if staged is None or staged["byte_size"] != size:
        raise HTTPException(409, "Пакет подписанных страниц не передан для сверки.")
    content = await storage.get(staged["storage_key"])
    if len(content) != size or hashlib.sha256(content).hexdigest() != operation.blob_sha256:
        raise HTTPException(409, "Пакет подписанных страниц повреждён.")
    pages: list[tuple[str, bytes, str]] = []
    try:
        with ZipFile(BytesIO(content)) as archive:
            entries = archive.infolist()
            if len(entries) != len(manifest):
                raise HTTPException(422, "Число страниц в пакете не совпало.")
            for index, (entry, item) in enumerate(zip(entries, manifest, strict=True), 1):
                name = f"{index:03d}.pdf"
                if (
                    not isinstance(item, dict) or item.get("name") != name
                    or entry.filename != name or entry.compress_type != ZIP_STORED
                    or bool(entry.flag_bits & 1)
                    or type(item.get("byteSize")) is not int
                    or not 0 < item["byteSize"] <= 20 * 1024 * 1024
                    or entry.file_size != item["byteSize"]
                    or not isinstance(item.get("sha256"), str)
                ):
                    raise HTTPException(422, "Недопустимая подписанная страница.")
                page = archive.read(entry)
                digest = hashlib.sha256(page).hexdigest()
                if not page.startswith(b"%PDF-") or digest != item["sha256"]:
                    raise HTTPException(422, "Подписанная страница повреждена.")
                pages.append((name, page, digest))
    except (BadZipFile, RuntimeError, ValueError) as error:
        raise HTTPException(422, "Пакет подписанных страниц повреждён.") from error
    for name, page, digest in pages:
        # Deterministic keys make retry safe if object storage succeeded but SQL rolled back.
        key = f"ai-referent/offline-signed/{operation.letter_id}/{command_id}/{name}"
        await storage.put(key, page, "application/pdf")
        await connection.execute(insert(ai_referent_files).values(
            id=uuid5(NAMESPACE_URL, f"ai-offline-signed-page:{operation.operation_id}:{name}"),
            kind="outgoing", owner_id=operation.letter_id,
            relative_path=f"signed/{command_id}/{name}", storage_key=key,
            sha256=digest, byte_size=len(page), content_type="application/pdf",
            created_at=occurred_at,
        ))
    await connection.execute(update(ai_referent_delivery_commands).where(
        ai_referent_delivery_commands.c.id == command_id
    ).values(
        status="completed", result={
            "outcome": "prepared", "signedPages": len(pages),
            "detail": "Автономное подписание без отправки",
        }, completed_at=occurred_at, updated_at=occurred_at, last_error="",
    ))
    await connection.execute(update(ai_referent_letters).where(
        ai_referent_letters.c.id == operation.letter_id
    ).values(
        status="signed", revision=revision + 1, updated_at=occurred_at,
        final_pdf_file_id=None, delivery_error="",
    ))
    await connection.execute(insert(ai_referent_events).values(
        id=uuid5(NAMESPACE_URL, "ai-offline-event:" + str(operation.operation_id)),
        letter_id=operation.letter_id, actor_user_id=None, event_type="agent.prepared",
        from_status="queued", to_status="signed", comment="",
        metadata={"offlineOperationId": str(operation.operation_id), "signedPages": len(pages)},
        created_at=occurred_at,
    ))
    await connection.execute(insert(audit_events).values(
        id=uuid5(NAMESPACE_URL, "ai-offline-audit:" + str(operation.operation_id)),
        actor_user_id=None, action="ai_referent.offline_signed",
        target_type="ai_referent_letter", target_id=operation.letter_id,
        details={"agentId": agent_id, "epoch": str(epoch), "commandId": str(command_id)},
        created_at=now,
    ))
    await connection.execute(insert(ai_referent_offline_operation_receipts).values(
        operation_id=operation.operation_id, agent_id=agent_id, epoch=epoch,
        sequence=operation.sequence, letter_id=operation.letter_id,
        kind=operation.kind, fingerprint=fingerprint, result_revision=revision + 1,
        occurred_at=occurred_at, accepted_at=now,
    ))
    return OfflineReplayReceipt(
        operation_id=operation.operation_id, sequence=operation.sequence,
        letter_id=operation.letter_id, result_revision=revision + 1, accepted_at=now,
    )


async def _replay_dispatched(
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
    try:
        release_id = UUID(str(values["releaseOperationId"]))
        command_id = UUID(str(values["commandId"]))
    except (KeyError, TypeError, ValueError) as error:
        raise HTTPException(422, "Подготовка отправки не связана с решением.") from error
    revision, auto_send = values.get("expectedRevision"), values.get("autoSend")
    next_status = "queued" if auto_send else "referent_review_pending"
    if (
        operation.operation_id != uuid5(NAMESPACE_URL, "ai-offline-dispatch:" + str(release_id))
        or command_id != uuid5(NAMESPACE_URL, "ai-offline-command:" + str(release_id))
        or type(revision) is not int or revision < 2 or type(auto_send) is not bool
        or values.get("fromStatus") != "queued" or values.get("toStatus") != next_status
        or operation.blob_sha256 is not None
    ):
        raise HTTPException(422, "Поля автономной подготовки отправки недействительны.")
    letter = (
        await connection.execute(select(ai_referent_letters).where(
            ai_referent_letters.c.id == operation.letter_id
        ).with_for_update())
    ).mappings().one_or_none()
    reviewer_keys = actor.get("reviewerKeys")
    if not isinstance(reviewer_keys, list):
        reviewer_keys = []
    if (
        letter is None or letter["status"] != "queued" or letter["revision"] != revision
        or letter["workflow_kind"] != "delivery" or letter["final_pdf_file_id"] is None
        or letter["reviewer_user_id"] != UUID(str(actor["userId"]))
        or letter["reviewer_key"] not in reviewer_keys
    ):
        raise HTTPException(409, "Письмо не ожидает автономной подготовки отправки.")
    command = (
        await connection.execute(select(ai_referent_delivery_commands).where(
            ai_referent_delivery_commands.c.id == command_id
        ).with_for_update())
    ).mappings().one_or_none()
    if (
        command is None or command["letter_id"] != operation.letter_id
        or command["kind"] != "dispatch" or command["status"] != "pending"
        or command["created_at"] > occurred_at
    ):
        raise HTTPException(409, "Задание отправки отсутствует или уже выполнено.")
    await connection.execute(update(ai_referent_delivery_commands).where(
        ai_referent_delivery_commands.c.id == command_id
    ).values(
        status="completed", result={"outcome": "ready", "autoSend": auto_send,
                                    "detail": "Автономная подготовка отправки"},
        completed_at=occurred_at, updated_at=occurred_at, last_error="",
    ))
    await connection.execute(update(ai_referent_letters).where(
        ai_referent_letters.c.id == operation.letter_id
    ).values(status=next_status, revision=revision + 1, updated_at=occurred_at))
    if auto_send:
        await connection.execute(insert(ai_referent_delivery_commands).values(
            id=uuid5(NAMESPACE_URL, "ai-offline-send-command:" + str(operation.operation_id)),
            letter_id=operation.letter_id, route=letter["route"], status="pending",
            idempotency_key=f"letter:{operation.letter_id}:revision:{revision + 1}",
            kind="send", claimed_by=None, lease_until=None, attempt_count=0,
            last_error="", created_at=occurred_at, updated_at=occurred_at,
            completed_at=None,
        ))
    await connection.execute(insert(ai_referent_events).values(
        id=uuid5(NAMESPACE_URL, "ai-offline-event:" + str(operation.operation_id)),
        letter_id=operation.letter_id, actor_user_id=None, event_type="agent.ready",
        from_status="queued", to_status=next_status, comment="",
        metadata={"offlineOperationId": str(operation.operation_id)}, created_at=occurred_at,
    ))
    await connection.execute(insert(audit_events).values(
        id=uuid5(NAMESPACE_URL, "ai-offline-audit:" + str(operation.operation_id)),
        actor_user_id=None, action="ai_referent.offline_dispatch",
        target_type="ai_referent_letter", target_id=operation.letter_id,
        details={"agentId": agent_id, "epoch": str(epoch), "commandId": str(command_id)},
        created_at=now,
    ))
    await connection.execute(insert(ai_referent_offline_operation_receipts).values(
        operation_id=operation.operation_id, agent_id=agent_id, epoch=epoch,
        sequence=operation.sequence, letter_id=operation.letter_id,
        kind=operation.kind, fingerprint=fingerprint, result_revision=revision + 1,
        occurred_at=occurred_at, accepted_at=now,
    ))
    return OfflineReplayReceipt(
        operation_id=operation.operation_id, sequence=operation.sequence,
        letter_id=operation.letter_id, result_revision=revision + 1, accepted_at=now,
    )


async def _replay_external_result(
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
    try:
        effect_id = UUID(str(values["effectId"]))
        source_id = UUID(str(values["sendOperationId"]))
        command_id = UUID(str(values["commandId"]))
    except (KeyError, TypeError, ValueError) as error:
        raise HTTPException(422, "Квитанция не связана с заданием отправки.") from error
    sent, revision = values.get("sent"), values.get("expectedRevision")
    evidence, signed_hash = values.get("evidence"), values.get("signedSha256")
    manual = values.get("manual", False)
    next_status = "sent" if sent else "referent_review_pending"
    if (
        operation.operation_id != uuid5(NAMESPACE_URL, "ai-offline-result:" + str(effect_id))
        or effect_id != uuid5(NAMESPACE_URL, "ai-offline-effect:" + str(source_id))
        or operation.required_action not in {"approve", "admin"}
        or type(manual) is not bool or (manual and operation.required_action != "admin")
        or (not sent and not manual)
        or type(sent) is not bool or type(revision) is not int or revision < 2
        or values.get("fromStatus") != "queued" or values.get("toStatus") != next_status
        or not isinstance(evidence, str) or not 3 <= len(evidence) <= 2000
        or evidence != evidence.strip() or not isinstance(signed_hash, str)
        or len(signed_hash) != 64 or operation.blob_sha256 is not None
    ):
        raise HTTPException(422, "Поля автономной квитанции отправки недействительны.")
    source = (
        await connection.execute(select(ai_referent_offline_operation_receipts).where(
            ai_referent_offline_operation_receipts.c.operation_id == source_id,
            ai_referent_offline_operation_receipts.c.epoch == epoch,
            ai_referent_offline_operation_receipts.c.agent_id == agent_id,
            ai_referent_offline_operation_receipts.c.letter_id == operation.letter_id,
        ))
    ).mappings().one_or_none()
    if source is None or source["kind"] not in {"letter.dispatched", "letter.action"}:
        raise HTTPException(409, "Исходная операция отправки не сверена.")
    if (
        (not manual and operation.required_action != (
            "approve" if source["kind"] == "letter.dispatched" else "admin"
        ))
        or command_id != uuid5(
            NAMESPACE_URL,
            ("ai-offline-send-command:" if source["kind"] == "letter.dispatched"
             else "ai-offline-command:") + str(source_id),
        )
    ):
        raise HTTPException(403, "Квитанция не соответствует отправившему сотруднику.")
    letter = (
        await connection.execute(select(ai_referent_letters).where(
            ai_referent_letters.c.id == operation.letter_id
        ).with_for_update())
    ).mappings().one_or_none()
    if (
        letter is None or letter["status"] != "queued" or letter["revision"] != revision
        or letter["workflow_kind"] != "delivery" or letter["final_pdf_file_id"] is None
    ):
        raise HTTPException(409, "Письмо не ожидает квитанцию отправки.")
    if operation.required_action == "approve":
        reviewer_keys = actor.get("reviewerKeys")
        if (
            letter["reviewer_user_id"] != UUID(str(actor["userId"]))
            or not isinstance(reviewer_keys, list)
            or letter["reviewer_key"] not in reviewer_keys
        ):
            raise HTTPException(403, "Квитанция не относится к итоговому согласующему.")
    command = (
        await connection.execute(select(ai_referent_delivery_commands).where(
            ai_referent_delivery_commands.c.id == command_id
        ).with_for_update())
    ).mappings().one_or_none()
    if (
        command is None or command["letter_id"] != operation.letter_id
        or command["kind"] != "send" or command["status"] != "pending"
        or command["created_at"] > occurred_at
    ):
        raise HTTPException(409, "Задание физической отправки отсутствует.")
    signed_file = (
        await connection.execute(select(ai_referent_files).where(
            ai_referent_files.c.id == letter["final_pdf_file_id"],
            ai_referent_files.c.owner_id == operation.letter_id,
            ai_referent_files.c.kind == "outgoing",
        ))
    ).mappings().one_or_none()
    if signed_file is None or signed_file["sha256"] != signed_hash:
        raise HTTPException(409, "Подписанный PDF отличается от отправленного.")
    await connection.execute(update(ai_referent_delivery_commands).where(
        ai_referent_delivery_commands.c.id == command_id
    ).values(
        status="completed", result={"outcome": "sent" if sent else "not_sent",
                                    "detail": evidence, "offlineEffectId": str(effect_id)},
        completed_at=occurred_at, updated_at=occurred_at, last_error="",
    ))
    await connection.execute(update(ai_referent_letters).where(
        ai_referent_letters.c.id == operation.letter_id
    ).values(
        status=next_status, revision=revision + 1, updated_at=occurred_at,
        sent_at=occurred_at if sent else letter["sent_at"], delivery_error="",
    ))
    await connection.execute(insert(ai_referent_events).values(
        id=uuid5(NAMESPACE_URL, "ai-offline-event:" + str(operation.operation_id)),
        letter_id=operation.letter_id, actor_user_id=None,
        event_type="agent.sent" if sent else "agent.not_sent",
        from_status="queued", to_status=next_status, comment=evidence,
        metadata={"offlineOperationId": str(operation.operation_id),
                  "effectId": str(effect_id)}, created_at=occurred_at,
    ))
    await connection.execute(insert(audit_events).values(
        id=uuid5(NAMESPACE_URL, "ai-offline-audit:" + str(operation.operation_id)),
        actor_user_id=UUID(str(actor["userId"])),
        action="ai_referent.offline_external_result",
        target_type="ai_referent_letter", target_id=operation.letter_id,
        details={"agentId": agent_id, "epoch": str(epoch), "effectId": str(effect_id),
                 "sent": sent, "evidence": evidence}, created_at=now,
    ))
    await connection.execute(insert(ai_referent_offline_operation_receipts).values(
        operation_id=operation.operation_id, agent_id=agent_id, epoch=epoch,
        sequence=operation.sequence, letter_id=operation.letter_id,
        kind=operation.kind, fingerprint=fingerprint, result_revision=revision + 1,
        occurred_at=occurred_at, accepted_at=now,
    ))
    return OfflineReplayReceipt(
        operation_id=operation.operation_id, sequence=operation.sequence,
        letter_id=operation.letter_id, result_revision=revision + 1, accepted_at=now,
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
    # Disabling new offline sessions must not strand a previously issued epoch.
    # The assigned agent, epoch and replay-required fence are verified below.
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
    last_epoch_sequence = await connection.scalar(
        select(func.max(ai_referent_offline_operation_receipts.c.sequence)).where(
            ai_referent_offline_operation_receipts.c.agent_id == agent_id,
            ai_referent_offline_operation_receipts.c.epoch == epoch,
        )
    )
    last_agent_sequence = await connection.scalar(
        select(func.max(ai_referent_offline_operation_receipts.c.sequence)).where(
            ai_referent_offline_operation_receipts.c.agent_id == agent_id,
        )
    )
    if (
        (last_epoch_sequence is not None and operation.sequence != last_epoch_sequence + 1)
        or (last_epoch_sequence is None and operation.sequence <= (last_agent_sequence or 0))
    ):
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
        ("letter.delete", "edit"),
        ("letter.attachment", "edit"),
        ("letter.document_check", "edit"),
        ("letter.comment_audio", "approve"), ("letter.comment_audio", "admin"),
        ("letter.prepared", "approve"), ("letter.signed", "approve"),
        ("letter.dispatched", "approve"),
        ("letter.external_result", "approve"), ("letter.external_result", "admin"),
        ("letter.action", "edit"), ("letter.action", "approve"),
        ("letter.action", "admin"),
    }:
        raise HTTPException(422, "Этот вид автономной операции пока не поддерживается.")
    if (
        operation.kind not in {
            "letter.attachment", "letter.document_check", "letter.comment_audio",
            "letter.prepared", "letter.signed",
        }
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
    if operation.kind == "letter.comment_audio":
        return await _replay_comment_audio(
            connection, storage, agent_id=agent_id, epoch=epoch,
            operation=operation, actor=actor, fingerprint=fingerprint,
            occurred_at=occurred_at, now=now,
        )
    if operation.kind == "letter.prepared":
        return await _replay_prepared(
            connection, storage, agent_id=agent_id, epoch=epoch,
            operation=operation, actor=actor, fingerprint=fingerprint,
            occurred_at=occurred_at, now=now,
        )
    if operation.kind == "letter.signed":
        return await _replay_signed_pages(
            connection, storage, agent_id=agent_id, epoch=epoch,
            operation=operation, actor=actor, fingerprint=fingerprint,
            occurred_at=occurred_at, now=now,
        )
    if operation.kind == "letter.dispatched":
        return await _replay_dispatched(
            connection, agent_id=agent_id, epoch=epoch,
            operation=operation, actor=actor, fingerprint=fingerprint,
            occurred_at=occurred_at, now=now,
        )
    if operation.kind == "letter.external_result":
        return await _replay_external_result(
            connection, agent_id=agent_id, epoch=epoch,
            operation=operation, actor=actor, fingerprint=fingerprint,
            occurred_at=occurred_at, now=now,
        )
    if operation.kind == "letter.action":
        return await _replay_action(
            connection, agent_id=agent_id, epoch=epoch,
            operation=operation, actor=actor, fingerprint=fingerprint,
            occurred_at=occurred_at, now=now,
        )
    if operation.kind == "letter.delete":
        return await _replay_delete(
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
