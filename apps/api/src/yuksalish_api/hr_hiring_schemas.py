"""Private hiring data, immutable document revisions and explicit signing actions."""

from datetime import date, datetime
from typing import Literal, Self
from uuid import UUID

from pydantic import ConfigDict, Field, model_validator

from .workspace_schemas import ApiModel, to_camel


class StrictModel(ApiModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, extra="forbid")


class HiringFields(StrictModel):
    full_name: str = Field(min_length=3, max_length=200)
    job_title: str = Field(min_length=2, max_length=160)
    department: str = Field(min_length=2, max_length=200)
    start_date: date
    contract_number: str = Field(min_length=1, max_length=40, pattern=r"^[\w/-]+$")
    order_number: str = Field(min_length=1, max_length=40, pattern=r"^[\w/-]+$")
    document_date: date
    work_type: Literal["primary", "secondary"] = "primary"
    term: Literal["indefinite", "fixed"] = "indefinite"
    end_date: date | None = None
    fixed_term_reason: str = Field(default="", max_length=1000)
    probation_months: int = Field(default=0, ge=0, le=6)
    probation_eligible: bool = False
    work_regime: str = Field(default="Иш вақтининг нормал давомийлиги", max_length=300)
    days_per_week: int = Field(default=5, ge=1, le=6)
    hours_per_week: int = Field(default=40, gt=0, le=40)
    annual_leave: int = Field(default=21, ge=21, le=90)
    additional_leave: int = Field(default=0, ge=0, le=90)
    salary_terms: str = Field(min_length=3, max_length=1000)
    allowances: str = Field(default="", max_length=1000)
    passport: str = Field(min_length=5, max_length=80)
    pinfl: str = Field(pattern=r"^\d{14}$")
    address: str = Field(min_length=5, max_length=500)
    phone: str = Field(min_length=7, max_length=30, pattern=r"^[+\d ()-]+$")
    additional_terms: str = Field(default="", max_length=2000)

    @model_validator(mode="after")
    def coherent_terms(self) -> Self:
        if self.term == "fixed":
            if not self.end_date or self.end_date <= self.start_date:
                raise ValueError("Для срочного договора укажите дату окончания после даты начала")
            if not self.fixed_term_reason.strip():
                raise ValueError("Укажите основание срочного договора")
        elif self.end_date is not None or self.fixed_term_reason.strip():
            raise ValueError("Для бессрочного договора дата окончания и основание не нужны")
        if self.probation_months and not self.probation_eligible:
            raise ValueError("Кадровик должен подтвердить допустимость испытательного срока")
        if any(
            not value.strip()
            for value in (
                self.full_name,
                self.job_title,
                self.department,
                self.salary_terms,
                self.address,
            )
        ):
            raise ValueError("Заполните обязательные поля")
        return self


class SignatureBox(StrictModel):
    """Fractions of the visible page, measured from its top-left after rotation normalization."""

    page: int = Field(default=1, ge=1, le=20)
    x: float = Field(default=0.58, ge=0, le=1, allow_inf_nan=False)
    y: float = Field(default=0.78, ge=0, le=1, allow_inf_nan=False)
    width: float = Field(default=0.30, ge=0.10, le=0.5, allow_inf_nan=False)
    height: float = Field(default=0.10, ge=0.04, le=0.3, allow_inf_nan=False)

    @model_validator(mode="after")
    def inside_page(self) -> Self:
        if self.x + self.width > 1 or self.y + self.height > 1:
            raise ValueError("Подпись выходит за границы страницы")
        return self


class HiringWrite(StrictModel):
    expected_revision: int = Field(ge=0)
    fields: HiringFields
    application_box: SignatureBox = Field(default_factory=SignatureBox)


class HiringAction(StrictModel):
    request_id: UUID
    expected_revision: int = Field(ge=1)
    action: Literal["submit", "approve", "return", "complete"]
    comment: str = Field(default="", max_length=2000)


class HiringSummary(ApiModel):
    id: UUID
    full_name: str
    job_title: str
    status: Literal["draft", "pending", "returned", "awaiting_employee", "completed"]
    revision: int
    updated_at: datetime
    can_edit: bool
    can_sign: bool


class HiringDetail(HiringSummary):
    fields: HiringFields
    application_box: SignatureBox
    has_application: bool
    application_pages: int
    has_employee_scan: bool
    return_comment: str
    signer_name: str
    approved_at: datetime | None
    document_hashes: dict[str, str]


class HiringRegistry(ApiModel):
    items: list[HiringSummary]
    total: int
    can_create: bool
    can_configure_signature: bool
    signature_ready: bool
    signer_name: str
