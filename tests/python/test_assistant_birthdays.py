"""Focused tests for the assistant boundary and birthday calendar rules."""

import asyncio
from datetime import date

import httpx
import pytest
from pydantic import ValidationError

from yuksalish_api.assistant_service import MODELS, generate_text
from yuksalish_api.birthday_service import birthday_today
from yuksalish_api.routers.assistant import BirthdayRequest


def test_birthday_setting_keeps_only_valid_day_and_month() -> None:
    assert BirthdayRequest(month=2, day=29).day == 29
    assert BirthdayRequest().month is None
    for month, day in [(2, 30), (4, 31), (None, 5), (12, None)]:
        with pytest.raises(ValidationError):
            BirthdayRequest(month=month, day=day)


def test_leap_day_is_observed_on_february_28_when_needed() -> None:
    assert birthday_today(2, 29, date(2028, 2, 29))
    assert birthday_today(2, 29, date(2027, 2, 28))
    assert not birthday_today(2, 29, date(2027, 3, 1))
    assert birthday_today(9, 28, date(2026, 9, 28))


def test_text_model_allowlist_and_server_only_key(monkeypatch: pytest.MonkeyPatch) -> None:
    original_client = httpx.AsyncClient
    requests: list[httpx.Request] = []

    def respond(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(200, json={
            "candidates": [{"content": {"parts": [{"text": "Ответ"}]}}]
        })

    def client_factory(*args: object, **kwargs: object) -> httpx.AsyncClient:
        return original_client(*args, transport=httpx.MockTransport(respond), **kwargs)

    monkeypatch.setattr("yuksalish_api.assistant_service.httpx.AsyncClient", client_factory)
    result = asyncio.run(generate_text(
        "test-secret", "flash", "Reply briefly", [{"role": "user", "parts": [{"text": "Hi"}]}],
    ))
    assert result == "Ответ"
    assert MODELS["flash"] in str(requests[0].url)
    assert requests[0].headers["x-goog-api-key"] == "test-secret"
    assert "test-secret" not in requests[0].content.decode()


def test_unconfigured_key_fails_without_network() -> None:
    with pytest.raises(ValueError, match="Ключ Gemini"):
        asyncio.run(generate_text("", "flash", "", []))
