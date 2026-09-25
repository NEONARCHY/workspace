"""Independent project portfolio, work items and approval route."""

from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4
from zoneinfo import ZoneInfo

from sqlalchemy import func, insert, or_, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.engine import RowMapping
from sqlalchemy.ext.asyncio import AsyncConnection

from .auth import AuthenticatedUser
from .project_hub_schemas import (
    ProjectFundingAction,
    ProjectFundingActionResponse,
    ProjectFundingResponse,
    ProjectFundingWrite,
    ProjectHubOverview,
    ProjectHubResponse,
    ProjectHubWrite,
    ProjectWorkItemResponse,
    ProjectWorkItemWrite,
    ProjectWorkStatusWrite,
)
from .repository import WorkspaceRepositoryError, _upsert_notification, create_calendar_event
from .tables import (
    calendar_events,
    project_hub_item_assignees,
    project_hub_items,
    project_hub_people,
    project_hub_projects,
    project_hub_request_actions,
    project_hub_requests,
    users,
    workspace_notifications,
)
from .workspace_schemas import CreateCalendarEventRequest

TZ = ZoneInfo("Asia/Tashkent")


def _admin(user: AuthenticatedUser) -> bool:
    return user.role in {"admin", "superadmin"}


async def _active_people(connection: AsyncConnection, values: list[str]) -> list[UUID]:
    try:
        ids = [UUID(value) for value in values]
    except ValueError as error:
        raise WorkspaceRepositoryError(422, "Invalid employee identifier") from error
    if len(set(ids)) != len(ids):
        raise WorkspaceRepositoryError(422, "Employees must be unique")
    if not ids:
        return []
    found = set(
        (
            await connection.execute(
                select(users.c.id).where(users.c.id.in_(ids), users.c.status == "active")
            )
        ).scalars()
    )
    if found != set(ids):
        raise WorkspaceRepositoryError(422, "Every selected employee must be active")
    return ids


async def _project_people(
    connection: AsyncConnection, project_id: UUID
) -> tuple[list[UUID], list[UUID]]:
    rows = (
        (
            await connection.execute(
                select(project_hub_people)
                .where(project_hub_people.c.project_id == project_id)
                .order_by(project_hub_people.c.sort_order)
            )
        )
        .mappings()
        .all()
    )
    return (
        [row["user_id"] for row in rows if row["kind"] == "responsible"],
        [row["user_id"] for row in rows if row["kind"] == "approver"],
    )


async def _project_row(
    connection: AsyncConnection, project_id: UUID, *, lock: bool = False
) -> RowMapping:
    statement = select(project_hub_projects).where(project_hub_projects.c.id == project_id)
    if lock:
        statement = statement.with_for_update()
    row = (await connection.execute(statement)).mappings().first()
    if row is None:
        raise WorkspaceRepositoryError(404, "Project was not found")
    return row


async def _can_view_project(
    connection: AsyncConnection, user: AuthenticatedUser, row: RowMapping
) -> bool:
    if _admin(user) or row["access_status"] == "open":
        return True
    if user.id in {row["manager_user_id"], row["created_by_user_id"]}:
        return True
    person = await connection.scalar(
        select(project_hub_people.c.user_id)
        .where(
            project_hub_people.c.project_id == row["id"],
            project_hub_people.c.user_id == user.id,
        )
        .limit(1)
    )
    if person is not None:
        return True
    assigned = await connection.scalar(
        select(project_hub_item_assignees.c.user_id)
        .select_from(
            project_hub_item_assignees.join(
                project_hub_items, project_hub_items.c.id == project_hub_item_assignees.c.item_id
            )
        )
        .where(
            project_hub_items.c.project_id == row["id"],
            project_hub_item_assignees.c.user_id == user.id,
        )
        .limit(1)
    )
    if assigned is not None:
        return True
    return bool(
        await connection.scalar(
            select(project_hub_requests.c.id)
            .where(
                project_hub_requests.c.project_id == row["id"],
                or_(
                    project_hub_requests.c.requester_user_id == user.id,
                    project_hub_requests.c.approver_ids.contains([str(user.id)]),
                ),
            )
            .limit(1)
        )
    )


