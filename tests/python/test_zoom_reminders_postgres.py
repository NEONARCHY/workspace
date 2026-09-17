"""Zoom reminders must reach everyone once, and repeat only after a reschedule."""

import os
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import create_async_engine

from test_zoom_postgres import zoom_settings
from yuksalish_api.repository import find_active_user_by_username
from yuksalish_api.seed import seed_demo_data
from yuksalish_api.tables import workspace_notifications, zoom_meeting_participants, zoom_meetings
from yuksalish_api.zoom_service import materialize_zoom_reminders


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"


@pytest.mark.anyio
@pytest.mark.postgres
async def test_reminders_are_sent_once_to_everyone_invited() -> None:
    database_url = os.environ.get("YUKSALISH_TEST_DATABASE_URL")
    if not database_url:
        pytest.skip("YUKSALISH_TEST_DATABASE_URL is not configured")
    engine = create_async_engine(database_url)
    settings = zoom_settings(database_url)
    try:
        await seed_demo_data(engine)
        meeting_id = uuid4()
        starts_at = datetime.now(UTC) + timedelta(minutes=20)
        async with engine.begin() as connection:
            await connection.execute(delete(zoom_meeting_participants))
            await connection.execute(delete(zoom_meetings))
            await connection.execute(
                delete(workspace_notifications).where(workspace_notifications.c.kind == "zoom")
            )
            organizer = await find_active_user_by_username(connection, "dilshod")
            guest = await find_active_user_by_username(connection, "aziza")
            assert organizer is not None and guest is not None
            await connection.execute(
                zoom_meetings.insert().values(
                    id=meeting_id,
                    organizer_user_id=organizer["id"],
                    topic="Планёрка отдела",
                    starts_at=starts_at,
                    ends_at=starts_at + timedelta(minutes=30),
                    duration_minutes=30,
                    timezone=settings.zoom_timezone,
                    status="scheduled",
                    source="workspace",
                    reminders_enabled=True,
                    zoom_meeting_id="81234567890",
                    created_at=datetime.now(UTC),
                    updated_at=datetime.now(UTC),
                )
            )
            await connection.execute(
                zoom_meeting_participants.insert().values(
                    meeting_id=meeting_id, user_id=guest["id"]
                )
            )

        async def reminders() -> list[str]:
            async with engine.begin() as connection:
                rows = (
                    await connection.execute(
                        select(workspace_notifications.c.user_id).where(
                            workspace_notifications.c.entity_id == meeting_id,
                            workspace_notifications.c.kind == "zoom",
                        )
                    )
                ).scalars().all()
            return sorted(str(value) for value in rows)

        async def run() -> int:
            async with engine.begin() as connection:
                return await materialize_zoom_reminders(connection, settings)

        assert await run() == 1
        expected = sorted([str(organizer["id"]), str(guest["id"])])
        assert await reminders() == expected

        # A second scheduler pass must not duplicate anything.
        await run()
        assert await reminders() == expected

        # A meeting further out than the lead time is not due yet.
        async with engine.begin() as connection:
            await connection.execute(
                update(zoom_meetings)
                .where(zoom_meetings.c.id == meeting_id)
                .values(
                    starts_at=datetime.now(UTC) + timedelta(hours=6),
                    ends_at=datetime.now(UTC) + timedelta(hours=6, minutes=30),
                )
            )
        assert await run() == 0

        # Reminders switched off, for example on an imported bot booking, stay silent.
        async with engine.begin() as connection:
            await connection.execute(
                update(zoom_meetings)
                .where(zoom_meetings.c.id == meeting_id)
                .values(
                    starts_at=datetime.now(UTC) + timedelta(minutes=10),
                    ends_at=datetime.now(UTC) + timedelta(minutes=40),
                    reminders_enabled=False,
                )
            )
        assert await run() == 0
    finally:
        await engine.dispose()
