from uuid import uuid4

import pytest

from yuksalish_api.access_control import (
    MODULE_ACTIONS,
    module_permissions_for_user,
    normalize_permissions,
    request_module_action,
)
from yuksalish_api.auth import AuthenticatedUser
from yuksalish_api.repository import _can_act_from_config


def test_permission_normalization_preserves_safe_dependencies() -> None:
    assert normalize_permissions(
        {"view": False, "create": True, "edit": False, "approve": False, "admin": False}
    ) == {
        "view": True,
        "create": True,
        "edit": False,
        "approve": False,
        "admin": False,
    }
    assert all(
        normalize_permissions(
            {"view": False, "create": False, "edit": False, "approve": False, "admin": True}
        ).values()
    )
    assert not any(normalize_permissions({}).values())


def test_request_paths_map_to_server_enforced_module_actions() -> None:
    assert request_module_action("/api/v1/workspace/bootstrap", "GET") is None
    assert request_module_action("/api/v1/directory", "GET") == ("employees", "view")
    assert request_module_action("/api/v1/members", "GET") == ("members", "view")
    assert request_module_action("/api/v1/directory/departments", "POST") == (
        "employees",
        "admin",
    )
    assert request_module_action("/api/v1/tasks", "POST") == ("tasks", "create")
    assert request_module_action("/api/v1/efficiency", "GET") == ("team_overview", "view")
    assert request_module_action("/api/v1/tasks/task-id", "PATCH") == ("tasks", "edit")
    assert request_module_action(
        "/api/v1/approval-requests/request-id/actions", "POST"
    ) == ("payment_requests", "view")
    assert request_module_action("/api/v1/tasks/id/accept-result", "POST") == (
        "tasks",
        "approve",
    )
    assert request_module_action("/api/v1/auth/invitations", "POST") == (
        "employees",
        "admin",
    )
    assert request_module_action("/api/v1/approval-templates/id/publish", "POST") == (
        "payment_requests",
        "admin",
    )
    assert request_module_action("/api/v1/zoom-meetings", "GET") == ("zoom_meetings", "view")
    assert request_module_action("/api/v1/zoom-meetings/availability", "GET") == (
        "zoom_meetings",
        "view",
    )
    assert request_module_action("/api/v1/zoom-meetings", "POST") == ("zoom_meetings", "create")
    assert request_module_action("/api/v1/ai-referent/letters", "GET") == (
        "ai_referent",
        "view",
    )
    assert request_module_action("/api/v1/ai-referent/letters", "POST") == (
        "ai_referent",
        "create",
    )
    assert request_module_action(
        "/api/v1/ai-referent/letters/letter-id/actions", "POST"
    ) == ("ai_referent", "view")
    assert request_module_action("/api/v1/zoom-meetings/meeting-id/cancel", "POST") == (
        "zoom_meetings",
        "edit",
    )


@pytest.mark.anyio
async def test_admin_cannot_be_restricted_by_module_overrides() -> None:
    admin = AuthenticatedUser(
        id=uuid4(), username="admin", full_name="Admin", position_id=None,
        job_title=None, role="admin",
    )
    permissions = await module_permissions_for_user(object(), admin)  # type: ignore[arg-type]
    assert permissions
    assert all(all(rule[action] for action in MODULE_ACTIONS) for rule in permissions.values())


def test_admin_can_act_on_any_configured_approval_stage() -> None:
    admin = AuthenticatedUser(
        id=uuid4(), username="admin", full_name="Admin", position_id=None,
        job_title=None, role="admin",
    )
    assert _can_act_from_config(
        admin,
        {"actor_overrides": {"finance": str(uuid4())}},
        "finance",
        {"approverUserId": str(uuid4())},
    )
