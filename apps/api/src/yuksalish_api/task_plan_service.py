"""Shared plans with server-side task permissions and audited links."""

from datetime import UTC, datetime
from uuid import UUID, uuid4

from sqlalchemy import delete, insert, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.engine import RowMapping
from sqlalchemy.ext.asyncio import AsyncConnection

from .access_control import ensure_module_action
from .auth import AuthenticatedUser
from .position_policy import is_executive_leader
from .repository import WorkspaceRepositoryError, _task_access_row, create_task
from .tables import audit_events, task_participants, task_plan_links, task_plans, tasks
from .task_plan_schemas import TaskPlanImportConfirm, TaskPlanResponse, TaskPlanWrite
from .workspace_schemas import CreateTaskRequest, TaskCreateParticipantRequest


def _response(row: RowMapping, task_ids: list[str] | None = None) -> TaskPlanResponse:
    return TaskPlanResponse(
        id=str(row["id"]), title=row["title"], kind=row["kind"],
        period_start=row["period_start"], period_end=row["period_end"],
        created_by_user_id=str(row["created_by_user_id"]),
        created_at=row["created_at"], updated_at=row["updated_at"],
        task_ids=task_ids or [],
    )


async def _audit(
    connection: AsyncConnection, user: AuthenticatedUser, action: str,
    plan_id: UUID, details: dict[str, str],
) -> None:
    await connection.execute(insert(audit_events).values(
        id=uuid4(), actor_user_id=user.id, action=action,
        target_type="task_plan", target_id=plan_id,
        details=details, created_at=datetime.now(UTC),
    ))


async def _plan_row(connection: AsyncConnection, plan_id: UUID) -> RowMapping:
    row = (await connection.execute(select(task_plans).where(
        task_plans.c.id == plan_id,
    ))).mappings().first()
    if row is None:
        raise WorkspaceRepositoryError(404, "Plan was not found")
    return row


async def list_plans(
    connection: AsyncConnection, user: AuthenticatedUser,
) -> list[TaskPlanResponse]:
    await ensure_module_action(connection, user, "tasks", "view")
    rows = (await connection.execute(select(task_plans).order_by(
        task_plans.c.updated_at.desc(), task_plans.c.id,
    ))).mappings().all()
    privileged = user.role in {"manager", "admin", "superadmin"} or is_executive_leader(
        user.job_title
    )
    visible_tasks = select(tasks.c.id)
    if not privileged:
        participant_ids = select(task_participants.c.task_id).where(
            task_participants.c.user_id == user.id,
        )
        visible_tasks = visible_tasks.where(
            (tasks.c.author_user_id == user.id)
            | (tasks.c.primary_assignee_user_id == user.id)
            | tasks.c.id.in_(participant_ids)
        )
    links = (await connection.execute(select(
        task_plan_links.c.plan_id, task_plan_links.c.task_id,
    ).where(task_plan_links.c.task_id.in_(visible_tasks)))).all()
    task_ids: dict[UUID, list[str]] = {}
    for plan_id, task_id in links:
        task_ids.setdefault(plan_id, []).append(str(task_id))
    return [
        _response(row, task_ids.get(row["id"])) for row in rows
        if privileged or row["created_by_user_id"] == user.id or row["id"] in task_ids
    ]


async def create_plan(
    connection: AsyncConnection, user: AuthenticatedUser, payload: TaskPlanWrite,
) -> TaskPlanResponse:
    await ensure_module_action(connection, user, "tasks", "create")
    now, plan_id = datetime.now(UTC), uuid4()
    row = (await connection.execute(insert(task_plans).values(
        id=plan_id, title=payload.title, kind=payload.kind,
        period_start=payload.period_start, period_end=payload.period_end,
        created_by_user_id=user.id, created_at=now, updated_at=now,
    ).returning(task_plans))).mappings().one()
    await _audit(connection, user, "task_plan.created", plan_id, {"title": payload.title})
    return _response(row)


async def update_plan(
    connection: AsyncConnection, user: AuthenticatedUser, plan_id: UUID,
    payload: TaskPlanWrite,
) -> TaskPlanResponse:
    await ensure_module_action(connection, user, "tasks", "edit")
    row = await _plan_row(connection, plan_id)
    if row["created_by_user_id"] != user.id and user.role not in {"admin", "superadmin"}:
        raise WorkspaceRepositoryError(403, "Only the plan author or administrator can edit it")
    revised = (await connection.execute(update(task_plans).where(
        task_plans.c.id == plan_id,
    ).values(
        title=payload.title, kind=payload.kind,
        period_start=payload.period_start, period_end=payload.period_end,
        updated_at=datetime.now(UTC),
    ).returning(task_plans))).mappings().one()
    await _audit(connection, user, "task_plan.updated", plan_id, {"title": payload.title})
    return _response(revised)


