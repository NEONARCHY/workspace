"""Task plans keep task links many-to-many without exposing private task ids."""

import os
from datetime import UTC, date, datetime
from uuid import UUID, uuid4

import pytest
from pydantic import ValidationError
from sqlalchemy import insert
from sqlalchemy.ext.asyncio import create_async_engine

from yuksalish_api.access_control import request_module_action
from yuksalish_api.auth import AuthenticatedUser
from yuksalish_api.repository import WorkspaceRepositoryError, create_task
from yuksalish_api.tables import users
from yuksalish_api.task_plan_schemas import TaskPlanWrite
from yuksalish_api.task_plan_service import change_link, create_plan, list_plans
from yuksalish_api.workspace_schemas import CreateTaskRequest


def actor(user_id: UUID, role: str) -> AuthenticatedUser:
    return AuthenticatedUser(
        id=user_id, username=f"plan-{user_id.hex[:8]}", full_name="Test User",
        position_id=None, job_title=None, role=role,
    )


def test_plan_validation_rejects_blank_title_and_reversed_period() -> None:
    assert request_module_action("/api/v1/task-plans", "POST") == ("tasks", "create")
    assert request_module_action("/api/v1/task-plans", "GET") == ("tasks", "view")
    assert request_module_action("/api/v1/task-plans/a/tasks/b", "PUT") == ("tasks", "edit")
    with pytest.raises(ValidationError):
        TaskPlanWrite(title="   ")
    with pytest.raises(ValidationError):
        TaskPlanWrite(title="Иш режа", period_start=date(2026, 12, 1),
                      period_end=date(2026, 11, 1))


@pytest.mark.anyio
@pytest.mark.postgres
async def test_plan_links_are_many_to_many_and_private_task_ids_stay_hidden() -> None:
    database_url = os.environ.get("YUKSALISH_TEST_DATABASE_URL")
    if not database_url:
        pytest.skip("YUKSALISH_TEST_DATABASE_URL is not configured")
    engine = create_async_engine(database_url)
    manager_id, outsider_id = uuid4(), uuid4()
    try:
        async with engine.connect() as connection:
            transaction = await connection.begin()
            try:
                for user_id, role in ((manager_id, "manager"), (outsider_id, "employee")):
                    await connection.execute(insert(users).values(
                        id=user_id, username=f"plan-{user_id.hex[:12]}",
                        full_name="Test User", role=role, status="active",
                        created_at=datetime.now(UTC), updated_at=datetime.now(UTC),
                    ))
                manager, outsider = actor(manager_id, "manager"), actor(outsider_id, "employee")
                task = await create_task(connection, manager, CreateTaskRequest(
                    title="Private plan task", assignee_id=str(manager_id),
                ))
                first = await create_plan(connection, manager, TaskPlanWrite(
                    title="Иш режа", kind="work",
                ))
                second = await create_plan(connection, manager, TaskPlanWrite(
                    title="Региональный план", kind="regional",
                ))
                await change_link(connection, manager, UUID(first.id), UUID(task.id), linked=True)
                await change_link(connection, manager, UUID(second.id), UUID(task.id), linked=True)
                await change_link(connection, manager, UUID(second.id), UUID(task.id), linked=True)
                manager_plans = await list_plans(connection, manager)
                assert {first.id, second.id}.issubset({plan.id for plan in manager_plans})
                assert all(plan.task_ids == [task.id] for plan in manager_plans
                           if plan.id in {first.id, second.id})
                outsider_plans = await list_plans(connection, outsider)
                assert outsider_plans == []
                with pytest.raises(WorkspaceRepositoryError) as forbidden:
                    await change_link(connection, outsider, UUID(first.id), UUID(task.id),
                                      linked=False)
                assert forbidden.value.status_code in {403, 404}
                await change_link(connection, manager, UUID(first.id), UUID(task.id), linked=False)
                assert next(plan for plan in await list_plans(connection, manager)
                            if plan.id == first.id).task_ids == []
            finally:
                await transaction.rollback()
    finally:
        await engine.dispose()
