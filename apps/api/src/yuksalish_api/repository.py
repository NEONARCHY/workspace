from calendar import monthrange
from collections.abc import Mapping, Sequence
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import UUID, uuid4

from sqlalchemy import and_, delete, func, insert, or_, select, update
from sqlalchemy.engine import RowMapping
from sqlalchemy.ext.asyncio import AsyncConnection

from .auth import AuthenticatedUser
from .tables import (
    approval_actions,
    approval_edges,
    approval_nodes,
    approval_request_versions,
    approval_requests,
    approval_templates,
    attachments,
    chat_members,
    chats,
    message_versions,
    messages,
    task_checklist_items,
    task_comments,
    task_cycles,
    task_dependencies,
    task_participants,
    tasks,
    users,
)
from .workspace_schemas import (
    ApprovalActionHistoryResponse,
    ApprovalActionRequest,
    ApprovalRequestResponse,
    ApprovalRequestVersionResponse,
    AttachmentOwnerType,
    AttachmentResponse,
    ChangeTaskStatusRequest,
    ChatMessageResponse,
    ChatSummaryResponse,
    CreateApprovalRequest,
    CreateChecklistItemRequest,
    CreateTaskCommentRequest,
    CreateTaskRequest,
    PersonResponse,
    SaveWorkflowRequest,
    SendMessageRequest,
    TaskChecklistItemResponse,
    TaskCommentResponse,
    TaskCycleRequest,
    TaskCycleResponse,
    TaskDependencyRequest,
    TaskDependencyResponse,
    TaskParticipantRequest,
    TaskParticipantResponse,
    TaskResponse,
    UpdateApprovalRequest,
    UpdateChecklistItemRequest,
    UpdateTaskRequest,
    WorkflowEdgeResponse,
    WorkflowNodeResponse,
    WorkflowResponse,
    WorkspaceBootstrapResponse,
)

PERSON_COLORS = ("#0f6cbd", "#6b5b95", "#0e7a0d", "#9b3a4d", "#8a4f12")
STATUS_LABELS = {
    "draft": "Черновик",
    "running": "Ожидает решения",
    "needs_revision": "На доработке",  # noqa: RUF001
    "approved": "Согласовано",
    "rejected": "Отклонено",
    "cancelled": "Отменено",
}

Record = Mapping[str, Any] | RowMapping


class WorkspaceRepositoryError(RuntimeError):
    def __init__(self, status_code: int, detail: str) -> None:
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


def _initials(full_name: str) -> str:
    return "".join(part[0] for part in full_name.split()[:2]).upper()


def person_from_record(row: Record, color_index: int = 0) -> PersonResponse:
    return PersonResponse(
        id=str(row["id"]),
        username=row["username"],
        name=row["full_name"],
        initials=_initials(row["full_name"]),
        role=row["role"],
        job_title=row["job_title"],
        color=PERSON_COLORS[color_index % len(PERSON_COLORS)],
    )


def _time_label(value: datetime | None) -> str:
    if value is None:
        return ""
    local = value.astimezone()
    now = datetime.now(UTC).astimezone()
    if local.date() == now.date():
        return local.strftime("%H:%M")
    return local.strftime("%d.%m")


def _due_label(value: datetime | None) -> str:
    if value is None:
        return "Срок не указан"
    return value.astimezone().strftime("%d.%m.%Y, %H:%M")


def _task_cycle(row: Record) -> TaskCycleResponse:
    config = row["schedule_config"] or {}
    return TaskCycleResponse(
        id=str(row["id"]),
        title=row["title"],
        schedule_kind=row["schedule_kind"],
        interval=int(config.get("interval", 1)),
        timezone=row["timezone"],
        next_run_at=row["next_run_at"],
        is_enabled=row["is_enabled"],
    )


def _task_checklist_item(row: Record) -> TaskChecklistItemResponse:
    return TaskChecklistItemResponse(
        id=str(row["id"]),
        title=row["title"],
        is_completed=row["is_completed"],
        sort_order=row["sort_order"],
        created_by_user_id=str(row["created_by_user_id"]),
        completed_by_user_id=(
            str(row["completed_by_user_id"]) if row["completed_by_user_id"] else None
        ),
        completed_at=row["completed_at"],
        created_at=row["created_at"],
    )


def _task_comment(row: Record) -> TaskCommentResponse:
    return TaskCommentResponse(
        id=str(row["id"]),
        author_user_id=str(row["author_user_id"]),
        body=row["body"],
        created_at=row["created_at"],
        edited_at=row["edited_at"],
    )


def _task_dependency(row: Record, dependency: Record) -> TaskDependencyResponse:
    return TaskDependencyResponse(
        depends_on_task_id=str(row["depends_on_task_id"]),
        dependency_kind=row["dependency_kind"],
        title=dependency["title"],
        status=dependency["status"],
    )


def _task(
    row: Record,
    *,
    participants: Sequence[TaskParticipantResponse] = (),
    checklist: Sequence[TaskChecklistItemResponse] = (),
    comments: Sequence[TaskCommentResponse] = (),
    dependencies: Sequence[TaskDependencyResponse] = (),
    cycle: TaskCycleResponse | None = None,
) -> TaskResponse:
    checklist_done = sum(item.is_completed for item in checklist)
    return TaskResponse(
        id=str(row["id"]),
        title=row["title"],
        description=row["description"],
        project=row["project_key"] or "Без проекта",
        author_id=str(row["author_user_id"]),
        assignee_id=str(row["primary_assignee_user_id"]),
        due_label=_due_label(row["due_at"]),
        starts_at=row["starts_at"],
        due_at=row["due_at"],
        status=row["status"],
        priority=row["priority"],
        checklist_done=checklist_done,
        checklist_total=len(checklist),
        source_message_id=(str(row["source_message_id"]) if row["source_message_id"] else None),
        result_text=row["result_text"],
        participants=list(participants),
        checklist=list(checklist),
        comments=list(comments),
        dependencies=list(dependencies),
        cycle=cycle,
    )


def _approval_version(row: Record) -> ApprovalRequestVersionResponse:
    payload = row["payload"] or {}
    return ApprovalRequestVersionResponse(
        version=row["version"],
        title=row["title"],
        amount=int(payload.get("amount", 0)),
        currency=str(payload.get("currency", "UZS")),
        purpose=str(payload.get("purpose", "")),
        attachment_ids=[str(value) for value in row["attachment_ids"] or []],
        edited_by_user_id=str(row["edited_by_user_id"]),
        change_reason=row["change_reason"],
        change_comment=row["change_comment"],
        created_at=row["created_at"],
    )


def _approval_action(row: Record) -> ApprovalActionHistoryResponse:
    return ApprovalActionHistoryResponse(
        action=row["action"],
        comment=row["comment"],
        actor_user_id=str(row["actor_user_id"]),
        node_key=row["node_key"],
        created_at=row["created_at"],
    )


