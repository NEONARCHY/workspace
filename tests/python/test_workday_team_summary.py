from datetime import UTC, datetime
from typing import Any
from uuid import uuid4

import pytest

from yuksalish_api import workday_service
from yuksalish_api.auth import AuthenticatedUser
from yuksalish_api.position_policy import EXECUTIVE_LEADER_POSITION_NAME


class _Rows:
    def __init__(self, rows: list[dict[str, Any]]) -> None:
        self.rows = rows

    def mappings(self) -> "_Rows":
        return self

    def all(self) -> list[dict[str, Any]]:
        return self.rows


@pytest.mark.anyio
async def test_team_summary_marks_approved_leave_and_trip() -> None:
    leave_user, trip_user = uuid4(), uuid4()

    class Connection:
        def __init__(self) -> None:
            self.calls = 0

        async def execute(self, _statement: Any) -> Any:
            self.calls += 1
            user_id = leave_user if self.calls == 1 else trip_user

            class Result:
                def all(self) -> list[tuple[Any]]:
                    return [(user_id,)]

            return Result()

    connection = Connection()
    statuses = await workday_service._team_leave_and_trip(
        connection, [leave_user, trip_user], datetime(2026, 10, 17, 9, tzinfo=UTC),
    )
    assert statuses == {leave_user: "vacation", trip_user: "trip"}
    assert connection.calls == 2


@pytest.mark.anyio
async def test_chairman_sees_all_active_presence_without_schedule_edit_rights(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    manager_id, chairman_id, employee_id = uuid4(), uuid4(), uuid4()
    rows = [
        {"id": user_id, "full_name": name, "job_title": title,
         "avatar_updated_at": None, "direct_manager_user_id": direct_manager}
        for user_id, name, title, direct_manager in (
            (manager_id, "Manager", None, None),
            (chairman_id, "Chairman", EXECUTIVE_LEADER_POSITION_NAME, None),
            (employee_id, "Employee", None, manager_id),
        )
    ]

    class Connection:
        async def execute(self, statement: Any) -> _Rows:
            if "direct_manager_user_id =" in str(statement):
                return _Rows([rows[0], rows[2]])
            return _Rows(rows)

    async def today_data(*_args: Any) -> tuple[dict[Any, Any], dict[Any, Any], dict[Any, Any]]:
        return {}, {}, {}

    async def leave_and_trip(*_args: Any) -> dict[Any, Any]:
        return {}

    monkeypatch.setattr(workday_service, "_today_data", today_data)
    monkeypatch.setattr(workday_service, "_team_leave_and_trip", leave_and_trip)
    now = datetime(2026, 10, 17, 9, tzinfo=UTC)
    manager = AuthenticatedUser(
        id=manager_id, username="manager", full_name="Manager", position_id=None,
        job_title=None, role="manager",
    )
    chairman = AuthenticatedUser(
        id=chairman_id, username="chairman", full_name="Chairman", position_id=None,
        job_title=EXECUTIVE_LEADER_POSITION_NAME, role="manager",
    )
    connection = Connection()
    manager_team = await workday_service.load_team(
        connection, manager, can_edit_schedules=True, now=now,  # type: ignore[arg-type]
    )
    chairman_team = await workday_service.load_team(
        connection, chairman, can_edit_schedules=True, now=now,  # type: ignore[arg-type]
    )
    assert {member.user_id for member in manager_team.members} == {manager_id, employee_id}
    assert {member.user_id for member in chairman_team.members} == {
        manager_id, chairman_id, employee_id,
    }
    assert not next(
        member for member in chairman_team.members if member.user_id == employee_id
    ).can_edit_schedule
