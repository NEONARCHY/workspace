from datetime import UTC, date, datetime
from unittest.mock import AsyncMock, Mock
from uuid import uuid4

import pytest

from yuksalish_api import trip_hr_service as service
from yuksalish_api.auth import AuthenticatedUser
from yuksalish_api.errors import WorkspaceRepositoryError
from yuksalish_api.trip_hr_pdf import TripDocumentSnapshot
from yuksalish_api.workspace_schemas import TripActionRequest


class FixedClock(datetime):
    @classmethod
    def now(cls, tz=None):
        # Tashkent is already in the next year at this instant.
        return datetime(2029, 12, 31, 21, 30, tzinfo=UTC).astimezone(tz)


def setup_order(monkeypatch):
    user = AuthenticatedUser(uuid4(), "hr", "HR", None, None, "employee")
    facts = TripDocumentSnapshot(
        requester="Initiator", requester_title="Specialist", chair="Chair", brief_text="Brief",
        purpose="Purpose", destination="Samarqand", start=date(2030, 5, 1), end=date(2030, 5, 2),
        employees=[("Employee", "Specialist")], expense_source="Project",
        signature_key="signature", signature_sha256="hash",
    )
    row = {
        "hr_processing_required": True, "hr_processor_user_id": user.id, "status": "running",
        "order_pdf_key": None, "start_date": facts.start, "end_date": facts.end,
        "resolved_brief_key": "brief", "resolved_brief_sha256": "hash",
        "resolution_snapshot": facts.model_dump(mode="json"), "resolution_actor_user_id": uuid4(),
        "order_number": "29", "order_series": "a/f", "order_purpose": "Purpose",
        "order_issued_at": datetime(2029, 12, 30, 19, tzinfo=UTC),
    }
    monkeypatch.setattr(service, "datetime", FixedClock)
    monkeypatch.setattr(service, "_row", AsyncMock(return_value=row))
    monkeypatch.setattr(service, "_trip_allowed_actions", lambda *_: ["complete"])
    monkeypatch.setattr(service, "ensure_trip_available", AsyncMock())
    monkeypatch.setattr(service, "_verified", AsyncMock(return_value=b"signature"))
    renderer = Mock(return_value=b"PDF")
    monkeypatch.setattr(service, "hr_order_pdf", renderer)
    archive = AsyncMock(return_value=("order.pdf", "digest"))
    monkeypatch.setattr(service, "_archive", archive)
    connection = AsyncMock()
    connection.scalar.return_value = None
    return user, row, connection, renderer, archive


@pytest.mark.anyio
@pytest.mark.parametrize("selected,expected", [
    (date(2029, 12, 31), date(2029, 12, 31)), (None, date(2030, 1, 1)),
])
async def test_order_date_drives_pdf_archive_and_numbering_year(monkeypatch, selected, expected):
    user, _, connection, renderer, archive = setup_order(monkeypatch)
    payload = TripActionRequest(action="complete", order_number="29", order_series="a/f",
                                order_purpose="Purpose", order_date=selected)
    await service.complete_order(connection, user, AsyncMock(), uuid4(), payload)
    assert renderer.call_args.kwargs["issued"] == expected
    assert archive.call_args.kwargs["facts"]["issued"] == expected.isoformat()
    duplicate_query = connection.scalar.call_args.args[0].compile().params
    assert duplicate_query["order_year_1"] == expected.year
    stored = connection.execute.call_args.args[0].compile().params
    assert stored["order_year"] == expected.year
    assert stored["order_issued_at"].astimezone(service._LOCAL).date() == expected
    if selected is None:
        assert stored["order_issued_at"] == FixedClock.now(UTC)


@pytest.mark.anyio
async def test_backdated_order_rejects_duplicate_number_in_selected_year(monkeypatch):
    user, _, connection, renderer, archive = setup_order(monkeypatch)
    connection.scalar.return_value = uuid4()
    payload = TripActionRequest(action="complete", order_number="29", order_series="a/f",
                                order_date=date(2029, 12, 31))
    with pytest.raises(WorkspaceRepositoryError, match="уже зарегистрированы"):
        await service.complete_order(connection, user, AsyncMock(), uuid4(), payload)
    assert connection.scalar.call_args.args[0].compile().params["order_year_1"] == 2029
    renderer.assert_not_called()
    archive.assert_not_awaited()
    connection.execute.assert_not_awaited()


@pytest.mark.anyio
@pytest.mark.parametrize("selected,rejected", [
    (None, False), (date(2029, 12, 31), False), (date(2030, 1, 1), True),
])
async def test_completed_order_retry_compares_local_date_without_reissuing(
    monkeypatch, selected, rejected,
):
    user, row, connection, renderer, archive = setup_order(monkeypatch)
    row.update(status="approved", order_pdf_key="order.pdf")
    payload = TripActionRequest(action="complete", order_number="29", order_series="a/f",
                                order_purpose="Purpose", order_date=selected)
    if rejected:
        with pytest.raises(WorkspaceRepositoryError, match="реквизиты отличаются"):
            await service.complete_order(connection, user, AsyncMock(), uuid4(), payload)
    else:
        await service.complete_order(connection, user, AsyncMock(), uuid4(), payload)
    renderer.assert_not_called()
    archive.assert_not_awaited()
    connection.execute.assert_not_awaited()
