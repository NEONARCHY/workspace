"""Exact monetary strings; project plans and actual expense remain separate."""

import re
from uuid import UUID, uuid4

from pydantic import Field, field_validator

from .project_hub_schemas import BudgetArticleResponse, HubModel
from .project_import_schemas import ImportBudgetLine


class BudgetArticleWrite(ImportBudgetLine):
    idempotency_key: UUID = Field(default_factory=uuid4)
    title: str = Field(min_length=1, max_length=500)

    @field_validator("amount")
    @classmethod
    def bounded_decimal_notation(cls, value: str) -> str:
        if not re.fullmatch(r"[0-9]+(?:\.[0-9]{1,12})?", value):
            raise ValueError("Use a decimal amount with at most 12 fractional digits; no rounding")
        return value

    @field_validator("title")
    @classmethod
    def nonempty_title(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("A budget article needs a title")
        return value.strip()


class ExpenseTotal(HubModel):
    currency: str
    amount: str


class ProjectBudgetResponse(HubModel):
    project_id: str
    articles: list[BudgetArticleResponse]
    actual_by_currency: list[ExpenseTotal]
    remaining_project_amount: str
