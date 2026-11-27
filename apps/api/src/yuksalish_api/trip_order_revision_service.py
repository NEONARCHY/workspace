"""Versioned reissue of an approved trip's documents without replaying its approval."""

import hashlib
from datetime import UTC, datetime, time
from uuid import UUID, uuid4
from zoneinfo import ZoneInfo

from sqlalchemy import insert, select, update
from sqlalchemy.engine import RowMapping
from sqlalchemy.ext.asyncio import AsyncConnection
from starlette.concurrency import run_in_threadpool

from .auth import AuthenticatedUser
from .errors import WorkspaceRepositoryError as Error
from .hr_hiring_pdf import application_pdf
from .hr_hiring_tables import hiring_signatures
from .object_storage import ObjectStorage
from .tables import hr_settings, trip_document_revisions, trip_request_actions, trip_requests, users
from .trip_document_service import _row, _verified
from .trip_hr_pdf import TripDocumentSnapshot, hr_brief_pdf, hr_order_pdf
from .trip_hr_service import _archive, live_snapshot
from .trip_order_registration import reserve_order_number
from .trip_order_revision_permissions import order_revision_actions
from .workspace_schemas import TripActionRequest

_LOCAL = ZoneInfo("Asia/Tashkent")


async def _preserve_current_documents(
    connection: AsyncConnection, storage: ObjectStorage, row: RowMapping, actor_id: UUID,
) -> None:
    for kind, key_name, hash_name in [
        ("order", "order_pdf_key", "order_pdf_sha256"),
        ("resolution", "resolved_brief_key", "resolved_brief_sha256"),
        ("brief", "signed_brief_key", "signed_brief_sha256"),
    ]:
        key = row.get(key_name)
        if not key:
            continue
        await _verified(storage, key, row[hash_name])
        # Signed DOCX/image sources remain available through the original
        # attachment. This PDF history must not mislabel those bytes as a PDF.
        if kind == "brief" and row.get("original_signature_confirmed_at") \
                and row.get("brief_attachment_type") != "application/pdf":
            continue
        recorded = await connection.scalar(select(trip_document_revisions.c.id).where(
            trip_document_revisions.c.request_id == row["id"],
            trip_document_revisions.c.storage_key == key,
        ))
        if recorded is not None:
            continue
        issued = row.get("order_issued_at")
        await connection.execute(insert(trip_document_revisions).values(
            id=uuid4(), request_id=row["id"], actor_user_id=actor_id, kind=kind,
            storage_key=key, sha256=row[hash_name], created_at=datetime.now(UTC),
            facts={"number": row["order_number"] or "", "series": row["order_series"] or "",
                   "issued": issued.astimezone(_LOCAL).date().isoformat() if issued else "",
                   "preservedOriginal": True},
        ))


async def _resolution(
    connection: AsyncConnection, storage: ObjectStorage, row: RowMapping, user: AuthenticatedUser,
) -> dict[str, object]:
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
    # Existing HR decisions retain their frozen trip facts. Legacy orders have
    # no snapshot; capture their unchanged travel details at the new decision.
    facts = TripDocumentSnapshot.model_validate(row["resolution_snapshot"]) \
        if row.get("resolution_snapshot") else await live_snapshot(connection, row["id"])
    facts.chair = user.full_name
    facts.signature_key = f"trip-requests/{row['id']}/resolution-signatures/{uuid4()}.png"
    facts.signature_sha256 = hashlib.sha256(image).hexdigest()
    await storage.put(facts.signature_key, image, "image/png")
    original_pdf = None
    if facts.source_brief_key and facts.original_name and row["brief_attachment_type"] != (
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    ):
        source = await _verified(storage, facts.source_brief_key, facts.source_brief_sha256)
        original_pdf, _ = await run_in_threadpool(application_pdf, source)
    content = await run_in_threadpool(hr_brief_pdf, facts, image, original_pdf)
    key, digest = await _archive(
        connection, storage, request_id=row["id"], user_id=user.id, kind="resolution",
        content=content, facts=facts.model_dump(mode="json"),
    )
    return {"facts": facts.model_dump(mode="json"), "resolutionKey": key,
            "resolutionSha256": digest, "hrUserId": str(hr_id), "chairUserId": str(user.id),
            "resolutionAt": datetime.now(UTC).isoformat()}


def _same_order(row: RowMapping, payload: TripActionRequest) -> bool:
    return (row["order_number"], row["order_series"], row["order_purpose"]) == (
        payload.order_number, payload.order_series, payload.order_purpose,
    ) and (payload.order_date is None or (
        row["order_issued_at"].astimezone(_LOCAL).date() == payload.order_date
    ))


