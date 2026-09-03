from datetime import date, datetime
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
    position_id: str | None
    job_title: str | None
    color: str


class WorkflowPositionResponse(ApiModel):
    id: str
    name: str


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
    document_role: Literal["general", "primary", "additional"] = "general"
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


TaskParticipantRole = Literal["co_assignee", "observer"]


class TaskParticipantResponse(ApiModel):
    user_id: str
    role: TaskParticipantRole


class TaskChecklistItemResponse(ApiModel):
    id: str
    title: str
    is_completed: bool
    sort_order: int
    created_by_user_id: str
    completed_by_user_id: str | None
    completed_at: datetime | None
    created_at: datetime


class TaskCommentResponse(ApiModel):
    id: str
    author_user_id: str
    body: str
    created_at: datetime
    edited_at: datetime | None


class TaskDependencyResponse(ApiModel):
    depends_on_task_id: str
    dependency_kind: Literal["blocks", "relates"]
    title: str
    status: TaskStatus


class TaskCycleResponse(ApiModel):
    id: str
    title: str
    schedule_kind: Literal["daily", "weekly", "monthly"]
    interval: int
    timezone: str
    next_run_at: datetime | None
    is_enabled: bool


class TaskResponse(ApiModel):
    id: str
    title: str
    description: str
    project: str
    author_id: str
    assignee_id: str
    due_label: str
    starts_at: datetime | None
    due_at: datetime | None
    status: TaskStatus
    priority: Literal["low", "normal", "high", "urgent"]
    checklist_done: int = 0
    checklist_total: int = 0
    source_message_id: str | None = None
    result_text: str | None = None
    participants: list[TaskParticipantResponse] = Field(default_factory=list)
    checklist: list[TaskChecklistItemResponse] = Field(default_factory=list)
    comments: list[TaskCommentResponse] = Field(default_factory=list)
    dependencies: list[TaskDependencyResponse] = Field(default_factory=list)
    cycle: TaskCycleResponse | None = None


