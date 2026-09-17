# ruff: noqa: RUF001
"""The Zoom endpoints over HTTP: who may call them and what they return."""

import os
from datetime import UTC, datetime, timedelta

import httpx
import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import delete
from sqlalchemy.ext.asyncio import create_async_engine

from test_zoom_postgres import FakeZoom, zoom_settings
from yuksalish_api.main import create_app
from yuksalish_api.tables import zoom_meeting_participants, zoom_meetings
from yuksalish_api.zoom_client import ZoomClient
from yuksalish_api.zoom_service import reset_host_calendar_cache


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"


def _slot(days_ahead: int, hour: int) -> str:
    moment = (datetime.now(UTC) + timedelta(days=days_ahead)).replace(
        hour=hour, minute=0, second=0, microsecond=0
    )
    return moment.isoformat()


@pytest.mark.anyio
@pytest.mark.postgres
async def test_zoom_endpoints_enforce_access_and_report_conflicts() -> None:
    database_url = os.environ.get("YUKSALISH_TEST_DATABASE_URL")
    if not database_url:
        pytest.skip("YUKSALISH_TEST_DATABASE_URL is not configured")
    engine = create_async_engine(database_url)
    async with engine.begin() as connection:
        await connection.execute(delete(zoom_meeting_participants))
        await connection.execute(delete(zoom_meetings))
    await engine.dispose()

    settings = zoom_settings(database_url)
    settings.seed_demo_data = True
    app = create_app(settings)
    zoom_account = FakeZoom()
    reset_host_calendar_cache()
    async with (
        app.router.lifespan_context(app),
        AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client,
    ):
        # Drive the real client, but against a Zoom account we control.
        app.state.zoom_client = ZoomClient(
            settings, httpx.AsyncClient(transport=httpx.MockTransport(zoom_account.handler))
        )

        async def login(username: str) -> dict[str, str]:
            response = await client.post(
                "/api/v1/auth/login",
                json={
                    "username": username,
                    "password": "Yuksalish-Local-2026!",
                    "deviceLabel": "test",
                },
            )
            assert response.status_code == 200, response.text
            return {"Authorization": f"Bearer {response.json()['accessToken']}"}

        owner = await login("dilshod")
        peer = await login("aziza")

        assert (await client.get("/api/v1/zoom-meetings")).status_code == 401

        empty = await client.get("/api/v1/zoom-meetings", headers=owner)
        assert empty.status_code == 200
        payload = empty.json()
        assert payload["configured"] is True
        assert payload["slotMinutes"] == 15
        assert payload["meetings"] == []

        start = _slot(3, 10)
        created = await client.post(
            "/api/v1/zoom-meetings",
            headers=owner,
            json={"topic": "Планёрка отдела", "startsAt": start, "durationMinutes": 60},
        )
        assert created.status_code == 201, created.text
        meeting = created.json()
        assert meeting["status"] == "scheduled"
        assert meeting["joinUrl"].startswith("https://zoom.us/j/")
        assert meeting["canCancel"] is True

        # A malformed slot never reaches Zoom.
        rejected = await client.post(
            "/api/v1/zoom-meetings",
            headers=owner,
            json={"topic": "Не по сетке", "startsAt": _slot(4, 10), "durationMinutes": 20},
        )
        assert rejected.status_code == 422

        conflicting = await client.post(
            "/api/v1/zoom-meetings",
            headers=peer,
            json={"topic": "Пересечение", "startsAt": start, "durationMinutes": 30},
        )
        assert conflicting.status_code == 409

        availability = await client.get(
            "/api/v1/zoom-meetings/availability",
            headers=peer,
            params={"day": start[:10]},
        )
        assert availability.status_code == 200
        assert any(item["source"] == "workspace" for item in availability.json()["intervals"])

        # Another employee sees the booking but neither the link nor the controls.
        listing = await client.get("/api/v1/zoom-meetings", headers=peer)
        visible = listing.json()["meetings"][0]
        assert visible["joinUrl"] is None and visible["passcode"] is None
        assert visible["canCancel"] is False

        forbidden = await client.post(
            f"/api/v1/zoom-meetings/{meeting['id']}/cancel", headers=peer
        )
        assert forbidden.status_code == 403

        moved = await client.patch(
            f"/api/v1/zoom-meetings/{meeting['id']}",
            headers=owner,
            json={"topic": "Планёрка перенесена", "startsAt": _slot(5, 10), "durationMinutes": 45},
        )
        assert moved.status_code == 200, moved.text
        assert moved.json()["durationMinutes"] == 45

        cancelled = await client.post(
            f"/api/v1/zoom-meetings/{meeting['id']}/cancel", headers=owner
        )
        assert cancelled.status_code == 200
        assert cancelled.json()["status"] == "cancelled"
        assert zoom_account.created == {}

        missing = await client.post(
            f"/api/v1/zoom-meetings/{meeting['id']}/cancel", headers=owner
        )
        assert missing.status_code == 409
        await app.state.zoom_client.aclose()
    reset_host_calendar_cache()