def _attachment(row: Record) -> AttachmentResponse:
    return AttachmentResponse(
        id=str(row["id"]),
        owner_type=row["owner_type"],
        owner_id=str(row["owner_id"]),
        file_name=row["file_name"],
        content_type=row["content_type"],
        byte_size=row["byte_size"],
        sha256=row["sha256"],
        uploaded_by_user_id=str(row["uploaded_by_user_id"]),
        created_at=row["created_at"],
    )


def _approval_request(
    row: Record,
    versions: Sequence[ApprovalRequestVersionResponse] = (),
    actions: Sequence[ApprovalActionHistoryResponse] = (),
) -> ApprovalRequestResponse:
    payload = row["payload"] or {}
    status_value = str(row["status"])
    return ApprovalRequestResponse(
        id=str(row["id"]),
        number=str(payload.get("number", str(row["id"])[:8])),
        title=row["title"],
        amount=int(payload.get("amount", 0)),
        currency=str(payload.get("currency", "UZS")),
        status=row["status"],
        status_label=STATUS_LABELS.get(status_value, status_value),
        active_node_keys=list(row["active_node_keys"] or []),
        requester_id=str(row["requester_user_id"]),
        source_task_id=(str(row["source_task_id"]) if row["source_task_id"] else None),
        purpose=str(payload.get("purpose", "")),
        revision=int(row.get("current_version", 1)),
        versions=list(versions),
        actions=list(actions),
    )


async def _request_versions(
    connection: AsyncConnection,
    request_ids: Sequence[UUID],
) -> dict[UUID, list[ApprovalRequestVersionResponse]]:
    if not request_ids:
        return {}
    rows = (
        await connection.execute(
            select(approval_request_versions)
            .where(approval_request_versions.c.request_id.in_(request_ids))
            .order_by(
                approval_request_versions.c.request_id,
                approval_request_versions.c.version,
            )
        )
    ).mappings().all()
    result: dict[UUID, list[ApprovalRequestVersionResponse]] = {}
    for row in rows:
        result.setdefault(row["request_id"], []).append(_approval_version(row))
    return result


async def _request_actions(
    connection: AsyncConnection,
    request_ids: Sequence[UUID],
) -> dict[UUID, list[ApprovalActionHistoryResponse]]:
    if not request_ids:
        return {}
    rows = (
        await connection.execute(
            select(approval_actions)
            .where(approval_actions.c.request_id.in_(request_ids))
            .order_by(approval_actions.c.request_id, approval_actions.c.created_at)
        )
    ).mappings().all()
    result: dict[UUID, list[ApprovalActionHistoryResponse]] = {}
    for row in rows:
        result.setdefault(row["request_id"], []).append(_approval_action(row))
    return result


async def _request_response(
    connection: AsyncConnection,
    request_id: UUID,
) -> ApprovalRequestResponse:
    row = (
        await connection.execute(
            select(approval_requests).where(approval_requests.c.id == request_id)
        )
    ).mappings().first()
    if row is None:
        raise WorkspaceRepositoryError(404, "Request was not found")
    versions = await _request_versions(connection, [request_id])
    actions = await _request_actions(connection, [request_id])
    return _approval_request(
        row,
        versions.get(request_id, []),
        actions.get(request_id, []),
    )


async def find_active_user_by_username(
    connection: AsyncConnection,
    username: str,
) -> RowMapping | None:
    statement = select(users).where(users.c.username == username, users.c.status == "active")
    return (await connection.execute(statement)).mappings().first()


async def get_workflow(connection: AsyncConnection) -> WorkflowResponse:
    template_statement = (
        select(approval_templates)
        .where(approval_templates.c.template_key == "payment")
        .order_by(approval_templates.c.version.desc())
        .limit(1)
    )
    template = (await connection.execute(template_statement)).mappings().first()
    if template is None:
        raise WorkspaceRepositoryError(503, "Payment workflow is not configured")
    node_rows = (
        (
            await connection.execute(
                select(approval_nodes)
                .where(approval_nodes.c.template_id == template["id"])
                .order_by(approval_nodes.c.node_key)
            )
        )
        .mappings()
        .all()
    )
    edge_rows = (
        (
            await connection.execute(
                select(approval_edges)
                .where(approval_edges.c.template_id == template["id"])
                .order_by(approval_edges.c.source_node_key, approval_edges.c.sort_order)
            )
        )
        .mappings()
        .all()
    )
    return WorkflowResponse(
        id=str(template["id"]),
        name=template["name"],
        version=template["version"],
        status=template["status"],
        nodes=[
            WorkflowNodeResponse(
                id=row["node_key"],
                kind=row["kind"],
                label=row["title"],
                detail=str((row["config"] or {}).get("detail", "")),
                position_x=row["position_x"],
                position_y=row["position_y"],
                config=row["config"] or {},
            )
            for row in node_rows
        ],
        edges=[
            WorkflowEdgeResponse(
                id=str(row["id"]),
                source=row["source_node_key"],
                target=row["target_node_key"],
                outcome=row["outcome"],
                label=row["label"],
                condition=row["condition"] or {},
                sort_order=row["sort_order"],
            )
            for row in edge_rows
        ],
    )


async def _task_detail_maps(
    connection: AsyncConnection,
    task_rows: Sequence[Record],
) -> tuple[
    dict[UUID, list[TaskParticipantResponse]],
    dict[UUID, list[TaskChecklistItemResponse]],
    dict[UUID, list[TaskCommentResponse]],
    dict[UUID, list[TaskDependencyResponse]],
    dict[UUID, TaskCycleResponse],
]:
    task_ids = [row["id"] for row in task_rows]
    if not task_ids:
        return {}, {}, {}, {}, {}

    participant_rows = (
        await connection.execute(
            select(task_participants)
            .where(task_participants.c.task_id.in_(task_ids))
            .order_by(task_participants.c.task_id, task_participants.c.participant_role)
        )
    ).mappings().all()
    participants: dict[UUID, list[TaskParticipantResponse]] = {}
    for row in participant_rows:
        participants.setdefault(row["task_id"], []).append(
            TaskParticipantResponse(
                user_id=str(row["user_id"]),
                role=row["participant_role"],
            )
        )

    checklist_rows = (
        await connection.execute(
            select(task_checklist_items)
            .where(task_checklist_items.c.task_id.in_(task_ids))
            .order_by(
                task_checklist_items.c.task_id,
                task_checklist_items.c.sort_order,
                task_checklist_items.c.created_at,
            )
        )
    ).mappings().all()
    checklist: dict[UUID, list[TaskChecklistItemResponse]] = {}
    for row in checklist_rows:
        checklist.setdefault(row["task_id"], []).append(_task_checklist_item(row))

    comment_rows = (
        await connection.execute(
            select(task_comments)
            .where(task_comments.c.task_id.in_(task_ids))
            .order_by(task_comments.c.task_id, task_comments.c.created_at)
        )
    ).mappings().all()
    comments: dict[UUID, list[TaskCommentResponse]] = {}
    for row in comment_rows:
        comments.setdefault(row["task_id"], []).append(_task_comment(row))

    dependency_rows = (
        await connection.execute(
            select(task_dependencies)
            .where(task_dependencies.c.task_id.in_(task_ids))
            .order_by(task_dependencies.c.task_id, task_dependencies.c.created_at)
        )
    ).mappings().all()
    dependency_ids = list({row["depends_on_task_id"] for row in dependency_rows})
    dependency_task_rows = (
        (
            await connection.execute(select(tasks).where(tasks.c.id.in_(dependency_ids)))
        ).mappings().all()
        if dependency_ids
        else []
    )
    dependency_tasks = {row["id"]: row for row in dependency_task_rows}
    dependencies: dict[UUID, list[TaskDependencyResponse]] = {}
    for row in dependency_rows:
        dependency = dependency_tasks.get(row["depends_on_task_id"])
        if dependency is not None:
            dependencies.setdefault(row["task_id"], []).append(
                _task_dependency(row, dependency)
            )

    cycle_ids = list({row["cycle_id"] for row in task_rows if row["cycle_id"] is not None})
    cycle_rows = (
        (await connection.execute(select(task_cycles).where(task_cycles.c.id.in_(cycle_ids))))
        .mappings()
        .all()
        if cycle_ids
        else []
    )
    cycles = {row["id"]: _task_cycle(row) for row in cycle_rows}
    return participants, checklist, comments, dependencies, cycles


