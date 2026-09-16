from __future__ import annotations

from datetime import date, datetime, time
from typing import Literal
from uuid import UUID

from pydantic import Field, field_validator, model_validator

from .workspace_schemas import ApiModel

AttendanceDayStatus = Literal[
    "unscheduled", "scheduled", "arrived", "working", "completed", "late", "absence"
]
AttendanceEventKind = Literal["arrival", "start", "end"]
AttendanceCorrectionStatus = Literal["pending", "approved", "rejected", "cancelled"]


class AttendanceProfileUpdateRequest(ApiModel):
    smartoffice_staff_key: str | None = Field(default=None, max_length=128)
    date_of_birth: date | None = None

    @field_validator("smartoffice_staff_key")
    @classmethod
    def normalize_staff_key(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip()
        return normalized or None


class WorkSchedulePeriodWriteRequest(ApiModel):
    user_id: UUID
    starts_on: date
    ends_on: date
    weekdays: list[int] = Field(min_length=1, max_length=7)
    starts_at: time
    ends_at: time

    @field_validator("weekdays")
    @classmethod
    def unique_weekdays(cls, value: list[int]) -> list[int]:
        if any(day < 0 or day > 6 for day in value) or len(value) != len(set(value)):
            raise ValueError("Weekdays must contain unique values from 0 to 6")
        return sorted(value)

    @model_validator(mode="after")
    def valid_period(self) -> WorkSchedulePeriodWriteRequest:
        if self.ends_on < self.starts_on:
            raise ValueError("Schedule end date must not precede start date")
        if self.ends_at <= self.starts_at:
            raise ValueError("Schedule end time must follow start time")
        return self


class WorkScheduleExceptionWriteRequest(ApiModel):
    user_id: UUID
    work_date: date
    kind: Literal["day_off", "workday"]
    starts_at: time | None = None
    ends_at: time | None = None

    @model_validator(mode="after")
    def valid_exception(self) -> WorkScheduleExceptionWriteRequest:
        if self.kind == "workday" and (self.starts_at is None or self.ends_at is None):
            raise ValueError("Working-day exception needs start and end times")
        if (
            self.starts_at is not None
            and self.ends_at is not None
            and self.ends_at <= self.starts_at
        ):
            raise ValueError("Schedule end time must follow start time")
        return self


class AttendanceActionRequest(ApiModel):
    action: Literal["start", "end"]
    occurred_at: datetime | None = None


class AttendanceCorrectionCreateRequest(ApiModel):
    event_kind: AttendanceEventKind
    requested_at: datetime
    reason: str = Field(min_length=1, max_length=2000)

    @field_validator("reason")
    @classmethod
    def nonblank_reason(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("Reason must not be blank")
        return normalized


class AttendanceCorrectionActionRequest(ApiModel):
    action: Literal["approve", "reject", "cancel"]
    comment: str = Field(default="", max_length=2000)


class WorkSchedulePeriodResponse(ApiModel):
    id: str
    user_id: str
    starts_on: date
    ends_on: date
    weekdays: list[int]
    starts_at: time
    ends_at: time


class WorkScheduleExceptionResponse(ApiModel):
    id: str
    user_id: str
    work_date: date
    kind: Literal["day_off", "workday"]
    starts_at: time | None
    ends_at: time | None


class AttendanceDayResponse(ApiModel):
    id: str
    user_id: str
    work_date: date
    status: AttendanceDayStatus
    scheduled_starts_at: datetime | None
    scheduled_ends_at: datetime | None
    arrived_at: datetime | None
    started_at: datetime | None
    ended_at: datetime | None
    absence_kind: str | None


class AttendanceCorrectionResponse(ApiModel):
    id: str
    user_id: str
    direct_manager_user_id: str
    event_kind: AttendanceEventKind
    requested_at: datetime
    reason: str
    status: AttendanceCorrectionStatus
    comment: str | None
    created_at: datetime


class AttendanceProfileResponse(ApiModel):
    user_id: str
    smartoffice_staff_key: str | None
    date_of_birth: date | None


class SmartOfficeAttendanceEventRequest(ApiModel):
    event_id: UUID
    staff_key: str = Field(min_length=1, max_length=128)
    occurred_at: datetime


class SmartOfficeAttendanceEventResponse(ApiModel):
    accepted: bool
    user_id: str
    birthday_greeting_created: bool


class SmartOfficeSnapshotEmployeeResponse(ApiModel):
    staff_key: str
    user_id: str
    active: bool
    birthday_today: bool
    schedule: WorkScheduleExceptionResponse | WorkSchedulePeriodResponse | None
    absence_kind: str | None


class SmartOfficeSnapshotResponse(ApiModel):
    generated_at: datetime
    work_date: date
    employees: list[SmartOfficeSnapshotEmployeeResponse]