async def _require_project(
    connection: AsyncConnection,
    user: AuthenticatedUser,
    project_id: UUID,
    *,
    edit: bool = False,
    lock: bool = False,
) -> RowMapping:
    row = await _project_row(connection, project_id, lock=lock)
    if not await _can_view_project(connection, user, row):
        raise WorkspaceRepositoryError(404, "Project was not found")
    if edit and not (_admin(user) or user.id == row["manager_user_id"]):
        raise WorkspaceRepositoryError(403, "Only the project manager may change this project")
    return row


async def _replace_people(
    connection: AsyncConnection, project_id: UUID, kind: str, ids: list[UUID]
) -> None:
    await connection.execute(
        project_hub_people.delete().where(
            project_hub_people.c.project_id == project_id,
            project_hub_people.c.kind == kind,
        )
    )
    if ids:
        await connection.execute(
            insert(project_hub_people),
            [
                {"project_id": project_id, "user_id": user_id, "kind": kind, "sort_order": index}
                for index, user_id in enumerate(ids)
            ],
        )


async def _project_response(
    connection: AsyncConnection, user: AuthenticatedUser, row: RowMapping
) -> ProjectHubResponse:
    responsible, approvers = await _project_people(connection, row["id"])
    approved = await connection.scalar(
        select(func.coalesce(func.sum(project_hub_requests.c.amount), 0)).where(
            project_hub_requests.c.project_id == row["id"],
            project_hub_requests.c.status == "approved",
        )
    )
    return ProjectHubResponse(
        id=str(row["id"]),
        code=row["code"],
        title=row["title"],
        description=row["description"],
        manager_user_id=str(row["manager_user_id"]),
        responsible_user_ids=[str(value) for value in responsible],
        approver_user_ids=[str(value) for value in approvers],
        start_date=row["start_date"],
        end_date=row["end_date"],
        budget=row["budget"],
        currency=row["currency"],
        access_status=row["access_status"],
        lifecycle_status=row["lifecycle_status"],
        created_by_user_id=str(row["created_by_user_id"]),
        created_at=row["created_at"],
        updated_at=row["updated_at"],
        approved_amount=int(approved or 0),
        can_edit=_admin(user) or user.id == row["manager_user_id"],
    )


async def save_project(
    connection: AsyncConnection,
    user: AuthenticatedUser,
    payload: ProjectHubWrite,
    project_id: UUID | None = None,
) -> ProjectHubResponse:
    if project_id is None and user.role not in {"manager", "admin", "superadmin"}:
        raise WorkspaceRepositoryError(403, "Only managers can create projects")
    existing = None
    if project_id is not None:
        existing = await _require_project(connection, user, project_id, edit=True, lock=True)
        approved_total = await connection.scalar(
            select(func.coalesce(func.sum(project_hub_requests.c.amount), 0)).where(
                project_hub_requests.c.project_id == project_id,
                project_hub_requests.c.status == "approved",
            )
        )
        if int(approved_total or 0) > payload.budget:
            raise WorkspaceRepositoryError(409, "Budget cannot fall below approved requests")
        if approved_total and existing["currency"] != payload.currency:
            raise WorkspaceRepositoryError(409, "Currency cannot change after approval")
    manager = (await _active_people(connection, [payload.manager_user_id]))[0]
    responsible = await _active_people(connection, payload.responsible_user_ids)
    approvers = await _active_people(connection, payload.approver_user_ids)
    duplicate_query = select(project_hub_projects.c.id).where(
        func.lower(project_hub_projects.c.code) == payload.code.lower()
    )
    if project_id is not None:
        duplicate_query = duplicate_query.where(project_hub_projects.c.id != project_id)
    duplicate = await connection.scalar(duplicate_query)
    if duplicate is not None:
        raise WorkspaceRepositoryError(409, "Project code is already used")
    now = datetime.now(UTC)
    fields = dict(
        code=payload.code,
        title=payload.title,
        description=payload.description,
        manager_user_id=manager,
        start_date=payload.start_date,
        end_date=payload.end_date,
        budget=payload.budget,
        currency=payload.currency,
        access_status=payload.access_status,
        lifecycle_status=payload.lifecycle_status,
        updated_at=now,
    )
    if project_id is None:
        project_id = uuid4()
        await connection.execute(
            insert(project_hub_projects).values(
                id=project_id, created_by_user_id=user.id, created_at=now, **fields
            )
        )
    else:
        await connection.execute(
            update(project_hub_projects)
            .where(project_hub_projects.c.id == project_id)
            .values(**fields)
        )
    await _replace_people(connection, project_id, "responsible", responsible)
    await _replace_people(connection, project_id, "approver", approvers)
    return await _project_response(connection, user, await _project_row(connection, project_id))


