from datetime import date, datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


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


class ChatPermissions(ApiModel):
    send_messages: bool = True
    upload_files: bool = True
    invite_members: bool = False
    manage_members: bool = False
    edit_info: bool = False


class ChatMemberResponse(ApiModel):
    user_id: str
    role: Literal["owner", "moderator", "member"]
    permissions: ChatPermissions


class CreateChatRequest(ApiModel):
    kind: Literal["direct", "group"]
    title: str = Field(default="", max_length=240)
    description: str = Field(default="", max_length=4000)
    member_ids: list[UUID] = Field(min_length=1, max_length=200)

    @model_validator(mode="after")
    def validate_chat(self) -> "CreateChatRequest":
        self.title = self.title.strip()
        if len(set(self.member_ids)) != len(self.member_ids):
            raise ValueError("Duplicate chat members")
        if self.kind == "group" and not self.title:
            raise ValueError("Group title is required")
        if self.kind == "direct" and len(self.member_ids) != 1:
            raise ValueError("Select exactly one colleague")
        return self


class UpdateChatRequest(ApiModel):
    title: str = Field(min_length=1, max_length=240)
    description: str = Field(default="", max_length=4000)

    @field_validator("title")
    @classmethod
    def nonblank_title(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("Group title is required")
        return value.strip()


class AddChatMembersRequest(ApiModel):
    member_ids: list[UUID] = Field(min_length=1, max_length=200)


class SetChatMemberRequest(ApiModel):
    role: Literal["moderator", "member"]
    permissions: ChatPermissions


class TransferChatOwnerRequest(ApiModel):
    user_id: UUID


class ChatSummaryResponse(ApiModel):
    id: str
    title: str
    kind: Literal["direct", "group", "department", "project", "task", "approval"]
    preview: str
    time: str
    unread: int
    description: str = ""
    owner_id: str | None = None
    members: list[ChatMemberResponse] = Field(default_factory=list)
    permissions: ChatPermissions = Field(default_factory=ChatPermissions)


class ChatMessageResponse(ApiModel):
    id: str
    chat_id: str
    author_id: str
    body: str
    time: str
    created_at: datetime
    own: bool
    reply_to_message_id: str | None = None
    mention_user_ids: list[str] = Field(default_factory=list)
    edited_at: datetime | None = None
    deleted_at: datetime | None = None
    revision: int = 1
    can_edit: bool = False


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
    reply_to_message_id: UUID | None = None
    mention_user_ids: list[UUID] = Field(default_factory=list, max_length=100)

    @field_validator("body")
    @classmethod
    def message_must_not_be_blank(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("Message must not be blank")
        return stripped


class EditMessageRequest(SendMessageRequest):
    expected_revision: int = Field(ge=1)


class DeleteMessageRequest(ApiModel):
    expected_revision: int = Field(ge=1)


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


ProjectStage = Literal["start", "preparation", "approval", "success", "failure"]
ProjectStatus = Literal["new", "in_progress", "completed"]


class ProjectStageActionResponse(ApiModel):
    id: str
    actor_user_id: str
    from_stage: ProjectStage | None
    to_stage: ProjectStage
    action: Literal["created", "moved"]
    comment: str | None
    created_at: datetime


class ProjectResponse(ApiModel):
    id: str
    code: str
    title: str
    description: str
    manager_user_id: str
    start_date: date | None
    end_date: date | None
    budget: int
    spent_budget: int
    remaining_budget: int
    currency: Literal["UZS", "USD", "EUR"]
    status: ProjectStatus
    stage: ProjectStage
    created_by_user_id: str
    created_at: datetime
    updated_at: datetime
    can_edit: bool
    can_move: bool
    history: list[ProjectStageActionResponse] = Field(default_factory=list)


class ProjectWriteRequest(ApiModel):
    code: str = Field(min_length=1, max_length=48)
    title: str = Field(min_length=1, max_length=240)
    description: str = Field(default="", max_length=20_000)
    manager_user_id: str
    start_date: date | None = None
    end_date: date | None = None
    budget: int = Field(default=0, ge=0)
    spent_budget: int = Field(default=0, ge=0)
    currency: Literal["UZS", "USD", "EUR"] = "UZS"

    @field_validator("code", "title")
    @classmethod
    def project_text_must_not_be_blank(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("Project code and title must not be blank")
        return stripped

    @model_validator(mode="after")
    def validate_project_limits(self) -> "ProjectWriteRequest":
        if (
            self.end_date is not None
            and self.start_date is not None
            and self.end_date < self.start_date
        ):
            raise ValueError("Project end date must not precede start date")
        if self.spent_budget > self.budget:
            raise ValueError("Spent budget must not exceed project budget")
        return self


class CreateProjectRequest(ProjectWriteRequest):
    pass


class UpdateProjectRequest(ProjectWriteRequest):
    pass


class ChangeProjectStageRequest(ApiModel):
    stage: ProjectStage
    comment: str = Field(default="", max_length=4000)


TripStage = Literal["launch", "manager_approval", "hr", "approved", "rejected"]
TripStatus = Literal["draft", "running", "needs_revision", "approved", "rejected"]
TripAction = Literal["submit", "approve", "return", "reject", "resubmit"]


class TripActionHistoryResponse(ApiModel):
    id: str
    actor_user_id: str
    from_stage: TripStage | None
    to_stage: TripStage
    action: Literal["created", "submit", "approve", "return", "reject", "resubmit"]
    comment: str | None
    created_at: datetime


class TripRequestResponse(ApiModel):
    id: str
    number: str
    requester_user_id: str
    purpose: str
    destination: str
    start_date: date
    end_date: date
    employee_ids: list[str]
    stage: TripStage
    stage_label: str
    status: TripStatus
    status_label: str
    can_edit: bool
    allowed_actions: list[TripAction]
    actions: list[TripActionHistoryResponse] = Field(default_factory=list)
    created_at: datetime
    updated_at: datetime
    finished_at: datetime | None


class TripWriteRequest(ApiModel):
    purpose: str = Field(min_length=1, max_length=4000)
    destination: str = Field(min_length=1, max_length=240)
    start_date: date
    end_date: date
    employee_ids: list[str] = Field(min_length=1, max_length=100)

    @field_validator("purpose", "destination")
    @classmethod
    def trip_text_must_not_be_blank(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("Trip purpose and destination must not be blank")
        return stripped

    @model_validator(mode="after")
    def validate_trip_dates(self) -> "TripWriteRequest":
        if self.end_date < self.start_date:
            raise ValueError("Trip end date must not precede start date")
        if len(set(self.employee_ids)) != len(self.employee_ids):
            raise ValueError("Trip employees must be unique")
        return self


class CreateTripRequest(TripWriteRequest):
    pass


class UpdateTripRequest(TripWriteRequest):
    pass


class TripActionRequest(ApiModel):
    action: TripAction
    comment: str = Field(default="", max_length=4000)


class FeedCommentResponse(ApiModel):
    id: str
    author_user_id: str
    body: str
    created_at: datetime


class FeedPostResponse(ApiModel):
    id: str
    author_user_id: str
    title: str
    body: str
    is_pinned: bool
    liked_by_current_user: bool
    like_count: int
    can_edit: bool
    can_pin: bool
    comments: list[FeedCommentResponse] = Field(default_factory=list)
    created_at: datetime
    updated_at: datetime


class CreateFeedPostRequest(ApiModel):
    title: str = Field(min_length=1, max_length=240)
    body: str = Field(min_length=1, max_length=20_000)

    @field_validator("title", "body")
    @classmethod
    def feed_text_must_not_be_blank(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("Feed post must not be blank")
        return stripped


class CreateFeedCommentRequest(ApiModel):
    body: str = Field(min_length=1, max_length=4000)

    @field_validator("body")
    @classmethod
    def feed_comment_must_not_be_blank(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("Feed comment must not be blank")
        return stripped


class PinFeedPostRequest(ApiModel):
    is_pinned: bool


CalendarEventType = Literal["meeting", "deadline", "trip", "task", "general"]


class CalendarEventResponse(ApiModel):
    id: str
    organizer_user_id: str
    title: str
    description: str
    event_type: CalendarEventType
    starts_at: datetime
    ends_at: datetime
    all_day: bool
    location: str
    status: Literal["scheduled", "cancelled"]
    attendee_ids: list[str]
    can_edit: bool
    created_at: datetime
    updated_at: datetime


class CalendarEventWriteRequest(ApiModel):
    title: str = Field(min_length=1, max_length=240)
    description: str = Field(default="", max_length=20_000)
    event_type: CalendarEventType = "general"
    starts_at: datetime
    ends_at: datetime
    all_day: bool = False
    location: str = Field(default="", max_length=240)
    attendee_ids: list[str] = Field(default_factory=list, max_length=100)

    @field_validator("title")
    @classmethod
    def event_title_must_not_be_blank(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("Calendar event title must not be blank")
        return stripped

    @model_validator(mode="after")
    def validate_event_period(self) -> "CalendarEventWriteRequest":
        if self.ends_at <= self.starts_at:
            raise ValueError("Calendar event end must be after start")
        if len(set(self.attendee_ids)) != len(self.attendee_ids):
            raise ValueError("Calendar attendees must be unique")
        return self


class CreateCalendarEventRequest(CalendarEventWriteRequest):
    pass


class UpdateCalendarEventRequest(CalendarEventWriteRequest):
    pass


NotificationKind = Literal["message", "task", "approval", "trip", "calendar"]
NotificationPriority = Literal["normal", "attention", "urgent"]
NotificationSection = Literal[
    "messenger",
    "tasks",
    "payment_requests",
    "trip_approvals",
    "calendar",
]


class NotificationResponse(ApiModel):
    id: str
    kind: NotificationKind
    priority: NotificationPriority
    title: str
    body: str
    section: NotificationSection
    entity_id: str | None
    requires_action: bool
    is_reminder: bool
    occurred_at: datetime
    read_at: datetime | None
    resolved_at: datetime | None
    desktop_delivered_at: datetime | None


class NotificationPreferencesResponse(ApiModel):
    desktop_enabled: bool = True
    messages_enabled: bool = True
    tasks_enabled: bool = True
    approvals_enabled: bool = True
    trips_enabled: bool = True
    calendar_enabled: bool = True
    reminders_enabled: bool = True


class NotificationPreferencesUpdate(ApiModel):
    desktop_enabled: bool
    messages_enabled: bool
    tasks_enabled: bool
    approvals_enabled: bool
    trips_enabled: bool
    calendar_enabled: bool
    reminders_enabled: bool


class WorkspaceBootstrapResponse(ApiModel):
    current_user: PersonResponse
    can_create_payment_requests: bool
    people: list[PersonResponse]
    positions: list[WorkflowPositionResponse]
    chats: list[ChatSummaryResponse]
    messages: list[ChatMessageResponse]
    tasks: list[TaskResponse]
    requests: list[ApprovalRequestResponse]
    projects: list[ProjectResponse]
    trip_requests: list[TripRequestResponse]
    feed_posts: list[FeedPostResponse]
    calendar_events: list[CalendarEventResponse]
    notifications: list[NotificationResponse]
    notification_preferences: NotificationPreferencesResponse
    attachments: list[AttachmentResponse]
    workflow: WorkflowResponse
