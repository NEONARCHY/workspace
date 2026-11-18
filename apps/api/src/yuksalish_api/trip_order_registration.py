"""Permanent reservation of manual order numbers, including previous PDF versions."""

from datetime import UTC, datetime
from uuid import UUID, uuid4

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncConnection

from .errors import WorkspaceRepositoryError
from .tables import trip_order_registrations


async def reserve_order_number(
    connection: AsyncConnection, request_id: UUID, *, year: int, number: str, series: str,
) -> None:
    # ON CONFLICT waits for a concurrent registration to commit before the owner
    # is read. The unique expression index protects case and whitespace variants.
    await connection.execute(insert(trip_order_registrations).values(
        id=uuid4(), request_id=request_id, order_year=year, order_number=number,
        order_series=series, created_at=datetime.now(UTC),
    ).on_conflict_do_nothing())
    owner = await connection.scalar(select(trip_order_registrations.c.request_id).where(
        trip_order_registrations.c.order_year == year,
        func.lower(func.btrim(trip_order_registrations.c.order_number)) == number.lower(),
        func.lower(func.btrim(trip_order_registrations.c.order_series)) == series.lower(),
    ))
    if owner != request_id:
        raise WorkspaceRepositoryError(
            409, "Номер и серия приказа уже зарегистрированы в этом году",
        )
