"""Ordinary tasks may optionally link to a visible current project."""

import os
from datetime import UTC, datetime
from uuid import UUID, uuid4

import pytest
from sqlalchemy import func, insert, select, update
from sqlalchemy.ext.asyncio import create_async_engine

from yuksalish_api.auth import AuthenticatedUser
from yuksalish_api.project_hub_schemas import ProjectHubWrite
from yuksalish_api.project_hub_service import save_project
from yuksalish_api.repository import (
    WorkspaceRepositoryError,
    create_task,
    list_task_project_options,
    update_task,
)
from yuksalish_api.tables import project_hub_projects, tasks, users
from yuksalish_api.workspace_schemas import CreateTaskRequest, UpdateTaskRequest


def actor(user_id: UUID, role: str) -> AuthenticatedUser:
    return AuthenticatedUser(
        id=user_id,
        username=f"task-project-{user_id.hex[:8]}",
        full_name="Test User",
        position_id=None,
        job_title=None,
        role=role,
    )


@pytest.mark.anyio
@pytest.mark.postgres
async def test_task_project_choice_is_optional_and_access_checked() -> None:
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
                    await connection.execute(
                        insert(users).values(
                            id=user_id,
                            username=f"task-project-{user_id.hex[:12]}",
                            full_name="Test User",
                            role=role,
                            status="active",
                            created_at=datetime.now(UTC),
                            updated_at=datetime.now(UTC),
                        )
                    )
                manager, outsider = actor(manager_id, "manager"), actor(outsider_id, "employee")
                project = await save_project(
                    connection,
                    manager,
                    ProjectHubWrite(
                        code=f"TP-{manager_id.hex[:8]}",
                        title="Проект для задачи",
                        manager_user_id=str(manager_id),
                        access_status="closed",
                        budget=1000,
                    ),
                )
                options = await list_task_project_options(connection, manager)
                assert any(option.id == project.id for option in options)
                assert await list_task_project_options(connection, outsider) == []

                unlinked = await create_task(
                    connection,
                    outsider,
                    CreateTaskRequest(
                        title="Обычная задача",
                        assignee_id=str(outsider_id),
                    ),
                )
                assert unlinked.project_id is None
                assert unlinked.project == "Без проекта"

                with pytest.raises(WorkspaceRepositoryError) as forbidden:
                    await create_task(
                        connection,
                        outsider,
                        CreateTaskRequest(
                            title="Чужой проект",
                            assignee_id=str(outsider_id),
                            project_id=project.id,
                        ),
                    )
                assert forbidden.value.status_code == 403
                assert (
                    await connection.scalar(
                        select(func.count())
                        .select_from(tasks)
                        .where(tasks.c.project_hub_project_id == UUID(project.id))
                    )
                    == 0
                )

                linked = await create_task(
                    connection,
                    manager,
                    CreateTaskRequest(
                        title="Задача проекта",
                        assignee_id=str(manager_id),
                        project="Подменённое название",
                        project_id=project.id,
                    ),
                )
                assert linked.project_id == project.id
                assert linked.project == project.title
                child = await create_task(
                    connection,
                    manager,
                    CreateTaskRequest(
                        title="Подзадача проекта",
                        assignee_id=str(manager_id),
                        parent_task_id=linked.id,
                    ),
                )
                assert child.project_id == project.id
                unchanged = await update_task(
                    connection,
                    manager,
                    UUID(linked.id),
                    UpdateTaskRequest(
                        title="Уточнённая задача",
                        project=project.title,
                        assignee_id=str(manager_id),
                    ),
                )
                assert unchanged.project_id == project.id  # Old installed client omits projectId.
                unlinked_again = await update_task(
                    connection,
                    manager,
                    UUID(linked.id),
                    UpdateTaskRequest(
                        title="Уточнённая задача",
                        project="Без проекта",
                        project_id=None,
                        assignee_id=str(manager_id),
                    ),
                )
                assert unlinked_again.project_id is None

                await connection.execute(
                    update(project_hub_projects)
                    .where(project_hub_projects.c.id == UUID(project.id))
                    .values(lifecycle_status="completed")
                )
                with pytest.raises(WorkspaceRepositoryError) as completed:
                    await create_task(
                        connection,
                        manager,
                        CreateTaskRequest(
                            title="После завершения",
                            assignee_id=str(manager_id),
                            project_id=project.id,
                        ),
                    )
                assert completed.value.status_code == 409
            finally:
                await transaction.rollback()
    finally:
        await engine.dispose()
