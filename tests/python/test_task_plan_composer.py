"""Atomic optional plan selection in ordinary task creation and editing."""

import os
from collections.abc import AsyncIterator
from datetime import UTC, datetime
from uuid import UUID, uuid4

import pytest
from pydantic import ValidationError
from sqlalchemy import func, insert, select
from sqlalchemy.ext.asyncio import AsyncConnection, create_async_engine

from yuksalish_api.auth import AuthenticatedUser
from yuksalish_api.errors import WorkspaceRepositoryError
from yuksalish_api.repository import create_task, update_task
from yuksalish_api.tables import audit_events, task_plan_links, tasks, users
from yuksalish_api.task_plan_schemas import TaskPlanWrite
from yuksalish_api.task_plan_service import create_plan
from yuksalish_api.task_proposal_schemas import TaskProposalDecision, TaskProposalWrite
from yuksalish_api.task_proposal_service import decide_proposal, propose_task
from yuksalish_api.workspace_schemas import CreateTaskRequest, UpdateTaskRequest

pytestmark = pytest.mark.anyio


@pytest.fixture
async def plan_db() -> AsyncIterator[tuple[AsyncConnection, list[AuthenticatedUser]]]:
    url = os.environ.get("YUKSALISH_TEST_DATABASE_URL")
    if not url:
        pytest.skip("Isolated PostgreSQL not configured")
    if not url.rsplit("/", 1)[-1].startswith("yuksalish_test"):
        raise RuntimeError("Refusing a non-test database")
    engine = create_async_engine(url)
    try:
        async with engine.connect() as connection, connection.begin():
            actors = []
            for label in ("author", "assignee", "outsider"):
                user_id = uuid4()
                await connection.execute(insert(users).values(
                    id=user_id, username=f"plan-compose-{user_id.hex[:12]}",
                    full_name=f"Synthetic {label}", role="employee", status="active",
                    created_at=datetime.now(UTC), updated_at=datetime.now(UTC),
                ))
                actors.append(AuthenticatedUser(user_id, label, label, None, None, "employee"))
            yield connection, actors
            await connection.rollback()
    finally:
        await engine.dispose()


async def _links(connection: AsyncConnection, task_id: str) -> set[UUID]:
    return set((await connection.execute(select(task_plan_links.c.plan_id).where(
        task_plan_links.c.task_id == UUID(task_id),
    ))).scalars())


@pytest.mark.postgres
async def test_create_and_edit_optional_plans_preserve_omitted_and_clear_explicit_empty(plan_db):
    connection, (author, assignee, _) = plan_db
    first = await create_plan(connection, author, TaskPlanWrite(title="First synthetic plan"))
    second = await create_plan(connection, author, TaskPlanWrite(title="Second synthetic plan"))
    ids = [UUID(first.id), UUID(second.id)]
    task = await create_task(connection, author, CreateTaskRequest(
        title="Task with plans", assignee_id=str(assignee.id), plan_ids=[*ids, ids[0]],
    ))
    assert await _links(connection, task.id) == set(ids)
    fields = dict(title="Edited task", assignee_id=str(assignee.id))
    await update_task(connection, author, UUID(task.id), UpdateTaskRequest(**fields))
    assert await _links(connection, task.id) == set(ids)
    await update_task(connection, author, UUID(task.id), UpdateTaskRequest(**fields, plan_ids=ids))
    linked_count = await connection.scalar(select(func.count()).select_from(audit_events).where(
        audit_events.c.action == "task_plan.linked", audit_events.c.actor_user_id == author.id,
    ))
    assert linked_count == 2
    await update_task(connection, author, UUID(task.id), UpdateTaskRequest(
        **fields, plan_ids=[ids[1]],
    ))
    assert await _links(connection, task.id) == {ids[1]}
    await update_task(connection, author, UUID(task.id), UpdateTaskRequest(**fields, plan_ids=[]))
    assert await _links(connection, task.id) == set()


