"""Contracts for the standalone project workspace and its funding queue."""

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from .workspace_schemas import AttachmentResponse


class HubModel(BaseModel):
    model_config = ConfigDict(
        alias_generator=lambda value: "".join(
            part.capitalize() if index else part for index, part in enumerate(value.split("_"))
        ),
        populate_by_name=True,
        from_attributes=True,
    )


class ProjectHubWrite(HubModel):
    code: str = Field(min_length=1, max_length=48)
    title: str = Field(min_length=1, max_length=240)
    description: str = Field(default="", max_length=20_000)
    manager_user_id: str
    responsible_user_ids: list[str] = Field(default_factory=list, max_length=100)
    approver_user_ids: list[str] = Field(default_factory=list, max_length=20)
    start_date: date | None = None
    end_date: date | None = None
    budget: int = Field(default=0, ge=0, le=9_007_199_254_740_991)
    currency: Literal["UZS", "USD", "EUR"] = "UZS"
    access_status: Literal["open", "closed"] = "open"
    lifecycle_status: Literal["active", "completed"] = "active"

    @model_validator(mode="after")
    def validate_project(self) -> "ProjectHubWrite":
        self.code = self.code.strip().upper()
        self.title = self.title.strip()
        if not self.code or not self.title:
            raise ValueError("Project code and title are required")
        if self.start_date and self.end_date and self.end_date < self.start_date:
            raise ValueError("Project end date must not precede start date")
        if len(set(self.approver_user_ids)) != len(self.approver_user_ids):
            raise ValueError("Approvers must be unique")
        if len(set(self.responsible_user_ids)) != len(self.responsible_user_ids):
            raise ValueError("Responsible people must be unique")
        return self


class ProjectHubResponse(ProjectHubWrite):
    id: str
    created_by_user_id: str
    created_at: datetime
    updated_at: datetime
    approved_amount: int
    can_edit: bool


class ProjectWorkstreamWrite(HubModel):
    title: str = Field(min_length=1, max_length=240)
    description: str = Field(default="", max_length=20_000)

    @model_validator(mode="after")
    def validate_workstream(self) -> "ProjectWorkstreamWrite":
        self.title = self.title.strip()
        if not self.title:
            raise ValueError("Workstream title is required")
        return self


class ProjectWorkstreamResponse(ProjectWorkstreamWrite):
    id: str
    project_id: str
    sort_order: int
    created_at: datetime
    updated_at: datetime


class ProjectWorkItemWrite(HubModel):
    workstream_id: str | None = None
    kind: Literal["task", "event"]
    title: str = Field(min_length=1, max_length=240)
    description: str = Field(default="", max_length=20_000)
    starts_at: datetime | None = None
    due_at: datetime | None = None
    budget: int = Field(default=0, ge=0, le=9_007_199_254_740_991)
    assignee_user_ids: list[str] = Field(default_factory=list, max_length=100)

    @model_validator(mode="after")
    def validate_item(self) -> "ProjectWorkItemWrite":
        self.title = self.title.strip()
        if not self.title:
            raise ValueError("Work item title is required")
        if self.kind == "event" and (self.starts_at is None or self.due_at is None):
            raise ValueError("An event requires start and end times")
        if self.starts_at and self.due_at and self.due_at <= self.starts_at:
            raise ValueError("End time must follow start time")
        if any(value and value.tzinfo is None for value in (self.starts_at, self.due_at)):
            raise ValueError("Project work times must include a timezone")
        if len(set(self.assignee_user_ids)) != len(self.assignee_user_ids):
            raise ValueError("Assignees must be unique")
        return self


class ProjectWorkItemResponse(ProjectWorkItemWrite):
    workstream_id: str
    id: str
    project_id: str
    status: Literal["planned", "active", "completed", "cancelled"]
    calendar_event_id: str | None
    created_by_user_id: str
    created_at: datetime
    updated_at: datetime
    request_count: int
    approved_request_count: int


class ProjectWorkStatusWrite(HubModel):
    status: Literal["planned", "active", "completed", "cancelled"]


class ProjectFundingWrite(HubModel):
    item_id: str
    title: str = Field(min_length=1, max_length=240)
    purpose: str = Field(default="", max_length=20_000)
    amount: int = Field(gt=0, le=9_007_199_254_740_991)
    approval_due_at: datetime | None = None

    @model_validator(mode="after")
    def validate_request(self) -> "ProjectFundingWrite":
        self.title = self.title.strip()
        if not self.title:
            raise ValueError("Request title is required")
        if self.approval_due_at is not None and self.approval_due_at.tzinfo is None:
            raise ValueError("Approval deadline must include a timezone")
        return self


class ProjectFundingAction(HubModel):
    action: Literal["approve", "reject"]
    comment: str = Field(default="", max_length=4000)


class ProjectFundingActionResponse(HubModel):
    actor_user_id: str
    action: Literal["submit", "approve", "reject"]
    step: int
    comment: str | None
    created_at: datetime


class ProjectFundingResponse(HubModel):
    id: str
    project_id: str
    project_title: str
    item_id: str
    item_title: str
    title: str
    purpose: str
    amount: int
    currency: str
    status: Literal["pending", "approved", "rejected"]
    approver_user_ids: list[str]
    current_step: int
    approval_due_at: datetime | None
    requester_user_id: str
    created_at: datetime
    updated_at: datetime
    can_decide: bool
    actions: list[ProjectFundingActionResponse] = Field(default_factory=list)
    attachments: list[AttachmentResponse] = Field(default_factory=list)


class ProjectHubOverview(HubModel):
    projects: list[ProjectHubResponse]
    workstreams: list[ProjectWorkstreamResponse]
    items: list[ProjectWorkItemResponse]
    requests: list[ProjectFundingResponse]