async def _task_response(connection: AsyncConnection, task_id: UUID) -> TaskResponse:
    row = (
        await connection.execute(select(tasks).where(tasks.c.id == task_id))
    ).mappings().first()
    if row is None:
        raise WorkspaceRepositoryError(404, "Task was not found")
    participants, checklist, comments, dependencies, cycles = await _task_detail_maps(
        connection, [row]
    )
    return _task(
        row,
        participants=participants.get(task_id, []),
        checklist=checklist.get(task_id, []),
        comments=comments.get(task_id, []),
        dependencies=dependencies.get(task_id, []),
        cycle=cycles.get(row["cycle_id"]),
    )


async def load_workspace(
    connection: AsyncConnection,
    current_user: AuthenticatedUser,
) -> WorkspaceBootstrapResponse:
    people_rows = (
        (
            await connection.execute(
                select(users).where(users.c.status == "active").order_by(users.c.full_name)
            )
        )
        .mappings()
        .all()
    )
    people = [person_from_record(row, index) for index, row in enumerate(people_rows)]
    current = next(person for person in people if person.id == str(current_user.id))

    accessible_chat_ids = select(chat_members.c.chat_id).where(
        chat_members.c.user_id == current_user.id
    )
    chat_rows = (
        (
            await connection.execute(
                select(chats)
                .where(chats.c.id.in_(accessible_chat_ids))
                .order_by(chats.c.updated_at.desc())
            )
        )
        .mappings()
        .all()
    )
    message_rows = (
        (
            await connection.execute(
                select(messages)
                .where(
                    messages.c.chat_id.in_(accessible_chat_ids),
                    messages.c.deleted_at.is_(None),
                )
                .order_by(messages.c.created_at)
            )
        )
        .mappings()
        .all()
    )
    latest_by_chat: dict[UUID, RowMapping] = {}
    for row in message_rows:
        latest_by_chat[row["chat_id"]] = row
    chat_responses = []
    for row in chat_rows:
        latest = latest_by_chat.get(row["id"])
        chat_responses.append(
            ChatSummaryResponse(
                id=str(row["id"]),
                title=row["title"] or "Чат",
                kind=row["kind"],
                preview=latest["body"] if latest is not None else "Сообщений пока нет",
                time=_time_label(latest["created_at"] if latest is not None else row["created_at"]),
                unread=0,
            )
        )
    message_responses = [
        ChatMessageResponse(
            id=str(row["id"]),
            chat_id=str(row["chat_id"]),
            author_id=str(row["author_user_id"]),
            body=row["body"],
            time=_time_label(row["created_at"]),
            created_at=row["created_at"],
            own=row["author_user_id"] == current_user.id,
        )
        for row in message_rows
    ]

    task_statement = select(tasks).order_by(tasks.c.updated_at.desc())
    if current_user.role == "employee":
        participant_task_ids = select(task_participants.c.task_id).where(
            task_participants.c.user_id == current_user.id
        )
        task_statement = task_statement.where(
            (tasks.c.author_user_id == current_user.id)
            | (tasks.c.primary_assignee_user_id == current_user.id)
            | tasks.c.id.in_(participant_task_ids)
        )
    task_rows = (await connection.execute(task_statement)).mappings().all()
    (
        task_participants_by_task,
        task_checklist_by_task,
        task_comments_by_task,
        task_dependencies_by_task,
        task_cycles_by_id,
    ) = await _task_detail_maps(connection, task_rows)

    request_statement = select(approval_requests).order_by(
        approval_requests.c.updated_at.desc()
    )
    if current_user.role == "employee":
        request_statement = request_statement.where(
            approval_requests.c.requester_user_id == current_user.id
        )
    request_rows = (await connection.execute(request_statement)).mappings().all()
    request_ids = [row["id"] for row in request_rows]
    versions_by_request = await _request_versions(connection, request_ids)
    actions_by_request = await _request_actions(connection, request_ids)

    attachment_filters = []
    message_ids = [row["id"] for row in message_rows]
    task_ids = [row["id"] for row in task_rows]
    if message_ids:
        attachment_filters.append(
            and_(attachments.c.owner_type == "message", attachments.c.owner_id.in_(message_ids))
        )
    if task_ids:
        attachment_filters.append(
            and_(attachments.c.owner_type == "task", attachments.c.owner_id.in_(task_ids))
        )
    if request_ids:
        attachment_filters.append(
            and_(
                attachments.c.owner_type == "approval_request",
                attachments.c.owner_id.in_(request_ids),
            )
        )
    attachment_rows: Sequence[RowMapping] = ()
    if attachment_filters:
        attachment_rows = (
            await connection.execute(
                select(attachments)
                .where(or_(*attachment_filters))
                .order_by(attachments.c.created_at)
            )
        ).mappings().all()

    return WorkspaceBootstrapResponse(
        current_user=current,
        people=people,
        chats=chat_responses,
        messages=message_responses,
        tasks=[
            _task(
                row,
                participants=task_participants_by_task.get(row["id"], []),
                checklist=task_checklist_by_task.get(row["id"], []),
                comments=task_comments_by_task.get(row["id"], []),
                dependencies=task_dependencies_by_task.get(row["id"], []),
                cycle=task_cycles_by_id.get(row["cycle_id"]),
            )
            for row in task_rows
        ],
        requests=[
            _approval_request(
                row,
                versions_by_request.get(row["id"], []),
                actions_by_request.get(row["id"], []),
            )
            for row in request_rows
        ],
        attachments=[_attachment(row) for row in attachment_rows],
        workflow=await get_workflow(connection),
    )