class CreateTaskRequest(ApiModel):
    title: str = Field(min_length=1, max_length=240)
    description: str = Field(default="", max_length=20_000)
    project: str = Field(default="Без проекта", max_length=96)
    assignee_id: str | None = None
    source_message_id: str | None = None
    priority: Literal["low", "normal", "high", "urgent"] = "normal"
    due_at: datetime | None = None

    @field_validator("title")
    @classmethod
    def create_task_title_must_not_be_blank(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("Task title must not be blank")
        return stripped


class UpdateTaskRequest(ApiModel):
    title: str = Field(min_length=1, max_length=240)
    description: str = Field(default="", max_length=20_000)
    project: str = Field(default="Без проекта", max_length=96)
    assignee_id: str
    priority: Literal["low", "normal", "high", "urgent"] = "normal"
    due_at: datetime | None = None

    @field_validator("title")
    @classmethod
    def task_title_must_not_be_blank(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("Task title must not be blank")
        return stripped


class ChangeTaskStatusRequest(ApiModel):
    status: TaskStatus


class TaskParticipantRequest(ApiModel):
    user_id: str
    role: TaskParticipantRole


class CreateChecklistItemRequest(ApiModel):
    title: str = Field(min_length=1, max_length=500)

    @field_validator("title")
    @classmethod
    def checklist_title_must_not_be_blank(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("Checklist title must not be blank")
        return stripped


class UpdateChecklistItemRequest(ApiModel):
    is_completed: bool


class CreateTaskCommentRequest(ApiModel):
    body: str = Field(min_length=1, max_length=20_000)

    @field_validator("body")
    @classmethod
    def comment_must_not_be_blank(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("Comment must not be blank")
        return stripped


class TaskDependencyRequest(ApiModel):
    depends_on_task_id: str
    dependency_kind: Literal["blocks", "relates"] = "blocks"


class TaskCycleRequest(ApiModel):
    title: str = Field(min_length=1, max_length=240)
    schedule_kind: Literal["daily", "weekly", "monthly"]
    interval: int = Field(default=1, ge=1, le=365)
    timezone: str = Field(default="Asia/Tashkent", min_length=1, max_length=64)
    next_run_at: datetime | None = None
    is_enabled: bool = True


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
    delegated_to_user_id: str | None = None
    node_key: str
    created_at: datetime


class ApprovalStageResponse(ApiModel):
    key: str
    label: str
    kind: str
    can_act: bool = False


class PaymentRequestDetails(ApiModel):
    transfer_type: (
        Literal[
            "Гонорар (с расчетом)",  # noqa: RUF001 - Cyrillic enum value
            "Конвертация",
            "Другие услуги",
        ]
        | None
    ) = None
    project_name: str = Field(default="", max_length=240)
    project_code: str = Field(default="", max_length=96)
    source_account: str = Field(default="", max_length=500)
    destination_account: str = Field(default="", max_length=500)
    request_priority: Literal["normal", "urgent"] = "normal"
    deadline: datetime | None = None
    comment: str = Field(default="", max_length=20_000)
    trip_purpose: str = Field(default="", max_length=4000)
    trip_start_date: date | None = None
    trip_end_date: date | None = None
    employee_ids: list[str] = Field(default_factory=list, max_length=100)
    payment_purpose: (
        Literal[
            "Мероприятия",
            "Гонорары",
            "Зарплаты",
            "Перелеты",
            "Оплата за услуги",
            "Другие",
        ]
        | None
    ) = None
    payment_reason: str = Field(default="", max_length=20_000)
    responsible_user_id: str | None = None

    @field_validator("trip_end_date")
    @classmethod
    def trip_dates_must_be_ordered(cls, value: date | None, info: Any) -> date | None:
        start = info.data.get("trip_start_date")
        if value is not None and start is not None and value < start:
            raise ValueError("Trip end date must not be before its start date")
        return value


class ApprovalRequestResponse(ApiModel):
    id: str
    number: str
    title: str
    amount: int
    currency: str
    status: ApprovalStatus
    status_label: str
    active_node_keys: list[str]
    active_stages: list[ApprovalStageResponse] = Field(default_factory=list)
    stage_label: str
    requester_id: str
    responsible_user_id: str
    source_task_id: str | None = None
    purpose: str = ""
    details: PaymentRequestDetails = Field(default_factory=PaymentRequestDetails)
    created_at: datetime
    updated_at: datetime
    revision: int = 1
    versions: list["ApprovalRequestVersionResponse"] = Field(default_factory=list)
    actions: list[ApprovalActionHistoryResponse] = Field(default_factory=list)


class ApprovalRequestVersionResponse(ApiModel):
    version: int
    title: str
    amount: int
    currency: str
    purpose: str
    details: PaymentRequestDetails = Field(default_factory=PaymentRequestDetails)
    attachment_ids: list[str]
    edited_by_user_id: str
    change_reason: str
    change_comment: str | None
    created_at: datetime


class CreateApprovalRequest(PaymentRequestDetails):
    title: str = Field(min_length=1, max_length=240)
    amount: int = Field(gt=0)
    currency: str = Field(default="UZS", min_length=3, max_length=3)
    purpose: str = Field(default="", max_length=20_000)
    source_task_id: str | None = None

    @field_validator("title")
    @classmethod
    def create_title_must_not_be_blank(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("Title must not be blank")
        return stripped


class UpdateApprovalRequest(PaymentRequestDetails):
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
    action: Literal[
        "approve",
        "reject",
        "return",
        "clarify",
        "delegate",
        "resubmit",
        "cancel",
    ]
    comment: str | None = Field(default=None, max_length=4000)
    node_key: str | None = Field(default=None, max_length=96)
    delegate_to_user_id: str | None = None


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
    published_version: int | None = None
    form_schema: dict[str, Any] = Field(default_factory=dict)
    nodes: list[WorkflowNodeResponse]
    edges: list[WorkflowEdgeResponse]


class SaveWorkflowRequest(ApiModel):
    nodes: list[WorkflowNodeResponse]
    edges: list[WorkflowEdgeResponse]


class WorkspaceBootstrapResponse(ApiModel):
    current_user: PersonResponse
    can_create_payment_requests: bool
    people: list[PersonResponse]
    positions: list[WorkflowPositionResponse]
    chats: list[ChatSummaryResponse]
    messages: list[ChatMessageResponse]
    tasks: list[TaskResponse]
    requests: list[ApprovalRequestResponse]
    attachments: list[AttachmentResponse]
    workflow: WorkflowResponse
