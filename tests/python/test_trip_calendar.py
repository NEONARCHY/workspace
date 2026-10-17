"""Approved trips materialize as private, official calendar entries."""

import asyncio
from datetime import UTC, date, datetime
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest
from sqlalchemy.dialects import postgresql

from yuksalish_api.auth import AuthenticatedUser
from yuksalish_api.errors import WorkspaceRepositoryError
from yuksalish_api.repository import (
    _calendar_event,
    _sync_trip_calendar_event,
    cancel_calendar_event,
    respond_to_calendar_event,
)
from yuksalish_api.workspace_schemas import RespondCalendarEventRequest


def test_approved_trip_creates_all_day_event_for_all_travelers() -> None:
    request_id, requester_id, first_id, second_id, event_id = (uuid4() for _ in range(5))
    trip = {
        "id": request_id, "requester_user_id": requester_id,
        "destination": "Самарканд", "start_date": date(2026, 10, 22),
        "end_date": date(2026, 10, 24), "order_number": "003-WS",
    }
    result = MagicMock()
    result.scalar_one.return_value = event_id
    result.scalars.return_value.all.return_value = [first_id, second_id]
    connection = AsyncMock()
    connection.execute.return_value = result
    now = datetime(2026, 10, 16, tzinfo=UTC)

    asyncio.run(_sync_trip_calendar_event(connection, trip, approved=True, now=now))

    statements = [call.args[0] for call in connection.execute.await_args_list]
    params = statements[0].compile(dialect=postgresql.dialect()).params
    assert params["trip_request_id"] == request_id
    assert params["starts_at"].isoformat() == "2026-10-22T00:00:00+05:00"
    assert params["ends_at"].isoformat() == "2026-10-25T00:00:00+05:00"
    assert params["all_day"] is True
    assert params["status"] == "scheduled"
    assert "003-WS" in params["description"]
    assert len(statements) == 5  # event, travelers, two attendance rows, stale-row cleanup
    attendees = [statement.compile(dialect=postgresql.dialect()).params
                 for statement in statements[2:4]]
    assert {attendee["user_id"] for attendee in attendees} == {first_id, second_id}
    assert all(attendee["status"] == "accepted" for attendee in attendees)


def test_annulled_trip_cancels_the_linked_calendar_event() -> None:
    request_id = uuid4()
    connection = AsyncMock()
    asyncio.run(_sync_trip_calendar_event(
        connection, {"id": request_id}, approved=False, now=datetime.now(UTC),
    ))
    statement = connection.execute.await_args.args[0]
    params = statement.compile(dialect=postgresql.dialect()).params
    assert params["status"] == "cancelled"
    assert request_id in params.values()


def test_trip_attendance_is_visible_but_cannot_be_changed_from_calendar() -> None:
    requester_id, traveler_id = uuid4(), uuid4()
    current_user = AuthenticatedUser(
        traveler_id, "traveler", "Traveler", None, None, "employee",
    )
    now = datetime.now(UTC)
    event = _calendar_event(
        {
            "id": uuid4(), "organizer_user_id": requester_id,
            "trip_request_id": uuid4(), "project_id": None, "workstream_id": None,
            "project_item_id": None, "title": "Командировка", "description": "",
            "event_type": "trip", "color": "#0091A8", "icon_key": "trip",
            "starts_at": now, "ends_at": now, "all_day": True,
            "location": "Самарканд", "status": "scheduled",
            "created_at": now, "updated_at": now,
        },
        current_user,
        [{"user_id": traveler_id, "status": "accepted", "responded_at": now}],
    )
    assert event.current_user_attendance_status == "accepted"
    assert event.can_respond is False
    assert event.can_edit is False


@pytest.mark.parametrize("action", ["cancel", "respond"])
def test_official_trip_event_rejects_calendar_mutations(action: str) -> None:
    event_id, user_id = uuid4(), uuid4()
    user = AuthenticatedUser(user_id, "traveler", "Traveler", None, None, "employee")
    result = MagicMock()
    result.mappings.return_value.first.return_value = {
        "id": event_id, "trip_request_id": uuid4(),
        "organizer_user_id": user_id if action == "cancel" else uuid4(),
        "status": "scheduled",
    }
    connection = AsyncMock()
    connection.execute.return_value = result
    with pytest.raises(WorkspaceRepositoryError) as denied:
        if action == "cancel":
            asyncio.run(cancel_calendar_event(connection, user, event_id))
        else:
            asyncio.run(respond_to_calendar_event(
                connection, user, event_id, RespondCalendarEventRequest(status="declined"),
            ))
    assert denied.value.status_code == 409
    assert connection.execute.await_count == (1 if action == "cancel" else 2)