async def send_message(
    connection: AsyncConnection,
    current_user: AuthenticatedUser,
    chat_id: UUID,
    payload: SendMessageRequest,
) -> ChatMessageResponse:
    membership = await connection.scalar(
        select(func.count())
        .select_from(chat_members)
        .where(chat_members.c.chat_id == chat_id, chat_members.c.user_id == current_user.id)
    )
    if not membership:
        raise WorkspaceRepositoryError(404, "Chat was not found")
    message_id = uuid4()
    created_at = datetime.now(UTC)
    await connection.execute(
        insert(messages).values(
            id=message_id,
            chat_id=chat_id,
            author_user_id=current_user.id,
            reply_to_message_id=None,
            body=payload.body,
            created_at=created_at,
            edited_at=None,
            deleted_at=None,
        )
    )
    await connection.execute(
        insert(message_versions).values(
            message_id=message_id,
            body=payload.body,
            change_reason="initial",
            created_at=created_at,
        )
    )
    await connection.execute(
        update(chats).where(chats.c.id == chat_id).values(updated_at=created_at)
    )
    return ChatMessageResponse(
        id=str(message_id),
        chat_id=str(chat_id),
        author_id=str(current_user.id),
        body=payload.body,
        time=_time_label(created_at),
        created_at=created_at,
        own=True,
    )


async def _task_access_row(
    connection: AsyncConnection,
    current_user: AuthenticatedUser,
    task_id: UUID,
    *,
    edit: bool = False,
    manage: bool = False,
) -> Record:
    row = (
        await connection.execute(select(tasks).where(tasks.c.id == task_id))
    ).mappings().first()
    if row is None:
        raise WorkspaceRepositoryError(404, "Task was not found")
    participant_roles = (
        await connection.execute(
            select(task_participants.c.participant_role).where(
                task_participants.c.task_id == task_id,
                task_participants.c.user_id == current_user.id,
            )
        )
    ).scalars().all()
    privileged = current_user.role in {"manager", "admin", "superadmin"}
    is_author = row["author_user_id"] == current_user.id
    is_assignee = row["primary_assignee_user_id"] == current_user.id
    can_read = privileged or is_author or is_assignee or bool(participant_roles)
    can_edit = privileged or is_author or is_assignee or "co_assignee" in participant_roles
    can_manage = privileged or is_author
    if not can_read:
        raise WorkspaceRepositoryError(404, "Task was not found")
    if manage and not can_manage:
        raise WorkspaceRepositoryError(403, "Task participants cannot be managed by this user")
    if edit and not can_edit:
        raise WorkspaceRepositoryError(403, "Task cannot be changed by this user")
    return row


async def _active_user_id(connection: AsyncConnection, value: str) -> UUID:
    try:
        user_id = UUID(value)
    except ValueError as error:
        raise WorkspaceRepositoryError(422, "Invalid user identifier") from error
    exists = await connection.scalar(
        select(func.count()).select_from(users).where(
            users.c.id == user_id,
            users.c.status == "active",
        )
    )
    if not exists:
        raise WorkspaceRepositoryError(422, "User is not active")
    return user_id


async def create_task(
    connection: AsyncConnection,
    current_user: AuthenticatedUser,
    payload: CreateTaskRequest,
) -> TaskResponse:
    try:
        assignee_id = UUID(payload.assignee_id) if payload.assignee_id else current_user.id
        source_message_id = UUID(payload.source_message_id) if payload.source_message_id else None
    except ValueError as error:
        raise WorkspaceRepositoryError(422, "Invalid linked object identifier") from error
    assignee_exists = await connection.scalar(
        select(func.count()).select_from(users).where(
            users.c.id == assignee_id,
            users.c.status == "active",
        )
    )
    if not assignee_exists:
        raise WorkspaceRepositoryError(422, "Assignee is not active")
    if source_message_id is not None:
        message_exists = await connection.scalar(
            select(func.count())
            .select_from(messages.join(chat_members, chat_members.c.chat_id == messages.c.chat_id))
            .where(
                messages.c.id == source_message_id,
                messages.c.deleted_at.is_(None),
                chat_members.c.user_id == current_user.id,
            )
        )
        if not message_exists:
            raise WorkspaceRepositoryError(422, "Source message is not accessible")
    task_id = uuid4()
    now = datetime.now(UTC)
    values = {
        "id": task_id,
        "title": payload.title.strip(),
        "description": payload.description,
        "status": "new",
        "priority": payload.priority,
        "author_user_id": current_user.id,
        "primary_assignee_user_id": assignee_id,
        "cycle_id": None,
        "cycle_occurrence_key": None,
        "project_key": payload.project,
        "starts_at": now,
        "due_at": payload.due_at,
        "result_text": None,
        "source_message_id": source_message_id,
        "created_at": now,
        "updated_at": now,
    }
    await connection.execute(insert(tasks).values(**values))
    return _task(values)


async def update_task(
    connection: AsyncConnection,
    current_user: AuthenticatedUser,
    task_id: UUID,
    payload: UpdateTaskRequest,
) -> TaskResponse:
    await _task_access_row(connection, current_user, task_id, edit=True)
    assignee_id = await _active_user_id(connection, payload.assignee_id)
    now = datetime.now(UTC)
    await connection.execute(
        update(tasks)
        .where(tasks.c.id == task_id)
        .values(
            title=payload.title,
            description=payload.description,
            project_key=payload.project,
            primary_assignee_user_id=assignee_id,
            priority=payload.priority,
            due_at=payload.due_at,
            updated_at=now,
        )
    )
    await connection.execute(
        delete(task_participants).where(
            task_participants.c.task_id == task_id,
            task_participants.c.user_id == assignee_id,
        )
    )
    return await _task_response(connection, task_id)


async def change_task_status(
    connection: AsyncConnection,
    current_user: AuthenticatedUser,
    task_id: UUID,
    payload: ChangeTaskStatusRequest,
) -> TaskResponse:
    await _task_access_row(connection, current_user, task_id, edit=True)
    if payload.status == "completed":
        incomplete_blockers = await connection.scalar(
            select(func.count())
            .select_from(
                task_dependencies.join(
                    tasks,
                    tasks.c.id == task_dependencies.c.depends_on_task_id,
                )
            )
            .where(
                task_dependencies.c.task_id == task_id,
                task_dependencies.c.dependency_kind == "blocks",
                tasks.c.status != "completed",
            )
        )
        if incomplete_blockers:
            raise WorkspaceRepositoryError(
                409,
                "Task cannot be completed until its blocking dependencies are completed",
            )
    updated_at = datetime.now(UTC)
    await connection.execute(
        update(tasks)
        .where(tasks.c.id == task_id)
        .values(status=payload.status, updated_at=updated_at)
    )
    return await _task_response(connection, task_id)


