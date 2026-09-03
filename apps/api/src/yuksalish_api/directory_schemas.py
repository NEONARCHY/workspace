from typing import Literal
from uuid import UUID

from pydantic import Field, field_validator

from .workspace_schemas import ApiModel

EditableRole = Literal["admin", "manager", "employee"]


def _non_blank(value: str) -> str:
    normalized = value.strip()
    if not normalized:
        raise ValueError("Value must not be blank")
    return normalized


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
        return _non_blank(value)


class PositionUpdateRequest(ApiModel):
    name: str | None = Field(default=None, min_length=1, max_length=160)
    is_active: bool | None = None
    sort_order: int | None = Field(default=None, ge=0, le=1_000_000)

    @field_validator("name")
    @classmethod
    def name_must_not_be_blank(cls, value: str | None) -> str | None:
        return None if value is None else _non_blank(value)


class DirectoryEmployeeResponse(ApiModel):
    id: str
    username: str
    name: str
    role: str
    position_id: str | None
    job_title: str | None
    status: str


class EmployeeAccessUpdateRequest(ApiModel):
    role: EditableRole
    position_id: UUID | None = None


class DirectoryBootstrapResponse(ApiModel):
    roles: list[RoleDescriptorResponse]
    positions: list[PositionResponse]
    employees: list[DirectoryEmployeeResponse]
