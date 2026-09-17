# ruff: noqa: RUF001
"""Booking guarantees that only a real PostgreSQL can prove.

The exclusion constraint, the released slot after a Zoom failure and the
server-side permission checks all live in the database or in the service, so
they are exercised against the test database with a mocked Zoom.
"""

import json
import os
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import UUID, uuid4

import httpx
import pytest
from pydantic import SecretStr
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import create_async_engine

from yuksalish_api.auth import load_authenticated_user
from yuksalish_api.repository import find_active_user_by_username
from yuksalish_api.seed import seed_demo_data
from yuksalish_api.settings import Settings
from yuksalish_api.tables import zoom_meeting_participants, zoom_meetings
from yuksalish_api.zoom_client import ZoomClient
from yuksalish_api.zoom_schemas import CreateZoomMeetingRequest, UpdateZoomMeetingRequest
from yuksalish_api.zoom_service import (
    ZoomServiceError,
    cancel_zoom_meeting,
    create_zoom_meeting,
    load_zoom_availability,
    load_zoom_meetings,
    recover_zoom_meetings,
    reset_host_calendar_cache,
    update_zoom_meeting,
)


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"


class FakeZoom:
    """A Zoom account whose calendar also holds bookings made by the Telegram bot."""

    def __init__(self) -> None:
        self.created: dict[str, dict[str, Any]] = {}
        self.external: list[dict[str, Any]] = []
        self.refuse_create = False
        self._next_id = 81000000000

    def add_external(self, starts_at: datetime, duration_minutes: int, topic: str) -> None:
        self.external.append(
            {
                "id": str(self._take_id()),
                "topic": topic,
                "start_time": starts_at.astimezone(UTC).isoformat().replace("+00:00", "Z"),
                "duration": duration_minutes,
            }
        )

    def _take_id(self) -> int:
        self._next_id += 1
        return self._next_id

    def handler(self, request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if path.endswith("/oauth/token"):
            return httpx.Response(200, json={"access_token": "token", "expires_in": 3600})
        if request.method == "POST" and path.endswith("/meetings"):
            if self.refuse_create:
                return httpx.Response(400, json={"code": 3000})
            body = json.loads(request.read())
            meeting_id = str(self._take_id())
            self.created[meeting_id] = {
                "id": meeting_id,
                "topic": body["topic"],
                "start_time": body["start_time"],
                "duration": body["duration"],
            }
            return httpx.Response(
                201,
                json={
                    "id": meeting_id,
                    "join_url": f"https://zoom.us/j/{meeting_id}",
                    "password": "4321",
                },
            )
        if request.method == "GET" and path.endswith("/meetings"):
            return httpx.Response(
                200,
                json={
                    "meetings": [*self.external, *self.created.values()],
                    "next_page_token": "",
                },
            )
        meeting_id = path.rsplit("/", 1)[-1]
        if request.method == "DELETE":
            self.created.pop(meeting_id, None)
            return httpx.Response(204)
        if request.method == "PATCH":
            body = json.loads(request.read())
            stored = self.created.get(meeting_id)
            if stored is not None:
                stored["start_time"] = body["start_time"]
                stored["duration"] = body["duration"]
                stored["topic"] = body["topic"]
            return httpx.Response(204)
        return httpx.Response(404, json={})


def zoom_settings(database_url: str) -> Settings:
    return Settings(  # type: ignore[call-arg]
        environment="test",
        database_url=database_url,
        zoom_account_id="account",
        zoom_client_id="client",
        zoom_client_secret=SecretStr("secret"),
        zoom_host_user_id="host@example.com",
        auth_signing_key=SecretStr("zoom-booking-test-signing-key"),
    )


def booking(starts_at: datetime, *, topic: str = "Планёрка", minutes: int = 60) -> Any:
    return {"topic": topic, "startsAt": starts_at, "durationMinutes": minutes}


def _next_slot(days_ahead: int, hour: int) -> datetime:
    base = datetime.now(UTC) + timedelta(days=days_ahead)
    return base.replace(hour=hour, minute=0, second=0, microsecond=0)


@pytest.mark.anyio
@pytest.mark.postgres
async def test_zoom_booking_conflicts_permissions_and_recovery() -> None:
    database_url = os.environ.get("YUKSALISH_TEST_DATABASE_URL")
    if not database_url:
        pytest.skip("YUKSALISH_TEST_DATABASE_URL is not configured")
    engine = create_async_engine(database_url)
    zoom_account = FakeZoom()
    settings = zoom_settings(database_url)
    client = ZoomClient(
        settings, httpx.AsyncClient(transport=httpx.MockTransport(zoom_account.handler))
    )
    try:
        await seed_demo_data(engine)
        async with engine.begin() as connection:
            # The shared host calendar is global, so a repeat run starts from empty.
            await connection.execute(delete(zoom_meeting_participants))
            await connection.execute(delete(zoom_meetings))
            owner_row = await find_active_user_by_username(connection, "dilshod")
            peer_row = await find_active_user_by_username(connection, "aziza")
            admin_row = await find_active_user_by_username(connection, "malika")
            assert owner_row is not None and peer_row is not None and admin_row is not None
            owner = await load_authenticated_user(connection, owner_row["id"])
            peer = await load_authenticated_user(connection, peer_row["id"])
            admin = await load_authenticated_user(connection, admin_row["id"])
        assert owner is not None and peer is not None and admin is not None
        reset_host_calendar_cache()

        start = _next_slot(3, 9)
        created = await create_zoom_meeting(
            engine,
            owner,
            settings,
            client,
            CreateZoomMeetingRequest.model_validate(
                booking(start) | {"participantIds": [str(peer.id)]}
            ),
        )
        assert created.status == "scheduled"
        assert created.join_url is not None and created.zoom_meeting_id is not None
        assert created.participant_ids == [str(peer.id)]
        assert created.can_cancel is True

        # A second booking inside the same hour is refused by the database itself.
        with pytest.raises(ZoomServiceError) as overlap:
            await create_zoom_meeting(
                engine,
                peer,
                settings,
                client,
                CreateZoomMeetingRequest.model_validate(
                    booking(start + timedelta(minutes=30), topic="Пересечение")
                ),
            )
        assert overlap.value.status_code == 409

        # Touching slots are legal: one ends exactly when the next begins.
        adjacent = await create_zoom_meeting(
            engine,
            peer,
            settings,
            client,
            CreateZoomMeetingRequest.model_validate(
                booking(start + timedelta(minutes=60), topic="Сразу после")
            ),
        )
        assert adjacent.status == "scheduled"

        # A booking the bot made in Zoom blocks the slot even though we never stored it.
        external_start = _next_slot(4, 11)
        zoom_account.add_external(external_start, 60, "Встреча из бота")
        reset_host_calendar_cache()
        with pytest.raises(ZoomServiceError) as external:
            await create_zoom_meeting(
                engine,
                owner,
                settings,
                client,
                CreateZoomMeetingRequest.model_validate(
                    booking(external_start + timedelta(minutes=30), topic="Поверх бота")
                ),
            )
        assert external.value.status_code == 409
        assert "вне Workspace" in external.value.detail
        async with engine.begin() as connection:
            rejected = (
                await connection.execute(
                    select(zoom_meetings.c.status).where(zoom_meetings.c.topic == "Поверх бота")
                )
            ).scalar_one()
        # The slot we held while asking Zoom is released again.
        assert rejected == "failed"

        # A refusal from Zoom must never leave the calendar blocked either.
        zoom_account.refuse_create = True
        failed_start = _next_slot(5, 14)
        with pytest.raises(ZoomServiceError):
            await create_zoom_meeting(
                engine,
                owner,
                settings,
                client,
                CreateZoomMeetingRequest.model_validate(booking(failed_start, topic="Сбой Zoom")),
            )
        zoom_account.refuse_create = False
        reset_host_calendar_cache()
        retried = await create_zoom_meeting(
            engine,
            owner,
            settings,
            client,
            CreateZoomMeetingRequest.model_validate(booking(failed_start, topic="Повтор")),
        )
        assert retried.status == "scheduled"

        # Someone else's conference is an administrative action.
        with pytest.raises(ZoomServiceError) as forbidden:
            await cancel_zoom_meeting(engine, peer, settings, client, UUID(created.id))
        assert forbidden.value.status_code == 403

        moved = await update_zoom_meeting(
            engine,
            owner,
            settings,
            client,
            UUID(created.id),
            UpdateZoomMeetingRequest.model_validate(
                booking(start + timedelta(days=1), topic="Перенесённая планёрка")
            ),
        )
        assert moved.topic == "Перенесённая планёрка"
        assert moved.zoom_meeting_id == created.zoom_meeting_id

        cancelled = await cancel_zoom_meeting(engine, admin, settings, client, UUID(created.id))
        assert cancelled.status == "cancelled"
        assert cancelled.zoom_meeting_id not in zoom_account.created

        # The freed slot becomes bookable again.
        reused = await create_zoom_meeting(
            engine,
            peer,
            settings,
            client,
            CreateZoomMeetingRequest.model_validate(
                booking(start + timedelta(days=1), topic="На освободившееся время")
            ),
        )
        assert reused.status == "scheduled"

        async with engine.begin() as connection:
            listing = await load_zoom_meetings(connection, admin, settings)
            outsider_view = await load_zoom_meetings(connection, peer, settings)
            availability = await load_zoom_availability(
                connection,
                settings,
                client,
                external_start.replace(hour=0),
                external_start.replace(hour=0) + timedelta(days=1),
            )
        assert listing.configured is True
        assert listing.reminder_minutes == settings.zoom_reminder_minutes
        # An employee who is neither organizer nor participant never sees the link.
        hidden = next(item for item in outsider_view.meetings if item.id == retried.id)
        assert hidden.join_url is None and hidden.passcode is None
        assert hidden.can_cancel is False
        assert availability.host_calendar_synced is True
        assert any(item.source == "external" for item in availability.intervals)

        # A crash mid-booking leaves a held slot that recovery has to resolve.
        stale_id = uuid4()
        stale_start = _next_slot(6, 8)
        async with engine.begin() as connection:
            await connection.execute(
                zoom_meetings.insert().values(
                    id=stale_id,
                    organizer_user_id=owner.id,
                    topic="Зависшее бронирование",
                    starts_at=stale_start,
                    ends_at=stale_start + timedelta(minutes=30),
                    duration_minutes=30,
                    timezone=settings.zoom_timezone,
                    status="provisioning",
                    source="workspace",
                    reminders_enabled=True,
                    created_at=datetime.now(UTC) - timedelta(minutes=30),
                    updated_at=datetime.now(UTC) - timedelta(minutes=30),
                )
            )
        assert await recover_zoom_meetings(engine, client) >= 1
        async with engine.begin() as connection:
            recovered = (
                await connection.execute(
                    select(zoom_meetings.c.status).where(zoom_meetings.c.id == stale_id)
                )
            ).scalar_one()
        assert recovered == "failed"
    finally:
        await client.aclose()
        await engine.dispose()
        reset_host_calendar_cache()


@pytest.mark.anyio
async def test_booking_is_refused_while_zoom_is_not_configured() -> None:
    # Stated outright rather than inherited from whatever .env this machine has.
    settings = Settings(  # type: ignore[call-arg]
        environment="test",
        zoom_account_id="",
        zoom_client_id="",
        zoom_client_secret=SecretStr(""),
        zoom_host_user_id="",
    )
    assert settings.zoom_configured is False
    transport = httpx.MockTransport(lambda _: httpx.Response(500))
    client = ZoomClient(settings, httpx.AsyncClient(transport=transport))
    with pytest.raises(ZoomServiceError) as refusal:
        await create_zoom_meeting(
            None,  # type: ignore[arg-type]
            None,  # type: ignore[arg-type]
            settings,
            client,
            CreateZoomMeetingRequest.model_validate(booking(_next_slot(2, 10))),
        )
    assert refusal.value.status_code == 503
    await client.aclose()
