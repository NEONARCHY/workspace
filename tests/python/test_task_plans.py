"""Task plans keep task links many-to-many without exposing private task ids."""

import os
from datetime import UTC, date, datetime
from uuid import UUID, uuid4

import pytest
from pydantic import ValidationError
from sqlalchemy import insert, select
from sqlalchemy.ext.asyncio import create_async_engine

from yuksalish_api.access_control import request_module_action
from yuksalish_api.auth import AuthenticatedUser
from yuksalish_api.repository import WorkspaceRepositoryError, create_task
from yuksalish_api.tables import (
    audit_events,
    chat_members,
    chats,
    task_checklist_items,
    task_efficiency_events,
    task_participants,
    task_plans,
    tasks,
    users,
)
from yuksalish_api.task_plan_schemas import (
    TaskPlanImportConfirm,
    TaskPlanStatusWrite,
    TaskPlanWrite,
)
from yuksalish_api.task_plan_service import (
    change_link,
    change_status,
    confirm_import,
    create_plan,
    list_plans,
    update_plan,
)
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
    assert request_module_action("/api/v1/task-plans/a/status", "PATCH") == ("tasks", "edit")
    with pytest.raises(ValidationError):
        TaskPlanWrite(title="   ")
    with pytest.raises(ValidationError):
        TaskPlanWrite(title="Иш режа", period_start=date(2026, 12, 1),
                      period_end=date(2026, 11, 1))
    with pytest.raises(ValidationError):
        TaskPlanStatusWrite.model_validate({"status": "archived"})


@pytest.mark.anyio
@pytest.mark.postgres
async def test_plan_owner_lifecycle_preserves_open_tasks_and_audits_transition() -> None:
    database_url = os.environ.get("YUKSALISH_TEST_DATABASE_URL")
    if not database_url:
        pytest.skip("YUKSALISH_TEST_DATABASE_URL is not configured")
    engine = create_async_engine(database_url)
    author_id, owner_id, outsider_id = uuid4(), uuid4(), uuid4()
    try:
        async with engine.connect() as connection:
            transaction = await connection.begin()
            try:
                for user_id, role in (
                    (author_id, "manager"), (owner_id, "employee"),
                    (outsider_id, "employee"),
                ):
                    await connection.execute(insert(users).values(
                        id=user_id, username=f"plan-lifecycle-{user_id.hex[:12]}",
                        full_name="Plan User", role=role, status="active",
                        created_at=datetime.now(UTC), updated_at=datetime.now(UTC),
                    ))
                author = actor(author_id, "manager")
                owner = actor(owner_id, "employee")
                outsider = actor(outsider_id, "employee")
                task = await create_task(connection, author, CreateTaskRequest(
                    title="Open task", assignee_id=str(author_id),
                ))
                with pytest.raises(WorkspaceRepositoryError) as invalid_owner:
                    await create_plan(connection, author, TaskPlanWrite(
                        title="Invalid owner", owner_user_id=uuid4(),
                    ))
                assert invalid_owner.value.status_code == 422
                created = await create_plan(connection, author, TaskPlanWrite(
                    title="Work plan", owner_user_id=owner_id,
                ))
                assert created.owner_user_id == str(owner_id)
                assert created.created_by_user_id == str(author_id)
                assert created.status == "active"
                await change_link(connection, author, UUID(created.id), UUID(task.id), linked=True)
                assert [plan.id for plan in await list_plans(connection, owner)] == [created.id]
                with pytest.raises(WorkspaceRepositoryError) as forbidden:
                    await update_plan(connection, outsider, UUID(created.id), TaskPlanWrite(
                        title="Unauthorized rename",
                    ))
                assert forbidden.value.status_code == 403
                with pytest.raises(WorkspaceRepositoryError) as forbidden_status:
                    await change_status(connection, outsider, UUID(created.id), "completed")
                assert forbidden_status.value.status_code == 403
                renamed = await update_plan(connection, owner, UUID(created.id), TaskPlanWrite(
                    title="Renamed work plan",
                ))
                assert renamed.title == "Renamed work plan"
                assert renamed.owner_user_id == str(owner_id)
                completed = await change_status(connection, owner, UUID(created.id), "completed")
                assert completed.status == "completed"
                await change_status(connection, owner, UUID(created.id), "completed")
                assert await connection.scalar(select(tasks.c.status).where(
                    tasks.c.id == UUID(task.id),
                )) == "new"
                assert next(plan for plan in await list_plans(connection, owner)
                            if plan.id == created.id).task_ids == []
                assert next(plan for plan in await list_plans(connection, author)
                            if plan.id == created.id).task_ids == [task.id]
                assert len((await connection.execute(select(audit_events.c.id).where(
                    audit_events.c.target_id == UUID(created.id),
                    audit_events.c.action == "task_plan.status_changed",
                ))).all()) == 1
                assert (await change_status(connection, author, UUID(created.id), "active")
                        ).status == "active"
                legacy_id = uuid4()
                await connection.execute(insert(task_plans).values(
                    id=legacy_id, title="Old API plan", kind="work",
                    created_by_user_id=author_id,
                    created_at=datetime.now(UTC), updated_at=datetime.now(UTC),
                ))
                legacy = next(plan for plan in await list_plans(connection, author)
                              if plan.id == str(legacy_id))
                assert legacy.owner_user_id == str(author_id)
                assert legacy.status == "active"
                assert (await update_plan(connection, author, legacy_id, TaskPlanWrite(
                    title="Old API plan renamed",
                ))).owner_user_id == str(author_id)
            finally:
                await transaction.rollback()
    finally:
        await engine.dispose()


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


