import asyncio
import os
from datetime import UTC, datetime, timedelta
from uuid import UUID

import pytest
from sqlalchemy import delete
from sqlalchemy.ext.asyncio import create_async_engine

from yuksalish_api.auth import load_authenticated_user
from yuksalish_api.repository import (
    WorkspaceRepositoryError,
    create_calendar_event,
    create_task,
    find_active_user_by_username,
    load_workspace,
    mark_notification_desktop_delivered,
    mark_notification_read,
    materialize_due_notifications,
    update_calendar_event,
    update_notification_preferences,
)
from yuksalish_api.seed import seed_demo_data
from yuksalish_api.tables import chat_members
from yuksalish_api.workspace_schemas import (
    CreateCalendarEventRequest,
    CreateTaskRequest,
    NotificationPreferencesUpdate,
    UpdateCalendarEventRequest,
)


async def _exercise_notifications(database_url: str) -> None:
    engine = create_async_engine(database_url)
    try:
        await seed_demo_data(engine)
        async with engine.connect() as connection:
            transaction = await connection.begin()
            try:
                owner_row = await find_active_user_by_username(connection, "aziza")
                other_row = await find_active_user_by_username(connection, "baxtiyor")
                assert owner_row is not None and other_row is not None
                owner = await load_authenticated_user(connection, owner_row["id"])
                other = await load_authenticated_user(connection, other_row["id"])
                assert owner is not None and other is not None
                await update_notification_preferences(
                    connection,
                    owner,
                    NotificationPreferencesUpdate(
                        desktop_enabled=False, messages_enabled=False, tasks_enabled=False,
                        approvals_enabled=False, trips_enabled=False, calendar_enabled=False,
                        reminders_enabled=False,
                    ),
                )
                deadline = datetime.now(UTC) + timedelta(hours=2)
                task = await create_task(
                    connection, owner,
                    CreateTaskRequest(title="Reminder isolation", due_at=deadline),
                )
                event = await create_calendar_event(
                    connection, owner,
                    CreateCalendarEventRequest(
                        title="Reminder meeting", starts_at=deadline,
                        ends_at=deadline + timedelta(hours=1), attendee_ids=[str(owner.id)],
                    ),
                )
                assert await materialize_due_notifications(connection) >= 2
                assert await materialize_due_notifications(connection) == 0
                snapshot = await load_workspace(connection, owner)
                reminders = [
                    item for item in snapshot.notifications
                    if item.is_reminder and item.entity_id in {task.id, event.id}
                ]
                assert len(reminders) == 2  # Disabled popups never discard the internal queue.
                assert all("(Ташкент)" in item.body for item in reminders)
                notification_id = UUID(reminders[0].id)
                first_read = await mark_notification_read(connection, owner, notification_id)
                second_read = await mark_notification_read(connection, owner, notification_id)
                assert first_read.read_at == second_read.read_at
                first_delivery = await mark_notification_desktop_delivered(
                    connection, owner, notification_id,
                )
                second_delivery = await mark_notification_desktop_delivered(
                    connection, owner, notification_id,
                )
                assert first_delivery.desktop_delivered_at == second_delivery.desktop_delivered_at
                with pytest.raises(WorkspaceRepositoryError, match="not found"):
                    await mark_notification_read(connection, other, notification_id)
                with pytest.raises(WorkspaceRepositoryError, match="not found"):
                    await mark_notification_desktop_delivered(connection, other, notification_id)
                await update_calendar_event(
                    connection, owner, UUID(event.id),
                    UpdateCalendarEventRequest(
                        title=event.title, starts_at=deadline + timedelta(hours=1),
                        ends_at=deadline + timedelta(hours=2), attendee_ids=[str(owner.id)],
                    ),
                )
                assert await materialize_due_notifications(connection) == 1
                assert await materialize_due_notifications(connection) == 0
                reloaded = await load_workspace(connection, owner)
                persisted = next(
                    item for item in reloaded.notifications if item.id == reminders[0].id
                )
                assert persisted.occurred_at == reminders[0].occurred_at
                assert persisted.desktop_delivered_at == first_delivery.desktop_delivered_at
                assert any(item.kind == "message" for item in reloaded.notifications)
                await connection.execute(
                    delete(chat_members).where(chat_members.c.user_id == owner.id)
                )
                restricted = await load_workspace(connection, owner)
                assert not any(item.kind == "message" for item in restricted.notifications)
            finally:
                await transaction.rollback()
    finally:
        await engine.dispose()


@pytest.mark.postgres
def test_notification_delivery_is_owned_and_idempotent() -> None:
    database_url = os.environ.get("YUKSALISH_TEST_DATABASE_URL")
    if not database_url:
        pytest.skip("YUKSALISH_TEST_DATABASE_URL is not configured")
    asyncio.run(_exercise_notifications(database_url))
