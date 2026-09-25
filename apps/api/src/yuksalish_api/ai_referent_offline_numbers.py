"""Atomically reserve outgoing numbers for the single assigned Referent agent.

Reservations are never reclaimed: an offline client may have already printed or
sent a letter with a number even if its acknowledgement was lost.
"""

# ruff: noqa: RUF001

from datetime import UTC, datetime
from uuid import UUID, uuid4

from sqlalchemy import func, insert, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncConnection

from .ai_referent_schemas import OfflineNumberReservationResponse
from .ai_referent_service import AIReferentServiceError
from .tables import (
    ai_referent_configuration,
    ai_referent_letters,
    ai_referent_number_counters,
    ai_referent_offline_number_reservations,
    audit_events,
)


async def reserve_offline_numbers(
    connection: AsyncConnection, *, agent_id: str, reservation_id: UUID, count: int
) -> OfflineNumberReservationResponse:
    """Reserve an idempotent range that ordinary numbering can never allocate."""
    if not 1 <= count <= 20:
        raise AIReferentServiceError(422, "Укажите от 1 до 20 номеров в одном резерве.")
    # Serialize duplicate requests and reassignment of the physical execution agent.
    assigned = await connection.scalar(
        select(ai_referent_configuration.c.execution_agent_id).with_for_update()
    )
    if assigned != agent_id:
        raise AIReferentServiceError(409, "Этот компьютер не назначен агентом отправки.")
    previous = (
        await connection.execute(
            select(ai_referent_offline_number_reservations).where(
                ai_referent_offline_number_reservations.c.id == reservation_id
            )
        )
    ).mappings().first()
    if previous is not None:
        if previous["agent_id"] != agent_id or (
            previous["last_number"] - previous["first_number"] + 1
        ) != count:
            raise AIReferentServiceError(409, "Запрос резерва уже использован с другими данными.")
        return OfflineNumberReservationResponse(
            reservation_id=reservation_id,
            agent_id=agent_id,
            year_suffix=previous["year_suffix"],
            first_number=previous["first_number"],
            last_number=previous["last_number"],
            valid_until=previous["valid_until"],
        )
    now = datetime.now(UTC)
    year_suffix = now.strftime("%y")
    maximum = await connection.scalar(
        select(func.max(ai_referent_letters.c.outgoing_number)).where(
            ai_referent_letters.c.year_suffix == year_suffix
        )
    )
    first_end = int(maximum or 0) + count
    statement = (
        pg_insert(ai_referent_number_counters)
        .values(year_suffix=year_suffix, last_number=first_end, updated_at=now)
        .on_conflict_do_update(
            index_elements=[ai_referent_number_counters.c.year_suffix],
            set_={
                "last_number": func.greatest(
                    ai_referent_number_counters.c.last_number + count, first_end
                ),
                "updated_at": now,
            },
        )
        .returning(ai_referent_number_counters.c.last_number)
    )
    last_number = await connection.scalar(statement)
    if last_number is None or int(last_number) > 99999999:
        raise AIReferentServiceError(409, "Резерв исходящих номеров исчерпан.")
    first_number = int(last_number) - count + 1
    valid_until = datetime(now.year + 1, 1, 1, tzinfo=UTC)
    await connection.execute(
        insert(ai_referent_offline_number_reservations).values(
            id=reservation_id,
            agent_id=agent_id,
            year_suffix=year_suffix,
            first_number=first_number,
            last_number=last_number,
            valid_until=valid_until,
            created_at=now,
        )
    )
    await connection.execute(
        insert(audit_events).values(
            id=uuid4(),
            actor_user_id=None,
            action="ai_referent.offline_numbers_reserved",
            target_type="ai_referent_reservation",
            target_id=reservation_id,
            details={
                "agentId": agent_id,
                "yearSuffix": year_suffix,
                "firstNumber": first_number,
                "lastNumber": int(last_number),
            },
            created_at=now,
        )
    )
    return OfflineNumberReservationResponse(
        reservation_id=reservation_id,
        agent_id=agent_id,
        year_suffix=year_suffix,
        first_number=first_number,
        last_number=int(last_number),
        valid_until=valid_until,
    )