async def set_task_participant(
    connection: AsyncConnection,
    current_user: AuthenticatedUser,
    task_id: UUID,
    payload: TaskParticipantRequest,
) -> TaskResponse:
    task_row = await _task_access_row(connection, current_user, task_id, manage=True)
    user_id = await _active_user_id(connection, payload.user_id)
    if user_id == task_row["primary_assignee_user_id"]:
        raise WorkspaceRepositoryError(409, "The primary assignee is already a task participant")
    await connection.execute(
        delete(task_participants).where(
            task_participants.c.task_id == task_id,
            task_participants.c.user_id == user_id,
        )
    )
    await connection.execute(
        insert(task_participants).values(
            task_id=task_id,
            user_id=user_id,
            participant_role=payload.role,
        )
    )
    return await _task_response(connection, task_id)


async def remove_task_participant(
    connection: AsyncConnection,
    current_user: AuthenticatedUser,
    task_id: UUID,
    user_id: UUID,
) -> TaskResponse:
    await _task_access_row(connection, current_user, task_id, manage=True)
    await connection.execute(
        delete(task_participants).where(
            task_participants.c.task_id == task_id,
            task_participants.c.user_id == user_id,
        )
    )
    return await _task_response(connection, task_id)


async def add_task_checklist_item(
    connection: AsyncConnection,
    current_user: AuthenticatedUser,
    task_id: UUID,
    payload: CreateChecklistItemRequest,
) -> TaskResponse:
    await _task_access_row(connection, current_user, task_id, edit=True)
    current_max = await connection.scalar(
        select(func.max(task_checklist_items.c.sort_order)).where(
            task_checklist_items.c.task_id == task_id
        )
    )
    now = datetime.now(UTC)
    await connection.execute(
        insert(task_checklist_items).values(
            id=uuid4(),
            task_id=task_id,
            title=payload.title,
            is_completed=False,
            sort_order=int(current_max or 0) + 1,
            created_by_user_id=current_user.id,
            completed_by_user_id=None,
            completed_at=None,
            created_at=now,
            updated_at=now,
        )
    )
    return await _task_response(connection, task_id)


async def update_task_checklist_item(
    connection: AsyncConnection,
    current_user: AuthenticatedUser,
    task_id: UUID,
    item_id: UUID,
    payload: UpdateChecklistItemRequest,
) -> TaskResponse:
    await _task_access_row(connection, current_user, task_id, edit=True)
    exists = await connection.scalar(
        select(func.count()).select_from(task_checklist_items).where(
            task_checklist_items.c.id == item_id,
            task_checklist_items.c.task_id == task_id,
        )
    )
    if not exists:
        raise WorkspaceRepositoryError(404, "Checklist item was not found")
    now = datetime.now(UTC)
    await connection.execute(
        update(task_checklist_items)
        .where(task_checklist_items.c.id == item_id)
        .values(
            is_completed=payload.is_completed,
            completed_by_user_id=current_user.id if payload.is_completed else None,
            completed_at=now if payload.is_completed else None,
            updated_at=now,
        )
    )
    return await _task_response(connection, task_id)


async def delete_task_checklist_item(
    connection: AsyncConnection,
    current_user: AuthenticatedUser,
    task_id: UUID,
    item_id: UUID,
) -> TaskResponse:
    await _task_access_row(connection, current_user, task_id, edit=True)
    await connection.execute(
        delete(task_checklist_items).where(
            task_checklist_items.c.id == item_id,
            task_checklist_items.c.task_id == task_id,
        )
    )
    return await _task_response(connection, task_id)


async def add_task_comment(
    connection: AsyncConnection,
    current_user: AuthenticatedUser,
    task_id: UUID,
    payload: CreateTaskCommentRequest,
) -> TaskResponse:
    await _task_access_row(connection, current_user, task_id)
    now = datetime.now(UTC)
    await connection.execute(
        insert(task_comments).values(
            id=uuid4(),
            task_id=task_id,
            author_user_id=current_user.id,
            body=payload.body,
            created_at=now,
            edited_at=None,
        )
    )
    return await _task_response(connection, task_id)


async def _would_create_dependency_cycle(
    connection: AsyncConnection,
    task_id: UUID,
    depends_on_task_id: UUID,
) -> bool:
    rows = (
        await connection.execute(
            select(
                task_dependencies.c.task_id,
                task_dependencies.c.depends_on_task_id,
            ).where(task_dependencies.c.dependency_kind == "blocks")
        )
    ).all()
    graph: dict[UUID, list[UUID]] = {}
    for source, target in rows:
        graph.setdefault(source, []).append(target)
    pending = [depends_on_task_id]
    visited: set[UUID] = set()
    while pending:
        current = pending.pop()
        if current == task_id:
            return True
        if current in visited:
            continue
        visited.add(current)
        pending.extend(graph.get(current, []))
    return False


async def set_task_dependency(
    connection: AsyncConnection,
    current_user: AuthenticatedUser,
    task_id: UUID,
    payload: TaskDependencyRequest,
) -> TaskResponse:
    await _task_access_row(connection, current_user, task_id, edit=True)
    try:
        depends_on_task_id = UUID(payload.depends_on_task_id)
    except ValueError as error:
        raise WorkspaceRepositoryError(422, "Invalid dependency task identifier") from error
    if depends_on_task_id == task_id:
        raise WorkspaceRepositoryError(422, "A task cannot depend on itself")
    await _task_access_row(connection, current_user, depends_on_task_id)
    if payload.dependency_kind == "blocks" and await _would_create_dependency_cycle(
        connection, task_id, depends_on_task_id
    ):
        raise WorkspaceRepositoryError(409, "This dependency would create a cycle")
    await connection.execute(
        delete(task_dependencies).where(
            task_dependencies.c.task_id == task_id,
            task_dependencies.c.depends_on_task_id == depends_on_task_id,
        )
    )
    await connection.execute(
        insert(task_dependencies).values(
            task_id=task_id,
            depends_on_task_id=depends_on_task_id,
            dependency_kind=payload.dependency_kind,
            created_by_user_id=current_user.id,
            created_at=datetime.now(UTC),
        )
    )
    return await _task_response(connection, task_id)


async def remove_task_dependency(
    connection: AsyncConnection,
    current_user: AuthenticatedUser,
    task_id: UUID,
    depends_on_task_id: UUID,
) -> TaskResponse:
    await _task_access_row(connection, current_user, task_id, edit=True)
    await connection.execute(
        delete(task_dependencies).where(
            task_dependencies.c.task_id == task_id,
            task_dependencies.c.depends_on_task_id == depends_on_task_id,
        )
    )
    return await _task_response(connection, task_id)


def _advance_cycle_time(value: datetime, schedule_kind: str, interval: int) -> datetime:
    if schedule_kind == "daily":
        return value + timedelta(days=interval)
    if schedule_kind == "weekly":
        return value + timedelta(weeks=interval)
    month_index = value.month - 1 + interval
    year = value.year + month_index // 12
    month = month_index % 12 + 1
    day = min(value.day, monthrange(year, month)[1])
    return value.replace(year=year, month=month, day=day)


