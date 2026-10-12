import asyncio
import os
from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

import pytest
from sqlalchemy import insert, select, update
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import create_async_engine

from yuksalish_api.auth import load_authenticated_user
from yuksalish_api.calendar_audience import calendar_audience_ids
from yuksalish_api.errors import WorkspaceRepositoryError
from yuksalish_api.repository import (
    cancel_calendar_event,
    create_calendar_event,
    load_workspace,
    respond_to_calendar_event,
    update_calendar_event,
)
from yuksalish_api.seed import seed_demo_data
from yuksalish_api.tables import calendar_events, departments, users, workspace_notifications
from yuksalish_api.workspace_schemas import (
    CreateCalendarEventRequest,
    RespondCalendarEventRequest,
    UpdateCalendarEventRequest,
)


async def exercise_audience(database_url: str) -> None:
    engine = create_async_engine(database_url, pool_pre_ping=True)
    try:
        await seed_demo_data(engine)
        async with engine.connect() as connection:
            transaction = await connection.begin()
            try:
                template = (await connection.execute(
                    select(users).where(users.c.username == "baxtiyor")
                )).mappings().one()
                admin_id = (await connection.execute(
                    select(users.c.id).where(users.c.username == "malika")
                )).scalar_one()
                admin = await load_authenticated_user(connection, admin_id)
                employee = await load_authenticated_user(connection, template["id"])
                assert admin is not None and employee is not None
                deputy_id = (await connection.execute(
                    select(users.c.id).where(users.c.username == "dilshod")
                )).scalar_one()
                deputy = await load_authenticated_user(connection, deputy_id)
                assert deputy is not None
                assert (await load_workspace(connection, deputy)).can_invite_calendar_audience
                assert (await load_workspace(connection, admin)).can_invite_calendar_audience
                assert not (await load_workspace(connection, employee)).can_invite_calendar_audience
                region_id, child_id = uuid4(), uuid4()
                await connection.execute(insert(departments), [
                    {"id": region_id, "code": f"qa-{region_id}", "name": "QA region",
                     "scope": "regional", "parent_id": None, "created_at": datetime.now(UTC)},
                    {"id": child_id, "code": f"qa-{child_id}", "name": "QA child",
                     "scope": "central", "parent_id": region_id, "created_at": datetime.now(UTC)},
                ])
                await connection.execute(update(users).where(users.c.id == employee.id)
                                         .values(department_id=child_id))
                extra_ids = [uuid4() for _ in range(105)]
                await connection.execute(insert(users), [{
                    **dict(template), "id": user_id, "username": f"qa-{user_id}",
                    "full_name": f"QA staff {index}", "department_id": None,
                } for index, user_id in enumerate(extra_ids)])
                await connection.execute(update(users).where(users.c.id == extra_ids[-1])
                                         .values(status="blocked"))
                start = datetime.now(UTC) + timedelta(days=50)
                with pytest.raises(WorkspaceRepositoryError) as denied:
                    await create_calendar_event(connection, employee, CreateCalendarEventRequest(
                        title="Forbidden audience", starts_at=start,
                        ends_at=start + timedelta(hours=1), audience_scope="all",
                    ))
                assert denied.value.status_code == 403
                assert not (await connection.execute(select(calendar_events.c.id)
                    .where(calendar_events.c.title == "Forbidden audience"))).scalars().all()

                for offset, scope in enumerate(("central", "regional", "all")):
                    requested_start = start + timedelta(days=offset)
                    expected = set(await calendar_audience_ids(
                        connection, admin, scope
                    )) | {admin.id}
                    event = await create_calendar_event(
                        connection, admin, CreateCalendarEventRequest(
                        title=f"QA {scope}", starts_at=requested_start,
                        ends_at=requested_start + timedelta(hours=1), audience_scope=scope,
                        attendee_ids=[str(extra_ids[-1])],  # Ignored by the scope command.
                        ),
                    )
                    assert {UUID(item) for item in event.attendee_ids} == expected
                    assert extra_ids[-1] not in expected
                    assert (employee.id in expected) is (scope != "central")
                    if scope == "all":
                        assert len(expected) > 100
                    key = f"calendar:invitation:{event.id}"
                    notifications = (await connection.execute(select(workspace_notifications)
                        .where(workspace_notifications.c.event_key == key))).mappings().all()
                    assert {row["user_id"] for row in notifications} == expected - {admin.id}
                    assert len(notifications) == len(expected) - 1
                    assert all(row["requires_action"] for row in notifications)
                    with pytest.raises(WorkspaceRepositoryError, match="заняты"):
                        await create_calendar_event(connection, admin, CreateCalendarEventRequest(
                            title="QA overlap", starts_at=requested_start,
                            ends_at=requested_start + timedelta(hours=1), audience_scope=scope,
                        ))
                    await update_calendar_event(connection, admin, UUID(event.id),
                        UpdateCalendarEventRequest(title=f"Updated {scope}",
                            starts_at=requested_start, ends_at=requested_start + timedelta(hours=1),
                            audience_scope=scope))
                    assert len((await connection.execute(select(workspace_notifications.c.id)
                        .where(workspace_notifications.c.event_key == key))).scalars().all()) == (
                        len(expected) - 1
                    )
                deputy_start = start + timedelta(days=4)
                deputy_event = await create_calendar_event(
                    connection, deputy, CreateCalendarEventRequest(
                        title="Deputy regional event", starts_at=deputy_start,
                        ends_at=deputy_start + timedelta(hours=1), audience_scope="regional",
                    ),
                )
                assert set(deputy_event.attendee_ids) == {str(deputy.id), str(employee.id)}

                # Pending chair invitations may coexist; an accepted one reserves
                # only its half-open interval, including after an appearance edit.
                third_id = (await connection.execute(select(users.c.id).where(
                    users.c.username == "aziza",
                ))).scalar_one()
                third = await load_authenticated_user(connection, third_id)
                assert third is not None
                booking_start = start + timedelta(days=10)
                booking_end = booking_start + timedelta(hours=1)
                first = await create_calendar_event(
                    connection, employee, CreateCalendarEventRequest(
                    title="Chair invitation", starts_at=booking_start, ends_at=booking_end,
                    attendee_ids=[str(admin.id)], color="#669988", icon_key="training",
                    ),
                )
                await create_calendar_event(connection, deputy, CreateCalendarEventRequest(
                    title="Second pending invitation", starts_at=booking_start,
                    ends_at=booking_end, attendee_ids=[str(admin.id)],
                ))
                await respond_to_calendar_event(connection, admin, UUID(first.id),
                    RespondCalendarEventRequest(status="accepted"))
                edited = await update_calendar_event(connection, employee, UUID(first.id),
                    UpdateCalendarEventRequest(title="Appearance edit", starts_at=booking_start,
                        ends_at=booking_end, attendee_ids=[str(admin.id)], color="#648ABD",
                        icon_key="interview"))
                assert next(item for item in edited.attendees
                            if item.user_id == str(admin.id)).status == "accepted"
                assert edited.color == "#648ABD" and edited.icon_key == "interview"
                with pytest.raises(WorkspaceRepositoryError, match="заняты"):
                    await create_calendar_event(connection, third, CreateCalendarEventRequest(
                        title="Rejected chair overlap", starts_at=booking_start,
                        ends_at=booking_end, attendee_ids=[str(admin.id)],
                    ))
                adjacent = await create_calendar_event(
                    connection, third, CreateCalendarEventRequest(
                    title="Adjacent chair invitation", starts_at=booking_end,
                    ends_at=booking_end + timedelta(hours=1), attendee_ids=[str(admin.id)],
                    ),
                )
                assert adjacent.id
                await cancel_calendar_event(connection, employee, UUID(first.id))
                free = await create_calendar_event(connection, third, CreateCalendarEventRequest(
                    title="Cancelled booking releases chair", starts_at=booking_start,
                    ends_at=booking_end, attendee_ids=[str(admin.id)],
                ))
                assert free.id
            finally:
                await transaction.rollback()
    finally:
        await engine.dispose()


@pytest.mark.postgres
def test_scope_membership_notifications_and_conflicts() -> None:
    database_url = os.environ.get("YUKSALISH_TEST_DATABASE_URL")
    if not database_url:
        pytest.skip("YUKSALISH_TEST_DATABASE_URL is not configured")
    if not (make_url(database_url).database or "").startswith("yuksalish_test"):
        raise AssertionError("Calendar audience QA requires a dedicated yuksalish_test database")
    asyncio.run(exercise_audience(database_url))
