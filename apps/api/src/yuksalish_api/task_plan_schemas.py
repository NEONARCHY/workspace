"""Plans are task-module records; a task may belong to several plans."""

from datetime import date, datetime
from typing import Literal
from uuid import UUID

from pydantic import Field, model_validator

from .workspace_schemas import ApiModel

PlanKind = Literal["work", "regional", "other"]
MAX_PLAN_IMPORT_ITEMS = 250


class TaskPlanWrite(ApiModel):
    title: str = Field(min_length=1, max_length=240)
    kind: PlanKind = "work"
    period_start: date | None = None
    period_end: date | None = None

    @model_validator(mode="after")
    def validate_plan(self) -> "TaskPlanWrite":
        self.title = self.title.strip()
        if not self.title:
            raise ValueError("Plan title must not be blank")
        if self.period_start and self.period_end and self.period_end < self.period_start:
            raise ValueError("Plan end must not precede start")
        return self


class TaskPlanResponse(TaskPlanWrite):
    id: str
    created_by_user_id: str
    created_at: datetime
    updated_at: datetime
    task_ids: list[str] = Field(default_factory=list)


class TaskPlanImportRow(ApiModel):
    title: str = Field(min_length=1, max_length=240)
    source: str = Field(max_length=300)
    warning: str | None = None


class TaskPlanImportPreview(ApiModel):
    suggested_title: str
    rows: list[TaskPlanImportRow]


class TaskPlanImportItem(ApiModel):
    title: str = Field(min_length=1, max_length=240)
    source: str = Field(max_length=300)
    mode: Literal["create", "link"]
    assignee_id: UUID | None = None
    due_at: datetime | None = None
    task_id: UUID | None = None

    @model_validator(mode="after")
    def validate_mode(self) -> "TaskPlanImportItem":
        self.title = self.title.strip()
        if not self.title:
            raise ValueError("Task title must not be blank")
        if self.mode == "link" and self.task_id is None:
            raise ValueError("Select a task to link")
        if self.mode == "create" and self.task_id is not None:
            raise ValueError("New task cannot reference an existing task")
        return self


class TaskPlanImportConfirm(ApiModel):
    operation_id: UUID
    plan: TaskPlanWrite
    items: list[TaskPlanImportItem] = Field(min_length=1, max_length=MAX_PLAN_IMPORT_ITEMS)
