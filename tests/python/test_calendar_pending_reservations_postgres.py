"""Exercise reservations and concurrent RSVP only in a dedicated test database."""

import asyncio
import os
from datetime import UTC, datetime, timedelta
from uuid import UUID

import pytest
from sqlalchemy import delete, select
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine

from yuksalish_api.auth import AuthenticatedUser, load_authenticated_user
from yuksalish_api.errors import WorkspaceRepositoryError
from yuksalish_api.repository import (
    cancel_calendar_event,
    create_calendar_event,
    respond_to_calendar_event,
)
from yuksalish_api.seed import seed_demo_data
from yuksalish_api.tables import (
    calendar_event_attendees,
    calendar_events,
    users,
    workspace_notifications,
)
from yuksalish_api.workspace_schemas import (
    CreateCalendarEventRequest,
    RespondCalendarEventRequest,
)


def _database_url() -> str:
    value = os.environ.get("YUKSALISH_TEST_DATABASE_URL")
    if not value:
        pytest.skip("YUKSALISH_TEST_DATABASE_URL is not configured")
    if not (make_url(value).database or "").startswith("yuksalish_test"):
        raise AssertionError("Calendar reservations require a dedicated yuksalish_test database")
    return value


async def _people(engine: AsyncEngine) -> list[AuthenticatedUser]:
    await seed_demo_data(engine)
    people = []
    async with engine.connect() as connection:
        for name in ("baxtiyor", "dilshod", "aziza"):
            user_id = await connection.scalar(select(users.c.id).where(users.c.username == name))
            assert user_id is not None
            user = await load_authenticated_user(connection, user_id)
            assert user is not None
            people.append(user)
    return people


async def _reservation_scenario(database_url: str) -> None:
    engine = create_async_engine(database_url)
    try:
        host, other_host, guest = await _people(engine)
        start = datetime.now(UTC) + timedelta(days=110)
        end = start + timedelta(hours=1)
        async with engine.connect() as connection:
            transaction = await connection.begin()
            try:
                facts = dict(starts_at=start, ends_at=end, attendee_ids=[str(guest.id)])
                first = await create_calendar_event(connection, host,
                    CreateCalendarEventRequest(title="QA pending A", **facts))
                second = await create_calendar_event(connection, other_host,
                    CreateCalendarEventRequest(title="QA pending B", **facts))
                for invitation in (first, second):
                    assert next(
                        a for a in invitation.attendees if a.user_id == str(guest.id)
                    ).status == "pending"
                own = await create_calendar_event(connection, guest, CreateCalendarEventRequest(
                    title="QA guest organizes despite pending invitations", starts_at=start,
                    ends_at=end,
                ))
                with pytest.raises(WorkspaceRepositoryError, match="заняты") as conflict:
                    await respond_to_calendar_event(connection, guest, UUID(first.id),
                        RespondCalendarEventRequest(status="accepted"))
                assert conflict.value.status_code == 409
                assert guest.full_name in conflict.value.detail
                status = await connection.scalar(select(calendar_event_attendees.c.status).where(
                    calendar_event_attendees.c.event_id == UUID(first.id),
                    calendar_event_attendees.c.user_id == guest.id,
                ))
                assert status == "pending"
                await cancel_calendar_event(connection, guest, UUID(own.id))
                await respond_to_calendar_event(connection, guest, UUID(first.id),
                    RespondCalendarEventRequest(status="accepted"))
                with pytest.raises(WorkspaceRepositoryError, match="заняты"):
                    await respond_to_calendar_event(connection, guest, UUID(second.id),
                        RespondCalendarEventRequest(status="accepted"))
                assert await connection.scalar(select(calendar_event_attendees.c.status).where(
                    calendar_event_attendees.c.event_id == UUID(second.id),
                    calendar_event_attendees.c.user_id == guest.id,
                )) == "pending"
                with pytest.raises(WorkspaceRepositoryError, match="заняты"):
                    await create_calendar_event(connection, guest, CreateCalendarEventRequest(
                        title="QA own confirmed overlap", starts_at=start, ends_at=end,
                    ))
                adjacent = await create_calendar_event(
                    connection, guest, CreateCalendarEventRequest(
                        title="QA adjacent", starts_at=end, ends_at=end + timedelta(hours=1),
                    ),
                )
                assert adjacent.id
                await respond_to_calendar_event(connection, guest, UUID(first.id),
                    RespondCalendarEventRequest(status="declined"))
                accepted = await respond_to_calendar_event(connection, guest, UUID(second.id),
                    RespondCalendarEventRequest(status="accepted"))
                assert next(
                    a for a in accepted.attendees if a.user_id == str(guest.id)
                ).status == "accepted"
            finally:
                await transaction.rollback()
    finally:
        await engine.dispose()


