from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import Field, field_validator

from .position_policy import latin_position_name
from .workspace_schemas import ApiModel, PersonResponse


def _normalize_username(value: str) -> str:
    normalized = value.strip().lower()
    allowed = set("abcdefghijklmnopqrstuvwxyz0123456789._-")
    if len(normalized) < 3 or any(character not in allowed for character in normalized):
        raise ValueError("Use 3-64 Latin letters, digits, dots, dashes or underscores")
    return normalized


class LoginRequest(ApiModel):
    username: str = Field(min_length=3, max_length=64)
    password: str = Field(min_length=12, max_length=128)
    totp_code: str | None = Field(default=None, pattern=r"^\d{6}$")
    device_label: str = Field(default="Yuksalish Desktop", min_length=1, max_length=160)

    @field_validator("username")
    @classmethod
    def normalize_username(cls, value: str) -> str:
        return _normalize_username(value)


class RefreshRequest(ApiModel):
    refresh_token: str = Field(min_length=32, max_length=256)


class AuthenticationResponse(ApiModel):
    access_token: str
    refresh_token: str
    token_type: Literal["bearer"] = "bearer"
    expires_in: int
    user: PersonResponse


class InvitationCreateRequest(ApiModel):
    username: str = Field(min_length=3, max_length=64)
    full_name: str = Field(min_length=2, max_length=200)
    job_title: str | None = Field(default=None, max_length=160)
    position_id: UUID | None = None
    role: Literal["admin", "manager", "employee"] = "employee"
    department_id: UUID | None = None

    @field_validator("username")
    @classmethod
    def normalize_username(cls, value: str) -> str:
        return _normalize_username(value)

    @field_validator("job_title")
    @classmethod
    def job_title_must_use_latin(cls, value: str | None) -> str | None:
        return None if value is None else latin_position_name(value)


class InvitationResponse(ApiModel):
    id: str
    username: str
    full_name: str
    role: str
    invite_token: str
    expires_at: datetime


class InvitationAcceptRequest(ApiModel):
    invite_token: str = Field(min_length=32, max_length=256)
    password: str = Field(min_length=12, max_length=128)
    device_label: str = Field(default="Yuksalish Desktop", min_length=1, max_length=160)


class PasswordResetCreateRequest(ApiModel):
    username: str = Field(min_length=3, max_length=64)
    reset_totp: bool = False

    @field_validator("username")
    @classmethod
    def normalize_username(cls, value: str) -> str:
        return _normalize_username(value)


class PasswordResetResponse(ApiModel):
    id: str
    username: str
    reset_token: str
    reset_totp: bool
    expires_at: datetime


class PasswordResetCompleteRequest(ApiModel):
    reset_token: str = Field(min_length=32, max_length=256)
    password: str = Field(min_length=12, max_length=128)
    device_label: str = Field(default="Yuksalish Desktop", min_length=1, max_length=160)


class DirectPasswordChangeRequest(ApiModel):
    password: str = Field(min_length=12, max_length=128)


class TotpSetupResponse(ApiModel):
    secret: str
    otpauth_uri: str


class TotpConfirmRequest(ApiModel):
    code: str = Field(pattern=r"^\d{6}$")


class TotpDisableRequest(ApiModel):
    password: str = Field(min_length=12, max_length=128)
    code: str = Field(pattern=r"^\d{6}$")


class TotpStatusResponse(ApiModel):
    enabled: bool


class SessionSummaryResponse(ApiModel):
    id: str
    device_label: str
    created_at: datetime
    last_seen_at: datetime
    expires_at: datetime
    current: bool
