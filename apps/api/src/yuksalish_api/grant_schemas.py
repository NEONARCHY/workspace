"""Grant preparation and its three explicit review decisions."""

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import Field, field_validator

from .workspace_schemas import ApiModel, AttachmentResponse

GrantStatus = Literal[
    "in_progress",
    "needs_revision",
    "author_review",
    "leader_review",
    "chair_review",
    "completed",
]


class GrantFields(ApiModel):
    title: str = Field(min_length=3, max_length=240)
    description: str = Field(default="", max_length=12000)
    assignee_id: UUID
    co_assignee_ids: list[UUID] = Field(default_factory=list, max_length=100)
    due_at: datetime
    checklist: list[str] = Field(default_factory=list, max_length=100)

    @field_validator("title", "description")
    @classmethod
    def clean_text(cls, value: str) -> str:
        return value.strip()

    @field_validator("due_at")
    @classmethod
    def aware_deadline(cls, value: datetime) -> datetime:
        if value.tzinfo is None:
            raise ValueError("Укажите часовой пояс срока")
        return value

    @field_validator("checklist")
    @classmethod
    def clean_checklist(cls, value: list[str]) -> list[str]:
        if any(not item.strip() or len(item.strip()) > 500 for item in value):
            raise ValueError("Пункт чек-листа должен содержать от 1 до 500 символов")
        cleaned = [item.strip() for item in value]
        if len(cleaned) != len(set(cleaned)):
            raise ValueError("Пункты чек-листа не должны повторяться")
        return cleaned


class GrantCreate(GrantFields):
    request_id: UUID


class GrantEdit(GrantFields):
    expected_revision: int = Field(ge=1)


class GrantAction(ApiModel):
    action: Literal["submit", "approve", "return", "comment", "check"]
    expected_revision: int = Field(ge=1)
    text: str = Field(default="", max_length=12000)
    item_id: UUID | None = None
    completed: bool | None = None


class GrantChecklistItem(ApiModel):
    id: str
    title: str
    completed: bool
    completed_by_user_id: str | None = None
    completed_at: datetime | None = None


class GrantSettings(ApiModel):
    leader_user_id: str | None
    chair_user_id: str | None
    revision: int


class GrantSettingsWrite(ApiModel):
    leader_user_id: UUID
    chair_user_id: UUID
    expected_revision: int = Field(ge=0)


class GrantReviewersWrite(GrantSettingsWrite):
    expected_revision: int = Field(ge=1)
    reason: str = Field(min_length=3, max_length=2000)


class GrantSummary(ApiModel):
    id: str
    title: str
    description: str
    author_user_id: str
    assignee_id: str
    co_assignee_ids: list[str]
    leader_user_id: str
    chair_user_id: str
    due_at: datetime
    status: GrantStatus
    revision: int
    checklist: list[GrantChecklistItem]
    result_text: str
    chat_id: str
    created_at: datetime
    updated_at: datetime
    allowed_actions: list[str]


class GrantEvent(ApiModel):
    id: str
    actor_user_id: str
    action: str
    text: str
    from_status: GrantStatus
    to_status: GrantStatus
    created_at: datetime


class GrantDetail(GrantSummary):
    events: list[GrantEvent]
    attachments: list[AttachmentResponse]
