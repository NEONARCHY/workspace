"""HR registration of an approved order without a new chairman decision."""

from datetime import UTC, datetime, time
from zoneinfo import ZoneInfo

from sqlalchemy import update
from sqlalchemy.engine import RowMapping
from sqlalchemy.ext.asyncio import AsyncConnection
from starlette.concurrency import run_in_threadpool

from .auth import AuthenticatedUser
from .errors import WorkspaceRepositoryError as Error
from .object_storage import ObjectStorage
from .tables import trip_requests
from .trip_document_service import _verified
from .trip_hr_service import _archive
from .trip_order_details_pdf import order_details_pdf
from .trip_order_registration import reserve_order_number
from .workspace_schemas import TripActionRequest

_LOCAL = ZoneInfo("Asia/Tashkent")


async def update_order_details(
    connection: AsyncConnection, user: AuthenticatedUser, storage: ObjectStorage,
    row: RowMapping, payload: TripActionRequest,
) -> str | None:
    """Caller locks the approved trip and checks the appointed HR identity."""
    from .trip_order_revision_service import _preserve_current_documents

    old_issued = row.get("order_issued_at")
    if old_issued is None or not row.get("order_pdf_key") or not row.get("order_number"):
        raise Error(409, "Зарегистрированный приказ поездки отсутствует")
    old_date = old_issued.astimezone(_LOCAL).date()
    issued = payload.order_date or old_date
    if row.get("order_manually_registered") and not row.get("order_revision_stage") and (
        row["order_number"], row["order_series"], old_date,
    ) == (payload.order_number, payload.order_series, issued):
        return None
    original = await _verified(storage, row["order_pdf_key"], row["order_pdf_sha256"])
    try:
        content = await run_in_threadpool(
            order_details_pdf, original, old_number=row["order_number"],
            old_series=row["order_series"] or "", old_date=old_date,
            number=payload.order_number, series=payload.order_series, issued=issued,
        )
    except ValueError as error:
        raise Error(422, str(error)) from error
    await reserve_order_number(
        connection, row["id"], year=issued.year,
        number=payload.order_number, series=payload.order_series,
    )
    await _preserve_current_documents(connection, storage, row, user.id)
    key, digest = await _archive(
        connection, storage, request_id=row["id"], user_id=user.id, kind="order", content=content,
        facts={"number": payload.order_number, "series": payload.order_series,
               "issued": issued.isoformat(), "replaces": row["order_pdf_key"],
               "registrationOnly": True, "originalSignerUserId": str(row["order_signer_user_id"])},
    )
    # No signature lookup, new resolution, changed purpose, or travel transition.
    await connection.execute(update(trip_requests).where(trip_requests.c.id == row["id"]).values(
        order_number=payload.order_number, order_series=payload.order_series,
        order_year=issued.year, order_sequence=None, order_manually_registered=True,
        order_issued_at=(old_issued if issued == old_date else
                         datetime.combine(issued, time.min, tzinfo=_LOCAL).astimezone(UTC)),
        order_pdf_key=key, order_pdf_sha256=digest,
        hr_processor_user_id=user.id,
        order_revision_stage=None,
        order_revision_snapshot={"registeredBy": str(user.id),
                                 "cancelledRevisionStage": row.get("order_revision_stage")},
        updated_at=datetime.now(UTC),
    ))
    return (
        f"Кадровые реквизиты: № {row['order_number']} {row['order_series'] or ''} "
        f"от {old_date:%d.%m.%Y} → № {payload.order_number} {payload.order_series} "
        f"от {issued:%d.%m.%Y}. Прежнее согласование сохранено."
    )
