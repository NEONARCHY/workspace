from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import Field, field_validator

from .workspace_schemas import ApiModel


class EmployeeStatusUpdateRequest(ApiModel):
    status: Literal["active", "blocked", "archived"]
    reason: str = Field(min_length=12, max_length=500)

    @field_validator("reason")
    @classmethod
    def reason_must_be_meaningful(cls, value: str) -> str:
        normalized = " ".join(value.split())
        if len(normalized) < 12:
            raise ValueError("Reason must contain at least 12 characters")
        return normalized


class AdministrativeChatMemberResponse(ApiModel):
    user_id: str
    name: str
    status: str


class AdministrativeChatResponse(ApiModel):
    id: str
    title: str
    kind: str
    members: list[AdministrativeChatMemberResponse]
    message_count: int
    updated_at: datetime


class AdministrativeChatMessageResponse(ApiModel):
    id: str
    author_user_id: str
    author_name: str
    body: str
    created_at: datetime
    edited_at: datetime | None = None
    deleted_at: datetime | None = None


class AdministrativeChatInspectionCreateRequest(ApiModel):
    chat_id: UUID
    reason: str = Field(min_length=12, max_length=500)
    duration_minutes: Literal[15, 30, 60] = 30

    @field_validator("reason")
    @classmethod
    def reason_must_be_meaningful(cls, value: str) -> str:
        normalized = " ".join(value.split())
        if len(normalized) < 12:
            raise ValueError("Reason must contain at least 12 characters")
        return normalized


class AdministrativeChatInspectionResponse(ApiModel):
    id: str
    chat: AdministrativeChatResponse
    messages: list[AdministrativeChatMessageResponse]
    reason: str
    created_at: datetime
    expires_at: datetime
    total_messages: int
    truncated: bool