async def _item_response(connection: AsyncConnection, row: RowMapping) -> ProjectWorkItemResponse:
    assignees = list(
        (
            await connection.execute(
                select(project_hub_item_assignees.c.user_id).where(
                    project_hub_item_assignees.c.item_id == row["id"]
                )
            )
        ).scalars()
    )
    counts = (
        await connection.execute(
            select(
                func.count(project_hub_requests.c.id),
                func.count(project_hub_requests.c.id).filter(
                    project_hub_requests.c.status == "approved"
                ),
            ).where(project_hub_requests.c.item_id == row["id"])
        )
    ).one()
    return ProjectWorkItemResponse(
        id=str(row["id"]),
        project_id=str(row["project_id"]),
        kind=row["kind"],
        title=row["title"],
        description=row["description"],
        starts_at=row["starts_at"],
        due_at=row["due_at"],
        budget=row["budget"],
        status=row["status"],
        calendar_event_id=str(row["calendar_event_id"]) if row["calendar_event_id"] else None,
        assignee_user_ids=[str(value) for value in assignees],
        created_by_user_id=str(row["created_by_user_id"]),
        created_at=row["created_at"],
        updated_at=row["updated_at"],
        request_count=int(counts[0]),
        approved_request_count=int(counts[1]),
    )


async def save_item(
    connection: AsyncConnection,
    user: AuthenticatedUser,
    project_id: UUID,
    payload: ProjectWorkItemWrite,
    item_id: UUID | None = None,
) -> ProjectWorkItemResponse:
    project = await _require_project(connection, user, project_id, edit=True)
    if project["lifecycle_status"] != "active":
        raise WorkspaceRepositoryError(409, "Completed projects cannot accept new work")
    if item_id is not None:
        row = (
            (
                await connection.execute(
                    select(project_hub_items).where(
                        project_hub_items.c.id == item_id,
                        project_hub_items.c.project_id == project_id,
                    )
                )
            )
            .mappings()
            .first()
        )
        if row is None:
            raise WorkspaceRepositoryError(404, "Work item was not found")
        if row["calendar_event_id"]:
            raise WorkspaceRepositoryError(409, "Published events must be edited in the calendar")
    assignees = await _active_people(connection, payload.assignee_user_ids)
    now = datetime.now(UTC)
    fields = dict(
        title=payload.title,
        description=payload.description,
        kind=payload.kind,
        starts_at=payload.starts_at,
        due_at=payload.due_at,
        budget=payload.budget,
        updated_at=now,
    )
    if item_id is None:
        item_id = uuid4()
        await connection.execute(
            insert(project_hub_items).values(
                id=item_id,
                project_id=project_id,
                status="planned",
                calendar_event_id=None,
                created_by_user_id=user.id,
                created_at=now,
                **fields,
            )
        )
    else:
        await connection.execute(
            update(project_hub_items).where(project_hub_items.c.id == item_id).values(**fields)
        )
    await connection.execute(
        project_hub_item_assignees.delete().where(project_hub_item_assignees.c.item_id == item_id)
    )
    if assignees:
        await connection.execute(
            insert(project_hub_item_assignees),
            [{"item_id": item_id, "user_id": value} for value in assignees],
        )
    row = (
        (
            await connection.execute(
                select(project_hub_items).where(project_hub_items.c.id == item_id)
            )
        )
        .mappings()
        .one()
    )
    return await _item_response(connection, row)


