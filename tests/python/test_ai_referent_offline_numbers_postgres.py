"""Reserved blocks and online allocations must share the same atomic counter."""

import os
from datetime import UTC, datetime
from uuid import uuid4

import pytest
from sqlalchemy import delete, update
from sqlalchemy.ext.asyncio import create_async_engine

from yuksalish_api.ai_referent_authority import start_authority
from yuksalish_api.ai_referent_offline_numbers import reserve_offline_numbers
from yuksalish_api.ai_referent_service import AIReferentServiceError, _reserve_number
from yuksalish_api.tables import ai_referent_authority, ai_referent_configuration


@pytest.mark.anyio
@pytest.mark.postgres
async def test_reserved_block_is_idempotent_and_not_used_by_online_numbering():
    url = os.environ.get("YUKSALISH_TEST_DATABASE_URL")
    if not url:
        pytest.skip("YUKSALISH_TEST_DATABASE_URL is not configured")
    engine = create_async_engine(url)
    agent_id = f"offline-reservation-{uuid4().hex}"
    reservation_id = uuid4()
    try:
        async with engine.connect() as connection:
            transaction = await connection.begin()
            try:
                await connection.execute(delete(ai_referent_authority))
                await connection.execute(
                    update(ai_referent_configuration).values(execution_agent_id=agent_id)
                )
                epoch = (await start_authority(
                    connection, agent_id=agent_id, enabled=True
                )).epoch
                reserved = await reserve_offline_numbers(
                    connection, agent_id=agent_id, epoch=epoch,
                    reservation_id=reservation_id, count=3, enabled=True,
                )
                assert reserved.first_number + 2 == reserved.last_number
                assert reserved.year_suffix == datetime.now(UTC).strftime("%y")
                repeated = await reserve_offline_numbers(
                    connection, agent_id=agent_id, epoch=epoch,
                    reservation_id=reservation_id, count=3, enabled=True,
                )
                assert repeated == reserved
                with pytest.raises(AIReferentServiceError) as wrong_agent:
                    await reserve_offline_numbers(
                        connection, agent_id="other-pc", epoch=epoch,
                        reservation_id=uuid4(), count=3, enabled=True,
                    )
                assert wrong_agent.value.status_code == 409
                with pytest.raises(AIReferentServiceError) as wrong_count:
                    await reserve_offline_numbers(
                        connection, agent_id=agent_id, epoch=epoch,
                        reservation_id=reservation_id, count=2, enabled=True,
                    )
                assert wrong_count.value.status_code == 409
                await connection.execute(
                    update(ai_referent_authority).values(mode="replay_required")
                )
                assert await reserve_offline_numbers(
                    connection, agent_id=agent_id, epoch=epoch,
                    reservation_id=reservation_id, count=3, enabled=True,
                ) == reserved
                with pytest.raises(AIReferentServiceError) as blocked:
                    await reserve_offline_numbers(
                        connection, agent_id=agent_id, epoch=epoch,
                        reservation_id=uuid4(), count=3, enabled=True,
                    )
                assert blocked.value.status_code == 503
                online_number, online_year = await _reserve_number(connection)
                assert online_year == reserved.year_suffix
                assert online_number > reserved.last_number
            finally:
                await transaction.rollback()
    finally:
        await engine.dispose()
