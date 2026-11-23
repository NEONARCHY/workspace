import os
from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

import pytest
from sqlalchemy import insert, select
from sqlalchemy.ext.asyncio import create_async_engine

from yuksalish_api.auth import AuthenticatedUser
from yuksalish_api.repository import (
    WorkspaceRepositoryError,
    create_task,
    decide_task_deadline_extension,
    extend_task_deadline,
    request_task_deadline_extension,
    update_task,
)
from yuksalish_api.tables import task_deadline_requests, task_efficiency_events, tasks, users
from yuksalish_api.workspace_schemas import (
    CreateTaskRequest,
    DecideTaskDeadlineExtension,
    ExtendTaskDeadline,
    RequestTaskDeadlineExtension,
    UpdateTaskRequest,
)


@pytest.mark.anyio
@pytest.mark.postgres
@pytest.mark.parametrize("role", ["employee", "manager", "admin", "superadmin"])
async def test_only_author_can_change_or_approve_executor_deadline(role: str) -> None:
    url = os.environ.get("YUKSALISH_TEST_DATABASE_URL")
    if not url:
        pytest.skip("YUKSALISH_TEST_DATABASE_URL is not configured")
    engine = create_async_engine(url)
    try:
        async with engine.connect() as connection:
            transaction = await connection.begin()
            try:
                now = datetime.now(UTC)
                author = AuthenticatedUser(uuid4(), f"setter-{uuid4().hex}", "Setter",
                                           None, None, "employee")
                executor = AuthenticatedUser(uuid4(), f"executor-{uuid4().hex}", "Executor",
                                             None, None, role)
                for person in [author, executor]:
                    await connection.execute(insert(users).values(
                        id=person.id, username=person.username, full_name=person.full_name,
                        role=person.role, status="active", created_at=now, updated_at=now,
                    ))
                due, proposed = now + timedelta(days=2), now + timedelta(days=4)
                task = await create_task(connection, author, CreateTaskRequest(
                    title="Author controls the deadline", assignee_id=str(executor.id), due_at=due,
                ))
                task_id = UUID(task.id)
                for changed in [proposed, None]:
                    with pytest.raises(WorkspaceRepositoryError) as denied_edit:
                        await update_task(connection, executor, task_id, UpdateTaskRequest(
                            title=task.title, assignee_id=str(executor.id), due_at=changed,
                        ))
                    assert denied_edit.value.status_code == 403
                    assert await connection.scalar(select(tasks.c.due_at).where(
                        tasks.c.id == task_id,
                    )) == due
                with pytest.raises(WorkspaceRepositoryError) as denied_direct:
                    await extend_task_deadline(connection, executor, task_id,
                                               ExtendTaskDeadline(proposed_due_at=proposed))
                assert denied_direct.value.status_code == 403
                requested = await request_task_deadline_extension(
                    connection, executor, task_id,
                    RequestTaskDeadlineExtension(proposed_due_at=proposed, reason="Awaiting input"),
                )
                assert requested.due_at == due
                request = requested.deadline_requests[-1]
                assert request.status == "pending"
                request_id = UUID(request.id)
                for approved in [True, False]:
                    with pytest.raises(WorkspaceRepositoryError) as self_decision:
                        await decide_task_deadline_extension(
                            connection, executor, task_id, request_id,
                            DecideTaskDeadlineExtension(approved=approved),
                        )
                    assert self_decision.value.status_code == 403
                assert await connection.scalar(select(task_deadline_requests.c.status).where(
                    task_deadline_requests.c.id == request_id,
                )) == "pending"
                assert await connection.scalar(select(tasks.c.due_at).where(
                    tasks.c.id == task_id,
                )) == due
                approved = await decide_task_deadline_extension(
                    connection, author, task_id, request_id,
                    DecideTaskDeadlineExtension(approved=True),
                )
                assert approved.due_at == proposed
                assert approved.deadline_requests[-1].status == "approved"
                with pytest.raises(WorkspaceRepositoryError) as replay:
                    await decide_task_deadline_extension(
                        connection, executor, task_id, request_id,
                        DecideTaskDeadlineExtension(approved=True),
                    )
                assert replay.value.status_code == 403
                changed = await extend_task_deadline(
                    connection, author, task_id,
                    ExtendTaskDeadline(proposed_due_at=proposed + timedelta(days=1)),
                )
                assert changed.due_at == proposed + timedelta(days=1)
                # The author can also remove or set a deadline in the general editor.
                cleared = await update_task(connection, author, task_id, UpdateTaskRequest(
                    title=task.title, assignee_id=str(executor.id), due_at=None,
                ))
                assert cleared.due_at is None
                with pytest.raises(WorkspaceRepositoryError) as setting_own:
                    await update_task(connection, executor, task_id, UpdateTaskRequest(
                        title=task.title, assignee_id=str(executor.id), due_at=proposed,
                    ))
                assert setting_own.value.status_code == 403
                events = (await connection.execute(select(task_efficiency_events).where(
                    task_efficiency_events.c.task_id == task_id,
                    task_efficiency_events.c.event_type == "deadline_changed",
                ))).mappings().all()
                assert events and all(event["actor_user_id"] == author.id for event in events)
            finally:
                await transaction.rollback()
    finally:
        await engine.dispose()
