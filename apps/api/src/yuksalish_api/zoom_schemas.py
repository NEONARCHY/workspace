"""Contracts for the Zoom conference module.

Booking rules match the ZoomBot the company already relies on: the start and the
duration are multiples of fifteen minutes and a conference lasts between fifteen
minutes and eight hours.
"""

from datetime import datetime
from typing import Literal

from pydantic import Field, field_validator, model_validator

from .workspace_schemas import ApiModel

SLOT_MINUTES = 15
MIN_DURATION_MINUTES = 15
MAX_DURATION_MINUTES = 480

ZoomMeetingStatus = Literal[
    "provisioning", "scheduled", "cancellation_pending", "cancelled", "failed"
]
ZoomMeetingSource = Literal["workspace", "zoombot"]
ZoomBusySource = Literal["workspace", "external"]


class ZoomMeetingWriteRequest(ApiModel):
    topic: str = Field(min_length=1, max_length=200)
    description: str = Field(default="", max_length=2000)
    starts_at: datetime
    duration_minutes: int = Field(ge=MIN_DURATION_MINUTES, le=MAX_DURATION_MINUTES)
    participant_ids: list[str] = Field(default_factory=list, max_length=100)

    @field_validator("topic")
    @classmethod
    def topic_must_not_be_blank(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("Название конференции не должно быть пустым")
        return stripped

    @model_validator(mode="after")
    def validate_slot(self) -> "ZoomMeetingWriteRequest":
        if self.duration_minutes % SLOT_MINUTES:
            raise ValueError("Продолжительность должна быть кратна 15 минутам")
        if self.starts_at.tzinfo is None:
            raise ValueError("Время начала должно содержать часовой пояс")
        if (
            self.starts_at.minute % SLOT_MINUTES
            or self.starts_at.second
            or self.starts_at.microsecond
        ):
            raise ValueError("Время начала должно быть кратно 15 минутам")
        if len(set(self.participant_ids)) != len(self.participant_ids):
            raise ValueError("Участники не должны повторяться")
        return self


class CreateZoomMeetingRequest(ZoomMeetingWriteRequest):
    pass


class UpdateZoomMeetingRequest(ZoomMeetingWriteRequest):
    pass


class ZoomMeetingResponse(ApiModel):
    id: str
    topic: str
    description: str
    starts_at: datetime
    ends_at: datetime
    duration_minutes: int
    status: ZoomMeetingStatus
    source: ZoomMeetingSource
    organizer_user_id: str | None
    organizer_name: str
    participant_ids: list[str] = Field(default_factory=list)
    # Connection details stay hidden from people who are not part of the meeting.
    zoom_meeting_id: str | None = None
    join_url: str | None = None
    passcode: str | None = None
    can_edit: bool = False
    can_cancel: bool = False


class ZoomMeetingsResponse(ApiModel):
    configured: bool
    timezone: str
    reminder_minutes: int
    booking_horizon_days: int
    slot_minutes: int = SLOT_MINUTES
    meetings: list[ZoomMeetingResponse] = Field(default_factory=list)


class ZoomBusyIntervalResponse(ApiModel):
    starts_at: datetime
    ends_at: datetime
    topic: str
    source: ZoomBusySource
    meeting_id: str | None = None


class ZoomAvailabilityResponse(ApiModel):
    configured: bool
    timezone: str
    slot_minutes: int = SLOT_MINUTES
    # False when Zoom itself could not be reached: the day is shown with local
    # bookings only, and the UI has to say the picture may be incomplete.
    host_calendar_synced: bool = True
    intervals: list[ZoomBusyIntervalResponse] = Field(default_factory=list)
