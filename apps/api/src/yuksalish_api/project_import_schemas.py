"""Versioned, reviewable document import; model output never grants permissions."""

from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from typing import Literal

from pydantic import ConfigDict, Field, field_validator, model_validator

from .project_hub_schemas import HubModel


class ImportModel(HubModel):
    model_config = ConfigDict(
        **{**HubModel.model_config, "extra": "forbid"},
    )


class ImportSource(ImportModel):
    document_id: str
    locator: str = Field(max_length=300)
    excerpt: str = Field(default="", max_length=1000)


class ImportProject(ImportModel):
    title: str = Field(default="", max_length=240)
    code: str = Field(default="", max_length=48)
    description: str = Field(default="", max_length=20_000)
    start_date: date | None = None
    end_date: date | None = None
    budget: str = Field(default="", max_length=30)
    currency: Literal["UZS", "USD", "EUR"] = "UZS"
    donor: str = Field(default="", max_length=500)
    partners: str = Field(default="", max_length=2000)
    scope: Literal["yuksalish", "consortium"] = "yuksalish"
    sources: list[ImportSource] = Field(default_factory=list, max_length=100)


class ImportItem(ImportModel):
    title: str = Field(max_length=240)
    kind: Literal["task", "event"] = "task"
    description: str = Field(default="", max_length=20_000)
    period: str = Field(default="", max_length=500)
    starts_at: datetime | None = None
    due_at: datetime | None = None
    budget: str = Field(default="0", max_length=30)
    budget_currency: Literal["UZS", "USD", "EUR"] | None = None
    include: bool = True
    assignee_user_ids: list[str] = Field(default_factory=list, max_length=100)
    sources: list[ImportSource] = Field(default_factory=list, max_length=20)


class ImportDirection(ImportModel):
    title: str = Field(max_length=240)
    description: str = Field(default="", max_length=20_000)
    start_date: date | None = None
    end_date: date | None = None
    items: list[ImportItem] = Field(default_factory=list, max_length=100)
    sources: list[ImportSource] = Field(default_factory=list, max_length=20)


class ImportBudgetLine(ImportModel):
    title: str = Field(max_length=500)
    amount: str = Field(max_length=30)
    currency: Literal["UZS", "USD", "EUR"]
    funding: Literal["donor", "own", "unspecified"] = "unspecified"
    sources: list[ImportSource] = Field(default_factory=list, max_length=20)

    @field_validator("amount")
    @classmethod
    def exact_amount(cls, value: str) -> str:
        try:
            amount = Decimal(value)
        except InvalidOperation as error:
            raise ValueError("Budget amounts must be decimal strings") from error
        if not amount.is_finite() or amount < 0 or amount > Decimal("9007199254740991"):
            raise ValueError("Invalid budget amount")
        return value


class ImportIssue(ImportModel):
    message: str = Field(max_length=2000)
    sources: list[ImportSource] = Field(default_factory=list, max_length=20)
    resolution: str = Field(default="", max_length=2000)


class ImportContent(ImportModel):
    template_version: Literal[1] = 1
    project: ImportProject = Field(default_factory=ImportProject)
    directions: list[ImportDirection] = Field(default_factory=list, max_length=40)
    budget_lines: list[ImportBudgetLine] = Field(default_factory=list, max_length=300)
    issues: list[ImportIssue] = Field(default_factory=list, max_length=100)

    @model_validator(mode="after")
    def bounded_items(self) -> "ImportContent":
        if sum(len(direction.items) for direction in self.directions) > 300:
            raise ValueError("A package can contain at most 300 work items")
        return self


class ImportDocument(ImportModel):
    id: str
    name: str
    size: int
    sha256: str
    mime_type: str


class ImportResponse(ImportModel):
    id: str
    state: Literal["draft", "queued", "processing", "ready", "failed", "published"]
    revision: int
    documents: list[ImportDocument]
    content: ImportContent
    error: str | None
    project_id: str | None
    publication: "ImportPublish | None" = None
    updated_at: datetime


class ImportRevision(ImportModel):
    expected_revision: int = Field(ge=1)


class ImportAnalyze(ImportRevision):
    allow_external_processing: Literal[True]


class ImportReview(ImportRevision):
    content: ImportContent


class ImportPublish(ImportRevision):
    manager_user_id: str
    responsible_user_ids: list[str] = Field(default_factory=list, max_length=100)
    access_status: Literal["open", "closed"] = "closed"
    reviewed: Literal[True]
