"""Telegram bot grants remain separate from letter approval rights."""

from uuid import uuid4

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from yuksalish_api.auth import AuthenticatedUser
from yuksalish_api.telegram_access_schemas import TelegramAccessUpdate
from yuksalish_api.telegram_access_service import BOT_CATALOG, require_telegram_admin


@pytest.mark.parametrize("role", ["employee", "manager", "admin", "superadmin"])
def test_only_administrators_can_manage_bot_access(role: str) -> None:
    actor = AuthenticatedUser(
        id=uuid4(), username="actor", full_name="Actor", role=role,
        position_id=None, job_title=None,
    )
    if role in {"admin", "superadmin"}:
        require_telegram_admin(actor)
    else:
        with pytest.raises(HTTPException) as error:
            require_telegram_admin(actor)
        assert error.value.status_code == 403


def test_bot_grant_requires_numeric_telegram_id() -> None:
    with pytest.raises(ValidationError, match="Укажите Telegram ID"):
        TelegramAccessUpdate(telegramId=None, botKeys=["ai_referent"], expectedRevision=0)
    for invalid in ("@username", "00123", "-123", "1" * 17):
        with pytest.raises(ValidationError):
            TelegramAccessUpdate(
                telegramId=invalid, botKeys=["ai_referent"], expectedRevision=0
            )
    assert TelegramAccessUpdate(
        telegramId="123456", botKeys=["ai_referent"], expectedRevision=0
    ).bot_keys == ["ai_referent"]
    with pytest.raises(ValidationError, match="не должен повторяться"):
        TelegramAccessUpdate(
            telegramId="123456", botKeys=["ai_referent", "ai_referent"],
            expectedRevision=0,
        )


def test_future_bot_catalog_is_explicitly_not_connected() -> None:
    assert [bot.key for bot in BOT_CATALOG if bot.connected] == ["ai_referent"]
    assert {bot.key for bot in BOT_CATALOG} == {
        "ai_referent", "hisobot", "takliflar", "hudud_rating", "ai_news_reader"
    }