@pytest.mark.anyio
@pytest.mark.postgres
async def test_import_confirm_is_atomic_idempotent_and_checks_links() -> None:
    database_url = os.environ.get("YUKSALISH_TEST_DATABASE_URL")
    if not database_url:
        pytest.skip("YUKSALISH_TEST_DATABASE_URL is not configured")
    engine = create_async_engine(database_url)
    manager_id, co_assignee_id = uuid4(), uuid4()
    try:
        async with engine.connect() as connection:
            transaction = await connection.begin()
            try:
                await connection.execute(insert(users).values(
                    id=manager_id, username=f"plan-import-{manager_id.hex[:12]}",
                    full_name="Plan Import", role="manager", status="active",
                    created_at=datetime.now(UTC), updated_at=datetime.now(UTC),
                ))
                await connection.execute(insert(users).values(
                    id=co_assignee_id, username=f"plan-member-{co_assignee_id.hex[:12]}",
                    full_name="Plan Co-assignee", role="employee", status="active",
                    created_at=datetime.now(UTC), updated_at=datetime.now(UTC),
                ))
                manager = actor(manager_id, "manager")
                unrelated = await create_task(connection, manager, CreateTaskRequest(
                    title="Existing task", assignee_id=str(manager_id),
                ))
                payload = TaskPlanImportConfirm.model_validate({
                    "operationId": str(uuid4()),
                    "plan": {"title": "Imported plan", "kind": "work",
                             "ownerUserId": str(co_assignee_id)},
                    "items": [
                        {"title": "New task", "source": "TXT, строка 1", "mode": "create",
                         "assigneeId": str(manager_id),
                         "coAssigneeIds": [str(co_assignee_id)]},
                        {"title": "Existing task", "source": "TXT, строка 2", "mode": "link",
                         "taskId": unrelated.id},
                    ],
                })
                created = await confirm_import(connection, manager, payload)
                assert created.owner_user_id == str(co_assignee_id)
                assert created.task_ids[1] == unrelated.id
                assert created.task_ids[0] != unrelated.id
                imported_id = UUID(created.task_ids[0])
                assert await connection.scalar(select(tasks.c.author_user_id).where(
                    tasks.c.id == imported_id,
                )) == co_assignee_id
                assert await connection.scalar(select(tasks.c.author_user_id).where(
                    tasks.c.id == UUID(unrelated.id),
                )) == manager_id  # Linking an existing task does not rewrite its author.
                chat = (await connection.execute(select(chats).where(
                    chats.c.context_type == "task", chats.c.context_id == imported_id,
                ))).mappings().one()
                assert chat["created_by_user_id"] == manager_id
                assert await connection.scalar(select(chat_members.c.member_role).where(
                    chat_members.c.chat_id == chat["id"],
                    chat_members.c.user_id == co_assignee_id,
                )) == "owner"
                assert await connection.scalar(select(task_efficiency_events.c.actor_user_id)
                    .where(task_efficiency_events.c.task_id == imported_id,
                           task_efficiency_events.c.event_type == "task_created")) == manager_id
                assert (await connection.execute(select(task_participants.c.user_id).where(
                    task_participants.c.task_id == UUID(created.task_ids[0]),
                    task_participants.c.participant_role == "co_assignee",
                ))).scalar_one() == co_assignee_id
                assert (await confirm_import(connection, manager, payload)).task_ids == (
                    created.task_ids
                )
                assert len((await connection.execute(select(task_plans.c.id).where(
                    task_plans.c.id == payload.operation_id,
                ))).all()) == 1
                assert len((await connection.execute(select(tasks.c.id).where(
                    tasks.c.title == "New task",
                ))).all()) == 1
                invalid = TaskPlanImportConfirm.model_validate({
                    "operationId": str(uuid4()), "plan": {"title": "Invalid import"},
                    "items": [{"title": "Hidden task", "source": "TXT, строка 1",
                               "mode": "link", "taskId": str(uuid4())}],
                })
                with pytest.raises(WorkspaceRepositoryError):
                    await confirm_import(connection, manager, invalid)
                assert await connection.scalar(select(task_plans.c.id).where(
                    task_plans.c.id == invalid.operation_id,
                )) is None
                late_failure = TaskPlanImportConfirm.model_validate({
                    "operationId": str(uuid4()), "plan": {"title": "Rollback import"},
                    "items": [
                        {"title": "Must roll back", "source": "TXT, строка 1",
                         "mode": "create", "assigneeId": str(manager_id)},
                        {"title": "Inactive assignee", "source": "TXT, строка 2",
                         "mode": "create", "assigneeId": str(uuid4())},
                    ],
                })
                with pytest.raises(WorkspaceRepositoryError):
                    async with connection.begin_nested():
                        await confirm_import(connection, manager, late_failure)
                assert await connection.scalar(select(task_plans.c.id).where(
                    task_plans.c.id == late_failure.operation_id,
                )) is None
                assert await connection.scalar(select(tasks.c.id).where(
                    tasks.c.title == "Must roll back",
                )) is None
                bad_participant = TaskPlanImportConfirm.model_validate({
                    "operationId": str(uuid4()), "plan": {"title": "Invalid participant"},
                    "items": [{"title": "Reject inactive participant", "source": "DOCX",
                               "mode": "create", "assigneeId": str(manager_id),
                               "coAssigneeIds": [str(uuid4())]}],
                })
                with pytest.raises(WorkspaceRepositoryError):
                    async with connection.begin_nested():
                        await confirm_import(connection, manager, bad_participant)
                assert await connection.scalar(select(task_plans.c.id).where(
                    task_plans.c.id == bad_participant.operation_id,
                )) is None
            finally:
                await transaction.rollback()
    finally:
        await engine.dispose()


