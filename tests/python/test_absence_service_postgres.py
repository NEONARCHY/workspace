import os
from datetime import UTC, datetime, timedelta
from uuid import UUID

import pytest
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import create_async_engine

from yuksalish_api.absence_service import (
    AbsenceError,
    act_on_absence,
    create_absence,
    materialize_sick_document_notifications,
    presence_summary,
    visible_absences,
)
from yuksalish_api.auth import load_authenticated_user
from yuksalish_api.repository import find_active_user_by_username
from yuksalish_api.seed import seed_demo_data
from yuksalish_api.tables import users, workspace_notifications
from yuksalish_api.workspace_schemas import AbsenceActionRequest, AbsenceWriteRequest


@pytest.mark.anyio
@pytest.mark.postgres
async def test_absence_lifecycle_conflicts_and_sick_document_reminders() -> None:
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
                    .values(direct_manager_user_id=manager_row["id"])
                )
                employee = await load_authenticated_user(connection, employee_row["id"])
                manager = await load_authenticated_user(connection, manager_row["id"])
                assert employee is not None and manager is not None

                now = datetime.now(UTC)
                vacation = AbsenceWriteRequest(
                    kind="vacation",
                    reason="Семейная поездка",
                    starts_at=now + timedelta(days=10),
                    ends_at=now + timedelta(days=12),
                )
                created = await create_absence(connection, employee, vacation)
                assert created.status == "pending"
                assert created.allowed_actions == ["cancel"]

                manager_queue = await visible_absences(connection, manager, allow_admin=False)
                assert [item.id for item in manager_queue] == [created.id]
                assert manager_queue[0].allowed_actions == ["approve", "reject"]

                with pytest.raises(AbsenceError, match="причину отказа"):
                    await act_on_absence(
                        connection,
                        manager,
                        UUID(created.id),
                        AbsenceActionRequest(action="reject"),
                    )
                approved = await act_on_absence(
                    connection,
                    manager,
                    UUID(created.id),
                    AbsenceActionRequest(action="approve", comment="Согласовано"),
                )
                assert approved.status == "approved"

                with pytest.raises(AbsenceError, match="наложение"):
                    await create_absence(connection, employee, vacation)

                sick_leave = AbsenceWriteRequest(
                    kind="sick_leave",
                    reason="Больничный",
                    starts_at=now - timedelta(days=8),
                    ends_at=now - timedelta(days=5),
                )
                sick = await create_absence(connection, employee, sick_leave)
                acknowledged = await act_on_absence(
                    connection,
                    manager,
                    UUID(sick.id),
                    AbsenceActionRequest(action="acknowledge"),
                )
                assert acknowledged.status == "acknowledged"
                assert acknowledged.document_status == "overdue"

                assert await materialize_sick_document_notifications(connection) == 1
                notification_count = await connection.scalar(
                    select(func.count())
                    .select_from(workspace_notifications)
                    .where(
                        workspace_notifications.c.event_key.like(
                            f"absence:{sick.id}:document-overdue"
                        )
                    )
                )
                assert notification_count >= 2
                summary = await presence_summary(connection, allow_admin=True)
                assert {item.user_id for item in summary} >= {str(employee.id), str(manager.id)}
            finally:
                await transaction.rollback()
    finally:
        await engine.dispose()
