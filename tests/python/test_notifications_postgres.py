import asyncio
import os
from datetime import UTC, datetime, timedelta
from uuid import UUID

import pytest
from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import create_async_engine

from yuksalish_api.auth import load_authenticated_user
from yuksalish_api.repository import (
    WorkspaceRepositoryError,
    create_approval_request,
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
from yuksalish_api.tables import (
    approval_deadline_events,
    approval_nodes,
    approval_requests,
    chat_members,
    workspace_notifications,
)
from yuksalish_api.workspace_schemas import (
    CreateApprovalRequest,
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

                control_deadline = datetime.now(UTC).replace(microsecond=0) + timedelta(hours=25)
                approval = await create_approval_request(
                    connection,
                    owner,
                    CreateApprovalRequest(
                        title="Deadline control approval",
                        amount=1_250_000,
                        deadline=control_deadline,
                    ),
                )
                template_id = await connection.scalar(
                    select(approval_requests.c.template_id).where(
                        approval_requests.c.id == UUID(approval.id)
                    )
                )
                node_key = approval.active_node_keys[0]
                node_config = await connection.scalar(
                    select(approval_nodes.c.config).where(
                        approval_nodes.c.template_id == template_id,
                        approval_nodes.c.node_key == node_key,
                    )
                )
                await connection.execute(
                    update(approval_nodes)
                    .where(
                        approval_nodes.c.template_id == template_id,
                        approval_nodes.c.node_key == node_key,
                    )
                    .values(
                        config={
                            **(node_config or {}),
                            "reminderHoursBefore": [12, 1],
                            "escalationAfterHours": 3,
                            "escalationUserId": str(other.id),
                        }
                    )
                )
                await materialize_due_notifications(
                    connection,
                    control_deadline - timedelta(hours=11),
                )
                await materialize_due_notifications(
                    connection,
                    control_deadline - timedelta(minutes=30),
                )
                await materialize_due_notifications(
                    connection,
                    control_deadline + timedelta(minutes=1),
                )
                await materialize_due_notifications(
                    connection,
                    control_deadline + timedelta(hours=5),
                )
                event_rows = (
                    (
                        await connection.execute(
                            select(approval_deadline_events).where(
                                approval_deadline_events.c.request_id == UUID(approval.id)
                            )
                        )
                    )
                    .mappings()
                    .all()
                )
                assert {row["event_type"] for row in event_rows} == {
                    "reminder",
                    "overdue",
                    "escalation",
                }
                assert {
                    row["threshold_hours"]
                    for row in event_rows
                    if row["event_type"] == "reminder"
                } == {12, 1}
                assert any(
                    row["recipient_role"] == "requester"
                    and row["recipient_user_id"] == owner.id
                    for row in event_rows
                )
                assert any(
                    row["recipient_role"] == "process_owner"
                    and row["recipient_user_id"] == other.id
                    and row["threshold_hours"] == 3
                    for row in event_rows
                )
                event_count = len(event_rows)
                await materialize_due_notifications(
                    connection,
                    control_deadline + timedelta(hours=5),
                )
                assert await connection.scalar(
                    select(func.count())
                    .select_from(approval_deadline_events)
                    .where(approval_deadline_events.c.request_id == UUID(approval.id))
                ) == event_count
                assert await connection.scalar(
                    select(func.count())
                    .select_from(workspace_notifications)
                    .where(
                        workspace_notifications.c.entity_id == UUID(approval.id),
                        workspace_notifications.c.is_reminder.is_(True),
                    )
                ) == event_count
                approval_snapshot = await load_workspace(connection, owner)
                controlled = next(
                    item for item in approval_snapshot.requests if item.id == approval.id
                )
                assert controlled.deadline_control.status == "on_track"
                assert controlled.deadline_control.reminder_hours_before == [12, 1]
                assert controlled.deadline_control.escalation_after_hours == 3
                assert len(controlled.deadline_control.events) >= 1
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
