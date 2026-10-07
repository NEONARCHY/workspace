from datetime import UTC, datetime, timedelta

import pytest
from pydantic import ValidationError

from yuksalish_api.workspace_schemas import (
    CreateApprovalRequest,
    CreateCalendarEventRequest,
)


def test_event_payment_requires_calendar_link() -> None:
    with pytest.raises(ValidationError, match="calendar meeting or event"):
        CreateApprovalRequest(
            title="Оплата площадки",
            amount=100,
            payment_purpose="Мероприятия",
        )
    request = CreateApprovalRequest(
        title="Оплата площадки",
        amount=100,
        payment_purpose="Мероприятия",
        calendar_event_id="event-id",
    )
    assert request.calendar_event_id == "event-id"
    assert CreateApprovalRequest(title="Обычная заявка", amount=100).calendar_event_id is None


def test_calendar_project_link_requires_direction_and_meeting_or_event() -> None:
    start = datetime.now(UTC) + timedelta(days=1)
    values = dict(
        title="Форум",
        starts_at=start,
        ends_at=start + timedelta(hours=1),
        project_id="project-id",
    )
    with pytest.raises(ValidationError, match="project direction"):
        CreateCalendarEventRequest(**values)
    with pytest.raises(ValidationError, match="Only meetings and events"):
        CreateCalendarEventRequest(
            **values, workstream_id="direction-id", event_type="task"
        )
    event = CreateCalendarEventRequest(
        **values, workstream_id="direction-id", event_type="general"
    )
    assert event.workstream_id == "direction-id"
