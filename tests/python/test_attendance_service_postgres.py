import os
from datetime import UTC, date, datetime, time
from uuid import UUID, uuid4

import pytest
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import create_async_engine

from yuksalish_api.attendance_schemas import (
    AttendanceActionRequest,
    AttendanceCorrectionActionRequest,
    AttendanceCorrectionCreateRequest,
    SmartOfficeAttendanceEventRequest,
    WorkSchedulePeriodWriteRequest,
)
from yuksalish_api.attendance_service import (
    AttendanceError,
    act_on_correction,
    create_correction,
    create_schedule_period,
    record_smartoffice_arrival,
    record_user_action,
    smartoffice_snapshot,
)
from yuksalish_api.auth import load_authenticated_user
from yuksalish_api.repository import find_active_user_by_username
from yuksalish_api.seed import seed_demo_data
from yuksalish_api.tables import attendance_events, users


@pytest.mark.anyio
@pytest.mark.postgres
async def test_attendance_schedule_correction_and_smartoffice_deduplication() -> None:
    database_url = os.environ.get("YUKSALISH_TEST_DATABASE_URL")
    if not database_url:
        pytest.skip("YUKSALISH_TEST_DATABASE_URL is not configured")
    engine = create_async_engine(database_url)
    try:
        await seed_demo_data(engine)
        async with engine.connect() as connection:
            transaction = await connection.begin()
            try:
                employee_row = await find_active_user_by_username(connection, "aziza")
                manager_row = await find_active_user_by_username(connection, "baxtiyor")
                assert employee_row is not None and manager_row is not None
                await connection.execute(
                    update(users)
                    .where(users.c.id == employee_row["id"])
                    .values(
                        direct_manager_user_id=manager_row["id"],
                        smartoffice_staff_key="smartoffice-aziza",
                        date_of_birth=date.today(),
                    )
                )
                employee = await load_authenticated_user(connection, employee_row["id"])
                manager = await load_authenticated_user(connection, manager_row["id"])
                assert employee is not None and manager is not None

                work_date = date.today()
                period = await create_schedule_period(
                    connection,
                    manager,
                    WorkSchedulePeriodWriteRequest(
                        user_id=employee.id,
                        starts_on=work_date,
                        ends_on=work_date,
                        weekdays=[work_date.weekday()],
                        starts_at=time(9),
                        ends_at=time(18),
                    ),
                )
                assert period.user_id == str(employee.id)

                late_start = datetime.combine(work_date, time(9, 20), UTC)
                day = await record_user_action(
                    connection,
                    employee,
                    AttendanceActionRequest(action="start", occurred_at=late_start),
                )
                assert day.status == "working"
                assert day.arrived_at == late_start

                correction = await create_correction(
                    connection,
                    employee,
                    AttendanceCorrectionCreateRequest(
                        event_kind="arrival",
                        requested_at=datetime.combine(work_date, time(8, 55), UTC),
                        reason="Камера не распознала сразу",
                    ),
                )
                with pytest.raises(AttendanceError, match="причину отказа"):
                    await act_on_correction(
                        connection,
                        manager,
                        UUID(correction.id),
                        AttendanceCorrectionActionRequest(action="reject"),
                    )
                approved = await act_on_correction(
                    connection,
                    manager,
                    UUID(correction.id),
                    AttendanceCorrectionActionRequest(action="approve", comment="Проверено"),
                )
                assert approved.status == "approved"

                event_id = uuid4()
                event = SmartOfficeAttendanceEventRequest(
                    event_id=event_id,
                    staff_key="smartoffice-aziza",
                    occurred_at=datetime.combine(work_date, time(8, 50), UTC),
                )
                first = await record_smartoffice_arrival(connection, event)
                duplicate = await record_smartoffice_arrival(connection, event)
                nearby = await record_smartoffice_arrival(
                    connection,
                    SmartOfficeAttendanceEventRequest(
                        event_id=uuid4(),
                        staff_key="smartoffice-aziza",
                        occurred_at=event.occurred_at.replace(second=30),
                    ),
                )
                assert first.accepted and first.birthday_greeting_created
                assert duplicate.accepted and not duplicate.birthday_greeting_created
                assert nearby.accepted and not nearby.birthday_greeting_created
                event_count = await connection.scalar(
                    select(attendance_events.c.id).where(
                        attendance_events.c.event_key == str(event_id)
                    )
                )
                assert event_count is not None
                smartoffice_event_count = await connection.scalar(
                    select(func.count())
                    .select_from(attendance_events)
                    .where(attendance_events.c.user_id == employee.id)
                    .where(attendance_events.c.source == "smartoffice")
                )
                assert smartoffice_event_count == 1

                snapshot = await smartoffice_snapshot(connection, work_date)
                synced = next(
                    item for item in snapshot.employees if item.staff_key == "smartoffice-aziza"
                )
                assert synced.birthday_today
                assert synced.schedule is not None
            finally:
                await transaction.rollback()
    finally:
        await engine.dispose()
