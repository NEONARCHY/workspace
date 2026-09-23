from datetime import date, datetime, time
from typing import Literal
from uuid import UUID

from pydantic import model_validator

from .workspace_schemas import ApiModel

WorkdayStatus = Literal["working", "finished", "approved_absence", "not_started", "weekend_off"]


class WorkdayScheduleWrite(ApiModel):
    starts_at: time
    ends_at: time

    @model_validator(mode="after")
    def valid_daytime_schedule(self) -> "WorkdayScheduleWrite":
        if self.starts_at.tzinfo or self.ends_at.tzinfo or self.starts_at >= self.ends_at:
            raise ValueError("Укажите дневной график: начало должно быть раньше окончания")
        return self


class WorkdayScheduleResponse(ApiModel):
    user_id: UUID
    starts_at: time
    ends_at: time


class WorkdaySessionResponse(ApiModel):
    id: UUID
    user_id: UUID
    work_date: date
    started_at: datetime
    ended_at: datetime | None
    scheduled_start_at: datetime
    scheduled_end_at: datetime
    closed_at: datetime | None
    close_source: Literal["manual", "automatic"] | None
    is_weekend: bool


class WorkdayMeResponse(ApiModel):
    status: WorkdayStatus
    schedule: WorkdayScheduleResponse
    session: WorkdaySessionResponse | None
    absence_kind: str | None
    as_of: datetime


class WorkdayTeamMemberResponse(ApiModel):
    user_id: UUID
    name: str
    job_title: str | None
    status: WorkdayStatus
    schedule: WorkdayScheduleResponse
    session: WorkdaySessionResponse | None
    absence_kind: str | None
    can_edit_schedule: bool


class WorkdayTeamResponse(ApiModel):
    as_of: datetime
    working_count: int
    members: list[WorkdayTeamMemberResponse]
