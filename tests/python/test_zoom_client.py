"""Zoom transport behaviour is verified against a mocked Zoom, never the live API."""

import json
from datetime import UTC, datetime, timedelta

import httpx
import pytest
from pydantic import SecretStr, ValidationError

from yuksalish_api.settings import Settings
from yuksalish_api.zoom_client import ZoomClient, ZoomError
from yuksalish_api.zoom_schemas import CreateZoomMeetingRequest

pytestmark = pytest.mark.anyio


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"


def zoom_settings(**overrides: object) -> Settings:
    values: dict[str, object] = {
        "environment": "test",
        "zoom_account_id": "account",
        "zoom_client_id": "client",
        "zoom_client_secret": SecretStr("secret"),
        "zoom_host_user_id": "host@example.com",
    }
    values.update(overrides)
    return Settings(**values)  # type: ignore[arg-type]


def _token_response() -> httpx.Response:
    return httpx.Response(200, json={"access_token": "token-1", "expires_in": 3600})


def test_settings_stay_unconfigured_until_every_credential_is_present() -> None:
    assert zoom_settings().zoom_configured is True
    assert zoom_settings(zoom_host_user_id="").zoom_configured is False
    assert zoom_settings(zoom_client_secret=SecretStr("")).zoom_configured is False


async def test_create_meeting_sends_a_scheduled_conference_and_reads_the_link() -> None:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        if request.url.path.endswith("/oauth/token"):
            return _token_response()
        return httpx.Response(
            201,
            json={
                "id": 81234567890,
                "join_url": "https://zoom.us/j/81234567890",
                "password": "7788",
            },
        )

    settings = zoom_settings()
    client = ZoomClient(settings, httpx.AsyncClient(transport=httpx.MockTransport(handler)))
    starts_at = datetime(2026, 10, 1, 9, 0, tzinfo=UTC)
    meeting = await client.create_meeting(
        topic="Планёрка", starts_at=starts_at, duration_minutes=45, description="Повестка"
    )

    assert meeting.meeting_id == "81234567890"
    assert meeting.join_url == "https://zoom.us/j/81234567890"
    assert meeting.passcode == "7788"
    creation = seen[-1]
    assert creation.headers["Authorization"] == "Bearer token-1"
    body = json.loads(creation.read())
    assert body["type"] == 2
    assert body["start_time"] == "2026-10-01T09:00:00Z"
    assert body["duration"] == 45
    assert body["timezone"] == "Asia/Tashkent"
    # Cloud recording is deliberately out of scope for the Workspace module.
    assert body["settings"]["auto_recording"] == "none"
    assert body["settings"]["join_before_host"] is True
    await client.aclose()


async def test_expired_token_is_refreshed_once_and_the_call_succeeds() -> None:
    calls = {"token": 0, "api": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/oauth/token"):
            calls["token"] += 1
            return httpx.Response(
                200, json={"access_token": f"token-{calls['token']}", "expires_in": 3600}
            )
        calls["api"] += 1
        if calls["api"] == 1:
            return httpx.Response(401, json={"code": 124})
        return httpx.Response(200, json={"meetings": []})

    client = zoom_settings()
    zoom = ZoomClient(client, httpx.AsyncClient(transport=httpx.MockTransport(handler)))
    assert await zoom.list_upcoming() == []
    assert calls == {"token": 2, "api": 2}
    await zoom.aclose()


async def test_rate_limited_request_is_retried_before_giving_up() -> None:
    attempts = {"api": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/oauth/token"):
            return _token_response()
        attempts["api"] += 1
        if attempts["api"] == 1:
            return httpx.Response(429, headers={"Retry-After": "0"}, json={})
        return httpx.Response(200, json={"meetings": []})

    zoom = ZoomClient(zoom_settings(), httpx.AsyncClient(transport=httpx.MockTransport(handler)))
    assert await zoom.list_upcoming() == []
    assert attempts["api"] == 2
    await zoom.aclose()


async def test_persistent_zoom_failure_surfaces_a_readable_error() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/oauth/token"):
            return _token_response()
        return httpx.Response(500, json={})

    zoom = ZoomClient(zoom_settings(), httpx.AsyncClient(transport=httpx.MockTransport(handler)))
    with pytest.raises(ZoomError) as failure:
        await zoom.list_upcoming()
    assert failure.value.status_code == 502
    assert "Zoom" in failure.value.detail
    await zoom.aclose()


async def test_unauthorized_credentials_do_not_leak_into_the_error() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(400, json={"reason": "Invalid client_secret"})

    zoom = ZoomClient(zoom_settings(), httpx.AsyncClient(transport=httpx.MockTransport(handler)))
    with pytest.raises(ZoomError) as failure:
        await zoom.list_upcoming()
    assert "secret" not in failure.value.detail
    await zoom.aclose()


async def test_deleting_an_already_removed_meeting_is_not_an_error() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/oauth/token"):
            return _token_response()
        return httpx.Response(404, json={"code": 3001})

    zoom = ZoomClient(zoom_settings(), httpx.AsyncClient(transport=httpx.MockTransport(handler)))
    await zoom.delete_meeting("81234567890")
    await zoom.aclose()


async def test_upcoming_calendar_spans_pages_and_skips_meetings_without_a_time() -> None:
    pages = {
        "": {
            "meetings": [
                {
                    "id": 1,
                    "topic": "Из бота",
                    "start_time": "2026-10-01T05:00:00Z",
                    "duration": 60,
                },
                {"id": 2, "topic": "Повторяющаяся без времени", "duration": 60},
                {"id": 3, "topic": "Без длительности", "start_time": "2026-10-01T08:00:00Z"},
            ],
            "next_page_token": "page-2",
        },
        "page-2": {
            "meetings": [
                {
                    "id": 4,
                    "topic": "Вторая страница",
                    "start_time": "2026-10-02T05:00:00Z",
                    "duration": 30,
                }
            ],
            "next_page_token": "",
        },
    }

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/oauth/token"):
            return _token_response()
        return httpx.Response(200, json=pages[request.url.params.get("next_page_token", "")])

    zoom = ZoomClient(zoom_settings(), httpx.AsyncClient(transport=httpx.MockTransport(handler)))
    bookings = await zoom.list_upcoming()
    assert [booking.meeting_id for booking in bookings] == ["1", "4"]
    first = bookings[0]
    assert first.starts_at == datetime(2026, 10, 1, 5, 0, tzinfo=UTC)
    assert first.ends_at == first.starts_at + timedelta(minutes=60)
    await zoom.aclose()


def test_booking_request_enforces_the_fifteen_minute_grid() -> None:
    base = datetime(2026, 10, 1, 9, 0, tzinfo=UTC)

    def build(**overrides: object) -> CreateZoomMeetingRequest:
        values: dict[str, object] = {
            "topic": "Планёрка",
            "startsAt": base,
            "durationMinutes": 60,
        }
        values.update(overrides)
        return CreateZoomMeetingRequest.model_validate(values)

    assert build().duration_minutes == 60
    for invalid in (
        {"durationMinutes": 20},
        {"durationMinutes": 10},
        {"durationMinutes": 495},
        {"startsAt": base.replace(minute=7)},
        {"startsAt": base.replace(second=30)},
        {"startsAt": datetime(2026, 10, 1, 9, 0)},
        {"topic": "   "},
        {"topic": "x" * 201},
        {"description": "d" * 2001},
        {"participantIds": ["same", "same"]},
    ):
        with pytest.raises(ValidationError):
            build(**invalid)
