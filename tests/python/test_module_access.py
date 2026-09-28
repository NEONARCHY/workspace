from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock
from uuid import uuid4

import pytest
import sqlalchemy as sa
from fastapi import HTTPException

from yuksalish_api.access_control import (
    MODULE_ACTIONS,
    ensure_request_module_access,
    module_permissions_for_user,
    normalize_permissions,
    request_module_action,
)
from yuksalish_api.auth import AuthenticatedUser
from yuksalish_api.directory_service import DirectoryServiceError, set_regional_assistant_access
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
    assert request_module_action("/api/v1/assistant/messages", "GET") == (
        "assistant", "view"
    )
    assert request_module_action("/api/v1/assistant/transcribe", "POST") == (
        "assistant", "view"
    )
    assert request_module_action("/api/v1/assistant/rewrite", "POST") == (
        "assistant", "view"
    )
    assert request_module_action("/api/v1/assistant/birthday", "GET") is None
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
async def test_assistant_switch_blocks_reads_and_writes_but_allows_enabled_user(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = AuthenticatedUser(uuid4(), "staff", "Staff", None, None, "employee")
    permissions = AsyncMock(return_value={"assistant": {"view": False}})
    monkeypatch.setattr(
        "yuksalish_api.access_control.module_permissions_for_user", permissions
    )
    for path, method in (
        ("/api/v1/assistant/messages", "GET"),
        ("/api/v1/assistant/messages", "POST"),
        ("/api/v1/assistant/transcribe", "POST"),
        ("/api/v1/assistant/rewrite", "POST"),
    ):
        with pytest.raises(HTTPException) as error:
            await ensure_request_module_access(object(), user, path, method)
        assert error.value.status_code == 403
    permissions.return_value = {"assistant": {"view": True}}
    await ensure_request_module_access(object(), user, "/api/v1/assistant/messages", "POST")


@pytest.mark.anyio
async def test_admin_cannot_be_restricted_by_module_overrides() -> None:
    admin = AuthenticatedUser(
        id=uuid4(), username="admin", full_name="Admin", position_id=None,
        job_title=None, role="admin",
    )
    connection = SimpleNamespace(execute=AsyncMock(return_value=Mock(
        mappings=lambda: Mock(all=lambda: [])
    )))
    permissions = await module_permissions_for_user(connection, admin)
    assert permissions
    assert all(all(rule[action] for action in MODULE_ACTIONS) for rule in permissions.values())


@pytest.mark.anyio
async def test_admin_assistant_can_be_disabled_without_revoking_other_admin_modules() -> None:
    admin = AuthenticatedUser(uuid4(), "admin", "Admin", None, None, "admin")
    denied = {action: False for action in MODULE_ACTIONS}
    connection = SimpleNamespace(execute=AsyncMock(return_value=Mock(
        mappings=lambda: Mock(all=lambda: [
            {"subject_type": "user", "subject_key": str(admin.id),
             "module_key": "assistant", "permissions": denied},
            {"subject_type": "user", "subject_key": str(admin.id),
             "module_key": "tasks", "permissions": denied},
        ])
    )))
    permissions = await module_permissions_for_user(connection, admin)
    assert permissions["assistant"]["view"] is False
    assert permissions["tasks"]["view"] is True


@pytest.mark.anyio
async def test_department_assistant_denial_beats_personal_override() -> None:
    department_id = uuid4()
    user = AuthenticatedUser(
        id=uuid4(), username="regional", full_name="Regional", position_id=None,
        job_title=None, role="employee", department_id=department_id,
    )
    denied = {action: False for action in MODULE_ACTIONS}
    allowed = {**denied, "view": True}
    parent_rows = Mock(all=lambda: [SimpleNamespace(id=department_id, parent_id=None)])
    rule_rows = Mock(mappings=lambda: Mock(all=lambda: [
        {"subject_type": "department", "subject_key": str(department_id),
         "module_key": "assistant", "permissions": denied},
        {"subject_type": "user", "subject_key": str(user.id),
         "module_key": "assistant", "permissions": allowed},
    ]))
    connection = SimpleNamespace(
        execute=AsyncMock(side_effect=[parent_rows, rule_rows]),
        scalar=AsyncMock(return_value=None),
    )
    permissions = await module_permissions_for_user(connection, user)
    assert permissions["assistant"]["view"] is False
    assert permissions["assistant"]["create"] is False


@pytest.mark.anyio
async def test_regional_bulk_access_requires_verified_scope(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    admin = AuthenticatedUser(uuid4(), "admin", "Admin", None, None, "admin")
    with pytest.raises(DirectoryServiceError, match="scope migration"):
        await set_regional_assistant_access(SimpleNamespace(), admin, False)
    regional_ids = [uuid4(), uuid4()]
    test_departments = sa.Table(
        "core_departments", sa.MetaData(), sa.Column("id", sa.Uuid()),
        sa.Column("scope", sa.String()),
    )
    monkeypatch.setattr("yuksalish_api.directory_service.departments", test_departments)
    connection = SimpleNamespace(execute=AsyncMock(return_value=Mock(
        scalars=lambda: Mock(all=lambda: regional_ids)
    )))
    save = AsyncMock(side_effect=["one", "two"])
    monkeypatch.setattr("yuksalish_api.directory_service.set_module_access_rule", save)
    result = await set_regional_assistant_access(connection, admin, False)
    assert result == ["one", "two"]
    assert save.await_count == 2
    assert all(call.args[2] == "department" and call.args[4] == "assistant"
               for call in save.await_args_list)


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