async def set_task_cycle(
    connection: AsyncConnection,
    current_user: AuthenticatedUser,
    task_id: UUID,
    payload: TaskCycleRequest,
) -> TaskResponse:
    task_row = await _task_access_row(connection, current_user, task_id, edit=True)
    now = datetime.now(UTC)
    next_run_at = payload.next_run_at or _advance_cycle_time(
        now, payload.schedule_kind, payload.interval
    )
    cycle_id = task_row["cycle_id"] or uuid4()
    values = {
        "title": payload.title,
        "schedule_kind": payload.schedule_kind,
        "schedule_config": {"interval": payload.interval},
        "timezone": payload.timezone,
        "next_run_at": next_run_at,
        "is_enabled": payload.is_enabled,
        "updated_at": now,
    }
    if task_row["cycle_id"] is None:
        await connection.execute(
            insert(task_cycles).values(
                id=cycle_id,
                created_by_user_id=current_user.id,
                created_at=now,
                **values,
            )
        )
        await connection.execute(
            update(tasks)
            .where(tasks.c.id == task_id)
            .values(cycle_id=cycle_id, cycle_occurrence_key="initial", updated_at=now)
        )
    else:
        await connection.execute(
            update(task_cycles).where(task_cycles.c.id == cycle_id).values(**values)
        )
    return await _task_response(connection, task_id)


async def materialize_due_task_cycles(
    connection: AsyncConnection,
    now: datetime | None = None,
) -> int:
    current_time = now or datetime.now(UTC)
    cycle_rows = (
        await connection.execute(
            select(task_cycles)
            .where(
                task_cycles.c.is_enabled.is_(True),
                task_cycles.c.next_run_at.is_not(None),
                task_cycles.c.next_run_at <= current_time,
            )
            .order_by(task_cycles.c.next_run_at)
            .with_for_update(skip_locked=True)
        )
    ).mappings().all()
    created = 0
    for cycle in cycle_rows:
        scheduled_at = cycle["next_run_at"]
        interval = int((cycle["schedule_config"] or {}).get("interval", 1))
        next_run_at = _advance_cycle_time(scheduled_at, cycle["schedule_kind"], interval)
        template = (
            await connection.execute(
                select(tasks)
                .where(tasks.c.cycle_id == cycle["id"])
                .order_by(tasks.c.created_at.desc())
                .limit(1)
            )
        ).mappings().first()
        occurrence_key = scheduled_at.isoformat()
        exists = await connection.scalar(
            select(func.count()).select_from(tasks).where(
                tasks.c.cycle_id == cycle["id"],
                tasks.c.cycle_occurrence_key == occurrence_key,
            )
        )
        if template is not None and not exists:
            task_id = uuid4()
            duration = (
                template["due_at"] - template["starts_at"]
                if template["due_at"] is not None and template["starts_at"] is not None
                else None
            )
            await connection.execute(
                insert(tasks).values(
                    id=task_id,
                    title=cycle["title"],
                    description=template["description"],
                    status="new",
                    priority=template["priority"],
                    author_user_id=cycle["created_by_user_id"],
                    primary_assignee_user_id=template["primary_assignee_user_id"],
                    cycle_id=cycle["id"],
                    cycle_occurrence_key=occurrence_key,
                    project_key=template["project_key"],
                    starts_at=scheduled_at,
                    due_at=scheduled_at + duration if duration is not None else None,
                    result_text=None,
                    source_message_id=None,
                    created_at=current_time,
                    updated_at=current_time,
                )
            )
            participant_rows = (
                await connection.execute(
                    select(task_participants).where(
                        task_participants.c.task_id == template["id"]
                    )
                )
            ).mappings().all()
            if participant_rows:
                await connection.execute(
                    insert(task_participants),
                    [
                        {
                            "task_id": task_id,
                            "user_id": row["user_id"],
                            "participant_role": row["participant_role"],
                        }
                        for row in participant_rows
                    ],
                )
            checklist_rows = (
                await connection.execute(
                    select(task_checklist_items).where(
                        task_checklist_items.c.task_id == template["id"]
                    )
                )
            ).mappings().all()
            if checklist_rows:
                await connection.execute(
                    insert(task_checklist_items),
                    [
                        {
                            "id": uuid4(),
                            "task_id": task_id,
                            "title": row["title"],
                            "is_completed": False,
                            "sort_order": row["sort_order"],
                            "created_by_user_id": cycle["created_by_user_id"],
                            "completed_by_user_id": None,
                            "completed_at": None,
                            "created_at": current_time,
                            "updated_at": current_time,
                        }
                        for row in checklist_rows
                    ],
                )
            created += 1
        await connection.execute(
            update(task_cycles)
            .where(task_cycles.c.id == cycle["id"])
            .values(next_run_at=next_run_at, updated_at=current_time)
        )
    return created


def _validate_graph(payload: SaveWorkflowRequest) -> None:
    node_ids = [node.id for node in payload.nodes]
    if len(node_ids) != len(set(node_ids)):
        raise WorkspaceRepositoryError(422, "Workflow node identifiers must be unique")
    starts = [node.id for node in payload.nodes if node.kind == "start"]
    ends = [node.id for node in payload.nodes if node.kind == "end"]
    if len(starts) != 1 or not ends:
        raise WorkspaceRepositoryError(422, "Workflow needs exactly one start and at least one end")
    node_set = set(node_ids)
    if any(edge.source not in node_set or edge.target not in node_set for edge in payload.edges):
        raise WorkspaceRepositoryError(422, "Every workflow edge must reference existing nodes")
    adjacency: dict[str, list[str]] = {node_id: [] for node_id in node_ids}
    for edge in payload.edges:
        adjacency[edge.source].append(edge.target)
    reachable: set[str] = set()
    pending = [starts[0]]
    while pending:
        node_id = pending.pop()
        if node_id in reachable:
            continue
        reachable.add(node_id)
        pending.extend(adjacency[node_id])
    if reachable != node_set:
        raise WorkspaceRepositoryError(422, "Every workflow node must be reachable from start")


async def save_workflow(
    connection: AsyncConnection,
    current_user: AuthenticatedUser,
    template_id: UUID,
    payload: SaveWorkflowRequest,
) -> WorkflowResponse:
    if current_user.role not in {"manager", "admin", "superadmin"}:
        raise WorkspaceRepositoryError(403, "Only managers can edit workflows")
    _validate_graph(payload)
    template = (
        await connection.execute(
            select(approval_templates)
            .where(approval_templates.c.id == template_id)
            .with_for_update()
        )
    ).mappings().first()
    if template is None:
        raise WorkspaceRepositoryError(404, "Workflow was not found")
    if template["status"] != "draft":
        raise WorkspaceRepositoryError(409, "Published workflow versions cannot be edited")
    await connection.execute(
        delete(approval_edges).where(approval_edges.c.template_id == template_id)
    )
    await connection.execute(
        delete(approval_nodes).where(approval_nodes.c.template_id == template_id)
    )
    await connection.execute(
        insert(approval_nodes),
        [
            {
                "id": uuid4(),
                "template_id": template_id,
                "node_key": node.id,
                "kind": node.kind,
                "title": node.label,
                "config": {**node.config, "detail": node.detail},
                "position_x": node.position_x,
                "position_y": node.position_y,
            }
            for node in payload.nodes
        ],
    )
    await connection.execute(
        insert(approval_edges),
        [
            {
                "id": uuid4(),
                "template_id": template_id,
                "source_node_key": edge.source,
                "target_node_key": edge.target,
                "outcome": edge.outcome,
                "label": edge.label,
                "condition": edge.condition,
                "sort_order": edge.sort_order,
            }
            for edge in payload.edges
        ],
    )
    return await get_workflow(connection)