async def change_link(
    connection: AsyncConnection, user: AuthenticatedUser, plan_id: UUID,
    task_id: UUID, *, linked: bool,
) -> None:
    await ensure_module_action(connection, user, "tasks", "edit")
    await _plan_row(connection, plan_id)
    if not any(plan.id == str(plan_id) for plan in await list_plans(connection, user)):
        raise WorkspaceRepositoryError(404, "Plan was not found")
    await _task_access_row(connection, user, task_id, manage=True)
    if linked:
        changed = await connection.scalar(pg_insert(task_plan_links).values(
            plan_id=plan_id, task_id=task_id, linked_by_user_id=user.id,
            created_at=datetime.now(UTC),
        ).on_conflict_do_nothing().returning(task_plan_links.c.plan_id))
    else:
        changed = await connection.scalar(delete(task_plan_links).where(
            task_plan_links.c.plan_id == plan_id, task_plan_links.c.task_id == task_id,
        ).returning(task_plan_links.c.plan_id))
    if changed is None:
        return
    await _audit(connection, user, "task_plan.linked" if linked else "task_plan.unlinked",
                 plan_id, {"taskId": str(task_id)})


async def confirm_import(
    connection: AsyncConnection, user: AuthenticatedUser, payload: TaskPlanImportConfirm,
) -> TaskPlanResponse:
    """One database transaction (provided by get_connection) for all imported records.

    The client keeps operation_id for safe retry after a lost HTTP response.
    """
    await ensure_module_action(connection, user, "tasks", "create")
    existing = (await connection.execute(select(task_plans).where(
        task_plans.c.id == payload.operation_id,
    ))).mappings().first()
    if existing is not None:
        if existing["created_by_user_id"] != user.id:
            raise WorkspaceRepositoryError(409, "Import identifier is already in use")
        linked = (await connection.execute(select(task_plan_links.c.task_id).where(
            task_plan_links.c.plan_id == payload.operation_id,
        ))).scalars().all()
        return _response(existing, [str(task_id) for task_id in linked])

    linked_ids = [item.task_id for item in payload.items if item.mode == "link"]
    if len(linked_ids) != len(set(linked_ids)):
        raise WorkspaceRepositoryError(422, "The same task was selected more than once")
    if linked_ids:
        await ensure_module_action(connection, user, "tasks", "edit")
        for task_id in linked_ids:
            if task_id is not None:
                await _task_access_row(connection, user, task_id, manage=True)

    now = datetime.now(UTC)
    inserted = (await connection.execute(pg_insert(task_plans).values(
        id=payload.operation_id, title=payload.plan.title, kind=payload.plan.kind,
        period_start=payload.plan.period_start, period_end=payload.plan.period_end,
        created_by_user_id=user.id, created_at=now, updated_at=now,
    ).on_conflict_do_nothing(index_elements=[task_plans.c.id]).returning(task_plans))).mappings().first()
    if inserted is None:
        row = await _plan_row(connection, payload.operation_id)
        if row["created_by_user_id"] != user.id:
            raise WorkspaceRepositoryError(409, "Import identifier is already in use")
        links = (await connection.execute(select(task_plan_links.c.task_id).where(
            task_plan_links.c.plan_id == payload.operation_id,
        ))).scalars().all()
        return _response(row, [str(task_id) for task_id in links])
    row = inserted
    task_ids: list[str] = []
    for item in payload.items:
        if item.mode == "link":
            task_id = item.task_id
        else:
            created = await create_task(connection, user, CreateTaskRequest(
                title=item.title, assignee_id=str(item.assignee_id or user.id),
                due_at=item.due_at,
                participants=[TaskCreateParticipantRequest(
                    user_id=str(participant_id), role="co_assignee",
                ) for participant_id in item.co_assignee_ids],
            ))
            task_id = UUID(created.id)
        if task_id is None:
            raise WorkspaceRepositoryError(422, "Select a task to link")
        await connection.execute(insert(task_plan_links).values(
            plan_id=payload.operation_id, task_id=task_id, linked_by_user_id=user.id,
            created_at=now,
        ))
        task_ids.append(str(task_id))
    await _audit(connection, user, "task_plan.imported", payload.operation_id,
                 {"title": payload.plan.title, "itemCount": str(len(task_ids))})
    return _response(row, task_ids)
