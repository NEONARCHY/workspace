"""Directory synchronization is separate from letter execution and read scopes."""

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from .workspace_schemas import ApiModel

SyncState = Literal["pending", "synced", "retry", "conflict"]
EmployeeState = Literal["active", "pending", "disabled", "blocked", "archived"]


class EmployeeSnapshot(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    employee_id: UUID
    username: str = Field(min_length=1, max_length=64)
    full_name: str = Field(min_length=1, max_length=200)
    status: EmployeeState
    department_id: UUID | None = None
    department_name: str | None = Field(default=None, max_length=200)
    job_title: str | None = Field(default=None, max_length=160)


class EmployeeSyncRequest(EmployeeSnapshot):
    protocol_version: Literal[1] = 1
    revision: int = Field(gt=0, le=9223372036854775807, strict=True)


class EmployeeSyncAck(BaseModel):
    model_config = ConfigDict(extra="forbid")
    protocol_version: Literal[1]
    employee_id: UUID
    revision: int = Field(gt=0, le=9223372036854775807, strict=True)
    request_sha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    edo_user_id: int | None = Field(default=None, gt=0, le=9223372036854775807, strict=True)
    mapping_active: bool = Field(strict=True)
    action: Literal["created", "linked", "updated", "unchanged", "absent"]


class EmployeeSyncEntry(ApiModel):
    user_id: UUID
    name: str
    status: SyncState
    revision: int
    delivered_revision: int
    edo_user_id: int | None
    attempts: int
    last_error_code: str | None
    last_synced_at: datetime | None


class EmployeeSyncStatus(ApiModel):
    enabled: bool
    configured: bool
    entries: list[EmployeeSyncEntry]
