import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock
from uuid import uuid4

import pytest
from pydantic import ValidationError

from yuksalish_api.auth import AuthenticatedUser
from yuksalish_api.directory_schemas import DepartmentCreateRequest, DepartmentUpdateRequest
from yuksalish_api.directory_service import DirectoryServiceError, delete_department


def test_department_icon_is_a_controlled_catalogue() -> None:
    assert DepartmentCreateRequest(code="unit", name="Unit").icon_key == "building"
    assert DepartmentUpdateRequest(iconKey="finance").icon_key == "finance"
    with pytest.raises(ValidationError):
        DepartmentCreateRequest(code="unit", name="Unit", iconKey="unsafe-html")


@pytest.mark.parametrize("blocking_check", ["member", "child", "report", "message"])
def test_department_delete_preserves_active_or_historical_records(
    blocking_check: str,
) -> None:
    department_id = uuid4()
    actor = AuthenticatedUser(uuid4(), "admin", "Admin", None, None, "admin")
    row = Mock()
    row.mappings.return_value.first.return_value = {
        "id": department_id, "code": "unit", "name": "Unit",
    }
    connection = SimpleNamespace(
        execute=AsyncMock(return_value=row),
        scalar=AsyncMock(side_effect=[
            uuid4() if blocking_check == check else None
            for check in ["member", "child", "report", "message"]
        ]),
    )
    with pytest.raises(DirectoryServiceError) as raised:
        asyncio.run(delete_department(connection, actor, department_id))
    assert raised.value.status_code == 409
    assert connection.execute.await_count == 1


def test_department_delete_requires_manager_permission() -> None:
    actor = AuthenticatedUser(uuid4(), "reader", "Reader", None, None, "employee")
    connection = SimpleNamespace(execute=AsyncMock(), scalar=AsyncMock())
    with pytest.raises(DirectoryServiceError) as raised:
        asyncio.run(delete_department(connection, actor, uuid4()))
    assert raised.value.status_code == 403
    connection.execute.assert_not_awaited()


def test_unused_department_can_be_deleted_with_audit() -> None:
    department_id = uuid4()
    actor = AuthenticatedUser(uuid4(), "admin", "Admin", None, None, "admin")
    row = Mock()
    row.mappings.return_value.first.return_value = {
        "id": department_id, "code": "unit", "name": "Unit",
    }
    connection = SimpleNamespace(
        execute=AsyncMock(return_value=row),
        scalar=AsyncMock(return_value=None),
    )
    asyncio.run(delete_department(connection, actor, department_id))
    assert connection.scalar.await_count == 4
    assert connection.execute.await_count == 5
