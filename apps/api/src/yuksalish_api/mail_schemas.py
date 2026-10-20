"""Personal mail contracts. No provider credentials are returned to a client."""

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import Field, field_validator

from .workspace_schemas import ApiModel, CreateTaskRequest

MailState = Literal["draft", "queued", "sending", "sent", "unknown", "failed"]


class MailConnection(ApiModel):
    configured: bool
    sending_enabled: bool
    account_id: str | None = None
    email: str | None = None
    connected_at: datetime | None = None
    reconnect_required: bool = False


class MailConnect(ApiModel):
    request_id: str
    authorization_url: str


class MailConnectStatus(ApiModel):
    status: Literal["pending", "exchanging", "connected", "failed", "expired"]


class MailMessageSummary(ApiModel):
    id: str
    thread_id: str
    subject: str
    sender: str
    recipients: str
    received_at: datetime
    snippet: str
    unread: bool


class MailProviderAttachment(ApiModel):
    id: str
    file_name: str
    content_type: str
    size_bytes: int


class MailMessage(MailMessageSummary):
    body: str
    message_id: str
    references: str
    reply_to: str
    attachments: list[MailProviderAttachment] = Field(default_factory=list)


class MailPage(ApiModel):
    messages: list[MailMessageSummary]
    next_page_token: str | None = None


class MailThread(ApiModel):
    messages: list[MailMessage]
    truncated: bool = False


class MailFields(ApiModel):
    to: list[str] = Field(default_factory=list, max_length=50)
    cc: list[str] = Field(default_factory=list, max_length=50)
    bcc: list[str] = Field(default_factory=list, max_length=50)
    subject: str = Field(default="", max_length=500)
    body: str = Field(default="", max_length=100_000)

    @field_validator("subject")
    @classmethod
    def subject_is_one_line(cls, value: str) -> str:
        if "\r" in value or "\n" in value or "\x00" in value:
            raise ValueError("Subject must be a single line")
        return value.strip()

    @field_validator("to", "cc", "bcc")
    @classmethod
    def addresses_are_plain(cls, values: list[str]) -> list[str]:
        import re

        result = []
        for raw in values:
            value = raw.strip()
            if len(value) > 254 or not re.fullmatch(
                r"[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,63}",
                value,
            ):
                raise ValueError("Use an email address without a display name")
            if value not in result:
                result.append(value)
        if len(result) != len(values):
            raise ValueError("Duplicate address")
        return result


class MailDraftWrite(MailFields):
    request_id: UUID
    expected_revision: int = Field(default=0, ge=0)
    reply_message_id: str | None = Field(default=None, max_length=200, pattern=r"^[A-Za-z0-9_-]+$")


class MailFile(ApiModel):
    id: str
    file_name: str
    content_type: str
    size_bytes: int
    signed_letter_id: str | None = None


class MailDraft(MailFields):
    id: str
    revision: int
    status: MailState
    updated_at: datetime
    attachments: list[MailFile]
    provider_message_id: str | None = None
    error: str = ""
    reply_message_id: str | None = None


class MailDraftSummary(ApiModel):
    id: str
    subject: str
    to: list[str]
    status: MailState
    revision: int
    updated_at: datetime
    error: str = ""


class MailSearch(ApiModel):
    folder: Literal["inbox", "sent", "starred", "all"] = "inbox"
    query: str = Field(default="", max_length=300)
    page: str = Field(default="", max_length=2048)


class MailRevision(ApiModel):
    expected_revision: int = Field(ge=1)


class MailSend(MailRevision):
    operation_id: UUID


class MailTaskExport(ApiModel):
    operation_id: UUID
    message_id: str = Field(min_length=1, max_length=200, pattern=r"^[A-Za-z0-9_-]+$")
    task: CreateTaskRequest
    attachment_ids: list[str] = Field(default_factory=list, max_length=20)


class MailSignedFile(ApiModel):
    id: str
    letter_id: str
    title: str
    file_name: str
    sha256: str


class MailAddSignedFile(MailRevision):
    file_id: UUID


class MailAddProviderFile(MailRevision):
    message_id: str = Field(min_length=1, max_length=200, pattern=r"^[A-Za-z0-9_-]+$")
    attachment_id: str = Field(min_length=1, max_length=2048, pattern=r"^[A-Za-z0-9_-]+$")