@pytest.mark.postgres
async def test_hidden_plan_and_non_author_edit_cannot_partially_change_task(plan_db):
    connection, (author, assignee, outsider) = plan_db
    private = await create_plan(connection, outsider, TaskPlanWrite(title="Private synthetic plan"))
    plan = await create_plan(connection, author, TaskPlanWrite(title="Visible synthetic plan"))
    with pytest.raises(WorkspaceRepositoryError) as inaccessible:
        await create_task(connection, author, CreateTaskRequest(
            title="Must not exist", plan_ids=[UUID(private.id)],
        ))
    assert inaccessible.value.status_code == 404
    assert await connection.scalar(select(func.count()).select_from(tasks).where(
        tasks.c.author_user_id == author.id,
    )) == 0
    task = await create_task(connection, author, CreateTaskRequest(
        title="Original", assignee_id=str(assignee.id), plan_ids=[UUID(plan.id)],
    ))
    for actor, plans, status in ((author, [UUID(private.id)], 404), (assignee, [], 403)):
        with pytest.raises(WorkspaceRepositoryError) as denied:
            await update_task(connection, actor, UUID(task.id), UpdateTaskRequest(
                title="Must not change", assignee_id=str(assignee.id), plan_ids=plans,
            ))
        assert denied.value.status_code == status
        assert await connection.scalar(select(tasks.c.title).where(tasks.c.id == UUID(task.id))) \
            == "Original"
        assert await _links(connection, task.id) == {UUID(plan.id)}
    await update_task(connection, assignee, UUID(task.id), UpdateTaskRequest(
        title="Assignee may edit text", assignee_id=str(assignee.id),
    ))
    assert await _links(connection, task.id) == {UUID(plan.id)}


@pytest.mark.postgres
async def test_plan_link_failure_rolls_back_task_and_link_together(plan_db, monkeypatch):
    from yuksalish_api import task_plan_service

    connection, (author, _, _) = plan_db
    plan = await create_plan(connection, author, TaskPlanWrite(title="Atomic synthetic plan"))
    original = task_plan_service._replace_task_plan_links

    async def fail_after_link(*args, **kwargs):
        await original(*args, **kwargs)
        raise WorkspaceRepositoryError(409, "Synthetic link failure")

    monkeypatch.setattr(task_plan_service, "_replace_task_plan_links", fail_after_link)
    with pytest.raises(WorkspaceRepositoryError):
        async with connection.begin_nested():
            await create_task(connection, author, CreateTaskRequest(
                title="Rolled back task", plan_ids=[UUID(plan.id)],
            ))
    assert await connection.scalar(select(func.count()).select_from(tasks).where(
        tasks.c.author_user_id == author.id,
    )) == 0
    assert await connection.scalar(select(func.count()).select_from(task_plan_links).where(
        task_plan_links.c.plan_id == UUID(plan.id),
    )) == 0


async def test_plan_identifiers_are_validated_in_both_task_forms():
    for schema in (CreateTaskRequest, UpdateTaskRequest):
        with pytest.raises(ValidationError):
            schema(title="Invalid plan", assignee_id=str(uuid4()), plan_ids=["not-a-uuid"])


@pytest.mark.postgres
async def test_plan_selection_survives_named_author_confirmation(plan_db):
    connection, (creator, author, _) = plan_db
    plan = await create_plan(connection, creator, TaskPlanWrite(title="Consent synthetic plan"))
    proposal = await propose_task(connection, creator, TaskProposalWrite(
        request_id=uuid4(), author_user_id=author.id,
        task=CreateTaskRequest(title="Task after consent", assignee_id=str(creator.id),
                               plan_ids=[UUID(plan.id)]),
    ))
    approved = await decide_proposal(connection, author, UUID(proposal.id),
                                     TaskProposalDecision(action="approve"))
    assert approved.task_id
    assert await _links(connection, approved.task_id) == {UUID(plan.id)}
    assert await connection.scalar(select(tasks.c.author_user_id).where(
        tasks.c.id == UUID(approved.task_id),
    )) == author.id