async def create_approval_request(
    connection: AsyncConnection,
    current_user: AuthenticatedUser,
    payload: CreateApprovalRequest,
) -> ApprovalRequestResponse:
    workflow = await get_workflow(connection)
    try:
        source_task_id = UUID(payload.source_task_id) if payload.source_task_id else None
    except ValueError as error:
        raise WorkspaceRepositoryError(422, "Invalid source task identifier") from error
    if source_task_id is not None:
        source_task = (
            await connection.execute(select(tasks).where(tasks.c.id == source_task_id))
        ).mappings().first()
        task_accessible = source_task is not None and (
            current_user.role in {"manager", "admin", "superadmin"}
            or source_task["author_user_id"] == current_user.id
            or source_task["primary_assignee_user_id"] == current_user.id
        )
        if not task_accessible:
            raise WorkspaceRepositoryError(422, "Source task is not accessible")
    first_edge = next((edge for edge in workflow.edges if edge.source == "start"), None)
    if first_edge is None:
        raise WorkspaceRepositoryError(409, "Workflow start is not connected")
    request_id = uuid4()
    now = datetime.now(UTC)
    number = str(int(now.timestamp() * 1000))[-6:]
    values = {
        "id": request_id,
        "template_id": UUID(workflow.id),
        "requester_user_id": current_user.id,
        "title": payload.title.strip(),
        "payload": {
            "amount": payload.amount,
            "currency": payload.currency.upper(),
            "purpose": payload.purpose,
            "number": number,
        },
        "status": "running",
        "active_node_keys": [first_edge.target],
        "source_task_id": source_task_id,
        "current_version": 1,
        "created_at": now,
        "updated_at": now,
        "finished_at": None,
    }
    await connection.execute(insert(approval_requests).values(**values))
    version_values = {
        "id": uuid4(),
        "request_id": request_id,
        "version": 1,
        "title": values["title"],
        "payload": values["payload"],
        "attachment_ids": [],
        "edited_by_user_id": current_user.id,
        "change_reason": "initial",
        "change_comment": None,
        "created_at": now,
    }
    await connection.execute(insert(approval_request_versions).values(**version_values))
    return _approval_request(values, [_approval_version(version_values)])


async def _attachment_ids_for_request(
    connection: AsyncConnection,
    request_id: UUID,
) -> list[str]:
    values = (
        await connection.execute(
            select(attachments.c.id)
            .where(
                attachments.c.owner_type == "approval_request",
                attachments.c.owner_id == request_id,
            )
            .order_by(attachments.c.created_at)
        )
    ).scalars().all()
    return [str(value) for value in values]


async def _append_request_version(
    connection: AsyncConnection,
    request_row: Record,
    editor_id: UUID,
    *,
    title: str,
    payload: Mapping[str, Any],
    change_reason: str,
    change_comment: str | None,
) -> int:
    request_id = request_row["id"]
    next_version = int(request_row.get("current_version", 1)) + 1
    now = datetime.now(UTC)
    await connection.execute(
        insert(approval_request_versions).values(
            id=uuid4(),
            request_id=request_id,
            version=next_version,
            title=title,
            payload=dict(payload),
            attachment_ids=await _attachment_ids_for_request(connection, request_id),
            edited_by_user_id=editor_id,
            change_reason=change_reason,
            change_comment=change_comment,
            created_at=now,
        )
    )
    await connection.execute(
        update(approval_requests)
        .where(approval_requests.c.id == request_id)
        .values(current_version=next_version, updated_at=now)
    )
    return next_version


async def update_approval_request(
    connection: AsyncConnection,
    current_user: AuthenticatedUser,
    request_id: UUID,
    payload: UpdateApprovalRequest,
) -> ApprovalRequestResponse:
    row = (
        await connection.execute(
            select(approval_requests)
            .where(approval_requests.c.id == request_id)
            .with_for_update()
        )
    ).mappings().first()
    if row is None:
        raise WorkspaceRepositoryError(404, "Request was not found")
    if row["requester_user_id"] != current_user.id:
        raise WorkspaceRepositoryError(403, "Only the requester can edit this request")
    if row["status"] != "needs_revision":
        raise WorkspaceRepositoryError(409, "Only a returned request can be edited")

    updated_payload = {
        **(row["payload"] or {}),
        "amount": payload.amount,
        "currency": payload.currency.upper(),
        "purpose": payload.purpose,
    }
    title = payload.title.strip()
    next_version = await _append_request_version(
        connection,
        row,
        current_user.id,
        title=title,
        payload=updated_payload,
        change_reason="correction",
        change_comment=payload.change_comment,
    )
    await connection.execute(
        update(approval_requests)
        .where(approval_requests.c.id == request_id)
        .values(title=title, payload=updated_payload, current_version=next_version)
    )
    return await _request_response(connection, request_id)


async def validate_attachment_owner(
    connection: AsyncConnection,
    current_user: AuthenticatedUser,
    owner_type: AttachmentOwnerType,
    owner_id: UUID,
    *,
    write: bool,
) -> None:
    if owner_type == "message":
        row = (
            await connection.execute(
                select(messages.c.author_user_id, chat_members.c.user_id)
                .select_from(
                    messages.join(chat_members, chat_members.c.chat_id == messages.c.chat_id)
                )
                .where(
                    messages.c.id == owner_id,
                    messages.c.deleted_at.is_(None),
                    chat_members.c.user_id == current_user.id,
                )
            )
        ).mappings().first()
        if row is None or (write and row["author_user_id"] != current_user.id):
            raise WorkspaceRepositoryError(404, "Message was not found")
        return

    if owner_type == "task":
        await _task_access_row(connection, current_user, owner_id, edit=write)
        return

    row = (
        await connection.execute(
            select(approval_requests).where(approval_requests.c.id == owner_id)
        )
    ).mappings().first()
    accessible = row is not None and (
        current_user.role in {"manager", "admin", "superadmin"}
        or row["requester_user_id"] == current_user.id
    )
    writable = (
        row is not None
        and row["requester_user_id"] == current_user.id
        and row["status"] in {"running", "needs_revision"}
    )
    if not accessible or (write and not writable):
        raise WorkspaceRepositoryError(404, "Approval request was not found")


