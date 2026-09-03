from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


def to_camel(value: str) -> str:
    first, *rest = value.split("_")
    return first + "".join(word.capitalize() for word in rest)


class ApiModel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


class PersonResponse(ApiModel):
    id: str
    username: str
    name: str
    initials: str
    role: str
    job_title: str | None
    color: str


class DevelopmentSessionRequest(ApiModel):
    username: str = Field(min_length=1, max_length=64)


class SessionResponse(ApiModel):
    access_token: str
    token_type: Literal["bearer"] = "bearer"
    user: PersonResponse


class ChatSummaryResponse(ApiModel):
    id: str
    title: str
    kind: Literal["direct", "group", "department", "project", "task", "approval"]
    preview: str
    time: str
    unread: int


class ChatMessageResponse(ApiModel):
    id: str
    chat_id: str
    author_id: str
    body: str
    time: str
    created_at: datetime
    own: bool


class SendMessageRequest(ApiModel):
    body: str = Field(min_length=1, max_length=20_000)

    @field_validator("body")
    @classmethod
    def message_must_not_be_blank(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("Message must not be blank")
        return stripped


TaskStatus = Literal[
    "new",
    "in_progress",
    "awaiting_review",
    "completed",
    "overdue",
    "cancelled",
]


class TaskResponse(ApiModel):
    id: str
    title: str
    description: str
    project: str
    assignee_id: str
    due_label: str
    status: TaskStatus
    priority: Literal["low", "normal", "high", "urgent"]
    checklist_done: int = 0
    checklist_total: int = 0
    source_message_id: str | None = None


class CreateTaskRequest(ApiModel):
    title: str = Field(min_length=1, max_length=240)
    description: str = Field(default="", max_length=20_000)
    project: str = Field(default="Без проекта", max_length=96)
    assignee_id: str | None = None
    source_message_id: str | None = None
    priority: Literal["low", "normal", "high", "urgent"] = "normal"


class ChangeTaskStatusRequest(ApiModel):
    status: TaskStatus


ApprovalStatus = Literal[
    "draft",
    "running",
    "needs_revision",
    "approved",
    "rejected",
    "cancelled",
]


class ApprovalRequestResponse(ApiModel):
    id: str
    number: str
    title: str
    amount: int
    currency: str
    status: ApprovalStatus
    status_label: str
    active_node_keys: list[str]
    requester_id: str
    source_task_id: str | None = None


class CreateApprovalRequest(ApiModel):
    title: str = Field(min_length=1, max_length=240)
    amount: int = Field(gt=0)
    currency: str = Field(default="UZS", min_length=3, max_length=3)
    purpose: str = Field(default="", max_length=20_000)
    source_task_id: str | None = None


class ApprovalActionRequest(ApiModel):
    action: Literal["approve", "reject", "return", "clarify", "delegate", "resubmit"]
    comment: str | None = Field(default=None, max_length=4000)


class WorkflowNodeResponse(ApiModel):
    id: str
    kind: Literal["start", "approval", "condition", "parallel", "correction", "end"]
    label: str
    detail: str
    position_x: float
    position_y: float
    config: dict[str, Any] = Field(default_factory=dict)


class WorkflowEdgeResponse(ApiModel):
    id: str
    source: str
    target: str
    outcome: str = "approve"
    label: str | None = None
    condition: dict[str, Any] = Field(default_factory=dict)
    sort_order: int = 0


class WorkflowResponse(ApiModel):
    id: str
    name: str
    version: int
    status: str
    nodes: list[WorkflowNodeResponse]
    edges: list[WorkflowEdgeResponse]


class SaveWorkflowRequest(ApiModel):
    nodes: list[WorkflowNodeResponse]
    edges: list[WorkflowEdgeResponse]


class WorkspaceBootstrapResponse(ApiModel):
    current_user: PersonResponse
    people: list[PersonResponse]
    chats: list[ChatSummaryResponse]
    messages: list[ChatMessageResponse]
    tasks: list[TaskResponse]
    requests: list[ApprovalRequestResponse]
    workflow: WorkflowResponse
