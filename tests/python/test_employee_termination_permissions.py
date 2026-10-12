import asyncio
from unittest.mock import AsyncMock, Mock
from uuid import uuid4

import pytest

from yuksalish_api.administration_schemas import EmployeeStatusUpdateRequest
from yuksalish_api.auth import AuthenticatedUser
from yuksalish_api.directory_service import (
    DirectoryServiceError,
    can_terminate_employees,
    update_employee_status,
)


@pytest.mark.parametrize("role,title,allowed", [
    ("admin", None, True), ("superadmin", None, True), ("manager", None, True),
    ("employee", "Rais o'rinbosari", True), ("employee", "Kadrlar mutaxassisi", True),
    ("employee", "Sun'iy intellekt bo'limi boshlig'i", True),
    ("employee", "Hududiy bo'linma rahbari", True),
    ("employee", "Bo'lim boshlig'i yordamchisi", False),
    ("employee", None, False),
])
def test_termination_authority(role: str, title: str | None, allowed: bool) -> None:
    actor = AuthenticatedUser(uuid4(), "tester", "Tester", None, title, role)
    connection = Mock(scalar=AsyncMock(return_value=False))
    assert asyncio.run(can_terminate_employees(connection, actor)) is allowed


def test_assigned_hr_or_department_lead_has_lifecycle_authority() -> None:
    actor = AuthenticatedUser(uuid4(), "tester", "Tester", None, None, "employee")
    connection = Mock(scalar=AsyncMock(return_value=True))
    assert asyncio.run(can_terminate_employees(connection, actor))
    query = str(connection.scalar.call_args.args[0])
    assert "hr_settings.hr_user_id" in query
    assert "core_departments.lead_user_id" in query


@pytest.mark.parametrize("status", ["blocked", "active"])
def test_lifecycle_authority_does_not_grant_block_or_restore(status: str) -> None:
    actor = AuthenticatedUser(uuid4(), "tester", "Tester", None, None, "manager")
    connection = Mock(execute=AsyncMock())
    with pytest.raises(DirectoryServiceError) as error:
        asyncio.run(update_employee_status(connection, actor, uuid4(),
            EmployeeStatusUpdateRequest.model_validate({
                "status": status, "reason": "Meaningful test reason",
            })))
    assert error.value.status_code == 403
    connection.execute.assert_not_awaited()
