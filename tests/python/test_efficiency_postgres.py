import asyncio
import os
from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

import pytest
from sqlalchemy import func, insert, select
from sqlalchemy.ext.asyncio import create_async_engine

from yuksalish_api.auth import load_authenticated_user
from yuksalish_api.efficiency_service import (
    load_efficiency_overview,
    materialize_efficiency_digest_notifications,
)
from yuksalish_api.repository import (
    create_task,
    find_active_user_by_username,
    load_workspace,
    return_task_for_revision,
    set_task_efficiency_exclusion,
    submit_task_result,
    update_task,
)
from yuksalish_api.seed import seed_demo_data
from yuksalish_api.tables import (
    employee_efficiency_snapshots,
    task_efficiency_events,
    workspace_notifications,
)
from yuksalish_api.workspace_schemas import (
    CreateTaskRequest,
    ReturnTaskForRevisionRequest,
    SubmitTaskResultRequest,
    TaskEfficiencyExclusionRequest,
    UpdateTaskRequest,
)


async def _exercise_efficiency(database_url: str) -> None:
    engine = create_async_engine(database_url, pool_pre_ping=True)
    try:
        await seed_demo_data(engine)
        async with engine.connect() as connection:
            transaction = await connection.begin()
            try:
                employee_row = await find_active_user_by_username(connection, "aziza")
                manager_row = await find_active_user_by_username(connection, "baxtiyor")
                assert employee_row is not None and manager_row is not None
                employee = await load_authenticated_user(connection, employee_row["id"])
                manager = await load_authenticated_user(connection, manager_row["id"])
                assert employee is not None and manager is not None
                due_at = datetime.now(UTC) + timedelta(hours=2)
                task = await create_task(
                    connection,
                    manager,
                    CreateTaskRequest(
                        title="Private EFF integration task",
                        assignee_id=str(employee.id),
                        due_at=due_at,
                    ),
                )
                await submit_task_result(
                    connection,
                    employee,
                    UUID(task.id),
                    SubmitTaskResultRequest(result_text="Result for manager review"),
                )
                await return_task_for_revision(
                    connection,
                    manager,
                    UUID(task.id),
                    ReturnTaskForRevisionRequest(
                        reason_code="corrections_required",
                        reason_text="Исправить итоговую сумму",
                    ),
                )
                await update_task(
                    connection,
                    manager,
                    UUID(task.id),
                    UpdateTaskRequest(
                        title=task.title,
                        description="",
                        project="Без проекта",
                        assignee_id=str(employee.id),
                        priority="normal",
                        due_at=due_at + timedelta(days=1),
                    ),
                )
                await set_task_efficiency_exclusion(
                    connection,
                    manager,
                    UUID(task.id),
                    TaskEfficiencyExclusionRequest(
                        excluded=True,
                        reason_code="external_dependency",
                    ),
                )
                overview = await load_efficiency_overview(connection, employee)
                payload = str(overview)
                assert task.title not in payload
                assert task.id not in payload
                assert "comments" not in payload and "attachments" not in payload
                assert {row["name"] for row in overview["employees"]}
                event_types = set(
                    (
                        await connection.execute(
                            select(task_efficiency_events.c.event_type).where(
                                task_efficiency_events.c.task_id == UUID(task.id)
                            )
                        )
                    ).scalars()
                )
                assert {
                    "task_created",
                    "result_submitted_for_review",
                    "result_returned_for_revision",
                    "deadline_changed",
                    "efficiency_excluded",
                } <= event_types
                exclusion_row = (
                    (
                        await connection.execute(
                            select(task_efficiency_events).where(
                                task_efficiency_events.c.task_id == UUID(task.id),
                                task_efficiency_events.c.event_type == "efficiency_excluded",
                            )
                        )
                    )
                    .mappings()
                    .one()
                )
                assert exclusion_row["reason_code"] == "external_dependency"
                return_notices = await connection.scalar(
                    select(func.count())
                    .select_from(workspace_notifications)
                    .where(
                        workspace_notifications.c.event_key.like("efficiency:return:%"),
                        workspace_notifications.c.entity_id == UUID(task.id),
                    )
                )
                assert return_notices == 1
                digest_time = datetime.now(UTC).replace(hour=14, minute=0, second=0, microsecond=0)
                await connection.execute(
                    insert(employee_efficiency_snapshots).values(
                        id=uuid4(),
                        user_id=employee.id,
                        snapshot_date=digest_time.date() - timedelta(days=1),
                        period=digest_time.strftime("%Y-%m"),
                        percentage=100,
                        on_time_count=999,
                        eligible_count=999,
                        overdue_count=0,
                        methodology_version="EFF-1.0",
                        created_at=digest_time - timedelta(days=1),
                    )
                )
                assert await materialize_efficiency_digest_notifications(
                    connection, now=digest_time
                ) >= 1
                assert (
                    await materialize_efficiency_digest_notifications(
                        connection, now=digest_time
                    )
                    == 0
                )
                workspace = await load_workspace(connection, employee)
                assert any(
                    notice.title == "Сводка по выполнению задач в срок"
                    for notice in workspace.notifications
                )
            finally:
                await transaction.rollback()
    finally:
        await engine.dispose()


@pytest.mark.postgres
def test_efficiency_event_log_privacy_and_notification_idempotency() -> None:
    database_url = os.environ.get("YUKSALISH_TEST_DATABASE_URL")
    if not database_url:
        pytest.skip("YUKSALISH_TEST_DATABASE_URL is not configured")
    asyncio.run(_exercise_efficiency(database_url))
