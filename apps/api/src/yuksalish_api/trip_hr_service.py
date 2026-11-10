"""Protected chair resolution and manual HR registration, with immutable document revisions."""

import hashlib
from datetime import UTC, datetime
from uuid import UUID, uuid4
from zoneinfo import ZoneInfo

from sqlalchemy import func, insert, select, update
from sqlalchemy.ext.asyncio import AsyncConnection
from starlette.concurrency import run_in_threadpool

from .auth import AuthenticatedUser
from .employee_availability import ensure_trip_available
from .errors import WorkspaceRepositoryError as Error
from .hr_hiring_pdf import application_pdf
from .hr_hiring_tables import hiring_signatures
from .object_storage import ObjectStorage
from .repository import _trip_allowed_actions
from .tables import hr_settings, trip_document_revisions, trip_request_actions, trip_requests, users
from .trip_document_service import _people, _row, _verified
from .trip_hr_pdf import TripDocumentSnapshot, hr_brief_pdf, hr_order_pdf
from .workspace_schemas import TripActionRequest

_LOCAL = ZoneInfo("Asia/Tashkent")


async def live_snapshot(connection: AsyncConnection, request_id: UUID) -> TripDocumentSnapshot:
    row = await _row(connection, request_id)
    chair_id = await connection.scalar(select(hr_settings.c.chair_user_id).where(
        hr_settings.c.id == 1,
    ))
    requester = (await connection.execute(select(users.c.full_name, users.c.job_title).where(
        users.c.id == row["requester_user_id"],
    ))).mappings().first()
    chair = await connection.scalar(select(users.c.full_name).where(
        users.c.id == chair_id, users.c.status == "active",
    ))
    if requester is None or not chair:
        raise Error(409, "Проверьте инициатора и назначенного председателя")
    return TripDocumentSnapshot(
        requester=requester["full_name"], requester_title=requester["job_title"] or "",
        chair=str(chair), brief_text=row["brief_text"] or "", purpose=row["purpose"] or "",
        destination=row["destination"], start=row["start_date"], end=row["end_date"],
        employees=await _people(connection, request_id), expense_source=row["expense_source"] or "",
        brief_font_size=row.get("brief_font_size") or 11,
        brief_font_weight=row.get("brief_font_weight") or "regular",
        source_brief_key=row["signed_brief_key"],
        source_brief_sha256=row["signed_brief_sha256"],
        original_name=row["brief_attachment_name"]
        if row.get("original_signature_confirmed_at") else None,
    )


async def _archive(
    connection: AsyncConnection, storage: ObjectStorage, *, request_id: UUID,
    user_id: UUID, kind: str, content: bytes, facts: dict[str, object],
) -> tuple[str, str]:
    key = f"trip-requests/{request_id}/{kind}/{uuid4()}.pdf"
    digest = hashlib.sha256(content).hexdigest()
    await storage.put(key, content, "application/pdf")
    await connection.execute(insert(trip_document_revisions).values(
        id=uuid4(), request_id=request_id, actor_user_id=user_id, kind=kind,
        storage_key=key, sha256=digest, facts=facts, created_at=datetime.now(UTC),
    ))
    return key, digest


