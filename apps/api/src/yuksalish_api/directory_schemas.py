from typing import Literal
from uuid import UUID

from pydantic import Field, field_validator

from .position_policy import latin_position_name
from .workspace_schemas import ApiModel, ModulePermissionSet

EditableRole = Literal["admin", "manager", "employee"]
ModuleAccessSubject = Literal["role", "department", "user"]


class RoleDescriptorResponse(ApiModel):
    key: str
    label: str
    description: str


class PositionResponse(ApiModel):
    id: str
    name: str
    is_active: bool
    sort_order: int
    source: str
    assigned_users_count: int


class PositionCreateRequest(ApiModel):
    name: str = Field(min_length=1, max_length=160)
    sort_order: int = Field(default=0, ge=0, le=1_000_000)

    @field_validator("name")
    @classmethod
    def name_must_not_be_blank(cls, value: str) -> str:
        return latin_position_name(value)


class PositionUpdateRequest(ApiModel):
    name: str | None = Field(default=None, min_length=1, max_length=160)
    is_active: bool | None = None
    sort_order: int | None = Field(default=None, ge=0, le=1_000_000)

    @field_validator("name")
    @classmethod
    def name_must_not_be_blank(cls, value: str | None) -> str | None:
        return None if value is None else latin_position_name(value)


class DepartmentResponse(ApiModel):
    id: str
    code: str
    name: str
    parent_id: str | None
    assigned_users_count: int


class DepartmentCreateRequest(ApiModel):
    code: str = Field(min_length=1, max_length=64, pattern=r"^[A-Za-z0-9][A-Za-z0-9_-]*$")
    name: str = Field(min_length=1, max_length=200)
    parent_id: UUID | None = None

    @field_validator("code", "name")
    @classmethod
    def values_must_not_be_blank(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("Value must not be blank")
        return stripped


class DepartmentUpdateRequest(ApiModel):
    code: str | None = Field(
        default=None,
        min_length=1,
        max_length=64,
        pattern=r"^[A-Za-z0-9][A-Za-z0-9_-]*$",
    )
    name: str | None = Field(default=None, min_length=1, max_length=200)
    parent_id: UUID | None = None

    @field_validator("code", "name")
    @classmethod
    def values_must_not_be_blank(cls, value: str | None) -> str | None:
        if value is None:
            return None
        stripped = value.strip()
        if not stripped:
            raise ValueError("Value must not be blank")
        return stripped


class ModuleAccessDescriptorResponse(ApiModel):
    key: str
    label: str
    status: str


class ModuleAccessRuleResponse(ApiModel):
    id: str
    subject_type: ModuleAccessSubject
    subject_key: str
    module_key: str
    permissions: ModulePermissionSet


class ModuleAccessRuleUpdateRequest(ApiModel):
    permissions: ModulePermissionSet


class DirectoryEmployeeResponse(ApiModel):
    id: str
    username: str
    name: str
    role: str
    department_id: str | None
    position_id: str | None
    job_title: str | None
    status: str


class EmployeeAccessUpdateRequest(ApiModel):
    role: EditableRole
    department_id: UUID | None = None
    position_id: UUID | None = None


class DirectoryBootstrapResponse(ApiModel):
    roles: list[RoleDescriptorResponse]
    departments: list[DepartmentResponse]
    positions: list[PositionResponse]
    employees: list[DirectoryEmployeeResponse]
    modules: list[ModuleAccessDescriptorResponse]
    access_rules: list[ModuleAccessRuleResponse]