async def set_item_status(
    connection: AsyncConnection,
    user: AuthenticatedUser,
    project_id: UUID,
    item_id: UUID,
    payload: ProjectWorkStatusWrite,
) -> ProjectWorkItemResponse:
    await _require_project(connection, user, project_id, edit=True)
    row = (
        (
            await connection.execute(
                select(project_hub_items).where(
                    project_hub_items.c.id == item_id,
                    project_hub_items.c.project_id == project_id,
                )
            )
        )
        .mappings()
        .first()
    )
    if row is None:
        raise WorkspaceRepositoryError(404, "Work item was not found")
    if payload.status == "cancelled" and row["calendar_event_id"]:
        await connection.execute(
            update(calendar_events)
            .where(calendar_events.c.id == row["calendar_event_id"])
            .values(status="cancelled", updated_at=datetime.now(UTC))
        )
        await connection.execute(
            update(workspace_notifications)
            .where(
                workspace_notifications.c.section == "calendar",
                workspace_notifications.c.entity_id == row["calendar_event_id"],
                workspace_notifications.c.resolved_at.is_(None),
            )
            .values(resolved_at=datetime.now(UTC))
        )
    if row["status"] == "cancelled" and row["calendar_event_id"] and payload.status != "cancelled":
        raise WorkspaceRepositoryError(409, "Cancelled calendar events cannot be reopened")
    await connection.execute(
        update(project_hub_items)
        .where(project_hub_items.c.id == item_id)
        .values(status=payload.status, updated_at=datetime.now(UTC))
    )
    new_row = (
        (
            await connection.execute(
                select(project_hub_items).where(project_hub_items.c.id == item_id)
            )
        )
        .mappings()
        .one()
    )
    return await _item_response(connection, new_row)


async def publish_event(
    connection: AsyncConnection,
    user: AuthenticatedUser,
    project_id: UUID,
    item_id: UUID,
) -> ProjectWorkItemResponse:
    await _require_project(connection, user, project_id, edit=True)
    row = (
        (
            await connection.execute(
                select(project_hub_items)
                .where(
                    project_hub_items.c.id == item_id,
                    project_hub_items.c.project_id == project_id,
                )
                .with_for_update()
            )
        )
        .mappings()
        .first()
    )
    if row is None or row["kind"] != "event":
        raise WorkspaceRepositoryError(404, "Project event was not found")
    if row["calendar_event_id"]:
        return await _item_response(connection, row)
    if row["status"] == "cancelled":
        raise WorkspaceRepositoryError(409, "Cancelled events cannot be published")
    assignees = list(
        (
            await connection.execute(
                select(project_hub_item_assignees.c.user_id).where(
                    project_hub_item_assignees.c.item_id == item_id
                )
            )
        ).scalars()
    )
    event = await create_calendar_event(
        connection,
        user,
        CreateCalendarEventRequest(
            title=row["title"],
            description=row["description"],
            event_type="general",
            starts_at=row["starts_at"],
            ends_at=row["due_at"],
            all_day=False,
            location="",
            attendee_ids=[str(value) for value in assignees],
        ),
    )
    await connection.execute(
        update(project_hub_items)
        .where(project_hub_items.c.id == item_id)
        .values(calendar_event_id=UUID(event.id), updated_at=datetime.now(UTC))
    )
    new_row = (
        (
            await connection.execute(
                select(project_hub_items).where(project_hub_items.c.id == item_id)
            )
        )
        .mappings()
        .one()
    )
    return await _item_response(connection, new_row)


