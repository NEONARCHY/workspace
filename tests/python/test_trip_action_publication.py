from types import SimpleNamespace
from unittest.mock import AsyncMock
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
    connection.scalar.side_effect = [3, "manager_approval"]
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
