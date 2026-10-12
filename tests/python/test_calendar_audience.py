import asyncio
from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, Mock
from uuid import uuid4

import pytest
from pydantic import ValidationError
from sqlalchemy.dialects import postgresql

from yuksalish_api.auth import AuthenticatedUser
from yuksalish_api.calendar_audience import (
    calendar_audience_ids,
    can_invite_calendar_audience,
)
from yuksalish_api.errors import WorkspaceRepositoryError
from yuksalish_api.position_policy import (
    EXECUTIVE_LEADER_POSITION_NAME,
    is_executive_leader,
)
from yuksalish_api.workspace_schemas import CreateCalendarEventRequest


def actor(role: str = "employee", title: str | None = None) -> AuthenticatedUser:
    return AuthenticatedUser(uuid4(), "test", "Test", None, title, role)


@pytest.mark.parametrize(("role", "title", "allowed"), [
    ("admin", None, True),
    ("superadmin", None, True),
    ("employee", EXECUTIVE_LEADER_POSITION_NAME, True),
    ("employee", "Rais o'rinbosari", True),
    ("employee", "Rais o\u2018rinbosari", True),
    ("employee", "  RAIS O\u2019RINBOSARI  ", True),
    ("employee", "Raisning birinchi o'rinbosari", True),
    ("manager", None, False),
    ("employee", "Rais o'rinbosari yordamchisi", False),
    ("employee", None, False),
])
def test_calendar_specific_authority(role: str, title: str | None, allowed: bool) -> None:
    assert can_invite_calendar_audience(actor(role, title)) is allowed
    if title and "rinbosari" in title.casefold():
        assert not is_executive_leader(title)  # No new access to other chairman-only objects.


def test_denied_broadcast_does_not_read_the_directory() -> None:
    connection = Mock(execute=AsyncMock())
    with pytest.raises(WorkspaceRepositoryError) as failure:
        asyncio.run(calendar_audience_ids(connection, actor("manager"), "all"))
    assert failure.value.status_code == 403
    connection.execute.assert_not_awaited()


def result(rows: list[dict[str, object]]) -> Mock:
    value = Mock()
    value.mappings.return_value.all.return_value = rows
    return value


@pytest.mark.parametrize("scope", ["central", "regional"])
def test_scope_inherits_regional_ancestors_and_defaults_missing_departments_to_central(
    scope: str,
) -> None:
    central, region, child, cycle_a, cycle_b = [uuid4() for _ in range(5)]
    employees = [{"id": uuid4(), "department_id": department} for department in (
        central, region, child, None, uuid4(), cycle_a,
    )]
    connection = Mock(execute=AsyncMock(side_effect=[result(employees), result([
        {"id": central, "parent_id": None, "scope": "central"},
        {"id": region, "parent_id": None, "scope": "regional"},
        {"id": child, "parent_id": region, "scope": "central"},
        {"id": cycle_a, "parent_id": cycle_b, "scope": "central"},
        {"id": cycle_b, "parent_id": cycle_a, "scope": "central"},
    ])]))
    selected = asyncio.run(calendar_audience_ids(connection, actor("admin"), scope))
    expected_indexes = [1, 2] if scope == "regional" else [0, 3, 4, 5]
    assert selected == [employees[index]["id"] for index in expected_indexes]
    statement = connection.execute.await_args_list[0].args[0].compile(
        dialect=postgresql.dialect()
    )
    assert "core_users.status =" in str(statement)
    assert "active" in statement.params.values()
    assert "FOR UPDATE" in str(statement)


def test_all_scope_has_no_manual_wire_list_limit() -> None:
    employees = [{"id": uuid4(), "department_id": None} for _ in range(130)]
    connection = Mock(execute=AsyncMock(return_value=result(employees)))
    assert asyncio.run(calendar_audience_ids(connection, actor("admin"), "all")) == [
        row["id"] for row in employees
    ]
    connection.execute.assert_awaited_once()
    start = datetime.now(UTC) + timedelta(days=1)
    values = {"title": "All staff", "starts_at": start, "ends_at": start + timedelta(hours=1)}
    assert CreateCalendarEventRequest(**values, audience_scope="all").attendee_ids == []
    with pytest.raises(ValidationError):
        CreateCalendarEventRequest(**values, audience_scope="unknown")
    with pytest.raises(ValidationError):
        CreateCalendarEventRequest(**values, attendee_ids=[str(uuid4()) for _ in range(101)])