async def _request_response(
    connection: AsyncConnection,
    user: AuthenticatedUser,
    row: RowMapping,
) -> ProjectFundingResponse:
    actions = (
        (
            await connection.execute(
                select(project_hub_request_actions)
                .where(project_hub_request_actions.c.request_id == row["id"])
                .order_by(project_hub_request_actions.c.created_at)
            )
        )
        .mappings()
        .all()
    )
    approvers = list(row["approver_ids"])
    names = (
        await connection.execute(
            select(
                project_hub_projects.c.title,
                project_hub_items.c.title,
            )
            .select_from(
                project_hub_requests.join(
                    project_hub_projects,
                    project_hub_projects.c.id == project_hub_requests.c.project_id,
                ).join(project_hub_items, project_hub_items.c.id == project_hub_requests.c.item_id)
            )
            .where(project_hub_requests.c.id == row["id"])
        )
    ).one()
    return ProjectFundingResponse(
        id=str(row["id"]),
        project_id=str(row["project_id"]),
        item_id=str(row["item_id"]),
        project_title=names[0],
        item_title=names[1],
        title=row["title"],
        purpose=row["purpose"],
        amount=row["amount"],
        currency=row["currency"],
        status=row["status"],
        approver_user_ids=approvers,
        current_step=row["current_step"],
        requester_user_id=str(row["requester_user_id"]),
        created_at=row["created_at"],
        updated_at=row["updated_at"],
        can_decide=(
            row["status"] == "pending"
            and row["current_step"] < len(approvers)
            and str(user.id) == approvers[row["current_step"]]
        ),
        actions=[
            ProjectFundingActionResponse(
                actor_user_id=str(action["actor_user_id"]),
                action=action["action"],
                step=action["step"],
                comment=action["comment"],
                created_at=action["created_at"],
            )
            for action in actions
        ],
    )


async def _may_create_request(
    connection: AsyncConnection,
    user: AuthenticatedUser,
    project: RowMapping,
    item_id: UUID,
) -> bool:
    if _admin(user) or user.id == project["manager_user_id"]:
        return True
    if await connection.scalar(
        select(project_hub_people.c.user_id)
        .where(
            project_hub_people.c.project_id == project["id"],
            project_hub_people.c.user_id == user.id,
            project_hub_people.c.kind == "responsible",
        )
        .limit(1)
    ):
        return True
    return bool(
        await connection.scalar(
            select(project_hub_item_assignees.c.user_id)
            .where(
                project_hub_item_assignees.c.item_id == item_id,
                project_hub_item_assignees.c.user_id == user.id,
            )
            .limit(1)
        )
    )


async def create_funding_request(
    connection: AsyncConnection,
    user: AuthenticatedUser,
    project_id: UUID,
    payload: ProjectFundingWrite,
) -> ProjectFundingResponse:
    project = await _require_project(connection, user, project_id, lock=True)
    if project["lifecycle_status"] != "active":
        raise WorkspaceRepositoryError(409, "Completed projects cannot accept requests")
    try:
        item_id = UUID(payload.item_id)
    except ValueError as error:
        raise WorkspaceRepositoryError(422, "Invalid work item") from error
    item = (
        (
            await connection.execute(
                select(project_hub_items).where(
                    project_hub_items.c.id == item_id,
                    project_hub_items.c.project_id == project_id,
                )
            )
        )
        .mappings()
        .first()
    )
    if item is None:
        raise WorkspaceRepositoryError(404, "Project work item was not found")
    if item["status"] == "cancelled":
        raise WorkspaceRepositoryError(409, "Cancelled work cannot receive requests")
    if not await _may_create_request(connection, user, project, item_id):
        raise WorkspaceRepositoryError(403, "Not responsible for this project work")
    _, approvers = await _project_people(connection, project_id)
    if not approvers:
        raise WorkspaceRepositoryError(409, "Set the project's approval route first")
    now = datetime.now(UTC)
    request_id = uuid4()
    await connection.execute(
        insert(project_hub_requests).values(
            id=request_id,
            project_id=project_id,
            item_id=item_id,
            title=payload.title.strip(),
            purpose=payload.purpose,
            amount=payload.amount,
            currency=project["currency"],
            status="pending",
            approver_ids=[str(value) for value in approvers],
            current_step=0,
            requester_user_id=user.id,
            created_at=now,
            updated_at=now,
        )
    )
    await connection.execute(
        insert(project_hub_request_actions).values(
            id=uuid4(),
            request_id=request_id,
            actor_user_id=user.id,
            action="submit",
            step=0,
            comment=None,
            created_at=now,
        )
    )
    await _upsert_notification(
        connection,
        user_id=approvers[0],
        event_key=f"project-funding:{request_id}:step:0",
        kind="approval",
        priority="attention",
        title="Проектная заявка ждёт решения",
        body=f"{project['title']} · {payload.title}",
        section="project_funding",
        entity_id=request_id,
        requires_action=True,
        occurred_at=now,
    )
    row = (
        (
            await connection.execute(
                select(project_hub_requests).where(project_hub_requests.c.id == request_id)
            )
        )
        .mappings()
        .one()
    )
    return await _request_response(connection, user, row)


