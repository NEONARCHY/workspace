"""Contracts for the outgoing-only AI Referent module."""

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import Field, field_validator

from .workspace_schemas import ApiModel, AttachmentResponse

AIReferentRoute = Literal["exat", "webmail"]
AIReferentStatus = Literal[
    "draft",
    "pending_review",
    "needs_revision",
    "approved",
    "queued",
    "sending",
    "sent",
    "failed",
    "cancelled",
]
AIReferentSource = Literal["workspace", "telegram", "import"]
AIReferentAction = Literal[
    "submit",
    "approve",
    "return_for_revision",
    "cancel",
    "queue_delivery",
    "retry_delivery",
]


class AIReferentLetterFields(ApiModel):
    subject: str = Field(min_length=1, max_length=300)
    recipient_organization: str = Field(min_length=1, max_length=300)
    recipient_address: str = Field(default="", max_length=500)
    route: AIReferentRoute
    note: str = Field(default="", max_length=5000)
    reviewer_user_id: UUID | None = None

    @field_validator("subject", "recipient_organization")
    @classmethod
    def required_text_must_not_be_blank(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("Поле не должно быть пустым")
        return stripped

    @field_validator("recipient_address", "note")
    @classmethod
    def optional_text_is_trimmed(cls, value: str) -> str:
        return value.strip()


class CreateAIReferentLetterRequest(AIReferentLetterFields):
    pass


class UpdateAIReferentLetterRequest(AIReferentLetterFields):
    expected_revision: int = Field(ge=1)


class AIReferentActionRequest(ApiModel):
    action: AIReferentAction
    comment: str = Field(default="", max_length=2000)
    expected_revision: int = Field(ge=1)

    @field_validator("comment")
    @classmethod
    def comment_is_trimmed(cls, value: str) -> str:
        return value.strip()


class AIReferentEventResponse(ApiModel):
    id: str
    event_type: str
    actor_user_id: str | None = None
    actor_name: str = "Системное действие"
    from_status: AIReferentStatus | None = None
    to_status: AIReferentStatus | None = None
    comment: str = ""
    created_at: datetime


class AIReferentLetterResponse(ApiModel):
    id: str
    display_number: str | None = None
    outgoing_number: int | None = None
    year_suffix: str | None = None
    subject: str
    recipient_organization: str
    recipient_address: str
    route: AIReferentRoute
    note: str
    status: AIReferentStatus
    source: AIReferentSource
    created_by_user_id: str
    created_by_name: str
    reviewer_user_id: str | None = None
    reviewer_name: str | None = None
    revision: int
    sent_at: datetime | None = None
    created_at: datetime
    updated_at: datetime
    attachments: list[AttachmentResponse] = Field(default_factory=list)
    events: list[AIReferentEventResponse] = Field(default_factory=list)
    available_actions: list[AIReferentAction] = Field(default_factory=list)
    can_edit: bool = False


class AIReferentRegistryResponse(ApiModel):
    letters: list[AIReferentLetterResponse] = Field(default_factory=list)
    total_count: int = 0
    pending_review_count: int = 0
    ready_count: int = 0
    sent_count: int = 0
