"""Reference directory contracts and server-side authorization mapping."""

from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock
from uuid import uuid4

import pytest
from pydantic import ValidationError

from yuksalish_api.access_control import module_permissions_for_user, request_module_action
from yuksalish_api.auth import AuthenticatedUser
from yuksalish_api.reference_schemas import (
    ExpertFields,
    PartnerFields,
    ProfileWrite,
    TemplateFields,
)


def test_reference_routes_require_module_permissions() -> None:
    assert request_module_action("/api/v1/reference", "GET") == ("reference", "view")
    assert request_module_action("/api/v1/reference/profile", "PUT") == ("reference", "edit")
    assert request_module_action("/api/v1/reference/partners", "POST") == ("reference", "create")
    assert request_module_action("/api/v1/reference/experts/id", "PUT") == ("reference", "edit")
    assert request_module_action("/api/v1/reference/templates/id/file", "PUT") == (
        "reference", "edit",
    )


def test_reference_fields_reject_blank_names_and_invalid_kinds() -> None:
    with pytest.raises(ValidationError):
        PartnerFields(name="  ", kind="partner")
    with pytest.raises(ValidationError):
        ExpertFields(name="Имя", specialization=" ")
    with pytest.raises(ValidationError):
        TemplateFields(title="Шаблон", kind="unknown")
    with pytest.raises(ValidationError):
        ProfileWrite(tin="ИНН", expected_revision=0)
    assert ExpertFields(name="Имя", specialization="Бюджет", partner_id=uuid4())


@pytest.mark.anyio
async def test_reference_defaults_to_read_only_for_staff() -> None:
    user = AuthenticatedUser(uuid4(), "staff", "Staff", None, None, "employee")
    connection = SimpleNamespace(
        execute=AsyncMock(return_value=Mock(mappings=lambda: Mock(all=lambda: []))),
        scalar=AsyncMock(return_value=None),
    )
    permissions = await module_permissions_for_user(connection, user)
    assert permissions["reference"] == {
        "view": True, "create": False, "edit": False,
        "approve": False, "admin": False,
    }
