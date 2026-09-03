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


AttachmentOwnerType = Literal["message", "task", "approval_request"]


class AttachmentResponse(ApiModel):
    id: str
    owner_type: AttachmentOwnerType
    owner_id: str
    file_name: str
    content_type: str
    byte_size: int
    sha256: str
    uploaded_by_user_id: str
    created_at: datetime


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


class ApprovalActionHistoryResponse(ApiModel):
    action: str
    comment: str | None
    actor_user_id: str
    node_key: str
    created_at: datetime


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
    purpose: str = ""
    revision: int = 1
    versions: list["ApprovalRequestVersionResponse"] = Field(default_factory=list)
    actions: list[ApprovalActionHistoryResponse] = Field(default_factory=list)


class ApprovalRequestVersionResponse(ApiModel):
    version: int
    title: str
    amount: int
    currency: str
    purpose: str
    attachment_ids: list[str]
    edited_by_user_id: str
    change_reason: str
    change_comment: str | None
    created_at: datetime


class CreateApprovalRequest(ApiModel):
    title: str = Field(min_length=1, max_length=240)
    amount: int = Field(gt=0)
    currency: str = Field(default="UZS", min_length=3, max_length=3)
    purpose: str = Field(default="", max_length=20_000)
    source_task_id: str | None = None


class UpdateApprovalRequest(ApiModel):
    title: str = Field(min_length=1, max_length=240)
    amount: int = Field(gt=0)
    currency: str = Field(default="UZS", min_length=3, max_length=3)
    purpose: str = Field(default="", max_length=20_000)
    change_comment: str | None = Field(default=None, max_length=4000)

    @field_validator("title")
    @classmethod
    def title_must_not_be_blank(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("Title must not be blank")
        return stripped


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
    attachments: list[AttachmentResponse]
    workflow: WorkflowResponse
