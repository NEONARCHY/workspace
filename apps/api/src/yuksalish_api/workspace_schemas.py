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
    department_id: str | None
    position_id: str | None
    job_title: str | None
    color: str
    status: Literal["pending", "active", "blocked", "archived"]
    avatar_version: str | None = None


class ProfileAvatarResponse(ApiModel):
    avatar_version: str


class ModulePermissionSet(ApiModel):
    view: bool
    create: bool
    edit: bool
    approve: bool
    admin: bool


class EffectiveModuleAccessResponse(ApiModel):
    module_key: str
    permissions: ModulePermissionSet


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
    manage_messages: bool = False


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
    context_type: str | None = None
    context_id: str | None = None
    preview: str
    time: str
    unread: int
    description: str = ""
    owner_id: str | None = None
    can_delete: bool = False
    members: list[ChatMemberResponse] = Field(default_factory=list)
    permissions: ChatPermissions = Field(default_factory=ChatPermissions)


class MessageReactionResponse(ApiModel):
    emoji: str = Field(min_length=1, max_length=16)
    count: int = Field(ge=1)
    reacted_by_current_user: bool = False


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
    can_delete: bool = False
    reactions: list[MessageReactionResponse] = Field(default_factory=list)
    is_pinned: bool = False
    pinned_at: datetime | None = None
    pinned_by_user_id: str | None = None
    can_pin: bool = False


class LinkPreviewResponse(ApiModel):
    url: str
    canonical_url: str
    kind: Literal["page", "video", "youtube", "instagram"]
    title: str
    description: str = ""
    site_name: str
    image_url: str | None = None
    embed_url: str | None = None


AttachmentOwnerType = Literal[
    "message", "task", "approval_request", "absence", "ai_referent_letter"
]


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
    media_kind: Literal["file", "voice"] = "file"
    media_duration_ms: int | None = Field(default=None, ge=500, le=600_000)
    media_codec: Literal["opus"] | None = None
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


class MessageReactionRequest(ApiModel):
    emoji: str = Field(min_length=1, max_length=16)


class PinMessageRequest(ApiModel):
    pinned: bool


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
    reactions: list[MessageReactionResponse] = Field(default_factory=list)


class TaskDependencyResponse(ApiModel):
    depends_on_task_id: str
    dependency_kind: Literal["blocks", "relates"]
    title: str
    status: TaskStatus


class TaskCycleResponse(ApiModel):
    id: str
    title: str
    schedule_kind: Literal["daily", "weekly", "monthly", "calendar"]
    interval: int
    calendar_rule: Literal["weekdays", "month_days"] | None = None
    weekdays: list[int] = Field(default_factory=list)
    month_days: list[int] = Field(default_factory=list)
    timezone: str
    next_run_at: datetime | None
    is_enabled: bool


class TaskReturnResponse(ApiModel):
    reason_code: str
    reason_text: str | None = None
    actor_user_id: str
    created_at: datetime


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
    calendar_event_id: str | None = None
    result_text: str | None = None
    parent_task_id: str | None = None
    parent_task_title: str | None = None
    chat_id: str | None = None
    latest_return: TaskReturnResponse | None = None
    participants: list[TaskParticipantResponse] = Field(default_factory=list)
    checklist: list[TaskChecklistItemResponse] = Field(default_factory=list)
    comments: list[TaskCommentResponse] = Field(default_factory=list)
    dependencies: list[TaskDependencyResponse] = Field(default_factory=list)
    cycle: TaskCycleResponse | None = None


class TaskCreateParticipantRequest(ApiModel):
    user_id: str
    role: TaskParticipantRole


