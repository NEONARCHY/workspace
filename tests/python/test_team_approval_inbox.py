import asyncio
from dataclasses import replace
from datetime import date
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest
from fastapi import HTTPException
from sqlalchemy.dialects import postgresql

from yuksalish_api import team_approval_inbox as service
from yuksalish_api.access_control import request_module_action
from yuksalish_api.auth import AuthenticatedUser


@pytest.fixture
def scenario(monkeypatch):
    user = AuthenticatedUser(
        id=uuid4(), username="deputy", full_name="Тестовый заместитель",
        position_id=None, job_title=None, role="manager",
    )
    connection = MagicMock()
    connection.execute = AsyncMock(return_value=MagicMock())
    permissions = AsyncMock(return_value={
        "trip_approvals": {"view": True, "approve": True},
        "leave_approvals": {"view": True, "approve": True},
    })
    monkeypatch.setattr(service, "ensure_module_action", AsyncMock())
    monkeypatch.setattr(service, "module_permissions_for_user", permissions)
    monkeypatch.setattr(service, "_trip_directory_deputy_id", AsyncMock(return_value=user.id))
    monkeypatch.setattr(service, "_trip_deputy_user_id", AsyncMock(return_value=user.id))
    monkeypatch.setattr(service, "_reviewers", AsyncMock(return_value=(uuid4(), user.id)))
    connection.execute.return_value.mappings.return_value.all.return_value = []
    return connection, user, permissions


def test_team_inbox_uses_team_permission_not_personal_home():
    assert request_module_action("/api/v1/home/approval-inbox/trips", "GET") == (
        "team_overview", "view",
    )


@pytest.mark.parametrize("kind", ["trips", "leaves"])
@pytest.mark.parametrize("role", ["employee", "hr"])
def test_non_managers_are_denied(scenario, kind, role):
    connection, user, _ = scenario
    with pytest.raises(HTTPException) as error:
        asyncio.run(service.team_approval_inbox(connection, replace(user, role=role), kind))
    assert error.value.status_code == 403
    connection.execute.assert_not_called()


@pytest.mark.parametrize("kind", ["trips", "leaves"])
@pytest.mark.parametrize("action", ["view", "approve"])
def test_denied_module_does_not_query_records(scenario, kind, action):
    connection, user, permissions = scenario
    module = "trip_approvals" if kind == "trips" else "leave_approvals"
    permissions.return_value[module][action] = False
    inbox = asyncio.run(service.team_approval_inbox(connection, user, kind))
    assert inbox.model_dump() == {"enabled": False, "items": []}
    connection.execute.assert_not_called()


def test_leave_queue_excludes_hr_and_completed_and_returns_minimal_metadata(scenario):
    connection, user, _ = scenario
    item_id = uuid4()
    connection.execute.return_value.mappings.return_value.all.return_value = [{
        "id": item_id, "full_name": "Тестовый сотрудник", "starts_on": date(2026, 11, 1),
        "ends_on": date(2026, 11, 10),
    }]
    inbox = asyncio.run(service.team_approval_inbox(connection, user, "leaves"))
    assert inbox.enabled and inbox.items[0].id == str(item_id)
    assert inbox.items[0].model_dump(by_alias=True, mode="json") == {
        "id": str(item_id), "title": "Заявление на отпуск", "requesterName": "Тестовый сотрудник",
        "startsOn": "2026-11-01", "endsOn": "2026-11-10",
    }
    query = connection.execute.call_args.args[0].compile(dialect=postgresql.dialect())
    assert "pending_deputy" in query.params.values()
    assert "application_text" not in str(query)


@pytest.mark.parametrize("role", ["manager", "admin", "superadmin"])
def test_other_users_do_not_receive_deputy_leave_queue(scenario, monkeypatch, role):
    connection, user, _ = scenario
    monkeypatch.setattr(service, "_trip_directory_deputy_id", AsyncMock(return_value=uuid4()))
    inbox = asyncio.run(service.team_approval_inbox(connection, replace(user, role=role), "leaves"))
    assert not inbox.enabled and not inbox.items
    connection.execute.assert_not_called()


def test_trips_use_pinned_actor_and_existing_action_guard(scenario, monkeypatch):
    connection, user, _ = scenario
    other_id = uuid4()
    monkeypatch.setattr(service, "_trip_directory_deputy_id", AsyncMock(return_value=other_id))
    monkeypatch.setattr(service, "_trip_deputy_user_id", AsyncMock(return_value=other_id))
    row = {
        "id": uuid4(), "requester_user_id": uuid4(), "destination": "Тестовый город",
        "full_name": "Сотрудник", "start_date": date(2026, 11, 1),
        "end_date": date(2026, 11, 2), "workflow_version": 3,
        "deputy_approver_user_id": user.id, "order_pdf_key": None,
        "stage": "deputy_approval", "status": "running",
    }
    connection.execute.return_value.mappings.return_value.all.return_value = [
        row, {**row, "id": uuid4(), "deputy_approver_user_id": other_id},
    ]
    inbox = asyncio.run(service.team_approval_inbox(connection, user, "trips"))
    assert inbox.enabled and [item.id for item in inbox.items] == [str(row["id"])]
    query = connection.execute.call_args.args[0].compile(dialect=postgresql.dialect())
    assert "deputy_approval" in query.params.values()
    assert "running" in query.params.values()
    assert "deleted_at IS NULL" in str(query)
    assert user.id in query.params.values()
    assert "brief_text" not in str(query)


def test_configured_deputy_sees_empty_trip_queue(scenario):
    connection, user, _ = scenario
    inbox = asyncio.run(service.team_approval_inbox(connection, user, "trips"))
    assert inbox.enabled and inbox.items == []


def test_changed_leave_assignment_is_rechecked_before_reading(scenario, monkeypatch):
    connection, user, _ = scenario
    monkeypatch.setattr(service, "_reviewers", AsyncMock(return_value=(uuid4(), uuid4())))
    inbox = asyncio.run(service.team_approval_inbox(connection, user, "leaves"))
    assert not inbox.enabled and not inbox.items
    connection.execute.assert_not_called()


def test_http_route_authentication_contract_no_store_and_configuration_error(scenario, monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    from yuksalish_api.auth import require_user
    from yuksalish_api.database import get_connection
    from yuksalish_api.leave_service import LeaveError
    from yuksalish_api.routers import home

    connection, user, _ = scenario
    app = FastAPI()
    app.include_router(home.router, prefix="/api/v1")
    app.dependency_overrides[get_connection] = lambda: connection
    app.dependency_overrides[require_user] = lambda: user
    mock = AsyncMock(return_value=service.TeamApprovalInbox(enabled=True, items=[]))
    monkeypatch.setattr(home, "team_approval_inbox", mock)
    with TestClient(app) as client:
        response = client.get("/api/v1/home/approval-inbox/trips")
        assert response.status_code == 200
        assert response.json() == {"enabled": True, "items": []}
        assert response.headers["cache-control"] == "private, no-store"
        mock.assert_awaited_once_with(connection, user, "trips")
        assert client.get("/api/v1/home/approval-inbox/unknown").status_code == 422
        mock.side_effect = LeaveError(409, "Назначьте кадровика")
        response = client.get("/api/v1/home/approval-inbox/leaves")
        assert response.status_code == 409
        assert response.headers["cache-control"] == "private, no-store"
        app.dependency_overrides[require_user] = lambda: (_ for _ in ()).throw(HTTPException(401))
        assert client.get("/api/v1/home/approval-inbox/trips").status_code == 401
