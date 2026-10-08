"""Public Workspace contract for letters owned by the separate EDO system."""

from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field


class EdoAssignment(BaseModel):
    user_id: int
    employee_id: str | None = None
    queue: int = 0
    assigned_at_legacy: str | None = None
    viewed: bool = False


class EdoAttachment(BaseModel):
    id: str
    name: str
    size: int = 0


class EdoIncomingLetter(BaseModel):
    id: int
    version: int = 1
    status: int | None = None
    in_num: str | None = None
    in_date: str | None = None
    out_num: str | None = None
    out_date: str | None = None
    organization: str | None = None
    region: str | None = None
    description: str | None = None
    deadline: str | None = None
    deadline2: str | None = None
    type: str | None = None
    comment: str | None = None
    result: str | None = None
    result_time: str | None = None
    legacy_dates_timezone: str = "unknown"
    assignments: list[EdoAssignment] = Field(default_factory=list)
    attachments: list[EdoAttachment] = Field(default_factory=list)
    overdue: bool | None = None


class EdoPageMeta(BaseModel):
    page: int
    limit: int
    total: int


class EdoIncomingPage(BaseModel):
    data: list[EdoIncomingLetter]
    meta: EdoPageMeta
    deadline_timezone_verified: bool = False


class EdoIncomingDetail(BaseModel):
    data: EdoIncomingLetter
    deadline_timezone_verified: bool = False


class EdoAssignWrite(BaseModel):
    expected_version: int = Field(gt=0)
    employee_id: UUID


class EdoCompleteWrite(BaseModel):
    expected_version: int = Field(gt=0)
    result: str | None = Field(default=None, max_length=255)


EdoListStatus = Literal["unread", "in_progress", "completed", "confirmed"]
