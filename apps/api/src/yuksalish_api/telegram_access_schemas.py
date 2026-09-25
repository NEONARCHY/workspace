"""Shared Telegram identity and bot-access contracts."""

from typing import Literal
from uuid import UUID

from pydantic import Field, model_validator

from .workspace_schemas import ApiModel

BotKey = Literal["ai_referent", "hisobot", "takliflar", "hudud_rating", "ai_news_reader"]
HISOBOT_REGIONS = frozenset({
    "Андижон вилояти", "Бухоро вилояти", "Фарғона вилояти", "Жиззах вилояти",
    "Наманган вилояти", "Навоий вилояти", "Қашқадарё вилояти",
    "Қорақалпоғистон Республикаси", "Самарқанд вилояти", "Сирдарё вилояти",
    "Сурхондарё вилояти", "Тошкент шаҳри", "Тошкент вилояти", "Хоразм вилояти",
})


class BotDescriptor(ApiModel):
    key: BotKey
    label: str
    connected: bool


class TelegramAccessPerson(ApiModel):
    user_id: UUID
    username: str
    full_name: str
    job_title: str | None
    telegram_id: str | None
    verified: bool
    verification_source: str | None
    bot_keys: list[BotKey]
    hisobot_scope: Literal["central", "hudud"] | None = None
    hisobot_region: str | None = None
    hisobot_report_required: bool = True
    hisobot_manager: bool = False
    revision: int


class TelegramAccessRegistry(ApiModel):
    bots: list[BotDescriptor]
    people: list[TelegramAccessPerson]


class TelegramAccessUpdate(ApiModel):
    telegram_id: str | None = Field(default=None, pattern=r"^[1-9][0-9]{0,15}$")
    bot_keys: list[BotKey] = Field(default_factory=list)
    hisobot_scope: Literal["central", "hudud"] | None = None
    hisobot_region: str | None = None
    hisobot_report_required: bool = True
    hisobot_manager: bool = False
    expected_revision: int = Field(ge=0)

    @model_validator(mode="after")
    def validate_grants(self) -> "TelegramAccessUpdate":
        if self.bot_keys and not self.telegram_id:
            raise ValueError("Укажите Telegram ID перед выдачей доступа к ботам.")
        if len(self.bot_keys) != len(set(self.bot_keys)):
            raise ValueError("Бот не должен повторяться в списке доступа.")
        if "hisobot" in self.bot_keys:
            if self.hisobot_scope is None:
                raise ValueError("Для AI Hisobot выберите Центральный аппарат или регион.")
            if self.hisobot_scope == "hudud" and not self.hisobot_region:
                raise ValueError("Для регионального сотрудника выберите регион.")
            if self.hisobot_scope == "hudud" and self.hisobot_region not in HISOBOT_REGIONS:
                raise ValueError("Выберите регион из списка 14 территориальных подразделений.")
            if self.hisobot_scope == "central" and self.hisobot_region:
                raise ValueError("Для центрального аппарата регион не указывается.")
        return self