class TaskCreateChecklistItemRequest(ApiModel):
    title: str = Field(min_length=1, max_length=500)

    @field_validator("title")
    @classmethod
    def checklist_title_must_not_be_blank(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("Checklist title must not be blank")
        return stripped


class TaskCreateDependencyRequest(ApiModel):
    depends_on_task_id: str
    dependency_kind: Literal["blocks", "relates"] = "blocks"


class TaskCreateCycleRequest(ApiModel):
    title: str = Field(min_length=1, max_length=240)
    schedule_kind: Literal["daily", "weekly", "monthly", "calendar"]
    interval: int = Field(default=1, ge=1, le=365)
    calendar_rule: Literal["weekdays", "month_days"] | None = None
    weekdays: list[int] = Field(default_factory=list, max_length=7)
    month_days: list[int] = Field(default_factory=list, max_length=31)
    timezone: str = Field(default="Asia/Tashkent", min_length=1, max_length=64)
    next_run_at: datetime | None = None
    is_enabled: bool = True

    @model_validator(mode="after")
    def validate_calendar_rule(self) -> "TaskCreateCycleRequest":
        self.weekdays = sorted(set(self.weekdays))
        self.month_days = sorted(set(self.month_days))
        if any(day < 0 or day > 6 for day in self.weekdays):
            raise ValueError("Weekdays must be between 0 and 6")
        if any(day < 1 or day > 31 for day in self.month_days):
            raise ValueError("Month days must be between 1 and 31")
        if self.schedule_kind != "calendar":
            self.calendar_rule = None
            self.weekdays = []
            self.month_days = []
            return self
        if self.calendar_rule == "weekdays" and self.weekdays:
            self.month_days = []
            return self
        if self.calendar_rule == "month_days" and self.month_days:
            self.weekdays = []
            return self
        raise ValueError("Select at least one calendar day")


class CreateTaskRequest(ApiModel):
    title: str = Field(min_length=1, max_length=240)
    description: str = Field(default="", max_length=20_000)
    project: str = Field(default="Без проекта", max_length=96)
    assignee_id: str | None = None
    source_message_id: str | None = None
    calendar_event_id: str | None = None
    parent_task_id: str | None = None
    priority: Literal["low", "normal", "high", "urgent"] = "normal"
    due_at: datetime | None = None
    participants: list[TaskCreateParticipantRequest] = Field(default_factory=list, max_length=100)
    checklist: list[TaskCreateChecklistItemRequest] = Field(default_factory=list, max_length=200)
    dependencies: list[TaskCreateDependencyRequest] = Field(default_factory=list, max_length=100)
    cycle: TaskCreateCycleRequest | None = None

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


class SubmitTaskResultRequest(ApiModel):
    result_text: str = Field(min_length=1, max_length=20_000)

    @field_validator("result_text")
    @classmethod
    def result_text_must_not_be_blank(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("Task result must not be blank")
        return stripped


TaskReturnReason = Literal[
    "incomplete_result",
    "requirements_not_met",
    "corrections_required",
    "other",
]
TaskEfficiencyExclusionReason = Literal[
    "cancelled",
    "external_dependency",
    "requirements_changed",
    "duplicate",
    "other",
]


class ReturnTaskForRevisionRequest(ApiModel):
    reason_code: TaskReturnReason
    reason_text: str = Field(default="", max_length=2_000)

    @model_validator(mode="after")
    def require_return_reason_text(self) -> "ReturnTaskForRevisionRequest":
        if self.reason_code == "other" and not self.reason_text.strip():
            raise ValueError("A text explanation is required for another return reason")
        return self


class TaskEfficiencyExclusionRequest(ApiModel):
    excluded: bool
    reason_code: TaskEfficiencyExclusionReason | None = None
    reason_text: str = Field(default="", max_length=2_000)

    @model_validator(mode="after")
    def require_exclusion_reason(self) -> "TaskEfficiencyExclusionRequest":
        if self.excluded and self.reason_code is None:
            raise ValueError("An exclusion reason is required")
        if self.excluded and self.reason_code == "other" and not self.reason_text.strip():
            raise ValueError("A text explanation is required for another exclusion reason")
        return self


HistoryCompleteness = Literal["complete", "partial", "unavailable"]


class EfficiencyHistoryPointResponse(ApiModel):
    period: str
    percentage: float | None
    on_time_count: int
    eligible_count: int
    history_completeness: HistoryCompleteness


class EmployeeEfficiencyResponse(ApiModel):
    user_id: str
    name: str
    job_title: str
    period: str
    timezone: str
    percentage: float | None
    on_time_count: int
    eligible_count: int
    overdue_count: int
    awaiting_review_count: int
    no_due_date_count: int
    returned_for_revision_count: int
    excluded_count: int
    sample_size: int
    methodology_version: str
    tracking_started_at: datetime
    history_completeness: HistoryCompleteness
    small_sample: bool
    history: list[EfficiencyHistoryPointResponse]


class EfficiencyOverviewResponse(ApiModel):
    period: str
    timezone: str
    methodology_version: str
    tracking_started_at: datetime
    current_user_id: str
    employees: list[EmployeeEfficiencyResponse]


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
    schedule_kind: Literal["daily", "weekly", "monthly", "calendar"]
    interval: int = Field(default=1, ge=1, le=365)
    calendar_rule: Literal["weekdays", "month_days"] | None = None
    weekdays: list[int] = Field(default_factory=list, max_length=7)
    month_days: list[int] = Field(default_factory=list, max_length=31)
    timezone: str = Field(default="Asia/Tashkent", min_length=1, max_length=64)
    next_run_at: datetime | None = None
    is_enabled: bool = True

    @model_validator(mode="after")
    def validate_calendar_rule(self) -> "TaskCycleRequest":
        self.weekdays = sorted(set(self.weekdays))
        self.month_days = sorted(set(self.month_days))
        if any(day < 0 or day > 6 for day in self.weekdays):
            raise ValueError("Weekdays must be between 0 and 6")
        if any(day < 1 or day > 31 for day in self.month_days):
            raise ValueError("Month days must be between 1 and 31")
        if self.schedule_kind != "calendar":
            self.calendar_rule = None
            self.weekdays = []
            self.month_days = []
            return self
        if self.calendar_rule == "weekdays" and self.weekdays:
            self.month_days = []
            return self
        if self.calendar_rule == "month_days" and self.month_days:
            self.weekdays = []
            return self
        raise ValueError("Select at least one calendar day")


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


class ApprovalDeadlineEventResponse(ApiModel):
    id: str
    event_type: Literal["reminder", "overdue", "escalation"]
    recipient_user_id: str
    recipient_role: Literal["approver", "requester", "process_owner"]
    node_key: str
    threshold_hours: int
    deadline_at: datetime
    created_at: datetime


class ApprovalDeadlineControlResponse(ApiModel):
    status: Literal["not_set", "on_track", "due_soon", "overdue", "finished"]
    remaining_seconds: int | None = None
    reminder_hours_before: list[int] = Field(default_factory=list)
    escalation_after_hours: int | None = None
    next_event_at: datetime | None = None
    escalation_at: datetime | None = None
    events: list[ApprovalDeadlineEventResponse] = Field(default_factory=list)


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
    workflow_id: str
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
    calendar_event_id: str | None = None
    purpose: str = ""
    details: PaymentRequestDetails = Field(default_factory=PaymentRequestDetails)
    created_at: datetime
    updated_at: datetime
    revision: int = 1
    versions: list["ApprovalRequestVersionResponse"] = Field(default_factory=list)
    actions: list[ApprovalActionHistoryResponse] = Field(default_factory=list)
    deadline_control: ApprovalDeadlineControlResponse


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
    calendar_event_id: str | None = None

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
        "move",
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
    chat_id: str | None = None
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
TripAction = Literal["submit", "approve", "return", "reject", "resubmit", "move"]

AbsenceKind = Literal["vacation", "personal_time", "late_arrival", "sick_leave", "business_event"]
AbsenceStatus = Literal["draft", "pending", "approved", "acknowledged", "rejected", "cancelled"]
AbsenceAction = Literal["submit", "approve", "acknowledge", "reject", "cancel"]


class AbsenceActionHistoryResponse(ApiModel):
    id: str
    actor_user_id: str
    action: str
    comment: str | None
    created_at: datetime


class AbsenceRequestResponse(ApiModel):
    id: str
    requester_user_id: str
    direct_manager_user_id: str
    kind: AbsenceKind
    reason: str
    starts_at: datetime
    ends_at: datetime
    status: AbsenceStatus
    status_label: str
    document_status: Literal["not_required", "required", "uploaded", "overdue"]
    can_edit: bool
    allowed_actions: list[AbsenceAction]
    actions: list[AbsenceActionHistoryResponse] = Field(default_factory=list)
    created_at: datetime
    updated_at: datetime


class AbsenceWriteRequest(ApiModel):
    kind: AbsenceKind
    reason: str = Field(min_length=1, max_length=4000)
    starts_at: datetime
    ends_at: datetime

    @field_validator("reason")
    @classmethod
    def absence_reason_not_blank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("Причина отсутствия обязательна")
        return value.strip()

    @model_validator(mode="after")
    def absence_period_is_valid(self) -> "AbsenceWriteRequest":
        if self.ends_at <= self.starts_at:
            raise ValueError("Окончание отсутствия должно быть позже начала")
        return self


class AbsenceActionRequest(ApiModel):
    action: AbsenceAction
    comment: str = Field(default="", max_length=4000)


class PresenceSummaryItemResponse(ApiModel):
    user_id: str
    status: str
    starts_at: datetime | None = None
    ends_at: datetime | None = None


class TripActionHistoryResponse(ApiModel):
    id: str
    actor_user_id: str
    from_stage: TripStage | None
    to_stage: TripStage
    action: Literal["created", "submit", "approve", "return", "reject", "resubmit", "move"]
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
    chat_id: str | None = None
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
    target_stage: TripStage | None = None


class FeedCommentResponse(ApiModel):
    id: str
    author_user_id: str
    body: str
    parent_comment_id: str | None = None
    reactions: list[MessageReactionResponse] = Field(default_factory=list)
    can_delete: bool = False
    created_at: datetime


class FeedPostResponse(ApiModel):
    id: str
    author_user_id: str
    title: str
    body: str
    is_pinned: bool
    liked_by_current_user: bool
    like_count: int
    reactions: list[MessageReactionResponse] = Field(default_factory=list)
    can_edit: bool
    can_delete: bool
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
    parent_comment_id: UUID | None = None

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
CalendarAttendanceStatus = Literal["accepted", "pending", "declined"]


class CalendarEventAttendeeResponse(ApiModel):
    user_id: str
    status: CalendarAttendanceStatus
    responded_at: datetime | None


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
    attendees: list[CalendarEventAttendeeResponse]
    current_user_attendance_status: CalendarAttendanceStatus | None
    can_respond: bool
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


class RespondCalendarEventRequest(ApiModel):
    status: Literal["accepted", "declined"]


NotificationKind = Literal[
    "message", "task", "approval", "trip", "calendar", "absence", "zoom"
]
NotificationPriority = Literal["normal", "attention", "urgent"]
NotificationSection = Literal[
    "ai_referent",
    "messenger",
    "tasks",
    "team_overview",
    "payment_requests",
    "trip_approvals",
    "calendar",
    "absences",
    "zoom_meetings",
    "hr",
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
    absences_enabled: bool = True
    zoom_enabled: bool = True
    reminders_enabled: bool = True


class NotificationPreferencesUpdate(ApiModel):
    desktop_enabled: bool
    messages_enabled: bool
    tasks_enabled: bool
    approvals_enabled: bool
    trips_enabled: bool
    calendar_enabled: bool
    absences_enabled: bool = True
    zoom_enabled: bool = True
    reminders_enabled: bool


NavigationKey = Literal[
    "crm",
    "tasks",
    "team_overview",
    "payment_requests",
    "feed",
    "projects",
    "trip_approvals",
    "messenger",
    "calendar",
    "zoom_meetings",
    "absences",
    "members",
    "employees",
    "notifications",
    "settings",
]
DEFAULT_NAVIGATION: list[NavigationKey] = [
    "crm",
    "tasks",
    "team_overview",
    "payment_requests",
    "feed",
    "projects",
    "trip_approvals",
    "messenger",
    "calendar",
    "zoom_meetings",
    "absences",
    "members",
    "employees",
    "notifications",
    "settings",
]


class PersonalPreferencesResponse(ApiModel):
    pinned_chat_ids: list[str] = Field(default_factory=list)
    archived_chat_ids: list[str] = Field(default_factory=list)
    navigation_order: list[NavigationKey] = Field(default_factory=lambda: list(DEFAULT_NAVIGATION))
    locale: Literal["ru", "uz_cyrl", "uz_latn"] = "ru"
    revision: int = 0


class InterfaceLocaleUpdate(ApiModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, extra="forbid")
    locale: Literal["ru", "uz_cyrl", "uz_latn"]
    revision: int = Field(ge=0)


class PersonalChatAction(ApiModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, extra="forbid")
    action: Literal["pin", "unpin", "archive", "unarchive"]


class PinnedChatOrder(ApiModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, extra="forbid")
    chat_ids: list[UUID] = Field(max_length=100)
    revision: int = Field(ge=0)

    @field_validator("chat_ids")
    @classmethod
    def unique_chats(cls, value: list[UUID]) -> list[UUID]:
        if len(value) != len(set(value)):
            raise ValueError("Чаты не должны повторяться")
        return value


class NavigationOrder(ApiModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, extra="forbid")
    # Derived from the catalog so adding a section never silently breaks reordering.
    order: list[NavigationKey] = Field(
        min_length=len(DEFAULT_NAVIGATION), max_length=len(DEFAULT_NAVIGATION)
    )
    revision: int = Field(ge=0)

    @field_validator("order")
    @classmethod
    def complete_order(cls, value: list[NavigationKey]) -> list[NavigationKey]:
        if set(value) != set(DEFAULT_NAVIGATION):
            raise ValueError("Меню должно содержать все разделы без повторений")
        return value


class WorkspaceBootstrapResponse(ApiModel):
    current_user: PersonResponse
    module_access: list[EffectiveModuleAccessResponse]
    can_create_payment_requests: bool
    people: list[PersonResponse]
    departments: list["WorkspaceDepartmentResponse"]
    positions: list[WorkflowPositionResponse]
    chats: list[ChatSummaryResponse]
    messages: list[ChatMessageResponse]
    tasks: list[TaskResponse]
    requests: list[ApprovalRequestResponse]
    request_workflows: list[WorkflowResponse]
    projects: list[ProjectResponse]
    trip_requests: list[TripRequestResponse]
    absence_requests: list[AbsenceRequestResponse]
    presence_summary: list[PresenceSummaryItemResponse]
    feed_posts: list[FeedPostResponse]
    calendar_events: list[CalendarEventResponse]
    notifications: list[NotificationResponse]
    notification_preferences: NotificationPreferencesResponse
    personal_preferences: PersonalPreferencesResponse
    attachments: list[AttachmentResponse]
    workflow: WorkflowResponse | None
    project_workflow: WorkflowResponse | None
    trip_workflow: WorkflowResponse | None


class WorkspaceDepartmentResponse(ApiModel):
    id: str
    code: str
    name: str
    parent_id: str | None = None
    assigned_users_count: int
    member_ids: list[str] = Field(default_factory=list)
    chat_id: str | None = None
