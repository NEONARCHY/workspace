"""Contracts for monthly reports. Object-storage keys never leave the server."""

from datetime import date, datetime
from uuid import UUID

from pydantic import Field, field_validator

from .workspace_schemas import ApiModel


class ReportFile(ApiModel):
    id: str
    name: str
    size: int


class MonthlyReport(ApiModel):
    id: str
    month: date
    user_id: str
    revision: int
    comment: str
    submitted_at: datetime
    files: list[ReportFile]


class MonthlyMember(ApiModel):
    user_id: str
    name: str
    department: str
    report: MonthlyReport | None = None


class MonthlyCycle(ApiModel):
    month: date
    reminder_on: date
    total: int
    submitted: int
    authorized_at: datetime | None = None
    authorized_by_name: str | None = None
    comment: str
    members: list[MonthlyMember]
    can_submit: bool = False


class MonthlyOverview(ApiModel):
    today: date
    active_month: date | None
    dashboard_visible: bool
    can_review: bool
    can_authorize: bool
    can_configure: bool
    reminder_month: date | None
    payroll_notice: MonthlyCycle | None = None
    payroll_notice_id: str | None = None
    cycles: list[MonthlyCycle]
    reports: list[MonthlyReport]


class PayrollAuthorization(ApiModel):
    comment: str = Field(default="", max_length=4000)


class CalendarDayWrite(ApiModel):
    day: date
    working: bool
    note: str = Field(min_length=1, max_length=300)


class MonthlySubmission(ApiModel):
    id: UUID
    month: date
    comment: str = Field(default="", max_length=4000)

    @field_validator("month")
    @classmethod
    def first_of_month(cls, value: date) -> date:
        if value.day != 1:
            raise ValueError("Select the first day of the report month")
        return value
