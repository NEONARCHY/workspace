from datetime import date, datetime
from decimal import Decimal
from typing import Literal
from uuid import UUID

from pydantic import Field

from .workspace_schemas import ApiModel


class HrSettingsResponse(ApiModel):
    hr_user_id: UUID | None = None
    chair_user_id: UUID | None = None
    accountant_user_id: UUID | None = None


class HrSettingsWrite(ApiModel):
    hr_user_id: UUID | None = None
    chair_user_id: UUID | None = None
    accountant_user_id: UUID | None = None


class HrProfileWrite(ApiModel):
    employment_date: date
    service_anchor_date: date
    service_years: int = Field(ge=0, le=100)
    service_months: int = Field(ge=0, le=11)
    service_days: int = Field(ge=0, le=30)
    service_reason: str = Field(min_length=3, max_length=2000)


class HrTerminationWrite(ApiModel):
    terminated_on: date
    termination_reason: str = Field(min_length=3, max_length=2000)


class HrProfileResponse(ApiModel):
    id: UUID
    user_id: UUID
    full_name: str
    job_title: str | None = None
    employment_date: date
    service_anchor_date: date
    service_years: int
    service_months: int
    service_days: int
    allowance_percent: Decimal
    employment_status: Literal["active", "terminated"]
    terminated_on: date | None = None
    termination_reason: str | None = None
    hidden_after_year: bool
    updated_at: datetime


class HrHistoryResponse(ApiModel):
    service_anchor_date: date
    service_years: int
    service_months: int
    service_days: int
    reason: str
    created_at: datetime


class HrRegisterItemResponse(ApiModel):
    user_id: UUID
    full_name: str
    job_title: str | None = None
    service_years: int
    service_months: int
    service_days: int
    allowance_percent: Decimal


class HrRegisterResponse(ApiModel):
    id: UUID
    period: str
    version: int
    status: str
    return_comment: str | None = None
    created_at: datetime
    submitted_at: datetime | None = None
    approved_at: datetime | None = None
    accounted_at: datetime | None = None
    items: list[HrRegisterItemResponse] = Field(default_factory=list)


class HrRegisterAction(ApiModel):
    action: Literal["submit", "approve", "return", "account"]
    comment: str | None = Field(default=None, max_length=2000)


class HrOverviewResponse(ApiModel):
    settings: HrSettingsResponse
    profiles: list[HrProfileResponse] = Field(default_factory=list)
    registers: list[HrRegisterResponse] = Field(default_factory=list)
