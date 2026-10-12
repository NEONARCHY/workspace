import asyncio
from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, Mock
from uuid import uuid4

import pytest
from pydantic import ValidationError

from yuksalish_api.errors import WorkspaceRepositoryError
from yuksalish_api.position_policy import EXECUTIVE_LEADER_POSITION_NAME
from yuksalish_api.repository import _ensure_calendar_participants_are_available
from yuksalish_api.workspace_schemas import CreateCalendarEventRequest


@pytest.mark.parametrize("color", ["#669988", "#aBcDeF", None])
def test_custom_calendar_color_and_icon(color: str | None) -> None:
    start = datetime.now(UTC)
    request = CreateCalendarEventRequest(
        title="Training", starts_at=start, ends_at=start + timedelta(hours=1),
        color=color, icon_key="training",
    )
    assert request.color == color
    assert request.icon_key == "training"


@pytest.mark.parametrize("values", [{"color": "red"}, {"color": "#abc"},
                                      {"color": "url(evil)"}, {"icon_key": "zoom"}])
def test_calendar_appearance_rejects_arbitrary_css_and_reserved_zoom(
    values: dict[str, str],
) -> None:
    start = datetime.now(UTC)
    with pytest.raises(ValidationError):
        CreateCalendarEventRequest.model_validate({
            "title": "Test", "starts_at": start, "ends_at": start + timedelta(hours=1), **values,
        })


@pytest.mark.parametrize("title,status,conflict", [
    (EXECUTIVE_LEADER_POSITION_NAME, "pending", False),
    (EXECUTIVE_LEADER_POSITION_NAME.replace("'", "\u2018"), "pending", False),
    (EXECUTIVE_LEADER_POSITION_NAME, "accepted", True),
    ("Specialist", "pending", True),
])
def test_chairman_is_reserved_only_after_acceptance(
    title: str, status: str, conflict: bool,
) -> None:
    user_id = uuid4()
    locks, bookings = Mock(), Mock()
    locks.scalars.return_value = [user_id]
    bookings.mappings.return_value.all.return_value = [{
        "full_name": "Chairman", "job_title": title, "status": status,
    }]
    connection = Mock(execute=AsyncMock(side_effect=[locks, bookings]))
    start = datetime.now(UTC)
    operation = _ensure_calendar_participants_are_available(
        connection, [user_id], starts_at=start, ends_at=start + timedelta(hours=1),
    )
    if conflict:
        with pytest.raises(WorkspaceRepositoryError) as error:
            asyncio.run(operation)
        assert error.value.status_code == 409
    else:
        asyncio.run(operation)
    assert "FOR UPDATE" in str(connection.execute.call_args_list[0].args[0])
    query = str(connection.execute.call_args_list[1].args[0])
    assert "calendar_events.starts_at <" in query
    assert "calendar_events.ends_at >" in query