async def act_on_order_revision(
    connection: AsyncConnection, user: AuthenticatedUser, storage: ObjectStorage,
    request_id: UUID, payload: TripActionRequest,
) -> None:
    row = await _row(connection, request_id, lock=True)
    if row["status"] != "approved":
        raise Error(409, "Переоформлять можно только документы утверждённой поездки")
    chair_id = await connection.scalar(select(hr_settings.c.chair_user_id).where(
        hr_settings.c.id == 1,
    ))
    hr_id = await connection.scalar(select(hr_settings.c.hr_user_id).where(hr_settings.c.id == 1))
    stage = row.get("order_revision_stage")
    snapshot = dict(row.get("order_revision_snapshot") or {})
    action = payload.action
    # Retries after a successful response loss must not create another PDF,
    # reserve another number, or append another audit decision.
    if action == "revise_order" and stage in {"chair", "hr"} \
            and snapshot.get("requestedBy") == str(user.id) \
            and snapshot.get("reason") == payload.comment.strip():
        return
    if action == "approve_revision" and stage == "hr" and user.id == chair_id \
            and snapshot.get("chairUserId") == str(user.id):
        return
    if action == "complete_revision" and stage is None \
            and snapshot.get("completedBy") == str(user.id):
        if _same_order(row, payload):
            return
        raise Error(409, "Приказ уже переоформлен; реквизиты отличаются")
    if action == "cancel_revision" and stage is None \
            and snapshot.get("cancelledBy") == str(user.id):
        return
    if action not in order_revision_actions(row, user, chair_id, hr_id):
        raise Error(403, "Действие переоформления недоступно этому сотруднику или этапу")
    if action == "update_order_details":
        from .trip_order_details_service import update_order_details

        comment = await update_order_details(connection, user, storage, row, payload)
        if comment is not None:
            await connection.execute(insert(trip_request_actions).values(
                id=uuid4(), request_id=request_id, actor_user_id=user.id, from_stage="approved",
                to_stage="approved", action=action, comment=comment, created_at=datetime.now(UTC),
            ))
        return
    values: dict[str, object] = {"updated_at": datetime.now(UTC)}
    if action == "revise_order":
        await _preserve_current_documents(connection, storage, row, user.id)
        values.update(order_revision_stage="chair", order_revision_snapshot={
            "requestedBy": str(user.id), "reason": payload.comment.strip(),
        })
        comment = payload.comment.strip()
    elif action == "approve_revision":
        snapshot.update(await _resolution(connection, storage, row, user))
        values.update(order_revision_stage="hr", order_revision_snapshot=snapshot)
        comment = "Поставлена новая резолюция; приказ передан кадровику"
    elif action == "cancel_revision":
        values.update(order_revision_stage=None, order_revision_snapshot={
            "cancelledBy": str(user.id),
        })
        comment = payload.comment.strip()
    else:
        facts = TripDocumentSnapshot.model_validate(snapshot["facts"])
        await _verified(storage, str(snapshot["resolutionKey"]), str(snapshot["resolutionSha256"]))
        image = await _verified(storage, facts.signature_key, facts.signature_sha256)
        issued = datetime.combine(payload.order_date, time.min, tzinfo=_LOCAL) \
            if payload.order_date else datetime.now(_LOCAL)
        await reserve_order_number(
            connection, request_id, year=issued.year,
            number=payload.order_number, series=payload.order_series,
        )
        content = await run_in_threadpool(
            hr_order_pdf, facts, number=payload.order_number, series=payload.order_series,
            purpose=payload.order_purpose or facts.purpose, issued=issued.date(), signature=image,
        )
        key, digest = await _archive(
            connection, storage, request_id=request_id, user_id=user.id, kind="order",
            content=content, facts={"number": payload.order_number, "series": payload.order_series,
                                  "purpose": payload.order_purpose,
                                  "issued": issued.date().isoformat(),
                                  "replaces": row["order_pdf_key"]},
        )
        values.update(
            order_pdf_key=key, order_pdf_sha256=digest, order_number=payload.order_number,
            order_series=payload.order_series, order_year=issued.year, order_sequence=None,
            order_purpose=payload.order_purpose, order_issued_at=issued.astimezone(UTC),
            order_signer_user_id=UUID(str(snapshot["chairUserId"])), order_manually_registered=True,
            hr_processor_user_id=user.id, resolved_brief_key=snapshot["resolutionKey"],
            resolved_brief_sha256=snapshot["resolutionSha256"],
            resolution_snapshot=snapshot["facts"],
            resolution_actor_user_id=UUID(str(snapshot["chairUserId"])),
            resolution_at=datetime.fromisoformat(str(snapshot["resolutionAt"])),
            order_revision_stage=None, order_revision_snapshot={"completedBy": str(user.id)},
        )
        comment = f"Переоформлен приказ № {payload.order_number} {payload.order_series}"
    # No stage/status/finished_at changes, availability checks, calendar calls,
    # or replay of trip approval side effects belong in document correction.
    await connection.execute(update(trip_requests).where(trip_requests.c.id == request_id).values(
        **values,
    ))
    await connection.execute(insert(trip_request_actions).values(
        id=uuid4(), request_id=request_id, actor_user_id=user.id, from_stage="approved",
        to_stage="approved", action=action, comment=comment, created_at=datetime.now(UTC),
    ))
