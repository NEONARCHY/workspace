"""Local document registry and explicit assignment contracts."""

from datetime import datetime
from uuid import UUID

from pydantic import Field, field_validator, model_validator

from .workspace_schemas import ApiModel, TaskStatus


class IncomingExecution(ApiModel):
    task_id: UUID
    status: TaskStatus
    due_at: datetime | None
    assignee_id: UUID
    assignee_name: str
    author_id: UUID


class IncomingDocument(ApiModel):
    id: UUID
    revision: int
    number: str
    subject: str
    sender: str
    received_at: datetime | None
    source: str
    files_expected: bool = False
    execution: IncomingExecution | None = None
    can_assign: bool = False
    can_open_task: bool = False


class IncomingDocumentFile(ApiModel):
    id: UUID
    name: str
    byte_size: int
    sha256: str


class IncomingDocumentDetail(ApiModel):
    document: IncomingDocument
    files: list[IncomingDocumentFile]


class IncomingDocumentPage(ApiModel):
    documents: list[IncomingDocument]
    total: int
    offset: int
    limit: int


class IncomingDocumentAssign(ApiModel):
    operation_id: UUID
    expected_revision: int = Field(ge=1)
    instruction: str = Field(min_length=1, max_length=10_000)
    assignee_id: UUID
    co_assignee_ids: list[UUID] = Field(default_factory=list, max_length=50)
    file_ids: list[UUID] = Field(max_length=100)
    due_at: datetime

    @field_validator("instruction")
    @classmethod
    def clean_instruction(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Укажите поручение")
        return value

    @field_validator("due_at")
    @classmethod
    def aware_deadline(cls, value: datetime) -> datetime:
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("Срок должен содержать часовой пояс")
        return value

    @model_validator(mode="after")
    def distinct_participants(self) -> "IncomingDocumentAssign":
        if len(set(self.co_assignee_ids)) != len(self.co_assignee_ids):
            raise ValueError("Соисполнители не должны повторяться")
        if self.assignee_id in self.co_assignee_ids:
            raise ValueError("Основной исполнитель уже участвует в поручении")
        if len(set(self.file_ids)) != len(self.file_ids):
            raise ValueError("Документы не должны повторяться")
        return self