@pytest.mark.anyio
@pytest.mark.postgres
async def test_import_confirm_accepts_large_weekly_plan_without_duplicates() -> None:
    database_url = os.environ.get("YUKSALISH_TEST_DATABASE_URL")
    if not database_url:
        pytest.skip("YUKSALISH_TEST_DATABASE_URL is not configured")
    engine = create_async_engine(database_url)
    manager_id = uuid4()
    try:
        async with engine.connect() as connection:
            transaction = await connection.begin()
            try:
                await connection.execute(insert(users).values(
                    id=manager_id, username=f"weekly-plan-{manager_id.hex[:12]}",
                    full_name="Weekly Plan", role="manager", status="active",
                    created_at=datetime.now(UTC), updated_at=datetime.now(UTC),
                ))
                payload = TaskPlanImportConfirm.model_validate({
                    "operationId": str(uuid4()), "plan": {"title": "Weekly plan"},
                    "items": [{"title": f"Weekly task {index}",
                               "source": f"DOCX, таблица 1, строка {index + 2}",
                               "mode": "create", "assigneeId": str(manager_id)}
                              for index in range(150)],
                })
                manager = actor(manager_id, "manager")
                created = await confirm_import(connection, manager, payload)
                assert len(created.task_ids) == 150
                assert len(set(created.task_ids)) == 150
                assert (await confirm_import(connection, manager, payload)).task_ids == (
                    created.task_ids
                )
                assert len((await connection.execute(select(tasks.c.id).where(
                    tasks.c.id.in_(UUID(task_id) for task_id in created.task_ids),
                ))).all()) == 150
            finally:
                await transaction.rollback()
    finally:
        await engine.dispose()