async def decide_funding_request(
    connection: AsyncConnection,
    user: AuthenticatedUser,
    request_id: UUID,
    payload: ProjectFundingAction,
) -> ProjectFundingResponse:
    row = (
        (
            await connection.execute(
                select(project_hub_requests)
                .where(project_hub_requests.c.id == request_id)
                .with_for_update()
            )
        )
        .mappings()
        .first()
    )
    if row is None:
        raise WorkspaceRepositoryError(404, "Project request was not found")
    await _require_project(connection, user, row["project_id"])
    approvers = list(row["approver_ids"])
    step = row["current_step"]
    if row["status"] != "pending" or step >= len(approvers):
        raise WorkspaceRepositoryError(409, "This request is already decided")
    if approvers[step] != str(user.id):
        raise WorkspaceRepositoryError(403, "This approval step belongs to another employee")
    if payload.action == "reject" and not payload.comment.strip():
        raise WorkspaceRepositoryError(422, "A rejection requires a reason")
    now = datetime.now(UTC)
    next_step = step + 1 if payload.action == "approve" else step
    status = (
        ("approved" if next_step == len(approvers) else "pending")
        if payload.action == "approve"
        else "rejected"
    )
    if status == "approved":
        project = await _project_row(connection, row["project_id"], lock=True)
        approved = await connection.scalar(
            select(func.coalesce(func.sum(project_hub_requests.c.amount), 0)).where(
                project_hub_requests.c.project_id == row["project_id"],
                project_hub_requests.c.status == "approved",
            )
        )
        if int(approved or 0) + row["amount"] > project["budget"]:
            raise WorkspaceRepositoryError(409, "Approved requests would exceed the project budget")
    await connection.execute(
        update(project_hub_requests)
        .where(project_hub_requests.c.id == request_id)
        .values(status=status, current_step=next_step, updated_at=now)
    )
    await connection.execute(
        insert(project_hub_request_actions).values(
            id=uuid4(),
            request_id=request_id,
            actor_user_id=user.id,
            action=payload.action,
            step=step,
            comment=payload.comment.strip() or None,
            created_at=now,
        )
    )
    recipient = UUID(approvers[next_step]) if status == "pending" else row["requester_user_id"]
    await _upsert_notification(
        connection,
        user_id=recipient,
        event_key=f"project-funding:{request_id}:{status}:{next_step}",
        kind="approval",
        priority="attention" if status == "pending" else "normal",
        title="Проектная заявка ждёт решения"
        if status == "pending"
        else (
            "Проектная заявка согласована" if status == "approved" else "Проектная заявка отклонена"
        ),
        body=row["title"],
        section="project_funding",
        entity_id=request_id,
        requires_action=status == "pending",
        occurred_at=now,
    )
    new_row = (
        (
            await connection.execute(
                select(project_hub_requests).where(project_hub_requests.c.id == request_id)
            )
        )
        .mappings()
        .one()
    )
    return await _request_response(connection, user, new_row)