async def _concurrent_scenario(database_url: str) -> None:
    engine = create_async_engine(database_url)
    created_ids: list[UUID] = []
    try:
        host, other_host, guest = await _people(engine)
        start = datetime.now(UTC) + timedelta(days=115)
        end = start + timedelta(hours=1)
        async with engine.begin() as connection:
            first = await create_calendar_event(connection, host, CreateCalendarEventRequest(
                title="QA concurrent RSVP A", starts_at=start, ends_at=end,
                attendee_ids=[str(guest.id)],
            ))
            second = await create_calendar_event(connection, other_host, CreateCalendarEventRequest(
                title="QA concurrent RSVP B", starts_at=start, ends_at=end,
                attendee_ids=[str(guest.id)],
            ))
            created_ids.extend((UUID(first.id), UUID(second.id)))

        async def accept(event_id: str) -> int:
            try:
                async with engine.begin() as connection:
                    await connection.exec_driver_sql("SET LOCAL lock_timeout = '8s'")
                    await respond_to_calendar_event(connection, guest, UUID(event_id),
                        RespondCalendarEventRequest(status="accepted"))
                return 200
            except WorkspaceRepositoryError as error:
                assert error.status_code == 409
                return error.status_code

        assert sorted(await asyncio.gather(accept(first.id), accept(second.id))) == [200, 409]
        async with engine.connect() as connection:
            statuses = (await connection.execute(select(calendar_event_attendees.c.status).where(
                calendar_event_attendees.c.event_id.in_([UUID(first.id), UUID(second.id)]),
                calendar_event_attendees.c.user_id == guest.id,
            ))).scalars().all()
            assert sorted(statuses) == ["accepted", "pending"]
            assert len((await connection.execute(select(calendar_events.c.id).where(
                calendar_events.c.id.in_([UUID(first.id), UUID(second.id)]),
                calendar_events.c.status == "scheduled",
            ))).scalars().all()) == 2
    finally:
        try:
            # Concurrent connections must see committed fixtures. Remove exactly
            # those fixtures and their notices even when a race assertion fails.
            if created_ids:
                async with engine.begin() as connection:
                    await connection.execute(delete(workspace_notifications).where(
                        workspace_notifications.c.entity_id.in_(created_ids),
                        workspace_notifications.c.section == "calendar",
                    ))
                    await connection.execute(delete(calendar_event_attendees).where(
                        calendar_event_attendees.c.event_id.in_(created_ids),
                    ))
                    await connection.execute(delete(calendar_events).where(
                        calendar_events.c.id.in_(created_ids),
                    ))
                    assert not (await connection.execute(select(calendar_events.c.id).where(
                        calendar_events.c.id.in_(created_ids),
                    ))).scalars().all()
        finally:
            await engine.dispose()


@pytest.mark.postgres
def test_pending_invitations_do_not_reserve_but_confirmed_participation_does() -> None:
    asyncio.run(_reservation_scenario(_database_url()))


@pytest.mark.postgres
def test_concurrent_acceptance_of_overlapping_invitations_has_one_winner() -> None:
    asyncio.run(_concurrent_scenario(_database_url()))