async def create_attachment(
    connection: AsyncConnection,
    current_user: AuthenticatedUser,
    owner_type: AttachmentOwnerType,
    owner_id: UUID,
    *,
    file_name: str,
    content_type: str,
    byte_size: int,
    sha256: str,
    storage_key: str,
) -> AttachmentResponse:
    await validate_attachment_owner(connection, current_user, owner_type, owner_id, write=True)
    now = datetime.now(UTC)
    values = {
        "id": uuid4(),
        "owner_type": owner_type,
        "owner_id": owner_id,
        "file_name": file_name,
        "content_type": content_type,
        "byte_size": byte_size,
        "sha256": sha256,
        "storage_key": storage_key,
        "uploaded_by_user_id": current_user.id,
        "created_at": now,
    }
    await connection.execute(insert(attachments).values(**values))
    if owner_type == "approval_request":
        request_row = (
            await connection.execute(
                select(approval_requests)
                .where(approval_requests.c.id == owner_id)
                .with_for_update()
            )
        ).mappings().one()
        await _append_request_version(
            connection,
            request_row,
            current_user.id,
            title=request_row["title"],
            payload=request_row["payload"] or {},
            change_reason="attachment_added",
            change_comment=file_name,
        )
    return _attachment(values)


async def get_attachment(
    connection: AsyncConnection,
    current_user: AuthenticatedUser,
    attachment_id: UUID,
) -> tuple[AttachmentResponse, str]:
    row = (
        await connection.execute(select(attachments).where(attachments.c.id == attachment_id))
    ).mappings().first()
    if row is None:
        raise WorkspaceRepositoryError(404, "Attachment was not found")
    await validate_attachment_owner(
        connection,
        current_user,
        row["owner_type"],
        row["owner_id"],
        write=False,
    )
    return _attachment(row), row["storage_key"]


def _condition_outcome(condition: Mapping[str, Any], request_payload: Mapping[str, Any]) -> bool:
    field = str(condition.get("field", ""))
    operator = condition.get("operator")
    expected = condition.get("value")
    actual = request_payload.get(field)
    if not isinstance(actual, (int, float)) or not isinstance(expected, (int, float)):
        return False
    if operator == "gt":
        return actual > expected
    if operator == "gte":
        return actual >= expected
    if operator == "lt":
        return actual < expected
    if operator == "lte":
        return actual <= expected
    return actual == expected


async def _next_node(
    connection: AsyncConnection,
    template_id: UUID,
    source: str,
    outcome: str,
    request_payload: Mapping[str, Any],
) -> tuple[str | None, str | None]:
    edges = (
        (
            await connection.execute(
                select(approval_edges)
                .where(
                    approval_edges.c.template_id == template_id,
                    approval_edges.c.source_node_key == source,
                    approval_edges.c.outcome == outcome,
                )
                .order_by(approval_edges.c.sort_order)
            )
        )
        .mappings()
        .all()
    )
    if not edges:
        if outcome != "return":
            return None, None
        correction = (
            await connection.execute(
                select(approval_nodes.c.node_key)
                .where(
                    approval_nodes.c.template_id == template_id,
                    approval_nodes.c.kind == "correction",
                )
                .limit(1)
            )
        ).scalar_one_or_none()
        return (correction, "correction") if correction is not None else (None, None)
    target = edges[0]["target_node_key"]
    target_kind = await connection.scalar(
        select(approval_nodes.c.kind).where(
            approval_nodes.c.template_id == template_id,
            approval_nodes.c.node_key == target,
        )
    )
    if target_kind != "condition":
        return target, target_kind
    condition_edges = (
        (
            await connection.execute(
                select(approval_edges)
                .where(
                    approval_edges.c.template_id == template_id,
                    approval_edges.c.source_node_key == target,
                )
                .order_by(approval_edges.c.sort_order)
            )
        )
        .mappings()
        .all()
    )
    chosen = next(
        (
            edge
            for edge in condition_edges
            if _condition_outcome(edge["condition"] or {}, request_payload)
        ),
        None,
    )
    if chosen is None:
        return None, None
    final_target = chosen["target_node_key"]
    final_kind = await connection.scalar(
        select(approval_nodes.c.kind).where(
            approval_nodes.c.template_id == template_id,
            approval_nodes.c.node_key == final_target,
        )
    )
    return final_target, final_kind


async def act_on_request(
    connection: AsyncConnection,
    current_user: AuthenticatedUser,
    request_id: UUID,
    payload: ApprovalActionRequest,
) -> ApprovalRequestResponse:
    row = (
        await connection.execute(
            select(approval_requests)
            .where(approval_requests.c.id == request_id)
            .with_for_update()
        )
    ).mappings().first()
    if row is None:
        raise WorkspaceRepositoryError(404, "Request was not found")
    if row["status"] not in {"running", "needs_revision"}:
        raise WorkspaceRepositoryError(409, "Request is already finished")
    if payload.action == "return" and not (payload.comment or "").strip():
        raise WorkspaceRepositoryError(422, "A return comment is required")
    resubmitting = payload.action == "resubmit"
    if resubmitting:
        if row["status"] != "needs_revision" or row["requester_user_id"] != current_user.id:
            raise WorkspaceRepositoryError(403, "Only the requester can resubmit a correction")
    elif current_user.role not in {"manager", "admin", "superadmin"}:
        raise WorkspaceRepositoryError(403, "Only managers can decide on requests")
    active_nodes: Sequence[str] = row["active_node_keys"] or []
    if not active_nodes:
        raise WorkspaceRepositoryError(409, "Request has no active workflow node")
    active_node = active_nodes[0]
    now = datetime.now(UTC)
    await connection.execute(
        insert(approval_actions).values(
            id=uuid4(),
            request_id=request_id,
            node_key=active_node,
            actor_user_id=current_user.id,
            action=payload.action,
            comment=payload.comment,
            created_at=now,
        )
    )
    status = row["status"]
    finished_at = None
    next_nodes = list(active_nodes)
    if payload.action == "reject":
        status = "rejected"
        next_nodes = []
        finished_at = now
    elif payload.action in {"clarify", "delegate"}:
        pass
    else:
        outcome = (
            "resubmit"
            if payload.action == "resubmit"
            else "return"
            if payload.action == "return"
            else "approve"
        )
        target, target_kind = await _next_node(
            connection,
            row["template_id"],
            active_node,
            outcome,
            row["payload"] or {},
        )
        if target is None:
            raise WorkspaceRepositoryError(409, f"No route for action {payload.action}")
        if target_kind == "start":
            target, target_kind = await _next_node(
                connection,
                row["template_id"],
                target,
                "submit",
                row["payload"] or {},
            )
            if target is None:
                raise WorkspaceRepositoryError(409, "Workflow start is not connected")
        if target_kind == "end":
            status = "approved"
            next_nodes = []
            finished_at = now
        else:
            status = "needs_revision" if target_kind == "correction" else "running"
            next_nodes = [target]
    await connection.execute(
        update(approval_requests)
        .where(approval_requests.c.id == request_id)
        .values(
            status=status,
            active_node_keys=next_nodes,
            updated_at=now,
            finished_at=finished_at,
        )
    )
    return await _request_response(connection, request_id)
