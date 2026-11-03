from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import ConfigDict, Field, field_validator, model_validator

from .memo_document_text import DocumentScript, document_text
from .workspace_schemas import ApiModel

MemoStatus = Literal[
    "draft",
    "pending",
    "approved",
    "needs_revision",
    "hr_pending",
    "accountant_pending",
    "completed",
]


class MemoInput(ApiModel):
    model_config = ConfigDict(extra="forbid")
    title: str = Field(min_length=1, max_length=160)
    body: str = Field(min_length=1, max_length=20000)
    document_script: DocumentScript = "cyrillic"

    @model_validator(mode="after")
    def consistent_script(self) -> "MemoInput":
        self.body = document_text(self.body, self.document_script)
        self.title = document_text(self.title, self.document_script)
        if len(self.body) > 20000 or len(self.title) > 160:
            raise ValueError("После смены алфавита текст превышает допустимую длину")
        return self

    @field_validator("title", "body")
    @classmethod
    def meaningful_text(cls, value: str) -> str:
        value = value.strip()
        if not value or any(ord(char) < 32 and char not in "\n\r\t" for char in value):
            raise ValueError("Введите текст без управляющих символов")
        return value


class MemoCreate(MemoInput):
    request_id: UUID


class MemoRevision(ApiModel):
    model_config = ConfigDict(extra="forbid")
    expected_revision: int = Field(ge=1)


class MemoUpdate(MemoInput, MemoRevision):
    pass


class MemoDecision(MemoRevision):
    decision: Literal["approve", "return"]
    comment: str = Field(default="", max_length=2000)

    @field_validator("comment")
    @classmethod
    def trimmed_comment(cls, value: str) -> str:
        return value.strip()


class MemoSummary(ApiModel):
    id: str
    title: str
    status: MemoStatus
    revision: int
    requester_name: str
    chair_name: str
    created_at: datetime
    submitted_at: datetime | None
    decided_at: datetime | None


class MemoDetail(MemoSummary):
    body: str
    requester_title: str
    decision_comment: str
    can_edit: bool
    can_submit: bool
    can_decide: bool
    can_withdraw: bool
    has_pdf: bool
    pdf_byte_size: int
    document_script: DocumentScript | None = None
    document_labels: dict[str, str] = Field(default_factory=dict)
    can_start_processing: bool = False
    can_attach_order: bool = False
    can_complete: bool = False
    hr_name: str | None = None
    accountant_name: str | None = None
    order_file_name: str | None = None
    order_byte_size: int = 0
    hr_completed_at: datetime | None = None
    completed_at: datetime | None = None


class MemoContext(ApiModel):
    requester_name: str
    requester_title: str
    enabled: bool
    can_create: bool
    can_review: bool
    pending_count: int
    chair_name: str | None
    configuration_error: str | None
    document_labels: dict[str, dict[str, str]] = Field(default_factory=dict)


class MemoRegistry(ApiModel):
    items: list[MemoSummary]
    total: int
