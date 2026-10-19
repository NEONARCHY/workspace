import asyncio
import os
from datetime import UTC, datetime
from uuid import UUID

import pytest
from scripts.maintenance.reopen_non_author_task_acceptances import (
    find_candidates,
    reopen_candidates,
)
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import create_async_engine

from yuksalish_api.auth import AuthenticatedUser, load_authenticated_user
from yuksalish_api.efficiency_service import record_task_event
from yuksalish_api.errors import WorkspaceRepositoryError
from yuksalish_api.repository import (
    accept_task_result,
    create_task,
    find_active_user_by_username,
    load_workspace,
    submit_task_result,
)
from yuksalish_api.seed import seed_demo_data
from yuksalish_api.tables import task_efficiency_events, tasks, workspace_notifications
from yuksalish_api.workspace_schemas import CreateTaskRequest, SubmitTaskResultRequest


async def _exercise_author_only_acceptance(database_url: str) -> None:
    engine = create_async_engine(database_url, pool_pre_ping=True)
    try:
        await seed_demo_data(engine)
        async with engine.connect() as connection:
            transaction = await connection.begin()
            try:
                users: dict[str, AuthenticatedUser] = {}
                for username in ("dilshod", "baxtiyor", "malika"):
                    row = await find_active_user_by_username(connection, username)
                    assert row is not None
                    user = await load_authenticated_user(connection, row["id"])
                    assert user is not None
                    users[username] = user

                author = users["dilshod"]
                assignee_manager = users["baxtiyor"]
                administrator = users["malika"]
                task = await create_task(
                    connection,
                    author,
                    CreateTaskRequest(
                        title="Only the author accepts a task result",
                        assignee_id=str(assignee_manager.id),
                    ),
                )
                submitted = await submit_task_result(
                    connection,
                    assignee_manager,
                    UUID(task.id),
                    SubmitTaskResultRequest(result_text="Ready for the author's review"),
                )
                assert submitted.status == "awaiting_review"
                workspace = await load_workspace(connection, author)
                assert any(
                    notice.entity_id == task.id
                    and notice.title == "Результат ожидает вашей проверки"
                    and notice.resolved_at is None
                    for notice in workspace.notifications
                )

                for other_user in (assignee_manager, administrator):
                    with pytest.raises(
                        WorkspaceRepositoryError,
                        match="Only the task author can accept the result",
                    ) as forbidden:
                        await accept_task_result(connection, other_user, UUID(task.id))
                    assert forbidden.value.status_code == 403

                accepted = await accept_task_result(connection, author, UUID(task.id))
                assert accepted.status == "completed"

                legacy_task = await create_task(
                    connection,
                    author,
                    CreateTaskRequest(
                        title="Legacy result accepted by a manager",
                        assignee_id=str(assignee_manager.id),
                    ),
                )
                await submit_task_result(
                    connection,
                    assignee_manager,
                    UUID(legacy_task.id),
                    SubmitTaskResultRequest(result_text="Preserve this submitted result"),
                )
                accepted_at = datetime.now(UTC)
                await connection.execute(
                    update(tasks).where(tasks.c.id == UUID(legacy_task.id)).values(
                        status="completed", updated_at=accepted_at,
                    )
                )
                for event_type in ("result_accepted", "task_completed"):
                    await record_task_event(
                        connection,
                        task_id=UUID(legacy_task.id),
                        event_type=event_type,
                        occurred_at=accepted_at,
                        actor_user_id=assignee_manager.id,
                        assignee_user_id=assignee_manager.id,
                        due_at=None,
                        old_value={"status": "awaiting_review"},
                        new_value={"status": "completed"},
                    )
                candidates = await find_candidates(connection, lock=True)
                legacy_candidate = next(
                    row for row in candidates if row["id"] == UUID(legacy_task.id)
                )
                assert all(row["id"] != UUID(task.id) for row in candidates)
                await reopen_candidates(connection, [legacy_candidate])
                reopened = (await connection.execute(
                    select(tasks.c.status, tasks.c.result_text)
                    .where(tasks.c.id == UUID(legacy_task.id))
                )).one()
                assert reopened.status == "awaiting_review"
                assert reopened.result_text == "Preserve this submitted result"
                assert not any(
                    row["id"] == UUID(legacy_task.id)
                    for row in await find_candidates(connection)
                )
                correction = (await connection.execute(
                    select(task_efficiency_events.c.reason_code)
                    .where(
                        task_efficiency_events.c.task_id == UUID(legacy_task.id),
                        task_efficiency_events.c.event_type == "task_status_changed",
                    )
                )).scalar_one()
                assert correction == "author_review_required"
                notice = (await connection.execute(
                    select(workspace_notifications.c.requires_action)
                    .where(
                        workspace_notifications.c.entity_id == UUID(legacy_task.id),
                        workspace_notifications.c.user_id == author.id,
                        workspace_notifications.c.event_key.like("task:review:pending:%"),
                    )
                )).scalar_one()
                assert notice is True
            finally:
                await transaction.rollback()
    finally:
        await engine.dispose()


@pytest.mark.postgres
def test_only_task_author_accepts_submitted_result() -> None:
    database_url = os.environ.get("YUKSALISH_TEST_DATABASE_URL")
    if not database_url:
        pytest.skip("YUKSALISH_TEST_DATABASE_URL is not configured")
    asyncio.run(_exercise_author_only_acceptance(database_url))