@pytest.mark.anyio
@pytest.mark.postgres
async def test_annual_import_maps_content_and_excludes_historical_tasks() -> None:
    database_url = os.environ.get("YUKSALISH_TEST_DATABASE_URL")
    if not database_url:
        pytest.skip("YUKSALISH_TEST_DATABASE_URL is not configured")
    engine = create_async_engine(database_url)
    author_id, observer_id, executor_id, co_executor_id = uuid4(), uuid4(), uuid4(), uuid4()
    try:
        async with engine.connect() as connection:
            transaction = await connection.begin()
            try:
                for user_id, role in ((author_id, "manager"), (observer_id, "employee"),
                                      (executor_id, "employee"),
                                      (co_executor_id, "employee")):
                    await connection.execute(insert(users).values(
                        id=user_id, username=f"annual-plan-{user_id.hex[:12]}",
                        full_name="Test User", role=role, status="active",
                        created_at=datetime.now(UTC), updated_at=datetime.now(UTC),
                    ))
                payload = TaskPlanImportConfirm.model_validate({
                    "operationId": str(uuid4()), "annualWorkPlan": True,
                    "plan": {"title": "Иш режа 2026", "ownerUserId": str(author_id)},
                    "items": [{
                        "title": "Тадбирни ташкил этиш", "source": "DOCX, таблица 1, строка 3",
                        "mode": "create", "assigneeId": str(executor_id),
                        "coAssigneeIds": [str(co_executor_id)],
                        "observerIds": [str(observer_id)],
                        "dueAt": "2026-03-31T13:00:00Z", "description": "Тадбир ўтказилди",
                        "checklist": ["Режа тузиш", "Учрашув"], "historicalCompleted": True,
                    }],
                })
                user = actor(author_id, "manager")
                created = await confirm_import(connection, user, payload)
                task_id = UUID(created.task_ids[0])
                task = (await connection.execute(select(tasks).where(
                    tasks.c.id == task_id,
                ))).mappings().one()
                assert task["title"] == "Тадбирни ташкил этиш"
                assert task["description"] == "Тадбир ўтказилди"
                assert task["status"] == "completed"
                assert task["primary_assignee_user_id"] == executor_id
                assert set((await connection.execute(select(
                    task_participants.c.user_id, task_participants.c.participant_role,
                ).where(
                    task_participants.c.task_id == task_id,
                ))).all()) == {(co_executor_id, "co_assignee"), (observer_id, "observer")}
                steps = (await connection.execute(select(task_checklist_items).where(
                    task_checklist_items.c.task_id == task_id,
                ).order_by(task_checklist_items.c.sort_order))).mappings().all()
                assert [step["title"] for step in steps] == ["Режа тузиш", "Учрашув"]
                assert all(step["is_completed"] for step in steps)
                events = (await connection.execute(select(task_efficiency_events).where(
                    task_efficiency_events.c.task_id == task_id,
                ))).mappings().all()
                assert {event["event_type"] for event in events} == {
                    "task_created", "efficiency_excluded", "task_completed",
                }
                event_times = {event["event_type"]: event["occurred_at"] for event in events}
                assert (event_times["task_created"] < event_times["efficiency_excluded"]
                        < event_times["task_completed"])
                assert (await confirm_import(connection, user, payload)).task_ids == (
                    created.task_ids
                )
            finally:
                await transaction.rollback()
    finally:
        await engine.dispose()
