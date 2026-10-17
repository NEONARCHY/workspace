import os
from datetime import UTC, datetime, time
from uuid import uuid4

import pytest
from sqlalchemy import insert, select
from sqlalchemy.ext.asyncio import create_async_engine

from yuksalish_api.auth import AuthenticatedUser
from yuksalish_api.position_policy import EXECUTIVE_LEADER_POSITION_NAME
from yuksalish_api.tables import audit_events, users, workday_sessions
from yuksalish_api.workday_schemas import WorkdayScheduleWrite
from yuksalish_api.workday_service import (
    WorkdayError,
    close_overdue_sessions,
    finish_workday,
    load_team,
    save_schedule,
    start_workday,
    working_user_ids,
)


@pytest.mark.anyio
@pytest.mark.postgres
async def test_workday_checkin_schedule_scope_and_automatic_close() -> None:
    database_url = os.environ.get("YUKSALISH_TEST_DATABASE_URL")
    if not database_url:
        pytest.skip("YUKSALISH_TEST_DATABASE_URL is not configured")
    engine = create_async_engine(database_url)
    manager_id, employee_id, outsider_id, chairman_id = uuid4(), uuid4(), uuid4(), uuid4()
    try:
        async with engine.connect() as connection:
            transaction = await connection.begin()
            try:
                for user_id, role, manager in (
                    (manager_id, "manager", None),
                    (employee_id, "employee", manager_id),
                    (outsider_id, "manager", None),
                    (chairman_id, "manager", None),
                ):
                    await connection.execute(insert(users).values(
                        id=user_id, username=f"workday-{user_id.hex[:12]}",
                        full_name=f"Test {user_id.hex[:8]}", role=role, status="active",
                        job_title=(
                            EXECUTIVE_LEADER_POSITION_NAME if user_id == chairman_id else None
                        ),
                        direct_manager_user_id=manager,
                        avatar_updated_at=(
                            datetime(2026, 10, 9, tzinfo=UTC) if user_id == employee_id else None
                        ),
                        created_at=datetime.now(UTC), updated_at=datetime.now(UTC),
                    ))
                employee = AuthenticatedUser(
                    id=employee_id, username="test-employee", full_name="Employee",
                    position_id=None, job_title=None, role="employee",
                )
                manager = AuthenticatedUser(
                    id=manager_id, username="test-manager", full_name="Manager",
                    position_id=None, job_title=None, role="manager",
                )
                outsider = AuthenticatedUser(
                    id=outsider_id, username="test-outsider", full_name="Outsider",
                    position_id=None, job_title=None, role="manager",
                )
                with pytest.raises(WorkdayError) as denied:
                    await save_schedule(
                        connection, outsider, employee_id,
                        WorkdayScheduleWrite(starts_at=time(10), ends_at=time(19)),
                    )
                assert denied.value.status_code == 403
                await save_schedule(
                    connection, manager, employee_id,
                    WorkdayScheduleWrite(starts_at=time(10), ends_at=time(19)),
                )
                first_at = datetime(2026, 9, 26, 5, tzinfo=UTC)  # 10:00 Saturday, Tashkent
                assert await working_user_ids(connection, [employee_id, manager_id]) == []
                started = await start_workday(connection, employee, now=first_at)
                assert await working_user_ids(connection, [employee_id, manager_id]) == [
                    employee_id
                ]
                assert await working_user_ids(connection, [manager_id]) == []
                assert await working_user_ids(connection, []) == []
                assert started.status == "working"
                assert started.session is not None and started.session.is_weekend
                assert started.schedule.starts_at == time(10)
                repeated = await start_workday(connection, employee, now=first_at)
                assert repeated.session is not None
                assert repeated.session.id == started.session.id
                team = await load_team(connection, manager, can_edit_schedules=True, now=first_at)
                assert team.working_count == 1
                assert {member.user_id for member in team.members} == {manager_id, employee_id}
                chairman = AuthenticatedUser(
                    id=chairman_id, username="test-chairman", full_name="Chairman",
                    position_id=None, job_title=EXECUTIVE_LEADER_POSITION_NAME, role="manager",
                )
                chairman_team = await load_team(
                    connection, chairman, can_edit_schedules=True, now=first_at,
                )
                assert {member.user_id for member in chairman_team.members} == {
                    manager_id, employee_id, outsider_id, chairman_id,
                }
                assert chairman_team.working_count == 1
                assert not next(
                    member for member in chairman_team.members if member.user_id == employee_id
                ).can_edit_schedule
                employee_row = next(row for row in team.members if row.user_id == employee_id)
                assert employee_row.can_edit_schedule
                assert employee_row.avatar_version == "2026-10-09T00:00:00+00:00"
                assert employee_row.model_dump(by_alias=True)["avatarVersion"] == (
                    "2026-10-09T00:00:00+00:00"
                )
                manager_row = next(row for row in team.members if row.user_id == manager_id)
                assert manager_row.avatar_version is None
                finished = await finish_workday(
                    connection, employee, now=datetime(2026, 9, 26, 7, tzinfo=UTC)
                )
                assert finished.status == "finished"
                assert await working_user_ids(connection, [employee_id, manager_id]) == []
                assert finished.session is not None
                assert finished.session.close_source == "manual"
                await start_workday(
                    connection, employee, now=datetime(2026, 9, 26, 8, tzinfo=UTC)
                )
                assert await close_overdue_sessions(
                    connection, now=datetime(2026, 9, 27, 0, 59, tzinfo=UTC)
                ) == 0
                assert await close_overdue_sessions(
                    connection, now=datetime(2026, 9, 27, 1, tzinfo=UTC)
                ) == 1
                assert await close_overdue_sessions(
                    connection, now=datetime(2026, 9, 27, 1, 1, tzinfo=UTC)
                ) == 0
                sessions = (await connection.execute(select(workday_sessions).where(
                    workday_sessions.c.user_id == employee_id
                ).order_by(workday_sessions.c.started_at))).mappings().all()
                assert len(sessions) == 2
                assert sessions[-1]["close_source"] == "automatic"
                assert await working_user_ids(connection, [employee_id, manager_id]) == []
                assert sessions[-1]["ended_at"] == sessions[-1]["scheduled_end_at"]
                auto_audit = (await connection.execute(select(audit_events).where(
                    audit_events.c.target_id == sessions[-1]["id"],
                    audit_events.c.action == "workday.auto_closed",
                ))).mappings().one()
                assert auto_audit["actor_user_id"] == employee_id
                assert auto_audit["details"]["initiator"] == "scheduler"
            finally:
                await transaction.rollback()
    finally:
        await engine.dispose()
