from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock
from uuid import uuid4

import pytest
from fastapi import HTTPException
from starlette.requests import Request

from yuksalish_api.auth import AuthenticatedUser
from yuksalish_api.errors import WorkspaceRepositoryError
from yuksalish_api.routers import workspace
from yuksalish_api.workspace_schemas import TripActionRequest


@pytest.mark.anyio
@pytest.mark.parametrize("fails", [False, True])
async def test_trip_decision_is_committed_before_clients_can_refresh(
    monkeypatch: pytest.MonkeyPatch, fails: bool,
) -> None:
    user = AuthenticatedUser(
        id=uuid4(), username="chair", full_name="Chair", role="manager",
        position_id=None, job_title=None,
    )
    connection = AsyncMock()
    route = Mock()
    route.mappings.return_value.first.return_value = {
        "workflow_version": 3, "stage": "manager_approval", "hr_processing_required": False,
    }
    connection.execute.return_value = route
    order: list[str] = []

    async def commit() -> None:
        order.append("commit")

    async def publish(event: dict[str, str]) -> None:
        assert order == ["commit"]
        assert event["type"] == "trip.updated"
        order.append("publish")

    connection.commit.side_effect = commit
    bus = SimpleNamespace(publish=AsyncMock(side_effect=publish))
    request = Request({"type": "http", "app": SimpleNamespace(state=SimpleNamespace())})
    monkeypatch.setattr(workspace, "ensure_module_action", AsyncMock())
    monkeypatch.setattr(workspace, "_object_storage", lambda _: object())
    monkeypatch.setattr(workspace, "_event_bus", lambda _: bus)
    monkeypatch.setattr(workspace, "issue_order", AsyncMock())
    result = SimpleNamespace(id=str(uuid4()))
    action = AsyncMock(return_value=result)
    if fails:
        action.side_effect = WorkspaceRepositoryError(409, "Decision conflict")
    monkeypatch.setattr(workspace, "act_on_trip_request", action)
    if fails:
        with pytest.raises(HTTPException) as conflict:
            await workspace.post_trip_action(
                uuid4(), TripActionRequest(action="approve"), request, user, connection,
            )
        assert conflict.value.status_code == 409
        connection.commit.assert_not_awaited()
        bus.publish.assert_not_awaited()
    else:
        assert await workspace.post_trip_action(
            uuid4(), TripActionRequest(action="approve"), request, user, connection,
        ) == result
        assert order == ["commit", "publish"]


@pytest.mark.anyio
@pytest.mark.parametrize("action,stage,service_name", [
    ("approve", "manager_approval", "apply_resolution"),
    ("complete", "hr", "complete_order"),
])
@pytest.mark.parametrize("fails", [False, True])
async def test_hr_route_uses_the_protected_service_and_commits_only_success(
    monkeypatch, action, stage, service_name, fails,
):
    user = AuthenticatedUser(uuid4(), "actor", "Actor", None, None, "employee")
    request_id = uuid4()
    connection = AsyncMock()
    route = Mock()
    route.mappings.return_value.first.return_value = {
        "workflow_version": 1, "hr_processing_required": True, "stage": stage,
    }
    connection.execute.return_value = route
    service = AsyncMock(side_effect=WorkspaceRepositoryError(403, "Denied") if fails else None)
    result = SimpleNamespace(id=str(request_id))
    transition = AsyncMock(return_value=result)
    bus = SimpleNamespace(publish=AsyncMock())
    monkeypatch.setattr(workspace, "ensure_module_action", AsyncMock())
    monkeypatch.setattr(workspace, service_name, service)
    monkeypatch.setattr(workspace, "act_on_trip_request", transition)
    monkeypatch.setattr(workspace, "_object_storage", lambda _: object())
    monkeypatch.setattr(workspace, "_event_bus", lambda _: bus)
    payload = TripActionRequest(action=action, **(
        {"order_number": "29", "order_series": "a/f"} if action == "complete" else {}
    ))
    request = Request({"type": "http"})
    if fails:
        with pytest.raises(HTTPException) as error:
            await workspace.post_trip_action(request_id, payload, request, user, connection)
        assert error.value.status_code == 403
        transition.assert_not_awaited()
        connection.commit.assert_not_awaited()
        bus.publish.assert_not_awaited()
    else:
        response = await workspace.post_trip_action(request_id, payload, request, user, connection)
        assert response == result
        service.assert_awaited_once()
        transition.assert_awaited_once_with(connection, user, request_id, payload)
        connection.commit.assert_awaited_once()
        bus.publish.assert_awaited_once_with({"type": "trip.updated", "entityId": str(request_id)})