async def apply_resolution(
    connection: AsyncConnection, user: AuthenticatedUser, storage: ObjectStorage, request_id: UUID,
) -> None:
    row = await _row(connection, request_id, lock=True)
    chair_id = await connection.scalar(select(hr_settings.c.chair_user_id).where(
        hr_settings.c.id == 1,
    ))
    if not row.get("hr_processing_required") or user.id != chair_id:
        raise Error(403, "Резолюцию может поставить только назначенный председатель")
    if row["stage"] == "hr" and row.get("resolved_brief_key") \
            and row.get("resolution_actor_user_id") == user.id:
        return
    if "approve" not in _trip_allowed_actions(row, user, chair_id):
        raise Error(409, "Поездка не ожидает резолюции председателя")
    hr_id = await connection.scalar(select(hr_settings.c.hr_user_id).where(hr_settings.c.id == 1))
    if hr_id is None or not await connection.scalar(select(users.c.id).where(
        users.c.id == hr_id, users.c.status == "active",
    )):
        raise Error(409, "Назначьте активного кадровика в настройках HR")
    signer = (await connection.execute(select(hiring_signatures).where(
        hiring_signatures.c.user_id == user.id,
    ))).mappings().first()
    if signer is None:
        raise Error(409, "Сначала настройте личную подпись председателя в HR")
    image = await _verified(storage, signer["storage_key"], signer["sha256"])
    facts = await live_snapshot(connection, request_id)
    original_pdf = None
    if facts.source_brief_key:
        source = await _verified(storage, facts.source_brief_key, facts.source_brief_sha256)
        if facts.original_name and row["brief_attachment_type"] != (
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        ):
            original_pdf, _ = await run_in_threadpool(application_pdf, source)
    signature_key = f"trip-requests/{request_id}/resolution-signatures/{uuid4()}.png"
    await storage.put(signature_key, image, "image/png")
    facts.signature_key = signature_key
    facts.signature_sha256 = hashlib.sha256(image).hexdigest()
    content = await run_in_threadpool(hr_brief_pdf, facts, image, original_pdf)
    snapshot = facts.model_dump(mode="json")
    key, digest = await _archive(
        connection, storage, request_id=request_id, user_id=user.id,
        kind="resolution", content=content, facts=snapshot,
    )
    await connection.execute(update(trip_requests).where(trip_requests.c.id == request_id).values(
        resolved_brief_key=key, resolved_brief_sha256=digest,
        resolution_snapshot=snapshot, resolution_actor_user_id=user.id,
        resolution_at=datetime.now(UTC), hr_processor_user_id=hr_id,
    ))
    if row["stage"] == "hr":
        await connection.execute(insert(trip_request_actions).values(
            id=uuid4(), request_id=request_id, actor_user_id=user.id, from_stage="hr",
            to_stage="hr", action="approve", comment="Добавлена резолюция председателя",
            created_at=datetime.now(UTC),
        ))


async def complete_order(
    connection: AsyncConnection, user: AuthenticatedUser, storage: ObjectStorage,
    request_id: UUID, payload: TripActionRequest,
) -> None:
    row = await _row(connection, request_id, lock=True)
    if not row.get("hr_processing_required") or row.get("hr_processor_user_id") != user.id:
        raise Error(403, "Приказ оформляет назначенный кадровик")
    if row["status"] == "approved" and row["order_pdf_key"]:
        if (row["order_number"], row["order_series"], row["order_purpose"]) != (
            payload.order_number, payload.order_series, payload.order_purpose,
        ):
            raise Error(409, "Приказ уже оформлен; реквизиты отличаются")
        return
    if "complete" not in _trip_allowed_actions(row, user):
        raise Error(409, "Поездка не ожидает кадрового оформления")
    await ensure_trip_available(connection, request_id, row["start_date"], row["end_date"])
    await _verified(storage, row["resolved_brief_key"], row["resolved_brief_sha256"])
    facts = TripDocumentSnapshot.model_validate(row["resolution_snapshot"])
    image = await _verified(storage, facts.signature_key, facts.signature_sha256)
    issued = datetime.now(_LOCAL)
    duplicate = await connection.scalar(select(trip_requests.c.id).where(
        trip_requests.c.hr_processing_required.is_(True),
        trip_requests.c.order_year == issued.year,
        trip_requests.c.order_pdf_key.is_not(None),
        trip_requests.c.id != request_id,
        # The database index also protects simultaneous registrations.
        func.lower(func.btrim(trip_requests.c.order_number)) == payload.order_number.lower(),
        func.lower(func.btrim(trip_requests.c.order_series)) == payload.order_series.lower(),
    ))
    if duplicate is not None:
        raise Error(409, "Номер и серия приказа уже зарегистрированы в этом году")
    content = await run_in_threadpool(
        hr_order_pdf, facts, number=payload.order_number, series=payload.order_series,
        purpose=payload.order_purpose or facts.purpose, issued=issued.date(), signature=image,
    )
    key, digest = await _archive(
        connection, storage, request_id=request_id, user_id=user.id, kind="order", content=content,
        facts={"number": payload.order_number, "series": payload.order_series,
               "purpose": payload.order_purpose, "resolutionKey": row["resolved_brief_key"]},
    )
    await connection.execute(update(trip_requests).where(trip_requests.c.id == request_id).values(
        order_pdf_key=key, order_pdf_sha256=digest,
        order_number=payload.order_number, order_series=payload.order_series,
        order_purpose=payload.order_purpose, order_year=issued.year,
        order_issued_at=issued.astimezone(UTC),
        order_signer_user_id=row["resolution_actor_user_id"],
    ))
