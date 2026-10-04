from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from yuksalish_api.auth import AuthenticatedUser
from yuksalish_api.efficiency_service import load_personal_efficiency
from yuksalish_api.workspace_schemas import PersonalEfficiencyResponse


@pytest.mark.anyio
@pytest.mark.parametrize("can_view_tasks", [True, False])
async def test_personal_summary_preserves_credit_without_leaking_inaccessible_tasks(
    monkeypatch: pytest.MonkeyPatch,
    can_view_tasks: bool,
) -> None:
    from yuksalish_api import efficiency_service

    user = AuthenticatedUser(uuid4(), "self", "Employee", None, None, "employee")
    task_id = uuid4()
    tracking = datetime(2026, 9, 1, tzinfo=UTC)
    submission = datetime(2026, 9, 5, tzinfo=UTC)
    due = datetime(2026, 9, 8, tzinfo=UTC)
    events = [
        {
            "id": uuid4(),
            "task_id": task_id,
            "event_type": "task_created",
            "occurred_at": tracking,
            "assignee_user_id": user.id,
            "due_at": due,
            "new_value": {"status": "new"},
        },
        {
            "id": uuid4(),
            "task_id": task_id,
            "event_type": "result_submitted_for_review",
            "occurred_at": submission,
            "assignee_user_id": user.id,
            "metadata": {"executorIds": [str(user.id)]},
        },
    ]
    methodology_result = MagicMock()
    methodology_result.mappings.return_value.one.return_value = {
        "tracking_started_at": tracking,
        "version": "EFF-2.0",
        "timezone": "Asia/Tashkent",
    }
    event_result = MagicMock()
    event_result.mappings.return_value.all.return_value = events
    tasks_result = MagicMock()
    tasks_result.mappings.return_value.all.return_value = []
    participant_result = MagicMock()
    participant_result.scalars.return_value.all.return_value = []
    connection = AsyncMock()
    connection.execute.side_effect = [
        methodology_result,
        event_result,
        tasks_result,
        participant_result,
    ]
    monkeypatch.setattr(
        efficiency_service,
        "module_permissions_for_user",
        AsyncMock(
            return_value={"tasks": {"view": can_view_tasks}, "team_overview": {"view": False}},
        ),
    )
    data = await load_personal_efficiency(
        connection,
        user,
        "2026-09",
        as_of=datetime(2026, 9, 10, tzinfo=UTC),
    )
    validated = PersonalEfficiencyResponse.model_validate(data)
    assert validated.employee.user_id == str(user.id)
    assert validated.employee.percentage == 100
    assert validated.employee.on_time_count == 1
    assert validated.impact_tasks == []
    assert validated.recent_tasks == []
    assert str(task_id) not in str(data)
    assert connection.execute.await_count == (4 if can_view_tasks else 2)
    if can_view_tasks:
        statement = str(connection.execute.call_args_list[2].args[0])
        assert "tasks.author_user_id" in statement
        assert "tasks.primary_assignee_user_id" in statement
        assert "tasks_participants.user_id" in statement


@pytest.mark.anyio
async def test_invalid_period_rejected_before_queries() -> None:
    connection = AsyncMock()
    user = AuthenticatedUser(uuid4(), "self", "Employee", None, None, "employee")
    with pytest.raises(ValueError):
        await load_personal_efficiency(connection, user, "2026-13")
    connection.execute.assert_not_awaited()


@pytest.mark.anyio
async def test_personal_route_requires_auth_and_never_accepts_another_user(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from yuksalish_api.access_control import request_module_action
    from yuksalish_api.auth import require_user
    from yuksalish_api.database import get_connection
    from yuksalish_api.routers import workspace

    app = FastAPI()
    app.include_router(workspace.router, prefix="/api/v1")
    connection = AsyncMock()
    app.dependency_overrides[get_connection] = lambda: connection
    service = AsyncMock(side_effect=ValueError("Invalid period"))
    monkeypatch.setattr(workspace, "load_personal_efficiency", service)
    user = AuthenticatedUser(uuid4(), "self", "Employee", None, None, "employee")
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get("/api/v1/profile/me/efficiency")
        assert response.status_code == 401
        service.assert_not_awaited()
        app.dependency_overrides[require_user] = lambda: user
        response = await client.get(
            "/api/v1/profile/me/efficiency", params={"period": "2026-09", "userId": str(uuid4())}
        )
        assert response.status_code == 422
        service.assert_awaited_once_with(connection, user, "2026-09")
        response = await client.get("/api/v1/profile/me/efficiency", params={"period": "bad"})
        assert response.status_code == 422
        assert service.await_count == 1
    assert request_module_action("/api/v1/profile/me/efficiency", "GET") is None
    assert request_module_action("/api/v1/efficiency", "GET") == ("team_overview", "view")
