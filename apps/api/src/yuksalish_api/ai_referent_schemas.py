"""Contracts for the shared incoming and outgoing AI Referent module."""

from datetime import date, datetime
from typing import Literal
from uuid import UUID

from pydantic import Field, field_validator

from .workspace_schemas import ApiModel, AttachmentResponse

AIReferentRoute = Literal["exat", "webmail"]
AIReferentStatus = Literal[
    "draft",
    "pending_review",
    "needs_revision",
    "approved",
    "queued",
    "sending",
    "sent",
    "failed",
    "cancelled",
    "awaiting_final_send",
    "referent_review_pending",
    "delivery_unknown",
    "signed",
    "operator_revision",
]
AIReferentWorkflowKind = Literal["delivery", "sign_only"]
AIReferentSource = Literal["workspace", "telegram", "import"]
AIReferentAction = Literal[
    "submit",
    "approve",
    "return_for_revision",
    "cancel",
    "queue_delivery",
    "retry_delivery",
    "release_delivery",
    "send",
    "confirm_sent",
    "confirm_not_sent",
    "remind",
    "replace_document",
    "mark_sent",
    "prepare_replacement",
]


class AIReferentLetterFields(ApiModel):
    workflow_kind: AIReferentWorkflowKind = "delivery"
    subject: str = Field(default="", max_length=300)
    recipient_organization: str = Field(default="", max_length=300)
    recipient_address: str = Field(default="", max_length=500)
    route: AIReferentRoute
    note: str = Field(default="", max_length=5000)
    reviewer_user_id: UUID | None = None
    final_reviewer_user_id: UUID | None = None

    @field_validator("subject", "recipient_organization", "recipient_address", "note")
    @classmethod
    def optional_text_is_trimmed(cls, value: str) -> str:
        return value.strip()


class CreateAIReferentLetterRequest(AIReferentLetterFields):
    operation_id: UUID | None = None


class UpdateAIReferentLetterRequest(AIReferentLetterFields):
    expected_revision: int = Field(ge=1)
    operation_id: UUID | None = None


class AIReferentActionRequest(ApiModel):
    action: AIReferentAction
    comment: str = Field(default="", max_length=2000)
    expected_revision: int = Field(ge=1)
    operation_id: UUID | None = None

    @field_validator("comment")
    @classmethod
    def comment_is_trimmed(cls, value: str) -> str:
        return value.strip()


class AIReferentEventResponse(ApiModel):
    id: str
    event_type: str
    actor_user_id: str | None = None
    actor_name: str = "Системное действие"
    from_status: AIReferentStatus | None = None
    to_status: AIReferentStatus | None = None
    comment: str = ""
    created_at: datetime


class AIReferentLetterResponse(ApiModel):
    id: str
    display_number: str | None = None
    outgoing_number: int | None = None
    year_suffix: str | None = None
    subject: str
    recipient_organization: str
    recipient_address: str
    route: AIReferentRoute
    note: str
    status: AIReferentStatus
    workflow_kind: AIReferentWorkflowKind = "delivery"
    source: AIReferentSource
    created_by_user_id: str
    created_by_name: str
    reviewer_user_id: str | None = None
    reviewer_name: str | None = None
    final_reviewer_user_id: str | None = None
    final_reviewer_name: str | None = None
    initial_reviewer_user_id: str | None = None
    delivery_error: str = ""
    revision: int
    sent_at: datetime | None = None
    created_at: datetime
    updated_at: datetime
    attachments: list[AttachmentResponse] = Field(default_factory=list)
    events: list[AIReferentEventResponse] = Field(default_factory=list)
    available_actions: list[AIReferentAction] = Field(default_factory=list)
    can_edit: bool = False
    can_replace_document: bool = False


class AIReferentRegistryResponse(ApiModel):
    letters: list[AIReferentLetterResponse] = Field(default_factory=list)
    total_count: int = 0
    pending_review_count: int = 0
    ready_count: int = 0
    sent_count: int = 0
    signed_count: int = 0


