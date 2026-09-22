"""Account bindings; Telegram identities are never derived from job titles."""

from datetime import datetime
from typing import Literal

from pydantic import Field, field_validator, model_validator

from .workspace_schemas import ApiModel

ReviewerKey = Literal["askar", "bobur", "umid", "davronbek"]


class ReviewerBindingInput(ApiModel):
    key: ReviewerKey
    username: str = Field(default="", max_length=64)
    telegram_id: str | None = Field(default=None, pattern=r"^[1-9][0-9]{0,15}$")
    enabled: bool = False

    @field_validator("username")
    @classmethod
    def normalize_username(cls, value: str) -> str:
        return value.strip().removeprefix("@").lower()

    @model_validator(mode="after")
    def enabled_requires_account(self) -> "ReviewerBindingInput":
        if self.enabled and not self.username:
            raise ValueError("Для включённого согласующего выберите аккаунт Workspace.")
        return self


class ReviewerConfigurationUpdate(ApiModel):
    expected_revision: int = Field(ge=1)
    reviewers: list[ReviewerBindingInput] = Field(min_length=4, max_length=4)

    @model_validator(mode="after")
    def validate_unique_bindings(self) -> "ReviewerConfigurationUpdate":
        if len({item.key for item in self.reviewers}) != 4:
            raise ValueError("Каждый согласующий должен быть указан один раз.")
        for values in (
            [item.username for item in self.reviewers if item.username],
            [item.telegram_id for item in self.reviewers if item.telegram_id],
        ):
            if len(set(values)) != len(values):
                raise ValueError("Один аккаунт или Telegram ID нельзя назначить дважды.")
        return self


class ReviewerBindingResponse(ApiModel):
    key: ReviewerKey
    label: str
    suggested_username: str
    user_id: str | None
    username: str
    full_name: str
    telegram_id: str | None
    enabled: bool
    account_active: bool
    can_approve: bool


class ReviewerRuntimeResponse(ApiModel):
    agent_id: str
    agent_name: str
    applied_revision: int | None
    applied_at: datetime | None
    last_seen_at: datetime
    error: str | None


class ReviewerConfigurationResponse(ApiModel):
    revision: int
    updated_at: datetime
    reviewers: list[ReviewerBindingResponse]
    runtimes: list[ReviewerRuntimeResponse] = Field(default_factory=list)


class ReviewerRuntimeAcknowledgement(ApiModel):
    agent_id: str = Field(min_length=1, max_length=128, pattern=r"^[A-Za-z0-9_.-]+$")
    agent_name: str = Field(min_length=1, max_length=200)
    revision: int = Field(ge=1)
    error: str | None = Field(default=None, max_length=500)
