from datetime import datetime
from typing import Literal

from pydantic import Field, field_validator, model_validator

from .workspace_schemas import ApiModel

SupportCategory = Literal["comment", "bug", "improvement"]
SupportStatus = Literal["open", "implemented", "rejected"]
SupportTone = Literal["positive", "negative"]
SupportRejectionReason = Literal[
    "insufficient_information",
    "not_needed",
    "already_implemented",
]
SupportMessageKind = Literal["submission", "comment", "implemented", "rejected"]


class SupportRequestCreate(ApiModel):
    category: SupportCategory
    subject: str = Field(min_length=3, max_length=160)
    body: str = Field(min_length=8, max_length=10_000)

    @field_validator("subject", "body", mode="before")
    @classmethod
    def strip_text(cls, value: object) -> object:
        return value.strip() if isinstance(value, str) else value


class SupportAdminAction(ApiModel):
    action: Literal["comment", "implement", "reject"]
    body: str = Field(default="", max_length=10_000)
    rejection_reason: SupportRejectionReason | None = None

    @field_validator("body", mode="before")
    @classmethod
    def strip_body(cls, value: object) -> object:
        return value.strip() if isinstance(value, str) else value

    @model_validator(mode="after")
    def validate_action(self) -> "SupportAdminAction":
        if self.action == "comment" and len(self.body) < 2:
            raise ValueError("Напишите комментарий для сотрудника")
        if self.action == "reject" and self.rejection_reason is None:
            raise ValueError("Выберите причину отклонения")
        if self.action != "reject" and self.rejection_reason is not None:
            raise ValueError("Причина отклонения допустима только при отклонении")
        return self


class SupportMessageResponse(ApiModel):
    id: str
    request_id: str
    author_id: str
    author_name: str
    kind: SupportMessageKind
    body: str
    created_at: datetime


class SupportRequestResponse(ApiModel):
    id: str
    author_id: str
    author_name: str
    author_username: str
    category: SupportCategory
    subject: str
    body: str
    status: SupportStatus
    resolution_code: SupportRejectionReason | Literal["implemented"] | None
    response_unread: bool
    latest_response_tone: SupportTone | None
    created_at: datetime
    updated_at: datetime
    resolved_at: datetime | None
    messages: list[SupportMessageResponse]


class SupportRegistryResponse(ApiModel):
    mode: Literal["support", "inbox"]
    indicator: SupportTone | None = None
    unread_response_count: int = Field(ge=0)
    requests: list[SupportRequestResponse]