async def load_hub(
    connection: AsyncConnection,
    user: AuthenticatedUser,
) -> ProjectHubOverview:
    project_rows = (
        (
            await connection.execute(
                select(project_hub_projects).order_by(project_hub_projects.c.updated_at.desc())
            )
        )
        .mappings()
        .all()
    )
    visible = [row for row in project_rows if await _can_view_project(connection, user, row)]
    if not visible:
        return ProjectHubOverview(projects=[], items=[], requests=[])
    project_ids = [row["id"] for row in visible]
    item_rows = (
        (
            await connection.execute(
                select(project_hub_items)
                .where(project_hub_items.c.project_id.in_(project_ids))
                .order_by(project_hub_items.c.due_at.nulls_last())
            )
        )
        .mappings()
        .all()
    )
    return ProjectHubOverview(
        projects=[await _project_response(connection, user, row) for row in visible],
        items=[await _item_response(connection, row) for row in item_rows],
        requests=[],
    )


async def load_funding_requests(
    connection: AsyncConnection,
    user: AuthenticatedUser,
) -> list[ProjectFundingResponse]:
    rows = (
        (
            await connection.execute(
                select(project_hub_requests).order_by(project_hub_requests.c.created_at.desc())
            )
        )
        .mappings()
        .all()
    )
    visible: list[ProjectFundingResponse] = []
    for row in rows:
        project = await _project_row(connection, row["project_id"])
        if not await _can_view_project(connection, user, project):
            continue
        if not (
            _admin(user)
            or user.id in {project["manager_user_id"], row["requester_user_id"]}
            or str(user.id) in row["approver_ids"]
        ):
            continue
        visible.append(await _request_response(connection, user, row))
    return visible


async def materialize_project_reminders(connection: AsyncConnection) -> int:
    """Notify manager and assignees once when an active deadline enters 20 days."""
    now = datetime.now(UTC)
    rows = (
        (
            await connection.execute(
                select(
                    project_hub_items,
                    project_hub_projects.c.title.label("project_title"),
                    project_hub_projects.c.manager_user_id,
                )
                .join(
                    project_hub_projects,
                    project_hub_projects.c.id == project_hub_items.c.project_id,
                )
                .where(
                    project_hub_items.c.status.in_(("planned", "active")),
                    project_hub_projects.c.lifecycle_status == "active",
                    project_hub_items.c.due_at > now,
                    project_hub_items.c.due_at <= now + timedelta(days=20),
                )
            )
        )
        .mappings()
        .all()
    )
    delivered = 0
    for row in rows:
        remaining = row["due_at"] - now
        threshold = (
            1 if remaining <= timedelta(days=1)
            else 7 if remaining <= timedelta(days=7)
            else 20
        )
        assignees = list(
            (
                await connection.execute(
                    select(project_hub_item_assignees.c.user_id).where(
                        project_hub_item_assignees.c.item_id == row["id"]
                    )
                )
            ).scalars()
        )
        for recipient in set([row["manager_user_id"], *assignees]):
            event_key = f"project-hub:due:{row['id']}:{row['due_at'].isoformat()}:{threshold}d"
            due_label = row["due_at"].astimezone(TZ).strftime("%d.%m.%Y")
            result = await connection.execute(
                pg_insert(workspace_notifications)
                .values(
                    id=uuid4(),
                    user_id=recipient,
                    event_key=event_key,
                    kind="task",
                    priority="attention",
                    title="Срок проектной работы приближается",
                    body=f"{row['project_title']} · {row['title']} · {due_label}",
                    section="project_hub",
                    entity_id=row["project_id"],
                    requires_action=False,
                    is_reminder=True,
                    occurred_at=now,
                    read_at=None,
                    resolved_at=None,
                    desktop_delivered_at=None,
                )
                .on_conflict_do_nothing(
                    index_elements=[
                        workspace_notifications.c.user_id,
                        workspace_notifications.c.event_key,
                    ]
                )
            )
            delivered += result.rowcount or 0
    return delivered
