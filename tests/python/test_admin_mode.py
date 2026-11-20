from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest

from yuksalish_api.access_control import module_permissions_for_user
from yuksalish_api.admin_mode import set_admin_mode
from yuksalish_api.auth import AuthenticatedUser, load_authenticated_user
from yuksalish_api.auth_service import AuthServiceError
from yuksalish_api.repository import person_from_record


@pytest.mark.anyio
@pytest.mark.parametrize("role", ["admin", "superadmin"])
async def test_mode_changes_effective_role_only_in_own_session(role: str) -> None:
    actor = AuthenticatedUser(uuid4(), "admin", "Administrator", uuid4(), "Specialist", role,
                              session_id=uuid4(), account_role=role, admin_mode_enabled=True)
    connection = AsyncMock()
    result = MagicMock()
    result.scalar_one_or_none.return_value = actor.session_id
    connection.execute.return_value = result
    ordinary = await set_admin_mode(connection, actor, False)
    assert ordinary.role == "employee"
    assert ordinary.account_role == role
    assert ordinary.position_id == actor.position_id
    assert ordinary.admin_mode_enabled is False
    assert actor.role == role
    statement = connection.execute.call_args_list[0].args[0]
    assert actor.session_id in statement.compile().params.values()
    assert actor.id in statement.compile().params.values()
    restored = await set_admin_mode(connection, ordinary, True)
    assert restored.role == role
    assert restored.admin_mode_enabled is True


@pytest.mark.anyio
async def test_employee_and_revoked_session_cannot_enable_admin_mode() -> None:
    actor = AuthenticatedUser(uuid4(), "employee", "Employee", None, None, "employee",
                              session_id=uuid4())
    connection = AsyncMock()
    with pytest.raises(AuthServiceError) as denied:
        await set_admin_mode(connection, actor, True)
    assert denied.value.status_code == 403
    connection.execute.assert_not_called()
    admin = AuthenticatedUser(uuid4(), "admin", "Admin", None, None, "employee",
                              session_id=uuid4(), account_role="admin", admin_mode_enabled=False)
    result = MagicMock()
    result.scalar_one_or_none.return_value = None
    connection.execute.return_value = result
    with pytest.raises(AuthServiceError) as revoked:
        await set_admin_mode(connection, admin, True)
    assert revoked.value.status_code == 401
    assert connection.execute.await_count == 1  # no success audit for a revoked session


@pytest.mark.anyio
async def test_ordinary_mode_keeps_position_permissions_without_global_admin_bypass() -> None:
    actor = AuthenticatedUser(uuid4(), "admin", "Admin", uuid4(), "Specialist", "employee",
                              session_id=uuid4(), account_role="admin", admin_mode_enabled=False)
    connection = AsyncMock()
    result = MagicMock()
    result.mappings.return_value.all.return_value = [{
        "subject_type": "position", "subject_key": str(actor.position_id),
        "module_key": "team_overview", "permissions": {
            "view": True, "create": False, "edit": False, "approve": False, "admin": False,
        },
    }]
    connection.execute.return_value = result
    connection.scalar.return_value = None
    permissions = await module_permissions_for_user(connection, actor)
    assert permissions["team_overview"]["view"] is True
    assert permissions["team_overview"]["admin"] is False
    assert permissions["employees"]["admin"] is False
    assert permissions["telegram_access"]["view"] is False


@pytest.mark.anyio
async def test_authentication_preserves_position_but_suppresses_admin_role() -> None:
    row = {"id": uuid4(), "username": "admin", "full_name": "Admin", "role": "superadmin",
           "position_id": uuid4(), "department_id": uuid4(), "job_title": "Specialist"}
    connection = AsyncMock()
    result = MagicMock()
    result.mappings.return_value.first.return_value = row
    connection.execute.return_value = result
    user = await load_authenticated_user(connection, row["id"], admin_mode_enabled=False)
    assert user is not None
    assert user.role == "employee"
    assert user.account_role == "superadmin"
    assert user.department_id == row["department_id"]
    assert user.position_id == row["position_id"]
    person = person_from_record({**row, "admin_mode_enabled": False})
    assert person.role == "employee"
    assert person.admin_mode_enabled is False
    assert person_from_record(row).role == "superadmin"  # directory account role is unchanged
