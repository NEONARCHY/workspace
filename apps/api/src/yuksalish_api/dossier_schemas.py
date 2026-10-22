"""Private personnel questionnaires; never part of the public employee bootstrap."""

from datetime import date, datetime
from typing import Literal
from uuid import UUID
from zoneinfo import ZoneInfo

from pydantic import ConfigDict, Field, field_validator, model_validator

from .workspace_schemas import ApiModel


class DossierModel(ApiModel):
    model_config = ConfigDict(alias_generator=ApiModel.model_config["alias_generator"],
                              populate_by_name=True, extra="forbid", str_strip_whitespace=True)

    @field_validator("*", mode="before")
    @classmethod
    def xml_safe_text(cls, value: object) -> object:
        if isinstance(value, str) and any(
            (ord(char) < 32 and char not in "\n\r\t") or char in "\ufffe\uffff"
            or 0xD800 <= ord(char) <= 0xDFFF for char in value
        ):
            raise ValueError("Текст содержит недопустимый управляющий символ")
        return value


class DossierEducation(DossierModel):
    institution: str = Field(min_length=1, max_length=300)
    start_year: int | None = Field(default=None, ge=1900, le=2100)
    graduation_year: int | None = Field(default=None, ge=1900, le=2100)
    specialty: str = Field(default="", max_length=300)
    qualification: str = Field(default="", max_length=200)

    @model_validator(mode="after")
    def valid_years(self) -> "DossierEducation":
        if self.start_year and self.graduation_year and self.start_year > self.graduation_year:
            raise ValueError("Год окончания не может быть раньше начала обучения")
        return self


class DossierRelative(DossierModel):
    relationship: str = Field(min_length=1, max_length=100)
    full_name: str = Field(min_length=1, max_length=300)
    birth_year: int | None = Field(default=None, ge=1900, le=2100)
    birth_place: str = Field(default="", max_length=300)
    workplace_position: str = Field(default="", max_length=600)
    address: str = Field(default="", max_length=600)

    @model_validator(mode="after")
    def valid_birth_year(self) -> "DossierRelative":
        if self.birth_year and self.birth_year > datetime.now(ZoneInfo("Asia/Tashkent")).year:
            raise ValueError("Год рождения родственника не может быть в будущем")
        return self


class DossierEmployment(DossierModel):
    organization: str = Field(default="", max_length=300)
    position: str = Field(default="", max_length=1000)
    period: str = Field(default="", max_length=100)
    start_date: date | None = None
    end_date: date | None = None

    @model_validator(mode="after")
    def valid_period(self) -> "DossierEmployment":
        if not (self.organization or self.position) or not (self.start_date or self.period):
            raise ValueError("Укажите организацию или должность и дату начала либо период из Word")
        if self.end_date and self.start_date and self.end_date < self.start_date:
            raise ValueError("Окончание работы не может быть раньше начала")
        return self


class DossierFields(DossierModel):
    birth_date: date | None = None
    birth_place: str = Field(default="", max_length=300)
    appointment_date: date | None = None
    nationality: str = Field(default="", max_length=200)
    party_membership: str = Field(default="", max_length=300)
    education_level: str = Field(default="", max_length=200)
    education: list[DossierEducation] = Field(default_factory=list, max_length=20)
    employment: list[DossierEmployment] = Field(default_factory=list, max_length=50)
    languages: str = Field(default="", max_length=1000)
    academic_degree: str = Field(default="", max_length=300)
    academic_title: str = Field(default="", max_length=300)
    military_rank: str = Field(default="", max_length=300)
    elected_membership: str = Field(default="", max_length=2000)
    awards: str = Field(default="", max_length=3000)
    relatives: list[DossierRelative] = Field(default_factory=list, max_length=40)
    additional_info: str = Field(default="", max_length=6000)

    @model_validator(mode="after")
    def valid_birth_date(self) -> "DossierFields":
        today = datetime.now(ZoneInfo("Asia/Tashkent")).date()
        if self.birth_date and not date(1900, 1, 1) <= self.birth_date <= today:
            raise ValueError("Проверьте дату рождения")
        return self


class DossierWrite(DossierModel):
    revision: int = Field(ge=0)
    status: Literal["draft", "saved"]
    fields: DossierFields


class DossierImportPreview(DossierModel):
    source_full_name: str
    source_job_title: str
    fields: DossierFields
    detected_fields: list[str]
    warnings: list[str]
    unrecognized_text: str


class DossierPermissions(DossierModel):
    can_view: bool
    can_edit: bool


class DossierDetail(DossierModel):
    user_id: UUID
    full_name: str
    job_title: str | None
    revision: int
    status: Literal["empty", "draft", "saved"]
    fields: DossierFields
    updated_at: datetime | None
    permissions: DossierPermissions


class DossierSummary(DossierModel):
    user_id: UUID
    full_name: str
    job_title: str | None
    department_id: UUID | None
    status: Literal["empty", "draft", "saved"]
    updated_at: datetime | None


class DossierHistory(DossierModel):
    revision: int
    actor_name: str
    changed_fields: list[str]
    created_at: datetime


class PhotoCard(DossierModel):
    user_id: UUID
    full_name: str
    job_title: str | None
    department_id: UUID | None
    birth_year: int | None
    universities: list[str]


class DossierContext(DossierModel):
    can_manage_access: bool
    can_view_photo_roster: bool


class DossierAccessRule(DossierModel):
    grantee_user_id: UUID
    scope: Literal["all", "department", "employee"]
    scope_id: UUID | None = None
    view: bool = False
    edit: bool = False
    photo_roster: bool = False

    @model_validator(mode="after")
    def valid_scope(self) -> "DossierAccessRule":
        if (self.scope == "all") != (self.scope_id is None):
            raise ValueError("Укажите сотрудника или подразделение для выбранной области")
        if self.edit and not self.view:
            raise ValueError("Редактирование требует права просмотра")
        if not (self.view or self.photo_roster):
            raise ValueError("Выберите хотя бы одно разрешение")
        return self


class DossierAccessWrite(DossierModel):
    revision: int = Field(ge=0)
    rules: list[DossierAccessRule] = Field(max_length=200)
    reason: str = Field(min_length=3, max_length=500)

    @model_validator(mode="after")
    def unique_rules(self) -> "DossierAccessWrite":
        identities = {(r.grantee_user_id, r.scope, r.scope_id) for r in self.rules}
        if len(identities) != len(self.rules):
            raise ValueError("Правила доступа не должны повторяться")
        return self


class DossierAccessSettings(DossierModel):
    revision: int
    rules: list[DossierAccessRule]
