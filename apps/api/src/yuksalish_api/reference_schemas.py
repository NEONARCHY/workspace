"""Validated contracts for the internal reference directory."""

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import Field, field_validator

from .workspace_schemas import ApiModel

PartnerKind = Literal["partner", "donor", "government", "contractor", "other"]
TemplateKind = Literal["project", "grant", "budget", "letter", "other"]
TemplateLocale = Literal["ru", "uz_cyrl", "uz_latn"]


class ProfileFields(ApiModel):
    legal_name: str = Field(default="", max_length=240)
    short_name: str = Field(default="", max_length=160)
    tin: str = Field(default="", max_length=24)
    registered_address: str = Field(default="", max_length=2000)
    postal_address: str = Field(default="", max_length=2000)
    bank_name: str = Field(default="", max_length=240)
    bank_code: str = Field(default="", max_length=40)
    bank_account: str = Field(default="", max_length=64)
    phone: str = Field(default="", max_length=80)
    email: str = Field(default="", max_length=240)
    website: str = Field(default="", max_length=240)

    @field_validator("tin")
    @classmethod
    def valid_tin(cls, value: str) -> str:
        value = value.strip()
        if value and not value.isascii():
            raise ValueError("ИНН должен содержать только латинские символы и цифры")
        return value


class ProfileWrite(ProfileFields):
    expected_revision: int = Field(ge=0)


class ProfileResponse(ProfileFields):
    revision: int = 0
    updated_at: datetime | None = None


class PartnerFields(ApiModel):
    name: str = Field(min_length=2, max_length=240)
    kind: PartnerKind = "partner"
    tin: str = Field(default="", max_length=24)
    address: str = Field(default="", max_length=2000)
    contact_person: str = Field(default="", max_length=160)
    phone: str = Field(default="", max_length=80)
    email: str = Field(default="", max_length=240)
    website: str = Field(default="", max_length=240)
    notes: str = Field(default="", max_length=4000)

    @field_validator("name")
    @classmethod
    def name_not_blank(cls, value: str) -> str:
        value = value.strip()
        if len(value) < 2:
            raise ValueError("Укажите название организации")
        return value

    @field_validator("tin")
    @classmethod
    def normalize_tin(cls, value: str) -> str:
        return value.strip()


class PartnerWrite(PartnerFields):
    expected_revision: int = Field(ge=1)
    archived: bool = False


class PartnerResponse(PartnerFields):
    id: UUID
    archived: bool
    revision: int
    updated_at: datetime


class ExpertFields(ApiModel):
    name: str = Field(min_length=2, max_length=160)
    specialization: str = Field(min_length=2, max_length=240)
    partner_id: UUID | None = None
    phone: str = Field(default="", max_length=80)
    email: str = Field(default="", max_length=240)
    notes: str = Field(default="", max_length=4000)

    @field_validator("name", "specialization")
    @classmethod
    def not_blank(cls, value: str) -> str:
        value = value.strip()
        if len(value) < 2:
            raise ValueError("Поле не должно быть пустым")
        return value


class ExpertWrite(ExpertFields):
    expected_revision: int = Field(ge=1)
    archived: bool = False


class ExpertResponse(ExpertFields):
    id: UUID
    archived: bool
    revision: int
    updated_at: datetime


class TemplateFields(ApiModel):
    title: str = Field(min_length=2, max_length=240)
    kind: TemplateKind = "project"
    locale: TemplateLocale = "ru"
    description: str = Field(default="", max_length=4000)

    @field_validator("title")
    @classmethod
    def title_not_blank(cls, value: str) -> str:
        value = value.strip()
        if len(value) < 2:
            raise ValueError("Укажите название шаблона")
        return value


class TemplateWrite(TemplateFields):
    expected_revision: int = Field(ge=1)
    archived: bool = False


class TemplateVersionResponse(ApiModel):
    id: UUID
    version: int
    file_name: str
    content_type: str
    byte_size: int
    created_at: datetime


class TemplateResponse(TemplateFields):
    id: UUID
    archived: bool
    revision: int
    updated_at: datetime
    versions: list[TemplateVersionResponse] = Field(default_factory=list)


class ReferenceChange(ApiModel):
    actor_user_id: UUID
    action: str
    target_type: str
    target_id: UUID
    created_at: datetime
    details: dict[str, object] = Field(default_factory=dict)


class ReferenceDirectoryResponse(ApiModel):
    profile: ProfileResponse
    partners: list[PartnerResponse]
    experts: list[ExpertResponse]
    templates: list[TemplateResponse]
    changes: list[ReferenceChange] = Field(default_factory=list)
