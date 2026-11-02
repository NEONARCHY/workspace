"""Employee-authored drafts that require the named author's explicit consent."""

from datetime import date, datetime
from typing import Literal
from uuid import UUID

from pydantic import ConfigDict, Field, model_validator

from .workspace_schemas import ApiModel, CreateTaskRequest


class TaskProposalWrite(ApiModel):
    model_config = ConfigDict(extra="forbid")
    request_id: UUID
    author_user_id: UUID
    task: CreateTaskRequest


class TaskProposalDecision(ApiModel):
    model_config = ConfigDict(extra="forbid")
    action: Literal["approve", "reject", "cancel"]
    reason: str = Field(default="", max_length=2000)
    assignee_id: UUID | None = None
    due_at: datetime | None = None
    import_reviewed: bool = False


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
    import_batch_id: str | None = None
    import_source_key: str | None = None


class TaskProposalImportContext(ApiModel):
    can_import: bool
    chair_user_id: str | None = None
    chair_name: str | None = None
    configuration_error: str | None = None


class TaskProposalImportRow(ApiModel):
    source_key: str
    number_hint: str
    title: str
    description: str
    assignee_hint: str
    coexecutor_hints: list[str]
    due_date_hint: date | None
    due_at_hint: datetime | None
    deadline_text: str
    note: str
    warnings: list[str]


class TaskProposalImportPreview(ApiModel):
    source_name: str
    rows: list[TaskProposalImportRow]


class TaskProposalImportItem(ApiModel):
    model_config = ConfigDict(extra="forbid")
    source_key: str = Field(min_length=1, max_length=300)
    task: CreateTaskRequest


class TaskProposalImportWrite(ApiModel):
    model_config = ConfigDict(extra="forbid")
    request_id: UUID
    author_user_id: UUID
    source_name: str = Field(min_length=1, max_length=240)
    items: list[TaskProposalImportItem] = Field(min_length=1, max_length=100)

    @model_validator(mode="after")
    def unique_rows(self) -> "TaskProposalImportWrite":
        keys = [item.source_key for item in self.items]
        if len(keys) != len(set(keys)):
            raise ValueError("Source rows must be unique")
        if any(not key.strip() for key in keys):
            raise ValueError("Source rows must not be blank")
        return self


class TaskProposalImportResult(ApiModel):
    batch_id: str
    proposals: list[TaskProposalResponse]
    reused: bool = False
