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


class HisobotUnitReport(ApiModel):
    id: UUID
    department_id: UUID
    department_name: str
    reporter_telegram_id: str
    reporter_employee_key: str
    reporter_name: str
    reporter_position: str
    report_scope: ReportScope
    region_name: str | None
    covered_telegram_ids: list[str]
    report_date: date
    content: str
    submitted_at: datetime
    is_late: bool
    source: Literal["telegram", "workspace"]


class HisobotUnit(ApiModel):
    id: UUID
    name: str
    is_lead: bool
    member_count: int


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
    can_submit_unit: bool = False
    window_opens_at: str = "12:00"
    window_closes_at: str = "18:30"
    today_report: HisobotReport | None
    unit: HisobotUnit | None = None
    today_unit_report: HisobotUnitReport | None = None
    covered_by_report: bool = False


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


class BridgeUnitReport(ApiModel):
    department_id: UUID
    department_name: str = Field(min_length=1, max_length=200)
    reporter_telegram_id: str = Field(pattern=r"^[1-9][0-9]{0,15}$")
    reporter_employee_key: str = Field(min_length=1, max_length=100)
    reporter_name: str = Field(min_length=1, max_length=200)
    reporter_position: str = Field(max_length=500)
    report_scope: ReportScope
    region_name: str | None = None
    covered_telegram_ids: list[str] = Field(min_length=1, max_length=500)
    report_date: date
    content: str = Field(min_length=3, max_length=20000)
    submitted_at: datetime
    is_late: bool


class BridgeUnitReportBatch(ApiModel):
    reports: list[BridgeUnitReport] = Field(max_length=200)


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
    department_id: UUID | None = None
    department_name: str | None = None
    department_lead: bool = False
