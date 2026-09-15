import os
from uuid import UUID

import pytest
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncConnection, create_async_engine

from yuksalish_api.auth import AuthenticatedUser, load_authenticated_user
from yuksalish_api.repository import (
    WorkspaceRepositoryError,
    create_project,
    create_task,
    delete_approval_request,
    delete_project,
    delete_task,
    find_active_user_by_username,
    load_workspace,
)
from yuksalish_api.seed import seed_demo_data
from yuksalish_api.tables import (
    approval_requests,
    audit_events,
    chat_members,
    chats,
    tasks,
    workspace_projects,
)
from yuksalish_api.workspace_schemas import (
    CreateProjectRequest,
    CreateTaskRequest,
    RecordDeletionRequest,
)


async def _user(connection: AsyncConnection, username: str) -> AuthenticatedUser:
    row = await find_active_user_by_username(connection, username)
    assert row is not None
    user = await load_authenticated_user(connection, row["id"])
    assert user is not None
    return user


@pytest.mark.anyio
@pytest.mark.postgres
async def test_core_records_use_authorized_auditable_soft_deletion() -> None:
    database_url = os.environ.get("YUKSALISH_TEST_DATABASE_URL")
    if not database_url:
        pytest.skip("YUKSALISH_TEST_DATABASE_URL is not configured")
    engine = create_async_engine(database_url)
    try:
        await seed_demo_data(engine)
        async with engine.connect() as connection:
            transaction = await connection.begin()
            try:
                employee = await _user(connection, "aziza")
                manager = await _user(connection, "dilshod")
                admin = await _user(connection, "malika")
                reason = RecordDeletionRequest(reason="Запись создана ошибочно")

                task = await create_task(
                    connection,
                    employee,
                    CreateTaskRequest(title="Disposable deletion task"),
                )
                assert task.can_delete is True
                with pytest.raises(WorkspaceRepositoryError) as forbidden_task:
                    await delete_task(connection, manager, UUID(task.id), reason)
                assert forbidden_task.value.status_code == 403
                await delete_task(connection, employee, UUID(task.id), reason)
                assert await connection.scalar(
                    select(tasks.c.deleted_at).where(tasks.c.id == UUID(task.id))
                ) is not None
                task_chat_ids = select(chats.c.id).where(
                    chats.c.context_type == "task",
                    chats.c.context_id == UUID(task.id),
                )
                assert await connection.scalar(
                    select(func.count()).select_from(chat_members).where(
                        chat_members.c.chat_id.in_(task_chat_ids)
                    )
                ) == 0
                admin_workspace = await load_workspace(connection, admin)
                assert all(item.id != task.id for item in admin_workspace.tasks)

                project = await create_project(
                    connection,
                    manager,
                    CreateProjectRequest(
                        code="DELETE-QA",
                        title="Disposable deletion project",
                        manager_user_id=str(manager.id),
                    ),
                )
                assert project.can_delete is True
                await delete_project(connection, admin, UUID(project.id), reason)
                assert await connection.scalar(
                    select(workspace_projects.c.deleted_at).where(
                        workspace_projects.c.id == UUID(project.id)
                    )
                ) is not None

                request_row = (
                    await connection.execute(
                        select(approval_requests).where(
                            approval_requests.c.deleted_at.is_(None)
                        ).limit(1)
                    )
                ).mappings().one()
                await delete_approval_request(connection, admin, request_row["id"], reason)
                assert await connection.scalar(
                    select(approval_requests.c.deleted_at).where(
                        approval_requests.c.id == request_row["id"]
                    )
                ) is not None
                audited = set(
                    (
                        await connection.execute(
                            select(audit_events.c.action).where(
                                audit_events.c.target_id.in_(
                                    [UUID(task.id), UUID(project.id), request_row["id"]]
                                )
                            )
                        )
                    ).scalars()
                )
                assert {"task.deleted", "project.deleted", "approval_request.deleted"} <= audited
            finally:
                await transaction.rollback()
    finally:
        await engine.dispose()
