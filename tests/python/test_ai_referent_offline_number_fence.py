"""Number reservations cannot be created without a live agent epoch."""

from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest

from yuksalish_api.ai_referent_offline_numbers import reserve_offline_numbers
from yuksalish_api.ai_referent_service import AIReferentServiceError


class _Rows:
    def __init__(self, value):
        self.value = value

    def mappings(self):
        return self

    def first(self):
        return self.value


class _Connection:
    def __init__(self, authority, previous=None):
        self.authority = authority
        self.previous = previous

    async def scalar(self, _statement):
        return "referent-pc"

    async def execute(self, statement):
        query = str(statement)
        if "ai_referent_authority" in query:
            return _Rows(self.authority)
        if "ai_referent_offline_number_reservations" in query:
            return _Rows(self.previous)
        raise AssertionError(f"Unexpected database write: {query}")


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.mark.anyio
async def test_number_reservation_requires_feature_flag_and_matching_epoch():
    epoch = uuid4()
    active = {
        "agent_id": "referent-pc", "epoch": epoch, "mode": "online",
        "lease_until": datetime.now(UTC) + timedelta(seconds=30),
    }
    with pytest.raises(AIReferentServiceError) as disabled:
        await reserve_offline_numbers(
            _Connection(active), agent_id="referent-pc", epoch=epoch,
            reservation_id=uuid4(), count=1, enabled=False,
        )
    assert disabled.value.status_code == 409
    with pytest.raises(AIReferentServiceError) as stale:
        await reserve_offline_numbers(
            _Connection(active), agent_id="referent-pc", epoch=uuid4(),
            reservation_id=uuid4(), count=1, enabled=True,
        )
    assert stale.value.status_code == 409


@pytest.mark.anyio
async def test_new_reservation_is_blocked_during_replay_but_old_receipt_is_readable():
    epoch = uuid4()
    reservation_id = uuid4()
    authority = {
        "agent_id": "referent-pc", "epoch": epoch, "mode": "replay_required",
        "lease_until": datetime.now(UTC) - timedelta(seconds=1),
    }
    with pytest.raises(AIReferentServiceError) as blocked:
        await reserve_offline_numbers(
            _Connection(authority), agent_id="referent-pc", epoch=epoch,
            reservation_id=reservation_id, count=2, enabled=True,
        )
    assert blocked.value.status_code == 503
    previous = {
        "agent_id": "referent-pc", "year_suffix": "26", "first_number": 100,
        "last_number": 101, "valid_until": datetime(2027, 1, 1, tzinfo=UTC),
    }
    receipt = await reserve_offline_numbers(
        _Connection(authority, previous), agent_id="referent-pc", epoch=epoch,
        reservation_id=reservation_id, count=2, enabled=True,
    )
    assert receipt.reservation_id == reservation_id
    assert receipt.first_number == 100
    assert receipt.last_number == 101
