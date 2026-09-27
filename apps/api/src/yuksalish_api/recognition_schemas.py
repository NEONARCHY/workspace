from datetime import date, datetime
from typing import Literal

from pydantic import Field, field_validator

from .workspace_schemas import ApiModel

RecognitionTier = Literal[
    "bronze",
    "silver",
    "gold",
    "platinum",
    "sapphire",
    "amethyst",
    "prism",
    "cosmic",
]
RecognitionCategory = Literal[
    "tasks",
    "projects",
    "trips",
    "meetings",
    "correspondence",
    "feed",
    "payment_creation",
    "payment_completion",
    "efficiency",
    "tenure",
    "communication",
    "support",
]
RewardIcon = Literal[
    "appreciation",
    "leadership",
    "rescue",
    "mentorship",
    "innovation",
    "reliability",
    "teamwork",
    "initiative",
    "mastery",
]


class EmployeeAchievementResponse(ApiModel):
    code: str
    title: str
    description: str
    category: RecognitionCategory
    tier: RecognitionTier
    icon_key: str
    progress: int = Field(ge=0)
    target: int = Field(ge=1)
    unlocked: bool
    earned_at: datetime | date | None = None


class EmployeeRewardResponse(ApiModel):
    id: str
    icon_key: RewardIcon
    title: str
    description: str
    context_note: str | None = None
    recipient_user_id: str
    issuer_user_id: str
    issuer_name: str
    created_at: datetime


class EmployeeRewardCatalogItem(ApiModel):
    icon_key: RewardIcon
    title: str
    description: str


class PublicEmployeeResponse(ApiModel):
    id: str
    name: str
    initials: str
    role: str
    department_id: str | None = None
    position_id: str | None = None
    job_title: str | None = None
    color: str
    status: Literal["pending", "active", "blocked", "archived"]
    avatar_version: str | None = None


class EmployeeRecognitionProfileResponse(ApiModel):
    person: PublicEmployeeResponse
    department_name: str | None = None
    employment_date: date | None = None
    service_years: int | None = Field(default=None, ge=0)
    service_months: int | None = Field(default=None, ge=0, le=11)
    service_days: int | None = Field(default=None, ge=0, le=31)
    active_task_count: int | None = Field(default=None, ge=0)
    active_task_count_visible: bool
    achievements: list[EmployeeAchievementResponse]
    rewards: list[EmployeeRewardResponse]
    reward_catalog: list[EmployeeRewardCatalogItem]
    can_issue_reward: bool
    can_manage_settings: bool


class RecognitionSettingsResponse(ApiModel):
    active_task_count_visible: bool
    updated_at: datetime | None = None


class RecognitionSettingsWrite(ApiModel):
    active_task_count_visible: bool


class EmployeeRewardCreate(ApiModel):
    icon_key: RewardIcon
    context_note: str | None = Field(default=None, max_length=240)

    @field_validator("context_note", mode="before")
    @classmethod
    def strip_context(cls, value: object) -> object:
        if isinstance(value, str):
            return value.strip() or None
        return value
