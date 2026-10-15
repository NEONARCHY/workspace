"""Plans are task-module records; a task may belong to several plans."""

from datetime import date, datetime
from typing import Literal
from uuid import UUID

from pydantic import Field, model_validator

from .workspace_schemas import ApiModel

PlanKind = Literal["work", "regional", "other"]
PlanStatus = Literal["active", "completed"]
MAX_PLAN_IMPORT_ITEMS = 250


class TaskPlanWrite(ApiModel):
    title: str = Field(min_length=1, max_length=240)
    kind: PlanKind = "work"
    period_start: date | None = None
    period_end: date | None = None
    owner_user_id: UUID | None = None

    @model_validator(mode="after")
    def validate_plan(self) -> "TaskPlanWrite":
        self.title = self.title.strip()
        if not self.title:
            raise ValueError("Plan title must not be blank")
        if self.period_start and self.period_end and self.period_end < self.period_start:
            raise ValueError("Plan end must not precede start")
        return self


class TaskPlanResponse(ApiModel):
    id: str
    title: str
    kind: PlanKind
    period_start: date | None
    period_end: date | None
    owner_user_id: str
    status: PlanStatus
    created_by_user_id: str
    created_at: datetime
    updated_at: datetime
    task_ids: list[str] = Field(default_factory=list)


class TaskPlanStatusWrite(ApiModel):
    status: PlanStatus


class TaskPlanImportRow(ApiModel):
    title: str = Field(min_length=1, max_length=240)
    source: str = Field(max_length=300)
    warning: str | None = None
    assignee_hint: str | None = Field(default=None, max_length=240)
    coexecutors_hint: str | None = Field(default=None, max_length=1000)
    group_key: str | None = Field(default=None, max_length=120)
    due_date_hint: date | None = None
    deadline_text: str | None = Field(default=None, max_length=1000)
    mechanism_items: list[str] = Field(default_factory=list, max_length=200)
    completed_work_text: str | None = Field(default=None, max_length=20_000)
    original_title: str | None = Field(default=None, max_length=2000)
    responsible_text: str | None = Field(default=None, max_length=1000)
    executors_text: str | None = Field(default=None, max_length=1000)
    section: str | None = Field(default=None, max_length=500)
    green_completion: bool = False
    deadline_needs_review: bool = False


class TaskPlanImportPreview(ApiModel):
    suggested_title: str
    rows: list[TaskPlanImportRow]
    annual_work_plan: bool = False


class TaskPlanImportItem(ApiModel):
    title: str = Field(min_length=1, max_length=240)
    source: str = Field(max_length=300)
    mode: Literal["create", "link"]
    assignee_id: UUID | None = None
    co_assignee_ids: list[UUID] = Field(default_factory=list, max_length=100)
    due_at: datetime | None = None
    task_id: UUID | None = None
    description: str = Field(default="", max_length=20_000)
    checklist: list[str] = Field(default_factory=list, max_length=200)
    historical_completed: bool = False

    @model_validator(mode="after")
    def validate_mode(self) -> "TaskPlanImportItem":
        self.title = self.title.strip()
        if not self.title:
            raise ValueError("Task title must not be blank")
        if self.mode == "link" and self.task_id is None:
            raise ValueError("Select a task to link")
        if self.mode == "create" and self.task_id is not None:
            raise ValueError("New task cannot reference an existing task")
        if self.mode == "link" and self.co_assignee_ids:
            raise ValueError("Linked task participants cannot be changed by import")
        if self.mode == "link" and (
            self.description or self.checklist or self.historical_completed
        ):
            raise ValueError("Linked task contents cannot be changed by import")
        if any(not title.strip() or len(title) > 500 for title in self.checklist):
            raise ValueError("Checklist steps must contain 1 to 500 characters")
        if self.historical_completed and self.due_at is None:
            raise ValueError("Historical completion requires a reviewed deadline")
        if len(self.co_assignee_ids) != len(set(self.co_assignee_ids)):
            raise ValueError("Co-assignees must be unique")
        if self.assignee_id in self.co_assignee_ids:
            raise ValueError("The responsible person cannot also be a co-assignee")
        return self


class TaskPlanImportConfirm(ApiModel):
    operation_id: UUID
    plan: TaskPlanWrite
    items: list[TaskPlanImportItem] = Field(min_length=1, max_length=MAX_PLAN_IMPORT_ITEMS)
    annual_work_plan: bool = False
