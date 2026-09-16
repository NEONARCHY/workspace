from datetime import date, datetime
from typing import Literal

from pydantic import Field

from .workspace_schemas import ApiModel


class MemberDirectoryItemResponse(ApiModel):
    id: int
    telegram_id: str | None = None
    username: str | None = None
    first_name: str
    last_name: str | None = None
    language: str | None = None
    phone: str | None = None
    status: str
    created_at: datetime
    region_id: int | None = None
    region_name_ru: str | None = None
    region_name_uz: str | None = None
    sphere_id: int | None = None
    sphere_name_ru: str | None = None
    sphere_name_uz: str | None = None
    gender: Literal["male", "female"] | None = None
    birth_date: date | None = None
    profile_status: str | None = None
    updated_at: datetime | None = None


class MemberDirectoryReferenceResponse(ApiModel):
    id: int
    name_ru: str
    name_uz: str
    name_en: str | None = None


class MembersRegistryResponse(ApiModel):
    configured: bool
    generated_at: datetime | None = None
    members: list[MemberDirectoryItemResponse] = Field(default_factory=list)
    regions: list[MemberDirectoryReferenceResponse] = Field(default_factory=list)
    spheres: list[MemberDirectoryReferenceResponse] = Field(default_factory=list)
