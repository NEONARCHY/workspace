"""Employee-authored drafts that require the named author's explicit consent."""

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import Field

from .workspace_schemas import ApiModel, CreateTaskRequest


class TaskProposalWrite(ApiModel):
    request_id: UUID
    author_user_id: UUID
    task: CreateTaskRequest


class TaskProposalDecision(ApiModel):
    action: Literal["approve", "reject", "cancel"]
    reason: str = Field(default="", max_length=2000)


class TaskProposalResponse(ApiModel):
    id: str
    creator_user_id: str
    author_user_id: str
    status: Literal["pending", "approved", "rejected", "cancelled"]
    task: CreateTaskRequest
    task_id: str | None
    reason: str
    created_at: datetime
    decided_at: datetime | None
