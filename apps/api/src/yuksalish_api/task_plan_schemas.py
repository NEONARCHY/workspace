"""Plans are task-module records; a task may belong to several plans."""

from datetime import date, datetime
from typing import Literal

from pydantic import Field, model_validator

from .workspace_schemas import ApiModel

PlanKind = Literal["work", "regional", "other"]


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