AIReferentIncomingSource = Literal["exat", "webmail", "import"]


class AIReferentIncomingSyncItem(ApiModel):
    external_id: str = Field(min_length=1, max_length=160)
    sequence_number: str = Field(min_length=1, max_length=32)
    platform_incoming_number: str = Field(default="", max_length=80)
    sender_letter_number: str = Field(default="", max_length=160)
    platform_incoming_date: date | None = None
    platform_outgoing_date: date | None = None
    received_at: datetime | None = None
    processed_at: datetime | None = None
    registered_at: datetime | None = None
    sender_organization: str = Field(default="", max_length=300)
    sender_person: str = Field(default="", max_length=300)
    subject: str = Field(default="", max_length=500)
    responsible_external_id: str = Field(default="", max_length=160)
    responsible_display_name: str = Field(default="", max_length=300)
    urgency: str = Field(default="normal", min_length=1, max_length=32)
    has_attachments: bool = False
    attachments_count: int = Field(default=0, ge=0, le=10_000)
    main_document_filename: str = Field(default="", max_length=500)
    platform_record_id: str = Field(default="", max_length=160)
    status: str = Field(min_length=1, max_length=64)
    fallback_used: bool = False
    error_message: str = Field(default="", max_length=5000)
    source: AIReferentIncomingSource = "exat"

    @field_validator(
        "platform_incoming_number",
        "sender_letter_number",
        "sender_organization",
        "sender_person",
        "subject",
        "responsible_external_id",
        "responsible_display_name",
        "urgency",
        "main_document_filename",
        "platform_record_id",
        "error_message",
    )
    @classmethod
    def incoming_text_is_trimmed(cls, value: str) -> str:
        return value.strip()

    @field_validator("external_id", "sequence_number", "status")
    @classmethod
    def incoming_required_text_is_not_blank(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("Поле не должно быть пустым")
        return stripped


class AIReferentIncomingSyncRequest(ApiModel):
    agent_id: str = Field(min_length=1, max_length=128, pattern=r"^[A-Za-z0-9_.-]+$")
    agent_name: str = Field(min_length=1, max_length=200)
    letters: list[AIReferentIncomingSyncItem] = Field(default_factory=list, max_length=500)

    @field_validator("agent_id", "agent_name")
    @classmethod
    def agent_text_is_trimmed(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("Поле не должно быть пустым")
        return stripped


class AIReferentIncomingSyncResponse(ApiModel):
    created_count: int
    updated_count: int
    unchanged_count: int
    received_count: int
    synced_at: datetime


class AIReferentIncomingLetterResponse(ApiModel):
    id: str
    agent_id: str
    external_id: str
    sequence_number: str
    platform_incoming_number: str
    sender_letter_number: str
    platform_incoming_date: date | None = None
    platform_outgoing_date: date | None = None
    received_at: datetime | None = None
    processed_at: datetime | None = None
    registered_at: datetime | None = None
    sender_organization: str
    sender_person: str
    subject: str
    responsible_external_id: str
    responsible_display_name: str
    responsible_user_id: str | None = None
    responsible_user_name: str | None = None
    urgency: str
    has_attachments: bool
    attachments_count: int
    main_document_filename: str
    platform_record_id: str
    status: str
    fallback_used: bool
    error_message: str
    source: AIReferentIncomingSource
    revision: int
    created_at: datetime
    updated_at: datetime


class AIReferentJournalResponse(ApiModel):
    available: bool = False
    file_name: str | None = None
    byte_size: int | None = None
    sha256: str | None = None
    updated_at: datetime | None = None
    agent_name: str | None = None


class AIReferentIncomingRegistryResponse(ApiModel):
    letters: list[AIReferentIncomingLetterResponse] = Field(default_factory=list)
    total_count: int = 0
    registered_count: int = 0
    attention_count: int = 0
    with_attachments_count: int = 0
    last_sync_at: datetime | None = None
    journal: AIReferentJournalResponse = Field(default_factory=AIReferentJournalResponse)
