"""Contracts for the shared Workspace ↔ Telegram Hisobot journal."""

from datetime import date, datetime
from typing import Literal
from uuid import UUID

from pydantic import Field, field_validator

from .workspace_schemas import ApiModel

ReportScope = Literal["central", "hudud"]


class HisobotReport(ApiModel):
    id: UUID
    user_id: UUID | None
    telegram_id: str
    employee_key: str
    full_name: str
    position: str
    report_scope: ReportScope
    region_name: str | None
    report_date: date
    content: str
    submitted_at: datetime
    is_late: bool
    source: Literal["telegram", "workspace"]


class HisobotReportInput(ApiModel):
    content: str = Field(min_length=3, max_length=20000)

    @field_validator("content")
    @classmethod
    def nonempty(cls, value: str) -> str:
        value = value.strip()
        if len(value) < 3:
            raise ValueError("Напишите отчёт текстом.")
        return value


class HisobotProfile(ApiModel):
    telegram_id: str
    full_name: str
    position: str
    report_scope: ReportScope
    region_name: str | None
    report_required: bool
    management_access: bool
    absence_kind: Literal["vacation", "sick_leave", "personal_time"] | None
    today: date
    can_submit: bool
    window_opens_at: str = "12:00"
    window_closes_at: str = "18:30"
    today_report: HisobotReport | None


class BridgeReport(ApiModel):
    telegram_id: str = Field(pattern=r"^[1-9][0-9]{0,15}$")
    employee_key: str = Field(min_length=1, max_length=100)
    full_name: str = Field(min_length=1, max_length=200)
    position: str = Field(max_length=500)
    report_scope: ReportScope
    region_name: str | None = None
    report_date: date
    content: str = Field(min_length=3, max_length=20000)
    submitted_at: datetime
    is_late: bool


class BridgeReportBatch(ApiModel):
    reports: list[BridgeReport] = Field(max_length=200)


class BridgeVacation(ApiModel):
    telegram_id: str = Field(pattern=r"^[1-9][0-9]{0,15}$")
    starts_date: date
    through_date: date


class BridgeVacationSnapshot(ApiModel):
    vacations: list[BridgeVacation] = Field(max_length=500)


class BridgeReportExemption(ApiModel):
    telegram_id: str
    starts_date: date
    through_date: date
    kind: Literal["vacation", "sick_leave", "personal_time"]


class BridgeRosterMember(ApiModel):
    telegram_id: str
    employee_key: str
    full_name: str
    position: str
    report_scope: ReportScope
    region_name: str | None
    report_required: bool
    management_access: bool
