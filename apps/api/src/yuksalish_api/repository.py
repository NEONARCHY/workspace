from calendar import monthrange
from collections.abc import Mapping, Sequence
from datetime import UTC, datetime, timedelta
from typing import Any, Literal, cast
from uuid import UUID, uuid4
from zoneinfo import ZoneInfo

from sqlalchemy import and_, delete, func, insert, or_, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.engine import RowMapping
from sqlalchemy.ext.asyncio import AsyncConnection

from . import messenger_service
from .absence_service import presence_summary, visible_absences
from .access_control import ModuleAction, module_permissions_for_user
from .auth import AuthenticatedUser
from .efficiency_service import METHODOLOGY_VERSION, record_task_event
from .errors import WorkspaceRepositoryError as WorkspaceRepositoryError
from .personal_preferences import get_preferences as get_personal_preferences
from .tables import (
    absence_requests,
    approval_actions,
    approval_deadline_events,
    approval_edges,
    approval_nodes,
    approval_request_versions,
    approval_requests,
    approval_templates,
    attachments,
    audit_events,
    calendar_event_attendees,
    calendar_events,
    chat_members,
    chats,
    feed_comments,
    feed_posts,
    feed_reactions,
    message_receipts,
    messages,
    positions,
    project_stage_actions,
    task_checklist_items,
    task_comments,
    task_cycles,
    task_dependencies,
    task_efficiency_events,
    task_participants,
    tasks,
    trip_request_actions,
    trip_request_employees,
    trip_requests,
    users,
    workspace_notification_preferences,
    workspace_notifications,
    workspace_projects,
)
from .workspace_schemas import (
    ApprovalActionHistoryResponse,
    ApprovalActionRequest,
    ApprovalDeadlineControlResponse,
    ApprovalDeadlineEventResponse,
    ApprovalRequestResponse,
    ApprovalRequestVersionResponse,
    ApprovalStageResponse,
    AttachmentOwnerType,
    AttachmentResponse,
    CalendarEventResponse,
    ChangeProjectStageRequest,
    ChangeTaskStatusRequest,
    ChatMessageResponse,
    ChatPermissions,
    CreateApprovalRequest,
    CreateCalendarEventRequest,
    CreateChecklistItemRequest,
    CreateFeedCommentRequest,
    CreateFeedPostRequest,
    CreateProjectRequest,
    CreateTaskCommentRequest,
    CreateTaskRequest,
    CreateTripRequest,
    EffectiveModuleAccessResponse,
    FeedCommentResponse,
    FeedPostResponse,
    ModulePermissionSet,
    NotificationPreferencesResponse,
    NotificationPreferencesUpdate,
    NotificationResponse,
    PaymentRequestDetails,
    PersonResponse,
    PinFeedPostRequest,
    ProjectResponse,
    ProjectStageActionResponse,
    ReturnTaskForRevisionRequest,
    SaveWorkflowRequest,
    SendMessageRequest,
    SubmitTaskResultRequest,
    TaskChecklistItemResponse,
    TaskCommentResponse,
    TaskCreateCycleRequest,
    TaskCycleRequest,
    TaskCycleResponse,
    TaskDependencyRequest,
    TaskDependencyResponse,
    TaskEfficiencyExclusionRequest,
    TaskParticipantRequest,
    TaskParticipantResponse,
    TaskResponse,
    TaskReturnResponse,
    TripAction,
    TripActionHistoryResponse,
    TripActionRequest,
    TripRequestResponse,
    UpdateApprovalRequest,
    UpdateCalendarEventRequest,
    UpdateChecklistItemRequest,
    UpdateProjectRequest,
    UpdateTaskRequest,
    UpdateTripRequest,
    WorkflowEdgeResponse,
    WorkflowNodeResponse,
    WorkflowPositionResponse,
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
DEFAULT_APPROVAL_REMINDER_HOURS = (24, 2)
DEFAULT_APPROVAL_ESCALATION_AFTER_HOURS = 4
PROJECT_STAGE_STATUS = {
    "start": "new",
    "preparation": "in_progress",
    "approval": "in_progress",
    "success": "completed",
    "failure": "completed",
}
PROJECT_TRANSITIONS = {
    "start": {"preparation"},
    "preparation": {"start", "approval"},
    "approval": {"preparation", "success", "failure"},
    "success": {"approval"},
    "failure": {"approval"},
}
TRIP_STAGE_LABELS = {
    "launch": "Запуск",
    "manager_approval": "Утверждение руководителем",
    "hr": "Кадровая служба",
    "approved": "Утверждено",
    "rejected": "Отклонено",
}
TRIP_STATUS_LABELS = {
    "draft": "Черновик",
    "running": "На согласовании",  # noqa: RUF001 - Russian UI label.
    "needs_revision": "На доработке",  # noqa: RUF001 - Russian UI label.
    "approved": "Утверждено",
    "rejected": "Отклонено",
}

Record = Mapping[str, Any] | RowMapping


def _initials(full_name: str) -> str:
    return "".join(part[0] for part in full_name.split()[:2]).upper()


def person_from_record(row: Record, color_index: int = 0) -> PersonResponse:
    return PersonResponse(
        id=str(row["id"]),
        username=row["username"],
        name=row["full_name"],
        initials=_initials(row["full_name"]),
        role=row["role"],
        department_id=(str(row["department_id"]) if row.get("department_id") else None),
        position_id=(str(row["position_id"]) if row.get("position_id") else None),
        job_title=row["job_title"],
        color=PERSON_COLORS[color_index % len(PERSON_COLORS)],
        avatar_version=(
            row["avatar_updated_at"].isoformat() if row.get("avatar_updated_at") else None
        ),
        # Some focused queries and test doubles predate the employment-status field.
        # Treat an omitted value as the legacy active state while preserving explicit
        # blocked/archived values for workspace people references.
        status=row.get("status", "active"),
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
        calendar_rule=config.get("calendarRule"),
        weekdays=list(config.get("weekdays", [])),
        month_days=list(config.get("monthDays", [])),
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
    parent_task_title: str | None = None,
    chat_id: UUID | None = None,
    latest_return: TaskReturnResponse | None = None,
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
        parent_task_id=(str(row["parent_task_id"]) if row.get("parent_task_id") else None),
        parent_task_title=parent_task_title,
        chat_id=str(chat_id) if chat_id else None,
        latest_return=latest_return,
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
        details=_payment_details(payload),
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
        delegated_to_user_id=(
            str(row["delegated_to_user_id"]) if row.get("delegated_to_user_id") else None
        ),
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
        document_role=row.get("document_role") or "general",
        media_kind=row.get("media_kind") or "file",
        media_duration_ms=row.get("media_duration_ms"),
        media_codec=row.get("media_codec"),
        created_at=row["created_at"],
    )


def _payment_details(
    payload: Mapping[str, Any],
    responsible_user_id: UUID | str | None = None,
) -> PaymentRequestDetails:
    return PaymentRequestDetails(
        transfer_type=payload.get("transfer_type"),
        project_name=str(payload.get("project_name", "")),
        project_code=str(payload.get("project_code", "")),
        source_account=str(payload.get("source_account", "")),
        destination_account=str(payload.get("destination_account", "")),
        request_priority=payload.get("request_priority", "normal"),
        deadline=payload.get("deadline"),
        comment=str(payload.get("comment", "")),
        trip_purpose=str(payload.get("trip_purpose", "")),
        trip_start_date=payload.get("trip_start_date"),
        trip_end_date=payload.get("trip_end_date"),
        employee_ids=[str(value) for value in payload.get("employee_ids", [])],
        payment_purpose=payload.get("payment_purpose"),
        payment_reason=str(payload.get("payment_reason", "")),
        responsible_user_id=(
            str(responsible_user_id)
            if responsible_user_id is not None
            else payload.get("responsible_user_id")
        ),
    )


def _approval_request(
    row: Record,
    versions: Sequence[ApprovalRequestVersionResponse] = (),
    actions: Sequence[ApprovalActionHistoryResponse] = (),
    active_stages: Sequence[ApprovalStageResponse] = (),
    deadline_control: ApprovalDeadlineControlResponse | None = None,
) -> ApprovalRequestResponse:
    payload = row["payload"] or {}
    status_value = str(row["status"])
    return ApprovalRequestResponse(
        id=str(row["id"]),
        workflow_id=str(row["template_id"]),
        number=str(payload.get("number", str(row["id"])[:8])),
        title=row["title"],
        amount=int(payload.get("amount", 0)),
        currency=str(payload.get("currency", "UZS")),
        status=row["status"],
        status_label=STATUS_LABELS.get(status_value, status_value),
        active_node_keys=list(row["active_node_keys"] or []),
        active_stages=list(active_stages),
        stage_label=(
            " · ".join(stage.label for stage in active_stages)
            if active_stages
            else "Выполнено"
            if status_value == "approved"
            else "Отмена"
            if status_value in {"rejected", "cancelled"}
            else STATUS_LABELS.get(status_value, status_value)
        ),
        requester_id=str(row["requester_user_id"]),
        responsible_user_id=str(row.get("responsible_user_id") or row["requester_user_id"]),
        source_task_id=(str(row["source_task_id"]) if row["source_task_id"] else None),
        purpose=str(payload.get("purpose", "")),
        details=_payment_details(
            payload,
            row.get("responsible_user_id") or row["requester_user_id"],
        ),
        created_at=row["created_at"],
        updated_at=row["updated_at"],
        revision=int(row.get("current_version", 1)),
        versions=list(versions),
        actions=list(actions),
        deadline_control=deadline_control or _approval_deadline_control(row),
    )


def _approval_deadline(row: Record) -> datetime | None:
    raw_value = (row.get("payload") or {}).get("deadline")
    if not raw_value:
        return None
    if isinstance(raw_value, datetime):
        return raw_value if raw_value.tzinfo is not None else raw_value.replace(tzinfo=UTC)
    try:
        parsed = datetime.fromisoformat(str(raw_value).replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo is not None else parsed.replace(tzinfo=UTC)


def _approval_reminder_hours(configs: Sequence[Mapping[str, Any]]) -> list[int]:
    configured: set[int] = set()
    for config in configs:
        values = config.get("reminderHoursBefore")
        if not isinstance(values, list):
            values = list(DEFAULT_APPROVAL_REMINDER_HOURS)
        for value in values:
            try:
                hour = int(value)
            except (TypeError, ValueError):
                continue
            if 1 <= hour <= 24 * 30:
                configured.add(hour)
    return sorted(configured or DEFAULT_APPROVAL_REMINDER_HOURS, reverse=True)


def _approval_escalation_hours(configs: Sequence[Mapping[str, Any]]) -> int | None:
    values: list[int] = []
    for config in configs:
        if config.get("escalationEnabled", True) is False:
            continue
        try:
            value = int(config.get("escalationAfterHours", DEFAULT_APPROVAL_ESCALATION_AFTER_HOURS))
        except (TypeError, ValueError):
            value = DEFAULT_APPROVAL_ESCALATION_AFTER_HOURS
        if 1 <= value <= 24 * 30:
            values.append(value)
    return min(values) if values else None


def _deadline_event(row: Record) -> ApprovalDeadlineEventResponse:
    return ApprovalDeadlineEventResponse(
        id=str(row["id"]),
        event_type=row["event_type"],
        recipient_user_id=str(row["recipient_user_id"]),
        recipient_role=row["recipient_role"],
        node_key=row["node_key"],
        threshold_hours=int(row["threshold_hours"]),
        deadline_at=row["deadline_at"],
        created_at=row["created_at"],
    )


def _approval_deadline_control(
    row: Record,
    configs: Sequence[Mapping[str, Any]] = (),
    events: Sequence[ApprovalDeadlineEventResponse] = (),
    *,
    now: datetime | None = None,
) -> ApprovalDeadlineControlResponse:
    current_time = now or datetime.now(UTC)
    deadline = _approval_deadline(row)
    reminder_hours = _approval_reminder_hours(configs)
    escalation_hours = _approval_escalation_hours(configs)
    if deadline is None:
        return ApprovalDeadlineControlResponse(
            status="not_set",
            reminder_hours_before=reminder_hours,
            escalation_after_hours=escalation_hours,
            events=list(events),
        )
    remaining_seconds = int((deadline - current_time).total_seconds())
    finished = row["status"] in {"approved", "rejected", "cancelled"}
    status: Literal["not_set", "on_track", "due_soon", "overdue", "finished"]
    if finished:
        status = "finished"
    elif remaining_seconds < 0:
        status = "overdue"
    elif remaining_seconds <= max(reminder_hours, default=24) * 3600:
        status = "due_soon"
    else:
        status = "on_track"
    escalation_at = (
        deadline + timedelta(hours=escalation_hours)
        if escalation_hours is not None and not finished
        else None
    )
    candidates = (
        []
        if finished
        else [
            candidate
            for candidate in [
                *(deadline - timedelta(hours=hours) for hours in reminder_hours),
                deadline,
                escalation_at,
            ]
            if candidate is not None and candidate > current_time
        ]
    )
    return ApprovalDeadlineControlResponse(
        status=status,
        remaining_seconds=remaining_seconds,
        reminder_hours_before=reminder_hours,
        escalation_after_hours=escalation_hours,
        next_event_at=min(candidates) if candidates else None,
        escalation_at=escalation_at,
        events=list(events),
    )


def _can_act_from_config(
    current_user: AuthenticatedUser,
    request_row: Record,
    node_key: str,
    config: Mapping[str, Any],
) -> bool:
    if current_user.role in {"admin", "superadmin"}:
        return True
    override = (request_row.get("actor_overrides") or {}).get(node_key)
    if override is not None:
        return str(current_user.id) == str(override)
    approver_user_id = config.get("approverUserId")
    if approver_user_id:
        return str(current_user.id) == str(approver_user_id)
    position_id = str(current_user.position_id) if current_user.position_id else None
    approver_position_ids = config.get("approverPositionIds")
    if isinstance(approver_position_ids, list):
        return position_id is not None and position_id in {
            str(value) for value in approver_position_ids
        }
    approver_position_id = config.get("approverPositionId")
    if approver_position_id:
        return position_id == str(approver_position_id)
    approver_role = config.get("approverRole", "manager")
    if approver_role == "manager":
        return current_user.role in {"manager", "admin"}
    return current_user.role == approver_role or current_user.role == "admin"


def _is_privileged(current_user: AuthenticatedUser) -> bool:
    return current_user.role in {"manager", "admin", "superadmin"}


def _project_action(row: Record) -> ProjectStageActionResponse:
    return ProjectStageActionResponse(
        id=str(row["id"]),
        actor_user_id=str(row["actor_user_id"]),
        from_stage=row["from_stage"],
        to_stage=row["to_stage"],
        action=row["action"],
        comment=row["comment"],
        created_at=row["created_at"],
    )


def _project(
    row: Record,
    current_user: AuthenticatedUser,
    history: Sequence[ProjectStageActionResponse] = (),
) -> ProjectResponse:
    can_manage = _is_privileged(current_user)
    return ProjectResponse(
        id=str(row["id"]),
        code=row["code"],
        title=row["title"],
        description=row["description"] or "",
        manager_user_id=str(row["manager_user_id"]),
        start_date=row["start_date"],
        end_date=row["end_date"],
        budget=int(row["budget"]),
        spent_budget=int(row["spent_budget"]),
        remaining_budget=int(row["budget"]) - int(row["spent_budget"]),
        currency=row["currency"],
        status=row["status"],
        stage=row["stage"],
        created_by_user_id=str(row["created_by_user_id"]),
        created_at=row["created_at"],
        updated_at=row["updated_at"],
        can_edit=can_manage,
        can_move=can_manage,
        history=list(history),
    )


def _trip_action(row: Record) -> TripActionHistoryResponse:
    return TripActionHistoryResponse(
        id=str(row["id"]),
        actor_user_id=str(row["actor_user_id"]),
        from_stage=row["from_stage"],
        to_stage=row["to_stage"],
        action=row["action"],
        comment=row["comment"],
        created_at=row["created_at"],
    )


def _trip_allowed_actions(row: Record, current_user: AuthenticatedUser) -> list[TripAction]:
    stage = row["stage"]
    status = row["status"]
    if stage == "launch" and row["requester_user_id"] == current_user.id:
        return ["resubmit"] if status == "needs_revision" else ["submit"]
    if stage == "manager_approval" and _is_privileged(current_user):
        return ["approve", "return", "reject"]
    if stage == "hr" and current_user.role in {"admin", "superadmin"}:
        return ["approve", "return", "reject"]
    return []


def _trip_request(
    row: Record,
    current_user: AuthenticatedUser,
    employee_ids: Sequence[UUID] = (),
    actions: Sequence[TripActionHistoryResponse] = (),
) -> TripRequestResponse:
    return TripRequestResponse(
        id=str(row["id"]),
        number=f"TR-{str(row['id']).replace('-', '')[:8].upper()}",
        requester_user_id=str(row["requester_user_id"]),
        purpose=row["purpose"],
        destination=row["destination"],
        start_date=row["start_date"],
        end_date=row["end_date"],
        employee_ids=[str(value) for value in employee_ids],
        stage=row["stage"],
        stage_label=TRIP_STAGE_LABELS[row["stage"]],
        status=row["status"],
        status_label=TRIP_STATUS_LABELS[row["status"]],
        can_edit=(
            row["requester_user_id"] == current_user.id
            and row["status"] in {"draft", "needs_revision"}
        ),
        allowed_actions=_trip_allowed_actions(row, current_user),
        actions=list(actions),
        created_at=row["created_at"],
        updated_at=row["updated_at"],
        finished_at=row["finished_at"],
    )


async def _project_action_map(
    connection: AsyncConnection,
    project_ids: Sequence[UUID],
) -> dict[UUID, list[ProjectStageActionResponse]]:
    if not project_ids:
        return {}
    rows = (
        (
            await connection.execute(
                select(project_stage_actions)
                .where(project_stage_actions.c.project_id.in_(project_ids))
                .order_by(project_stage_actions.c.project_id, project_stage_actions.c.created_at)
            )
        )
        .mappings()
        .all()
    )
    result: dict[UUID, list[ProjectStageActionResponse]] = {}
    for row in rows:
        result.setdefault(row["project_id"], []).append(_project_action(row))
    return result


async def _trip_detail_maps(
    connection: AsyncConnection,
    request_ids: Sequence[UUID],
) -> tuple[dict[UUID, list[UUID]], dict[UUID, list[TripActionHistoryResponse]]]:
    if not request_ids:
        return {}, {}
    employee_rows = (
        (
            await connection.execute(
                select(trip_request_employees)
                .where(trip_request_employees.c.request_id.in_(request_ids))
                .order_by(trip_request_employees.c.request_id, trip_request_employees.c.user_id)
            )
        )
        .mappings()
        .all()
    )
    action_rows = (
        (
            await connection.execute(
                select(trip_request_actions)
                .where(trip_request_actions.c.request_id.in_(request_ids))
                .order_by(trip_request_actions.c.request_id, trip_request_actions.c.created_at)
            )
        )
        .mappings()
        .all()
    )
    employees: dict[UUID, list[UUID]] = {}
    actions: dict[UUID, list[TripActionHistoryResponse]] = {}
    for row in employee_rows:
        employees.setdefault(row["request_id"], []).append(row["user_id"])
    for row in action_rows:
        actions.setdefault(row["request_id"], []).append(_trip_action(row))
    return employees, actions


def _feed_comment(row: Record) -> FeedCommentResponse:
    return FeedCommentResponse(
        id=str(row["id"]),
        author_user_id=str(row["author_user_id"]),
        body=row["body"],
        created_at=row["created_at"],
    )


def _feed_post(
    row: Record,
    current_user: AuthenticatedUser,
    comments: Sequence[FeedCommentResponse] = (),
    reaction_user_ids: Sequence[UUID] = (),
) -> FeedPostResponse:
    return FeedPostResponse(
        id=str(row["id"]),
        author_user_id=str(row["author_user_id"]),
        title=row["title"],
        body=row["body"],
        is_pinned=row["is_pinned"],
        liked_by_current_user=current_user.id in reaction_user_ids,
        like_count=len(reaction_user_ids),
        can_edit=row["author_user_id"] == current_user.id or _is_privileged(current_user),
        can_delete=row["author_user_id"] == current_user.id
        or current_user.role in {"admin", "superadmin"},
        can_pin=row["author_user_id"] == current_user.id
        or current_user.role in {"admin", "superadmin"},
        comments=list(comments),
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


async def _feed_detail_maps(
    connection: AsyncConnection,
    post_ids: Sequence[UUID],
) -> tuple[dict[UUID, list[FeedCommentResponse]], dict[UUID, list[UUID]]]:
    if not post_ids:
        return {}, {}
    comment_rows = (
        (
            await connection.execute(
                select(feed_comments)
                .where(feed_comments.c.post_id.in_(post_ids))
                .order_by(feed_comments.c.post_id, feed_comments.c.created_at)
            )
        )
        .mappings()
        .all()
    )
    reaction_rows = (
        (
            await connection.execute(
                select(feed_reactions).where(feed_reactions.c.post_id.in_(post_ids))
            )
        )
        .mappings()
        .all()
    )
    comments: dict[UUID, list[FeedCommentResponse]] = {}
    reactions: dict[UUID, list[UUID]] = {}
    for row in comment_rows:
        comments.setdefault(row["post_id"], []).append(_feed_comment(row))
    for row in reaction_rows:
        reactions.setdefault(row["post_id"], []).append(row["user_id"])
    return comments, reactions


def _calendar_event(
    row: Record,
    current_user: AuthenticatedUser,
    attendee_ids: Sequence[UUID] = (),
) -> CalendarEventResponse:
    return CalendarEventResponse(
        id=str(row["id"]),
        organizer_user_id=str(row["organizer_user_id"]),
        title=row["title"],
        description=row["description"] or "",
        event_type=row["event_type"],
        starts_at=row["starts_at"],
        ends_at=row["ends_at"],
        all_day=row["all_day"],
        location=row["location"] or "",
        status=row["status"],
        attendee_ids=[str(value) for value in attendee_ids],
        can_edit=row["organizer_user_id"] == current_user.id or _is_privileged(current_user),
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


async def _calendar_attendee_map(
    connection: AsyncConnection,
    event_ids: Sequence[UUID],
) -> dict[UUID, list[UUID]]:
    if not event_ids:
        return {}
    rows = (
        (
            await connection.execute(
                select(calendar_event_attendees)
                .where(calendar_event_attendees.c.event_id.in_(event_ids))
                .order_by(calendar_event_attendees.c.event_id, calendar_event_attendees.c.user_id)
            )
        )
        .mappings()
        .all()
    )
    result: dict[UUID, list[UUID]] = {}
    for row in rows:
        result.setdefault(row["event_id"], []).append(row["user_id"])
    return result


async def _active_stages_for_requests(
    connection: AsyncConnection,
    request_rows: Sequence[Record],
    current_user: AuthenticatedUser,
) -> dict[UUID, list[ApprovalStageResponse]]:
    template_ids = list({row["template_id"] for row in request_rows})
    if not template_ids:
        return {}
    node_rows = (
        (
            await connection.execute(
                select(approval_nodes).where(approval_nodes.c.template_id.in_(template_ids))
            )
        )
        .mappings()
        .all()
    )
    nodes = {(row["template_id"], row["node_key"]): row for row in node_rows}
    result: dict[UUID, list[ApprovalStageResponse]] = {}
    for request_row in request_rows:
        stages: list[ApprovalStageResponse] = []
        for key in request_row["active_node_keys"] or []:
            node = nodes.get((request_row["template_id"], key))
            if node is None:
                continue
            stages.append(
                ApprovalStageResponse(
                    key=node["node_key"],
                    label=node["title"],
                    kind=node["kind"],
                    can_act=_can_act_from_config(
                        current_user,
                        request_row,
                        key,
                        node["config"] or {},
                    ),
                )
            )
        result[request_row["id"]] = stages
    return result


async def _request_versions(
    connection: AsyncConnection,
    request_ids: Sequence[UUID],
) -> dict[UUID, list[ApprovalRequestVersionResponse]]:
    if not request_ids:
        return {}
    rows = (
        (
            await connection.execute(
                select(approval_request_versions)
                .where(approval_request_versions.c.request_id.in_(request_ids))
                .order_by(
                    approval_request_versions.c.request_id,
                    approval_request_versions.c.version,
                )
            )
        )
        .mappings()
        .all()
    )
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
        (
            await connection.execute(
                select(approval_actions)
                .where(approval_actions.c.request_id.in_(request_ids))
                .order_by(approval_actions.c.request_id, approval_actions.c.created_at)
            )
        )
        .mappings()
        .all()
    )
    result: dict[UUID, list[ApprovalActionHistoryResponse]] = {}
    for row in rows:
        result.setdefault(row["request_id"], []).append(_approval_action(row))
    return result


async def _request_deadline_controls(
    connection: AsyncConnection,
    request_rows: Sequence[Record],
) -> dict[UUID, ApprovalDeadlineControlResponse]:
    if not request_rows:
        return {}
    request_ids = [row["id"] for row in request_rows]
    template_ids = list({row["template_id"] for row in request_rows})
    node_rows = (
        (
            await connection.execute(
                select(
                    approval_nodes.c.template_id,
                    approval_nodes.c.node_key,
                    approval_nodes.c.config,
                ).where(approval_nodes.c.template_id.in_(template_ids))
            )
        )
        .mappings()
        .all()
    )
    configs_by_node = {
        (row["template_id"], row["node_key"]): row["config"] or {} for row in node_rows
    }
    event_rows = (
        (
            await connection.execute(
                select(approval_deadline_events)
                .where(approval_deadline_events.c.request_id.in_(request_ids))
                .order_by(
                    approval_deadline_events.c.request_id,
                    approval_deadline_events.c.created_at,
                )
            )
        )
        .mappings()
        .all()
    )
    events_by_request: dict[UUID, list[ApprovalDeadlineEventResponse]] = {}
    for event_row in event_rows:
        events_by_request.setdefault(event_row["request_id"], []).append(_deadline_event(event_row))
    return {
        row["id"]: _approval_deadline_control(
            row,
            [
                configs_by_node.get((row["template_id"], node_key), {})
                for node_key in row["active_node_keys"] or []
            ],
            events_by_request.get(row["id"], []),
        )
        for row in request_rows
    }


async def _request_response(
    connection: AsyncConnection,
    request_id: UUID,
    current_user: AuthenticatedUser,
) -> ApprovalRequestResponse:
    row = (
        (
            await connection.execute(
                select(approval_requests).where(approval_requests.c.id == request_id)
            )
        )
        .mappings()
        .first()
    )
    if row is None:
        raise WorkspaceRepositoryError(404, "Request was not found")
    versions = await _request_versions(connection, [request_id])
    actions = await _request_actions(connection, [request_id])
    stages = await _active_stages_for_requests(connection, [row], current_user)
    deadline_controls = await _request_deadline_controls(connection, [row])
    return _approval_request(
        row,
        versions.get(request_id, []),
        actions.get(request_id, []),
        stages.get(request_id, []),
        deadline_controls.get(request_id),
    )


async def find_active_user_by_username(
    connection: AsyncConnection,
    username: str,
) -> RowMapping | None:
    statement = select(users).where(users.c.username == username, users.c.status == "active")
    return (await connection.execute(statement)).mappings().first()


async def _workflow_response(
    connection: AsyncConnection,
    template: Record,
) -> WorkflowResponse:
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
    published_version = await connection.scalar(
        select(func.max(approval_templates.c.version)).where(
            approval_templates.c.template_key == template["template_key"],
            approval_templates.c.status == "published",
        )
    )
    return WorkflowResponse(
        id=str(template["id"]),
        name=template["name"],
        version=template["version"],
        status=template["status"],
        published_version=published_version,
        form_schema=template["form_schema"] or {},
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


async def _request_workflows(
    connection: AsyncConnection,
    request_rows: Sequence[Record],
) -> dict[UUID, WorkflowResponse]:
    template_ids = list(dict.fromkeys(row["template_id"] for row in request_rows))
    if not template_ids:
        return {}
    template_rows = (
        (
            await connection.execute(
                select(approval_templates).where(approval_templates.c.id.in_(template_ids))
            )
        )
        .mappings()
        .all()
    )
    return {
        row["id"]: await _workflow_response(connection, row)
        for row in template_rows
    }


async def get_workflow(connection: AsyncConnection) -> WorkflowResponse:
    template = (
        (
            await connection.execute(
                select(approval_templates)
                .where(
                    approval_templates.c.template_key == "payment",
                    approval_templates.c.status == "draft",
                )
                .order_by(approval_templates.c.version.desc())
                .limit(1)
            )
        )
        .mappings()
        .first()
    )
    if template is None:
        template = (
            (
                await connection.execute(
                    select(approval_templates)
                    .where(
                        approval_templates.c.template_key == "payment",
                        approval_templates.c.status == "published",
                    )
                    .order_by(approval_templates.c.version.desc())
                    .limit(1)
                )
            )
            .mappings()
            .first()
        )
    if template is None:
        raise WorkspaceRepositoryError(503, "Payment workflow is not configured")
    return await _workflow_response(connection, template)


async def _published_payment_template(connection: AsyncConnection) -> RowMapping:
    template = (
        (
            await connection.execute(
                select(approval_templates)
                .where(
                    approval_templates.c.template_key == "payment",
                    approval_templates.c.status == "published",
                )
                .order_by(approval_templates.c.version.desc())
                .limit(1)
            )
        )
        .mappings()
        .first()
    )
    if template is None:
        template = (
            (
                await connection.execute(
                    select(approval_templates)
                    .where(
                        approval_templates.c.template_key == "payment",
                        approval_templates.c.status == "draft",
                    )
                    .order_by(approval_templates.c.version.desc())
                    .limit(1)
                )
            )
            .mappings()
            .first()
        )
    if template is None:
        raise WorkspaceRepositoryError(503, "Payment workflow is not configured")
    return template


async def _task_detail_maps(
    connection: AsyncConnection,
    task_rows: Sequence[Record],
) -> tuple[
    dict[UUID, list[TaskParticipantResponse]],
    dict[UUID, list[TaskChecklistItemResponse]],
    dict[UUID, list[TaskCommentResponse]],
    dict[UUID, list[TaskDependencyResponse]],
    dict[UUID, TaskCycleResponse],
    dict[UUID, str],
    dict[UUID, UUID],
    dict[UUID, TaskReturnResponse],
]:
    task_ids = [row["id"] for row in task_rows]
    if not task_ids:
        return {}, {}, {}, {}, {}, {}, {}, {}

    participant_rows = (
        (
            await connection.execute(
                select(task_participants)
                .where(task_participants.c.task_id.in_(task_ids))
                .order_by(task_participants.c.task_id, task_participants.c.participant_role)
            )
        )
        .mappings()
        .all()
    )
    participants: dict[UUID, list[TaskParticipantResponse]] = {}
    for row in participant_rows:
        participants.setdefault(row["task_id"], []).append(
            TaskParticipantResponse(
                user_id=str(row["user_id"]),
                role=row["participant_role"],
            )
        )

    checklist_rows = (
        (
            await connection.execute(
                select(task_checklist_items)
                .where(task_checklist_items.c.task_id.in_(task_ids))
                .order_by(
                    task_checklist_items.c.task_id,
                    task_checklist_items.c.sort_order,
                    task_checklist_items.c.created_at,
                )
            )
        )
        .mappings()
        .all()
    )
    checklist: dict[UUID, list[TaskChecklistItemResponse]] = {}
    for row in checklist_rows:
        checklist.setdefault(row["task_id"], []).append(_task_checklist_item(row))

    comment_rows = (
        (
            await connection.execute(
                select(task_comments)
                .where(task_comments.c.task_id.in_(task_ids))
                .order_by(task_comments.c.task_id, task_comments.c.created_at)
            )
        )
        .mappings()
        .all()
    )
    comments: dict[UUID, list[TaskCommentResponse]] = {}
    for row in comment_rows:
        comments.setdefault(row["task_id"], []).append(_task_comment(row))

    dependency_rows = (
        (
            await connection.execute(
                select(task_dependencies)
                .where(task_dependencies.c.task_id.in_(task_ids))
                .order_by(task_dependencies.c.task_id, task_dependencies.c.created_at)
            )
        )
        .mappings()
        .all()
    )
    dependency_ids = list({row["depends_on_task_id"] for row in dependency_rows})
    dependency_task_rows = (
        (await connection.execute(select(tasks).where(tasks.c.id.in_(dependency_ids))))
        .mappings()
        .all()
        if dependency_ids
        else []
    )
    dependency_tasks = {row["id"]: row for row in dependency_task_rows}
    dependencies: dict[UUID, list[TaskDependencyResponse]] = {}
    for row in dependency_rows:
        dependency = dependency_tasks.get(row["depends_on_task_id"])
        if dependency is not None:
            dependencies.setdefault(row["task_id"], []).append(_task_dependency(row, dependency))

    cycle_ids = list({row["cycle_id"] for row in task_rows if row["cycle_id"] is not None})
    cycle_rows = (
        (await connection.execute(select(task_cycles).where(task_cycles.c.id.in_(cycle_ids))))
        .mappings()
        .all()
        if cycle_ids
        else []
    )
    cycles = {row["id"]: _task_cycle(row) for row in cycle_rows}
    parent_ids = list({row["parent_task_id"] for row in task_rows if row.get("parent_task_id")})
    parent_rows = (
        (
            await connection.execute(
                select(tasks.c.id, tasks.c.title).where(tasks.c.id.in_(parent_ids))
            )
        )
        .mappings()
        .all()
        if parent_ids
        else []
    )
    parent_titles = {row["id"]: row["title"] for row in parent_rows}
    task_chat_rows = (
        (
            await connection.execute(
                select(chats.c.id, chats.c.context_id).where(
                    chats.c.context_type == "task",
                    chats.c.context_id.in_(task_ids),
                )
            )
        )
        .mappings()
        .all()
    )
    task_chat_ids = {row["context_id"]: row["id"] for row in task_chat_rows}
    return_rows = (
        (
            await connection.execute(
                select(task_efficiency_events)
                .where(
                    task_efficiency_events.c.task_id.in_(task_ids),
                    task_efficiency_events.c.event_type == "result_returned_for_revision",
                )
                .order_by(
                    task_efficiency_events.c.task_id,
                    task_efficiency_events.c.occurred_at.desc(),
                )
            )
        )
        .mappings()
        .all()
    )
    latest_returns: dict[UUID, TaskReturnResponse] = {}
    for row in return_rows:
        latest_returns.setdefault(
            row["task_id"],
            TaskReturnResponse(
                reason_code=row["reason_code"] or "other",
                reason_text=row["reason_text"],
                actor_user_id=str(row["actor_user_id"]),
                created_at=row["occurred_at"],
            ),
        )
    return (
        participants,
        checklist,
        comments,
        dependencies,
        cycles,
        parent_titles,
        task_chat_ids,
        latest_returns,
    )


async def _task_response(connection: AsyncConnection, task_id: UUID) -> TaskResponse:
    row = (await connection.execute(select(tasks).where(tasks.c.id == task_id))).mappings().first()
    if row is None:
        raise WorkspaceRepositoryError(404, "Task was not found")
    (
        participants,
        checklist,
        comments,
        dependencies,
        cycles,
        parent_titles,
        task_chat_ids,
        latest_returns,
    ) = await _task_detail_maps(connection, [row])
    return _task(
        row,
        participants=participants.get(task_id, []),
        checklist=checklist.get(task_id, []),
        comments=comments.get(task_id, []),
        dependencies=dependencies.get(task_id, []),
        cycle=cycles.get(row["cycle_id"]),
        parent_task_title=parent_titles.get(row["parent_task_id"]),
        chat_id=task_chat_ids.get(task_id),
        latest_return=latest_returns.get(task_id),
    )


def _notification(row: Record) -> NotificationResponse:
    return NotificationResponse(
        id=str(row["id"]),
        kind=row["kind"],
        priority=row["priority"],
        title=row["title"],
        body=row["body"] or "",
        section=row["section"],
        entity_id=str(row["entity_id"]) if row["entity_id"] else None,
        requires_action=bool(row["requires_action"]),
        is_reminder=bool(row["is_reminder"]),
        occurred_at=row["occurred_at"],
        read_at=row["read_at"],
        resolved_at=row["resolved_at"],
        desktop_delivered_at=row["desktop_delivered_at"],
    )


async def get_notification_preferences(
    connection: AsyncConnection,
    current_user: AuthenticatedUser,
) -> NotificationPreferencesResponse:
    now = datetime.now(UTC)
    await connection.execute(
        pg_insert(workspace_notification_preferences)
        .values(user_id=current_user.id, updated_at=now)
        .on_conflict_do_nothing(index_elements=[workspace_notification_preferences.c.user_id])
    )
    row = (
        (
            await connection.execute(
                select(workspace_notification_preferences).where(
                    workspace_notification_preferences.c.user_id == current_user.id
                )
            )
        )
        .mappings()
        .one()
    )
    return NotificationPreferencesResponse(
        desktop_enabled=bool(row["desktop_enabled"]),
        messages_enabled=bool(row["messages_enabled"]),
        tasks_enabled=bool(row["tasks_enabled"]),
        approvals_enabled=bool(row["approvals_enabled"]),
        trips_enabled=bool(row["trips_enabled"]),
        calendar_enabled=bool(row["calendar_enabled"]),
        absences_enabled=bool(row["absences_enabled"]),
        zoom_enabled=bool(row["zoom_enabled"]),
        reminders_enabled=bool(row["reminders_enabled"]),
    )


async def update_notification_preferences(
    connection: AsyncConnection,
    current_user: AuthenticatedUser,
    payload: NotificationPreferencesUpdate,
) -> NotificationPreferencesResponse:
    values = payload.model_dump()
    values["updated_at"] = datetime.now(UTC)
    await connection.execute(
        pg_insert(workspace_notification_preferences)
        .values(user_id=current_user.id, **values)
        .on_conflict_do_update(
            index_elements=[workspace_notification_preferences.c.user_id],
            set_=values,
        )
    )
    return await get_notification_preferences(connection, current_user)


async def _upsert_notification(
    connection: AsyncConnection,
    *,
    user_id: UUID,
    event_key: str,
    kind: str,
    priority: str,
    title: str,
    body: str,
    section: str,
    entity_id: UUID | None,
    requires_action: bool,
    occurred_at: datetime,
    is_reminder: bool = False,
) -> None:
    statement = pg_insert(workspace_notifications).values(
        id=uuid4(),
        user_id=user_id,
        event_key=event_key,
        kind=kind,
        priority=priority,
        title=title[:240],
        body=body[:4000],
        section=section,
        entity_id=entity_id,
        requires_action=requires_action,
        is_reminder=is_reminder,
        occurred_at=occurred_at,
        read_at=None,
        resolved_at=None,
        desktop_delivered_at=None,
    )
    await connection.execute(
        statement.on_conflict_do_update(
            index_elements=[workspace_notifications.c.user_id, workspace_notifications.c.event_key],
            set_={
                "priority": statement.excluded.priority,
                "title": statement.excluded.title,
                "body": statement.excluded.body,
            },
        )
    )


async def _sync_notifications_for_user(
    connection: AsyncConnection,
    current_user: AuthenticatedUser,
    *,
    task_rows: Sequence[Record],
    request_rows: Sequence[Record],
    stages_by_request: Mapping[UUID, Sequence[ApprovalStageResponse]],
    trip_rows: Sequence[Record],
) -> list[NotificationResponse]:
    now = datetime.now(UTC)
    active_attention_keys: set[str] = set()
    accessible_chat_ids = select(chat_members.c.chat_id).where(
        chat_members.c.user_id == current_user.id
    )

    unread_message_rows = (
        (
            await connection.execute(
                select(
                    messages.c.id,
                    messages.c.chat_id,
                    messages.c.body,
                    messages.c.mention_user_ids,
                    messages.c.created_at,
                    chats.c.title.label("chat_title"),
                    users.c.full_name.label("author_name"),
                )
                .select_from(
                    message_receipts.join(messages, message_receipts.c.message_id == messages.c.id)
                    .join(chats, chats.c.id == messages.c.chat_id)
                    .join(users, users.c.id == messages.c.author_user_id)
                )
                .where(
                    message_receipts.c.user_id == current_user.id,
                    message_receipts.c.read_at.is_(None),
                    messages.c.deleted_at.is_(None),
                    messages.c.author_user_id != current_user.id,
                    messages.c.chat_id.in_(accessible_chat_ids),
                )
                .order_by(messages.c.created_at.desc())
                .limit(200)
            )
        )
        .mappings()
        .all()
    )
    for message_row in unread_message_rows:
        mentioned = str(current_user.id) in (message_row["mention_user_ids"] or [])
        notice = "Упоминание в чате" if mentioned else "Новое сообщение"
        await _upsert_notification(
            connection,
            user_id=current_user.id,
            event_key=f"message:{message_row['id']}",
            kind="message",
            priority="attention" if mentioned else "normal",
            title=f"{notice} · {message_row['chat_title'] or message_row['author_name']}",
            body=f"{message_row['author_name']}: {message_row['body']}",
            section="messenger",
            entity_id=message_row["chat_id"],
            requires_action=False,
            occurred_at=message_row["created_at"],
        )

    for task_row in task_rows:
        if task_row["primary_assignee_user_id"] != current_user.id or task_row["status"] in {
            "completed",
            "cancelled",
        }:
            continue
        overdue = task_row["due_at"] is not None and task_row["due_at"] <= now
        event_key = (
            f"task:{task_row['id']}:overdue:{task_row['due_at'].isoformat()}"
            if overdue
            else f"task:{task_row['id']}:{task_row['status']}:{task_row['updated_at'].isoformat()}"
        )
        active_attention_keys.add(event_key)
        await _upsert_notification(
            connection,
            user_id=current_user.id,
            event_key=event_key,
            kind="task",
            priority="urgent" if overdue or task_row["priority"] == "urgent" else "attention",
            title="Просроченная задача" if overdue else "Задача требует внимания",
            body=task_row["title"],
            section="tasks",
            entity_id=task_row["id"],
            requires_action=True,
            occurred_at=task_row["updated_at"],
        )

    for request_row in request_rows:
        for stage in stages_by_request.get(request_row["id"], []):
            if not stage.can_act:
                continue
            event_key = (
                f"approval:{request_row['id']}:{stage.key}:{request_row['updated_at'].isoformat()}"
            )
            active_attention_keys.add(event_key)
            await _upsert_notification(
                connection,
                user_id=current_user.id,
                event_key=event_key,
                kind="approval",
                priority=(
                    "urgent"
                    if (request_row["payload"] or {}).get("request_priority") == "urgent"
                    else "attention"
                ),
                title="Нужно решение по заявке",
                body=f"{request_row['title']} · {stage.label}",
                section="payment_requests",
                entity_id=request_row["id"],
                requires_action=True,
                occurred_at=request_row["updated_at"],
            )

    for trip_row in trip_rows:
        allowed_actions = _trip_allowed_actions(trip_row, current_user)
        if not allowed_actions:
            continue
        event_key = (
            f"trip:{trip_row['id']}:{trip_row['stage']}:{trip_row['updated_at'].isoformat()}"
        )
        active_attention_keys.add(event_key)
        await _upsert_notification(
            connection,
            user_id=current_user.id,
            event_key=event_key,
            kind="trip",
            priority="attention",
            title="Командировка требует действия",
            body=f"{trip_row['destination']} · {TRIP_STAGE_LABELS[trip_row['stage']]}",
            section="trip_approvals",
            entity_id=trip_row["id"],
            requires_action=True,
            occurred_at=trip_row["updated_at"],
        )

    unresolved_rows = (
        (
            await connection.execute(
                select(workspace_notifications.c.id, workspace_notifications.c.event_key).where(
                    workspace_notifications.c.user_id == current_user.id,
                    workspace_notifications.c.requires_action.is_(True),
                    workspace_notifications.c.resolved_at.is_(None),
                )
            )
        )
        .mappings()
        .all()
    )
    stale_ids = [
        item["id"] for item in unresolved_rows if item["event_key"] not in active_attention_keys
    ]
    if stale_ids:
        await connection.execute(
            update(workspace_notifications)
            .where(workspace_notifications.c.id.in_(stale_ids))
            .values(resolved_at=now)
        )

    rows = (
        (
            await connection.execute(
                select(workspace_notifications)
                .where(
                    workspace_notifications.c.user_id == current_user.id,
                    or_(
                        and_(
                            workspace_notifications.c.section == "messenger",
                            workspace_notifications.c.entity_id.in_(accessible_chat_ids),
                        ),
                        and_(
                            workspace_notifications.c.section == "tasks",
                            or_(
                                workspace_notifications.c.entity_id.in_(
                                    [row["id"] for row in task_rows]
                                ),
                                and_(
                                    workspace_notifications.c.entity_id.is_(None),
                                    workspace_notifications.c.event_key.like("efficiency:daily:%"),
                                ),
                            ),
                        ),
                        and_(
                            workspace_notifications.c.section == "payment_requests",
                            workspace_notifications.c.entity_id.in_(
                                [row["id"] for row in request_rows]
                            ),
                        ),
                        and_(
                            workspace_notifications.c.section == "trip_approvals",
                            workspace_notifications.c.entity_id.in_(
                                [row["id"] for row in trip_rows]
                            ),
                        ),
                        workspace_notifications.c.section == "calendar",
                        workspace_notifications.c.section == "absences",
                    ),
                )
                .order_by(workspace_notifications.c.occurred_at.desc())
                .limit(300)
            )
        )
        .mappings()
        .all()
    )
    return [_notification(row) for row in rows]


async def mark_notification_read(
    connection: AsyncConnection,
    current_user: AuthenticatedUser,
    notification_id: UUID,
) -> NotificationResponse:
    await connection.execute(
        update(workspace_notifications)
        .where(
            workspace_notifications.c.id == notification_id,
            workspace_notifications.c.user_id == current_user.id,
        )
        .values(read_at=func.coalesce(workspace_notifications.c.read_at, datetime.now(UTC)))
    )
    row = (
        (
            await connection.execute(
                select(workspace_notifications).where(
                    workspace_notifications.c.id == notification_id,
                    workspace_notifications.c.user_id == current_user.id,
                )
            )
        )
        .mappings()
        .first()
    )
    if row is None:
        raise WorkspaceRepositoryError(404, "Notification was not found")
    return _notification(row)


async def mark_all_notifications_read(
    connection: AsyncConnection,
    current_user: AuthenticatedUser,
) -> None:
    await connection.execute(
        update(workspace_notifications)
        .where(
            workspace_notifications.c.user_id == current_user.id,
            workspace_notifications.c.read_at.is_(None),
        )
        .values(read_at=datetime.now(UTC))
    )


async def mark_notification_desktop_delivered(
    connection: AsyncConnection,
    current_user: AuthenticatedUser,
    notification_id: UUID,
) -> NotificationResponse:
    await connection.execute(
        update(workspace_notifications)
        .where(
            workspace_notifications.c.id == notification_id,
            workspace_notifications.c.user_id == current_user.id,
        )
        .values(
            desktop_delivered_at=func.coalesce(
                workspace_notifications.c.desktop_delivered_at, datetime.now(UTC)
            )
        )
    )
    row = (
        (
            await connection.execute(
                select(workspace_notifications).where(
                    workspace_notifications.c.id == notification_id,
                    workspace_notifications.c.user_id == current_user.id,
                )
            )
        )
        .mappings()
        .first()
    )
    if row is None:
        raise WorkspaceRepositoryError(404, "Notification was not found")
    return _notification(row)


def _authenticated_user_from_row(row: Record) -> AuthenticatedUser:
    return AuthenticatedUser(
        id=row["id"],
        username=row["username"],
        full_name=row["full_name"],
        position_id=row["position_id"],
        job_title=row["job_title"],
        role=row["role"],
    )


def _approval_actor_ids(
    request_row: Record,
    node_key: str,
    config: Mapping[str, Any],
    user_rows: Sequence[Record],
) -> set[UUID]:
    if request_row["status"] == "needs_revision":
        return {request_row["requester_user_id"]}
    return {
        row["id"]
        for row in user_rows
        if _can_act_from_config(
            _authenticated_user_from_row(row),
            request_row,
            node_key,
            config,
        )
    }


def _approval_escalation_recipient_ids(
    config: Mapping[str, Any],
    user_rows: Sequence[Record],
    template_owner_id: UUID,
) -> set[UUID]:
    by_id = config.get("escalationUserId")
    if by_id:
        return {row["id"] for row in user_rows if str(row["id"]) == str(by_id)}
    by_position = config.get("escalationPositionId")
    if by_position:
        return {
            row["id"]
            for row in user_rows
            if row["position_id"] is not None and str(row["position_id"]) == str(by_position)
        }
    by_role = config.get("escalationRole")
    if by_role:
        return {row["id"] for row in user_rows if row["role"] == by_role}
    return {row["id"] for row in user_rows if row["id"] == template_owner_id}


async def _create_approval_deadline_delivery(
    connection: AsyncConnection,
    *,
    request_row: Record,
    recipient_user_id: UUID,
    node_key: str,
    node_title: str,
    event_type: str,
    recipient_role: str,
    threshold_hours: int,
    deadline: datetime,
    occurred_at: datetime,
) -> int:
    inserted_id = await connection.scalar(
        pg_insert(approval_deadline_events)
        .values(
            id=uuid4(),
            request_id=request_row["id"],
            recipient_user_id=recipient_user_id,
            node_key=node_key,
            event_type=event_type,
            recipient_role=recipient_role,
            threshold_hours=threshold_hours,
            deadline_at=deadline,
            created_at=occurred_at,
        )
        .on_conflict_do_nothing(constraint="uq_approval_deadline_delivery")
        .returning(approval_deadline_events.c.id)
    )
    if inserted_id is None:
        return 0
    local_deadline = deadline.astimezone(ZoneInfo("Asia/Tashkent"))
    if event_type == "reminder":
        title = "Срок заявки приближается"
        body = (
            f"{request_row['title']} · {node_title} · осталось менее {threshold_hours} ч. · "
            f"до {local_deadline:%d.%m %H:%M} (Ташкент)"
        )
        priority = "urgent" if threshold_hours <= 2 else "attention"
    elif event_type == "overdue":
        title = "Срок заявки истёк"
        body = (
            f"{request_row['title']} · {node_title} · срок был "
            f"{local_deadline:%d.%m %H:%M} (Ташкент)"
        )
        priority = "urgent"
    else:
        title = "Эскалация просроченной заявки"
        body = f"{request_row['title']} · {node_title} · просрочка более {threshold_hours} ч."
        priority = "urgent"
    await _upsert_notification(
        connection,
        user_id=recipient_user_id,
        event_key=(
            f"approval-deadline:{request_row['id']}:{deadline.isoformat()}:"
            f"{node_key}:{event_type}:{threshold_hours}"
        ),
        kind="approval",
        priority=priority,
        title=title,
        body=body,
        section="payment_requests",
        entity_id=request_row["id"],
        requires_action=False,
        occurred_at=occurred_at,
        is_reminder=True,
    )
    return 1


async def _materialize_approval_deadline_notifications(
    connection: AsyncConnection,
    now: datetime,
) -> int:
    request_rows = (
        (
            await connection.execute(
                select(
                    approval_requests,
                    approval_templates.c.created_by_user_id.label("template_owner_user_id"),
                )
                .join(
                    approval_templates,
                    approval_templates.c.id == approval_requests.c.template_id,
                )
                .where(approval_requests.c.status.in_({"running", "needs_revision"}))
            )
        )
        .mappings()
        .all()
    )
    due_rows = [row for row in request_rows if _approval_deadline(row) is not None]
    if not due_rows:
        return 0
    template_ids = list({row["template_id"] for row in due_rows})
    node_rows = (
        (
            await connection.execute(
                select(approval_nodes).where(approval_nodes.c.template_id.in_(template_ids))
            )
        )
        .mappings()
        .all()
    )
    node_by_key = {(row["template_id"], row["node_key"]): row for row in node_rows}
    user_rows = (
        (await connection.execute(select(users).where(users.c.status == "active"))).mappings().all()
    )
    created = 0
    for request_row in due_rows:
        deadline = _approval_deadline(request_row)
        if deadline is None:
            continue
        active_keys = request_row["active_node_keys"] or ["request"]
        requester_notified = False
        for node_key in active_keys:
            node = node_by_key.get((request_row["template_id"], node_key))
            config = node["config"] or {} if node is not None else {}
            node_title = str(node["title"] if node is not None else "Текущий этап")
            actor_ids = _approval_actor_ids(request_row, node_key, config, user_rows)
            actor_role = "requester" if request_row["status"] == "needs_revision" else "approver"
            if request_row["requester_user_id"] in actor_ids:
                requester_notified = True
            reminder_hours = _approval_reminder_hours([config])
            if now < deadline:
                reached = [
                    hours for hours in reminder_hours if now >= deadline - timedelta(hours=hours)
                ]
                if reached:
                    threshold = min(reached)
                    for recipient_id in actor_ids:
                        created += await _create_approval_deadline_delivery(
                            connection,
                            request_row=request_row,
                            recipient_user_id=recipient_id,
                            node_key=node_key,
                            node_title=node_title,
                            event_type="reminder",
                            recipient_role=actor_role,
                            threshold_hours=threshold,
                            deadline=deadline,
                            occurred_at=now,
                        )
                continue
            for recipient_id in actor_ids:
                created += await _create_approval_deadline_delivery(
                    connection,
                    request_row=request_row,
                    recipient_user_id=recipient_id,
                    node_key=node_key,
                    node_title=node_title,
                    event_type="overdue",
                    recipient_role=(
                        "requester"
                        if recipient_id == request_row["requester_user_id"]
                        else actor_role
                    ),
                    threshold_hours=0,
                    deadline=deadline,
                    occurred_at=now,
                )
            escalation_hours = _approval_escalation_hours([config])
            if escalation_hours is not None and now >= deadline + timedelta(hours=escalation_hours):
                for recipient_id in _approval_escalation_recipient_ids(
                    config,
                    user_rows,
                    request_row["template_owner_user_id"],
                ):
                    created += await _create_approval_deadline_delivery(
                        connection,
                        request_row=request_row,
                        recipient_user_id=recipient_id,
                        node_key=node_key,
                        node_title=node_title,
                        event_type="escalation",
                        recipient_role="process_owner",
                        threshold_hours=escalation_hours,
                        deadline=deadline,
                        occurred_at=now,
                    )
        if now >= deadline and not requester_notified:
            created += await _create_approval_deadline_delivery(
                connection,
                request_row=request_row,
                recipient_user_id=request_row["requester_user_id"],
                node_key="request",
                node_title="Заявка целиком",
                event_type="overdue",
                recipient_role="requester",
                threshold_hours=0,
                deadline=deadline,
                occurred_at=now,
            )
    return created


async def materialize_due_notifications(
    connection: AsyncConnection,
    current_time: datetime | None = None,
) -> int:
    """Create deadline reminders once; the unique event key makes every run idempotent."""
    now = current_time or datetime.now(UTC)
    if now.tzinfo is None:
        now = now.replace(tzinfo=UTC)
    reminder_limit = now + timedelta(hours=24)
    created = 0
    due_tasks = (
        (
            await connection.execute(
                select(tasks).where(
                    tasks.c.status.not_in({"completed", "cancelled"}),
                    tasks.c.due_at.is_not(None),
                    tasks.c.due_at >= now,
                    tasks.c.due_at <= reminder_limit,
                )
            )
        )
        .mappings()
        .all()
    )
    for row in due_tasks:
        statement = (
            pg_insert(workspace_notifications)
            .values(
                id=uuid4(),
                user_id=row["primary_assignee_user_id"],
                event_key=f"task:{row['id']}:deadline:24h:{row['due_at'].isoformat()}",
                kind="task",
                priority="urgent" if row["due_at"] <= now + timedelta(hours=2) else "attention",
                title="Срок задачи приближается",
                body=(
                    f"{row['title']} · до "
                    f"{row['due_at'].astimezone(ZoneInfo('Asia/Tashkent')):%d.%m %H:%M} (Ташкент)"
                ),
                section="tasks",
                entity_id=row["id"],
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
            .returning(workspace_notifications.c.id)
        )
        created += int((await connection.scalar(statement)) is not None)

    due_events = (
        (
            await connection.execute(
                select(calendar_events).where(
                    calendar_events.c.status == "scheduled",
                    calendar_events.c.starts_at >= now,
                    calendar_events.c.starts_at <= reminder_limit,
                )
            )
        )
        .mappings()
        .all()
    )
    attendee_map = await _calendar_attendee_map(connection, [row["id"] for row in due_events])
    for row in due_events:
        recipient_ids = set(attendee_map.get(row["id"], [])) | {row["organizer_user_id"]}
        for user_id in recipient_ids:
            statement = (
                pg_insert(workspace_notifications)
                .values(
                    id=uuid4(),
                    user_id=user_id,
                    event_key=f"calendar:{row['id']}:24h:{row['starts_at'].isoformat()}",
                    kind="calendar",
                    priority=(
                        "attention" if row["starts_at"] <= now + timedelta(hours=1) else "normal"
                    ),
                    title="Событие скоро начнётся",
                    body=(
                        f"{row['title']} · "
                        f"{row['starts_at'].astimezone(ZoneInfo('Asia/Tashkent')):%d.%m %H:%M} "
                        "(Ташкент)"
                    ),
                    section="calendar",
                    entity_id=row["id"],
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
                .returning(workspace_notifications.c.id)
            )
            created += int((await connection.scalar(statement)) is not None)
    created += await _materialize_approval_deadline_notifications(connection, now)
    return created


async def load_workspace(
    connection: AsyncConnection,
    current_user: AuthenticatedUser,
) -> WorkspaceBootstrapResponse:
    module_access = await module_permissions_for_user(connection, current_user)

    def can(module_key: str, action: ModuleAction = "view") -> bool:
        return bool(module_access.get(module_key, {}).get(action, False))

    people_rows = (
        (
            await connection.execute(
                select(users)
                .where(
                    or_(
                        users.c.status == "active",
                        users.c.id.in_(select(tasks.c.author_user_id)),
                        users.c.id.in_(select(tasks.c.primary_assignee_user_id)),
                        users.c.id.in_(select(task_participants.c.user_id)),
                    )
                )
                .order_by(users.c.full_name)
            )
        )
        .mappings()
        .all()
    )
    people = [person_from_record(row, index) for index, row in enumerate(people_rows)]
    current = next(person for person in people if person.id == str(current_user.id))
    position_rows = (
        (
            await connection.execute(
                select(positions.c.id, positions.c.name)
                .where(positions.c.is_active.is_(True))
                .order_by(positions.c.sort_order, positions.c.name)
            )
        )
        .mappings()
        .all()
    )
    published_payment_template = await _published_payment_template(connection)

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
                )
                .order_by(messages.c.created_at)
            )
        )
        .mappings()
        .all()
    )
    chat_responses = [
        await messenger_service.chat_summary(connection, current_user, row["id"])
        for row in chat_rows
    ]
    send_permissions = {chat.id: chat.permissions.send_messages for chat in chat_responses}
    pin_permissions = {
        chat.id: bool(chat.permissions.manage_messages)
        or (chat.kind == "direct" and chat.permissions.send_messages)
        for chat in chat_responses
    }
    reaction_map, pin_map = await messenger_service.message_detail_maps(
        connection, current_user, [row["id"] for row in message_rows]
    )
    message_responses = [
        messenger_service.message_response(
            row,
            current_user,
            can_send=send_permissions.get(str(row["chat_id"]), False),
            can_pin=pin_permissions.get(str(row["chat_id"]), False),
            reactions=reaction_map.get(row["id"]),
            pin=pin_map.get(row["id"]),
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
        task_parent_titles,
        task_chat_ids,
        task_latest_returns,
    ) = await _task_detail_maps(connection, task_rows)

    request_statement = select(approval_requests).order_by(approval_requests.c.updated_at.desc())
    request_rows = (await connection.execute(request_statement)).mappings().all()
    stages_by_request = await _active_stages_for_requests(connection, request_rows, current_user)
    if current_user.role == "employee":
        request_rows = [
            row
            for row in request_rows
            if row["requester_user_id"] == current_user.id
            or row["responsible_user_id"] == current_user.id
            or any(stage.can_act for stage in stages_by_request.get(row["id"], []))
        ]
    request_ids = [row["id"] for row in request_rows]
    versions_by_request = await _request_versions(connection, request_ids)
    actions_by_request = await _request_actions(connection, request_ids)
    deadline_controls_by_request = await _request_deadline_controls(connection, request_rows)
    request_workflows = (
        await _request_workflows(connection, request_rows)
        if can("payment_requests")
        else {}
    )

    project_rows = (
        (
            await connection.execute(
                select(workspace_projects).order_by(workspace_projects.c.updated_at.desc())
            )
        )
        .mappings()
        .all()
    )
    project_history = await _project_action_map(
        connection,
        [row["id"] for row in project_rows],
    )

    trip_statement = select(trip_requests).order_by(trip_requests.c.updated_at.desc())
    if current_user.role == "employee":
        participating_trip_ids = select(trip_request_employees.c.request_id).where(
            trip_request_employees.c.user_id == current_user.id
        )
        trip_statement = trip_statement.where(
            (trip_requests.c.requester_user_id == current_user.id)
            | trip_requests.c.id.in_(participating_trip_ids)
        )
    trip_rows = (await connection.execute(trip_statement)).mappings().all()
    trip_employee_ids, trip_actions = await _trip_detail_maps(
        connection,
        [row["id"] for row in trip_rows],
    )
    absence_responses = (
        await visible_absences(connection, current_user, can("absences", "admin"))
        if can("absences")
        else []
    )
    presence_responses = (
        await presence_summary(connection, can("absences", "admin")) if can("absences") else []
    )

    feed_rows = (
        (
            await connection.execute(
                select(feed_posts).order_by(
                    feed_posts.c.is_pinned.desc(),
                    feed_posts.c.created_at.desc(),
                )
            )
        )
        .mappings()
        .all()
    )
    feed_comment_map, feed_reaction_map = await _feed_detail_maps(
        connection,
        [row["id"] for row in feed_rows],
    )
    calendar_rows = (
        (await connection.execute(select(calendar_events).order_by(calendar_events.c.starts_at)))
        .mappings()
        .all()
    )
    calendar_attendees = await _calendar_attendee_map(
        connection,
        [row["id"] for row in calendar_rows],
    )
    notification_responses = await _sync_notifications_for_user(
        connection,
        current_user,
        task_rows=task_rows,
        request_rows=request_rows,
        stages_by_request=stages_by_request,
        trip_rows=trip_rows,
    )
    notification_preferences = await get_notification_preferences(connection, current_user)

    attachment_filters = []
    message_ids = [
        row["id"] for row in message_rows if row["deleted_at"] is None and can("messenger")
    ]
    task_ids = [row["id"] for row in task_rows] if can("tasks") else []
    if message_ids:
        attachment_filters.append(
            and_(attachments.c.owner_type == "message", attachments.c.owner_id.in_(message_ids))
        )
    if task_ids:
        attachment_filters.append(
            and_(attachments.c.owner_type == "task", attachments.c.owner_id.in_(task_ids))
        )
    if request_ids and can("payment_requests"):
        attachment_filters.append(
            and_(
                attachments.c.owner_type == "approval_request",
                attachments.c.owner_id.in_(request_ids),
            )
        )
    attachment_rows: Sequence[RowMapping] = ()
    if attachment_filters:
        attachment_rows = (
            (
                await connection.execute(
                    select(attachments)
                    .where(or_(*attachment_filters))
                    .order_by(attachments.c.created_at)
                )
            )
            .mappings()
            .all()
        )

    return WorkspaceBootstrapResponse(
        current_user=current,
        module_access=[
            EffectiveModuleAccessResponse(
                module_key=key,
                permissions=ModulePermissionSet.model_validate(permissions),
            )
            for key, permissions in module_access.items()
        ],
        can_create_payment_requests=(
            can("payment_requests", "create")
            and await _can_create_payment_request(
                connection,
                current_user,
                published_payment_template["id"],
            )
        ),
        people=people,
        positions=[
            WorkflowPositionResponse(id=str(row["id"]), name=row["name"]) for row in position_rows
        ],
        chats=chat_responses if can("messenger") else [],
        messages=message_responses if can("messenger") else [],
        tasks=[
            _task(
                row,
                participants=task_participants_by_task.get(row["id"], []),
                checklist=task_checklist_by_task.get(row["id"], []),
                comments=task_comments_by_task.get(row["id"], []),
                dependencies=task_dependencies_by_task.get(row["id"], []),
                cycle=task_cycles_by_id.get(row["cycle_id"]),
                parent_task_title=task_parent_titles.get(row["parent_task_id"]),
                chat_id=task_chat_ids.get(row["id"]),
                latest_return=task_latest_returns.get(row["id"]),
            )
            for row in task_rows
        ]
        if can("tasks")
        else [],
        requests=[
            _approval_request(
                row,
                versions_by_request.get(row["id"], []),
                actions_by_request.get(row["id"], []),
                stages_by_request.get(row["id"], []),
                deadline_controls_by_request.get(row["id"]),
            )
            for row in request_rows
        ]
        if can("payment_requests")
        else [],
        request_workflows=(
            list(request_workflows.values()) if can("payment_requests") else []
        ),
        projects=[
            _project(row, current_user, project_history.get(row["id"], [])) for row in project_rows
        ]
        if can("projects")
        else [],
        trip_requests=[
            _trip_request(
                row,
                current_user,
                trip_employee_ids.get(row["id"], []),
                trip_actions.get(row["id"], []),
            )
            for row in trip_rows
        ]
        if can("trip_approvals")
        else [],
        absence_requests=absence_responses,
        presence_summary=presence_responses,
        feed_posts=[
            _feed_post(
                row,
                current_user,
                feed_comment_map.get(row["id"], []),
                feed_reaction_map.get(row["id"], []),
            )
            for row in feed_rows
        ]
        if can("feed")
        else [],
        calendar_events=[
            _calendar_event(row, current_user, calendar_attendees.get(row["id"], []))
            for row in calendar_rows
        ]
        if can("calendar")
        else [],
        notifications=[
            notification for notification in notification_responses if can(notification.section)
        ],
        notification_preferences=notification_preferences,
        personal_preferences=await get_personal_preferences(connection, current_user),
        attachments=[_attachment(row) for row in attachment_rows],
        workflow=await get_workflow(connection) if can("payment_requests") else None,
    )


async def send_message(
    connection: AsyncConnection,
    current_user: AuthenticatedUser,
    chat_id: UUID,
    payload: SendMessageRequest,
) -> ChatMessageResponse:
    return await messenger_service.send_chat_message(connection, current_user, chat_id, payload)


async def mark_chat_read(
    connection: AsyncConnection,
    current_user: AuthenticatedUser,
    chat_id: UUID,
) -> None:
    membership = await connection.scalar(
        select(func.count())
        .select_from(chat_members)
        .where(chat_members.c.chat_id == chat_id, chat_members.c.user_id == current_user.id)
    )
    if not membership:
        raise WorkspaceRepositoryError(404, "Chat was not found")
    chat_message_ids = select(messages.c.id).where(messages.c.chat_id == chat_id)
    await connection.execute(
        update(message_receipts)
        .where(
            message_receipts.c.user_id == current_user.id,
            message_receipts.c.message_id.in_(chat_message_ids),
            message_receipts.c.read_at.is_(None),
        )
        .values(read_at=datetime.now(UTC))
    )
    await connection.execute(
        update(workspace_notifications)
        .where(
            workspace_notifications.c.user_id == current_user.id,
            workspace_notifications.c.section == "messenger",
            workspace_notifications.c.entity_id == chat_id,
            workspace_notifications.c.read_at.is_(None),
        )
        .values(read_at=datetime.now(UTC))
    )


async def search_messages(
    connection: AsyncConnection,
    current_user: AuthenticatedUser,
    query: str,
) -> list[ChatMessageResponse]:
    normalized = query.strip()
    if not normalized:
        return []
    rows = (
        (
            await connection.execute(
                select(
                    messages,
                    chat_members.c.member_role,
                    chat_members.c.permissions,
                    chats.c.kind,
                )
                .join(
                    chat_members,
                    and_(
                        chat_members.c.chat_id == messages.c.chat_id,
                        chat_members.c.user_id == current_user.id,
                    ),
                )
                .join(chats, chats.c.id == messages.c.chat_id)
                .where(
                    messages.c.deleted_at.is_(None),
                    messages.c.body.ilike(f"%{normalized}%"),
                )
                .order_by(messages.c.created_at.desc())
                .limit(100)
            )
        )
        .mappings()
        .all()
    )
    reaction_map, pin_map = await messenger_service.message_detail_maps(
        connection, current_user, [row["id"] for row in rows]
    )
    return [
        messenger_service.message_response(
            row,
            current_user,
            can_send=messenger_service.member_permissions(row).send_messages,
            can_pin=messenger_service.can_manage_messages(row, row),
            reactions=reaction_map.get(row["id"]),
            pin=pin_map.get(row["id"]),
        )
        for row in rows
    ]


async def _feed_post_response(
    connection: AsyncConnection,
    current_user: AuthenticatedUser,
    post_id: UUID,
) -> FeedPostResponse:
    row = (
        (await connection.execute(select(feed_posts).where(feed_posts.c.id == post_id)))
        .mappings()
        .first()
    )
    if row is None:
        raise WorkspaceRepositoryError(404, "Feed post was not found")
    comments, reactions = await _feed_detail_maps(connection, [post_id])
    return _feed_post(
        row,
        current_user,
        comments.get(post_id, []),
        reactions.get(post_id, []),
    )


async def create_feed_post(
    connection: AsyncConnection,
    current_user: AuthenticatedUser,
    payload: CreateFeedPostRequest,
) -> FeedPostResponse:
    post_id = uuid4()
    now = datetime.now(UTC)
    await connection.execute(
        insert(feed_posts).values(
            id=post_id,
            author_user_id=current_user.id,
            title=payload.title,
            body=payload.body,
            is_pinned=False,
            created_at=now,
            updated_at=now,
        )
    )
    return await _feed_post_response(connection, current_user, post_id)


async def add_feed_comment(
    connection: AsyncConnection,
    current_user: AuthenticatedUser,
    post_id: UUID,
    payload: CreateFeedCommentRequest,
) -> FeedPostResponse:
    exists = await connection.scalar(select(feed_posts.c.id).where(feed_posts.c.id == post_id))
    if exists is None:
        raise WorkspaceRepositoryError(404, "Feed post was not found")
    now = datetime.now(UTC)
    await connection.execute(
        insert(feed_comments).values(
            id=uuid4(),
            post_id=post_id,
            author_user_id=current_user.id,
            body=payload.body,
            created_at=now,
        )
    )
    await connection.execute(
        update(feed_posts).where(feed_posts.c.id == post_id).values(updated_at=now)
    )
    return await _feed_post_response(connection, current_user, post_id)


async def set_feed_like(
    connection: AsyncConnection,
    current_user: AuthenticatedUser,
    post_id: UUID,
    liked: bool,
) -> FeedPostResponse:
    exists = await connection.scalar(select(feed_posts.c.id).where(feed_posts.c.id == post_id))
    if exists is None:
        raise WorkspaceRepositoryError(404, "Feed post was not found")
    await connection.execute(
        delete(feed_reactions).where(
            feed_reactions.c.post_id == post_id,
            feed_reactions.c.user_id == current_user.id,
        )
    )
    if liked:
        await connection.execute(
            insert(feed_reactions).values(
                post_id=post_id,
                user_id=current_user.id,
                kind="like",
                created_at=datetime.now(UTC),
            )
        )
    return await _feed_post_response(connection, current_user, post_id)


async def pin_feed_post(
    connection: AsyncConnection,
    current_user: AuthenticatedUser,
    post_id: UUID,
    payload: PinFeedPostRequest,
) -> FeedPostResponse:
    post = (
        (
            await connection.execute(
                select(feed_posts.c.author_user_id).where(feed_posts.c.id == post_id)
            )
        )
        .mappings()
        .first()
    )
    if post is None:
        raise WorkspaceRepositoryError(404, "Feed post was not found")
    if post["author_user_id"] != current_user.id and current_user.role not in {
        "admin",
        "superadmin",
    }:
        raise WorkspaceRepositoryError(
            403,
            "Only the author or an administrator can pin feed posts",
        )
    result = await connection.execute(
        update(feed_posts)
        .where(feed_posts.c.id == post_id)
        .values(is_pinned=payload.is_pinned, updated_at=datetime.now(UTC))
    )
    if result.rowcount == 0:
        raise WorkspaceRepositoryError(404, "Feed post was not found")
    return await _feed_post_response(connection, current_user, post_id)


async def delete_feed_post(
    connection: AsyncConnection,
    current_user: AuthenticatedUser,
    post_id: UUID,
) -> None:
    post = (
        (
            await connection.execute(
                select(feed_posts).where(feed_posts.c.id == post_id).with_for_update()
            )
        )
        .mappings()
        .first()
    )
    if post is None:
        raise WorkspaceRepositoryError(404, "Feed post was not found")
    if post["author_user_id"] != current_user.id and current_user.role not in {
        "admin",
        "superadmin",
    }:
        raise WorkspaceRepositoryError(
            403,
            "Only the author or an administrator can delete feed posts",
        )
    await connection.execute(delete(feed_posts).where(feed_posts.c.id == post_id))


async def _calendar_event_response(
    connection: AsyncConnection,
    current_user: AuthenticatedUser,
    event_id: UUID,
) -> CalendarEventResponse:
    row = (
        (await connection.execute(select(calendar_events).where(calendar_events.c.id == event_id)))
        .mappings()
        .first()
    )
    if row is None:
        raise WorkspaceRepositoryError(404, "Calendar event was not found")
    attendees = await _calendar_attendee_map(connection, [event_id])
    return _calendar_event(row, current_user, attendees.get(event_id, []))


async def _validate_calendar_attendees(
    connection: AsyncConnection,
    values: Sequence[str],
) -> list[UUID]:
    try:
        attendee_ids = list(dict.fromkeys(UUID(value) for value in values))
    except ValueError as error:
        raise WorkspaceRepositoryError(422, "Invalid calendar attendee identifier") from error
    if not attendee_ids:
        return []
    active_ids = set(
        (
            await connection.execute(
                select(users.c.id).where(
                    users.c.id.in_(attendee_ids),
                    users.c.status == "active",
                )
            )
        ).scalars()
    )
    if len(active_ids) != len(attendee_ids):
        raise WorkspaceRepositoryError(422, "Every calendar attendee must be active")
    return attendee_ids


async def _replace_calendar_attendees(
    connection: AsyncConnection,
    event_id: UUID,
    attendee_ids: Sequence[UUID],
) -> None:
    await connection.execute(
        delete(calendar_event_attendees).where(calendar_event_attendees.c.event_id == event_id)
    )
    if attendee_ids:
        await connection.execute(
            insert(calendar_event_attendees),
            [{"event_id": event_id, "user_id": user_id} for user_id in attendee_ids],
        )


async def create_calendar_event(
    connection: AsyncConnection,
    current_user: AuthenticatedUser,
    payload: CreateCalendarEventRequest,
) -> CalendarEventResponse:
    calendar_zone = ZoneInfo("Asia/Tashkent")
    requested_start = payload.starts_at
    if requested_start.tzinfo is None:
        requested_start = requested_start.replace(tzinfo=UTC)
    requested_date = requested_start.astimezone(calendar_zone).date()
    current_date = datetime.now(UTC).astimezone(calendar_zone).date()
    if requested_date < current_date:
        raise WorkspaceRepositoryError(
            422,
            "New calendar events cannot be created for a past date",
        )
    attendee_ids = await _validate_calendar_attendees(connection, payload.attendee_ids)
    event_id = uuid4()
    now = datetime.now(UTC)
    await connection.execute(
        insert(calendar_events).values(
            id=event_id,
            organizer_user_id=current_user.id,
            title=payload.title,
            description=payload.description,
            event_type=payload.event_type,
            starts_at=payload.starts_at,
            ends_at=payload.ends_at,
            all_day=payload.all_day,
            location=payload.location,
            status="scheduled",
            created_at=now,
            updated_at=now,
        )
    )
    await _replace_calendar_attendees(connection, event_id, attendee_ids)
    return await _calendar_event_response(connection, current_user, event_id)


async def update_calendar_event(
    connection: AsyncConnection,
    current_user: AuthenticatedUser,
    event_id: UUID,
    payload: UpdateCalendarEventRequest,
) -> CalendarEventResponse:
    row = (
        (
            await connection.execute(
                select(calendar_events).where(calendar_events.c.id == event_id).with_for_update()
            )
        )
        .mappings()
        .first()
    )
    if row is None:
        raise WorkspaceRepositoryError(404, "Calendar event was not found")
    if row["organizer_user_id"] != current_user.id and not _is_privileged(current_user):
        raise WorkspaceRepositoryError(403, "Calendar event cannot be changed by this user")
    if row["status"] == "cancelled":
        raise WorkspaceRepositoryError(409, "Cancelled calendar events cannot be edited")
    attendee_ids = await _validate_calendar_attendees(connection, payload.attendee_ids)
    await connection.execute(
        update(calendar_events)
        .where(calendar_events.c.id == event_id)
        .values(
            title=payload.title,
            description=payload.description,
            event_type=payload.event_type,
            starts_at=payload.starts_at,
            ends_at=payload.ends_at,
            all_day=payload.all_day,
            location=payload.location,
            updated_at=datetime.now(UTC),
        )
    )
    await _replace_calendar_attendees(connection, event_id, attendee_ids)
    return await _calendar_event_response(connection, current_user, event_id)


async def cancel_calendar_event(
    connection: AsyncConnection,
    current_user: AuthenticatedUser,
    event_id: UUID,
) -> CalendarEventResponse:
    row = (
        (await connection.execute(select(calendar_events).where(calendar_events.c.id == event_id)))
        .mappings()
        .first()
    )
    if row is None:
        raise WorkspaceRepositoryError(404, "Calendar event was not found")
    if row["organizer_user_id"] != current_user.id and not _is_privileged(current_user):
        raise WorkspaceRepositoryError(403, "Calendar event cannot be cancelled by this user")
    await connection.execute(
        update(calendar_events)
        .where(calendar_events.c.id == event_id)
        .values(status="cancelled", updated_at=datetime.now(UTC))
    )
    return await _calendar_event_response(connection, current_user, event_id)


async def _task_access_row(
    connection: AsyncConnection,
    current_user: AuthenticatedUser,
    task_id: UUID,
    *,
    edit: bool = False,
    manage: bool = False,
) -> Record:
    row = (await connection.execute(select(tasks).where(tasks.c.id == task_id))).mappings().first()
    if row is None:
        raise WorkspaceRepositoryError(404, "Task was not found")
    participant_roles = (
        (
            await connection.execute(
                select(task_participants.c.participant_role).where(
                    task_participants.c.task_id == task_id,
                    task_participants.c.user_id == current_user.id,
                )
            )
        )
        .scalars()
        .all()
    )
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
        select(func.count())
        .select_from(users)
        .where(
            users.c.id == user_id,
            users.c.status == "active",
        )
    )
    if not exists:
        raise WorkspaceRepositoryError(422, "User is not active")
    return user_id


async def _sync_task_chat(
    connection: AsyncConnection,
    *,
    task_id: UUID,
    title: str,
    description: str,
    author_user_id: UUID,
    assignee_user_id: UUID,
    occurred_at: datetime | None = None,
) -> UUID:
    """Create one task chat and keep its membership aligned with task roles."""
    now = occurred_at or datetime.now(UTC)
    chat_id = await connection.scalar(
        select(chats.c.id).where(
            chats.c.context_type == "task",
            chats.c.context_id == task_id,
        )
    )
    if chat_id is None:
        proposed_id = uuid4()
        chat_id = await connection.scalar(
            pg_insert(chats)
            .values(
                id=proposed_id,
                kind="task",
                title=f"Задача · {title}"[:240],
                description=description[:4000],
                context_type="task",
                context_id=task_id,
                direct_key=None,
                created_by_user_id=author_user_id,
                created_at=now,
                updated_at=now,
            )
            .on_conflict_do_nothing(
                index_elements=[chats.c.context_type, chats.c.context_id],
                index_where=and_(
                    chats.c.context_type.is_not(None),
                    chats.c.context_id.is_not(None),
                ),
            )
            .returning(chats.c.id)
        )
        if chat_id is None:
            chat_id = await connection.scalar(
                select(chats.c.id).where(
                    chats.c.context_type == "task",
                    chats.c.context_id == task_id,
                )
            )
        if chat_id is None:
            raise WorkspaceRepositoryError(500, "Task chat could not be created")
    else:
        await connection.execute(
            update(chats)
            .where(chats.c.id == chat_id)
            .values(
                title=f"Задача · {title}"[:240],
                description=description[:4000],
                updated_at=now,
            )
        )

    participant_ids = set(
        (
            await connection.execute(
                select(task_participants.c.user_id).where(task_participants.c.task_id == task_id)
            )
        ).scalars()
    )
    desired_ids = participant_ids | {author_user_id, assignee_user_id}
    await connection.execute(
        delete(chat_members).where(
            chat_members.c.chat_id == chat_id,
            chat_members.c.user_id.not_in(desired_ids),
        )
    )
    await connection.execute(
        update(chat_members)
        .where(
            chat_members.c.chat_id == chat_id,
            chat_members.c.user_id != author_user_id,
        )
        .values(
            member_role="member",
            permissions=ChatPermissions().model_dump(),
        )
    )
    await connection.execute(
        pg_insert(chat_members)
        .values(
            chat_id=chat_id,
            user_id=author_user_id,
            member_role="owner",
            permissions=messenger_service.FULL_PERMISSIONS.model_dump(),
            joined_at=now,
            muted_until=None,
        )
        .on_conflict_do_update(
            index_elements=[chat_members.c.chat_id, chat_members.c.user_id],
            set_={
                "member_role": "owner",
                "permissions": messenger_service.FULL_PERMISSIONS.model_dump(),
            },
        )
    )
    member_values = [
        {
            "chat_id": chat_id,
            "user_id": user_id,
            "member_role": "member",
            "permissions": ChatPermissions().model_dump(),
            "joined_at": now,
            "muted_until": None,
        }
        for user_id in sorted(desired_ids - {author_user_id})
    ]
    if member_values:
        await connection.execute(
            pg_insert(chat_members).values(member_values).on_conflict_do_nothing()
        )
    return cast(UUID, chat_id)


async def create_task(
    connection: AsyncConnection,
    current_user: AuthenticatedUser,
    payload: CreateTaskRequest,
) -> TaskResponse:
    try:
        assignee_id = UUID(payload.assignee_id) if payload.assignee_id else current_user.id
        source_message_id = UUID(payload.source_message_id) if payload.source_message_id else None
        parent_task_id = UUID(payload.parent_task_id) if payload.parent_task_id else None
    except ValueError as error:
        raise WorkspaceRepositoryError(422, "Invalid linked object identifier") from error
    assignee_exists = await connection.scalar(
        select(func.count())
        .select_from(users)
        .where(
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
    parent_row: Record | None = None
    if parent_task_id is not None:
        parent_row = await _task_access_row(connection, current_user, parent_task_id, edit=True)
        if parent_row["status"] in {"completed", "cancelled"}:
            raise WorkspaceRepositoryError(409, "A closed task cannot receive new subtasks")
    participant_ids: list[tuple[UUID, str]] = []
    seen_participants: set[UUID] = set()
    for participant in payload.participants:
        participant_id = await _active_user_id(connection, participant.user_id)
        if participant_id == assignee_id:
            raise WorkspaceRepositoryError(
                409, "The primary assignee is already a task participant"
            )
        if participant_id in seen_participants:
            raise WorkspaceRepositoryError(409, "A task participant can have only one role")
        seen_participants.add(participant_id)
        participant_ids.append((participant_id, participant.role))
    dependency_ids: list[tuple[UUID, str]] = []
    seen_dependencies: set[UUID] = set()
    for dependency in payload.dependencies:
        try:
            dependency_id = UUID(dependency.depends_on_task_id)
        except ValueError as error:
            raise WorkspaceRepositoryError(422, "Invalid dependency task identifier") from error
        if dependency_id in seen_dependencies:
            raise WorkspaceRepositoryError(409, "A dependency can be added only once")
        await _task_access_row(connection, current_user, dependency_id)
        seen_dependencies.add(dependency_id)
        dependency_ids.append((dependency_id, dependency.dependency_kind))
    task_id = uuid4()
    now = datetime.now(UTC)
    cycle_id: UUID | None = None
    if payload.cycle is not None:
        cycle_id = await _create_task_cycle(connection, current_user, payload.cycle, now)
    values = {
        "id": task_id,
        "title": payload.title.strip(),
        "description": payload.description,
        "status": "new",
        "priority": payload.priority,
        "author_user_id": current_user.id,
        "primary_assignee_user_id": assignee_id,
        "parent_task_id": parent_task_id,
        "cycle_id": cycle_id,
        "cycle_occurrence_key": "initial" if cycle_id is not None else None,
        "project_key": payload.project,
        "starts_at": now,
        "due_at": payload.due_at,
        "result_text": None,
        "source_message_id": source_message_id,
        "created_at": now,
        "updated_at": now,
    }
    await connection.execute(insert(tasks).values(**values))
    if participant_ids:
        await connection.execute(
            insert(task_participants).values(
                [
                    {
                        "task_id": task_id,
                        "user_id": participant_id,
                        "participant_role": role,
                    }
                    for participant_id, role in participant_ids
                ]
            )
        )
    if payload.checklist:
        await connection.execute(
            insert(task_checklist_items).values(
                [
                    {
                        "id": uuid4(),
                        "task_id": task_id,
                        "title": item.title,
                        "is_completed": False,
                        "sort_order": index,
                        "created_by_user_id": current_user.id,
                        "completed_by_user_id": None,
                        "completed_at": None,
                        "created_at": now,
                        "updated_at": now,
                    }
                    for index, item in enumerate(payload.checklist, start=1)
                ]
            )
        )
    if dependency_ids:
        await connection.execute(
            insert(task_dependencies).values(
                [
                    {
                        "task_id": task_id,
                        "depends_on_task_id": dependency_id,
                        "dependency_kind": dependency_kind,
                        "created_by_user_id": current_user.id,
                        "created_at": now,
                    }
                    for dependency_id, dependency_kind in dependency_ids
                ]
            )
        )
    await record_task_event(
        connection,
        task_id=task_id,
        event_type="task_created",
        occurred_at=now,
        actor_user_id=current_user.id,
        assignee_user_id=assignee_id,
        due_at=payload.due_at,
        new_value={
            "status": "new",
            "assigneeId": str(assignee_id),
            "dueAt": payload.due_at.isoformat() if payload.due_at else None,
            "parentTaskId": str(parent_task_id) if parent_task_id else None,
        },
    )
    await _sync_task_chat(
        connection,
        task_id=task_id,
        title=payload.title,
        description=payload.description,
        author_user_id=current_user.id,
        assignee_user_id=assignee_id,
        occurred_at=now,
    )
    return await _task_response(connection, task_id)


async def _create_task_cycle(
    connection: AsyncConnection,
    current_user: AuthenticatedUser,
    payload: TaskCreateCycleRequest,
    now: datetime,
) -> UUID:
    try:
        ZoneInfo(payload.timezone)
    except (KeyError, ValueError) as error:
        raise WorkspaceRepositoryError(422, "Unknown cycle timezone") from error
    schedule_config: dict[str, Any] = {
        "interval": payload.interval,
        "calendarRule": payload.calendar_rule,
        "weekdays": payload.weekdays,
        "monthDays": payload.month_days,
    }
    if payload.schedule_kind == "calendar":
        next_run_at = _next_calendar_occurrence(
            payload.next_run_at or now + timedelta(minutes=1),
            schedule_config,
            payload.timezone,
            include_current=True,
        )
    else:
        next_run_at = payload.next_run_at or _advance_cycle_time(
            now, payload.schedule_kind, payload.interval
        )
    cycle_id = uuid4()
    await connection.execute(
        insert(task_cycles).values(
            id=cycle_id,
            title=payload.title,
            schedule_kind=payload.schedule_kind,
            schedule_config=schedule_config,
            timezone=payload.timezone,
            next_run_at=next_run_at,
            is_enabled=payload.is_enabled,
            created_by_user_id=current_user.id,
            created_at=now,
            updated_at=now,
        )
    )
    return cycle_id


async def update_task(
    connection: AsyncConnection,
    current_user: AuthenticatedUser,
    task_id: UUID,
    payload: UpdateTaskRequest,
) -> TaskResponse:
    task_row = await _task_access_row(connection, current_user, task_id, edit=True)
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
    if task_row["primary_assignee_user_id"] != assignee_id:
        await record_task_event(
            connection,
            task_id=task_id,
            event_type="assignee_changed",
            occurred_at=now,
            actor_user_id=current_user.id,
            assignee_user_id=assignee_id,
            due_at=payload.due_at,
            old_value={"assigneeId": str(task_row["primary_assignee_user_id"])},
            new_value={"assigneeId": str(assignee_id)},
        )
    if task_row["due_at"] != payload.due_at:
        await record_task_event(
            connection,
            task_id=task_id,
            event_type="deadline_changed",
            occurred_at=now,
            actor_user_id=current_user.id,
            assignee_user_id=assignee_id,
            due_at=payload.due_at,
            old_value={"dueAt": task_row["due_at"].isoformat() if task_row["due_at"] else None},
            new_value={"dueAt": payload.due_at.isoformat() if payload.due_at else None},
        )
    await connection.execute(
        delete(task_participants).where(
            task_participants.c.task_id == task_id,
            task_participants.c.user_id == assignee_id,
        )
    )
    await _sync_task_chat(
        connection,
        task_id=task_id,
        title=payload.title,
        description=payload.description,
        author_user_id=task_row["author_user_id"],
        assignee_user_id=assignee_id,
        occurred_at=now,
    )
    return await _task_response(connection, task_id)


async def delete_task(
    connection: AsyncConnection,
    current_user: AuthenticatedUser,
    task_id: UUID,
) -> None:
    """Permanently remove a task for its author or an administrator."""
    row = (
        (
            await connection.execute(
                select(tasks).where(tasks.c.id == task_id).with_for_update()
            )
        )
        .mappings()
        .first()
    )
    if row is None:
        raise WorkspaceRepositoryError(404, "Task was not found")
    if row["author_user_id"] != current_user.id and current_user.role not in {
        "admin",
        "superadmin",
    }:
        raise WorkspaceRepositoryError(
            403, "Only the task author or an administrator can delete it"
        )

    task_ids = {task_id}
    frontier = {task_id}
    while frontier:
        descendants = set(
            (
                await connection.execute(
                    select(tasks.c.id).where(tasks.c.parent_task_id.in_(frontier))
                )
            )
            .scalars()
            .all()
        )
        frontier = descendants - task_ids
        task_ids.update(frontier)

    task_chat_ids = set(
        (
            await connection.execute(
                select(chats.c.id).where(
                    chats.c.context_type == "task",
                    chats.c.context_id.in_(task_ids),
                )
            )
        )
        .scalars()
        .all()
    )
    if task_chat_ids:
        message_ids = set(
            (
                await connection.execute(
                    select(messages.c.id).where(messages.c.chat_id.in_(task_chat_ids))
                )
            )
            .scalars()
            .all()
        )
        if message_ids:
            await connection.execute(
                delete(attachments).where(
                    attachments.c.owner_type == "message",
                    attachments.c.owner_id.in_(message_ids),
                )
            )
        await connection.execute(delete(chats).where(chats.c.id.in_(task_chat_ids)))

    await connection.execute(
        delete(attachments).where(
            attachments.c.owner_type == "task",
            attachments.c.owner_id.in_(task_ids),
        )
    )
    await connection.execute(
        delete(task_efficiency_events).where(task_efficiency_events.c.task_id.in_(task_ids))
    )
    await connection.execute(delete(tasks).where(tasks.c.id == task_id))
    await connection.execute(
        insert(audit_events).values(
            id=uuid4(),
            actor_user_id=current_user.id,
            action="task.deleted",
            target_type="task",
            target_id=task_id,
            details={
                "title": row["title"],
                "status": row["status"],
                "deletedTaskCount": len(task_ids),
            },
            created_at=datetime.now(UTC),
        )
    )


async def change_task_status(
    connection: AsyncConnection,
    current_user: AuthenticatedUser,
    task_id: UUID,
    payload: ChangeTaskStatusRequest,
) -> TaskResponse:
    task_row = await _task_access_row(connection, current_user, task_id, edit=True)
    if payload.status in {"awaiting_review", "completed"}:
        raise WorkspaceRepositoryError(
            409,
            "Use result submission or result acceptance for this status",
        )
    if payload.status == task_row["status"]:
        return await _task_response(connection, task_id)
    allowed_transitions = {
        "new": {"in_progress", "cancelled"},
        "in_progress": {"new", "cancelled"},
        "overdue": {"in_progress", "cancelled"},
    }
    if payload.status not in allowed_transitions.get(task_row["status"], set()):
        raise WorkspaceRepositoryError(409, "This task status transition is not allowed")
    if payload.status == "cancelled":
        is_author = task_row["author_user_id"] == current_user.id
        if not is_author and not _is_privileged(current_user):
            raise WorkspaceRepositoryError(403, "Only the task author can cancel it")
    updated_at = datetime.now(UTC)
    await connection.execute(
        update(tasks)
        .where(tasks.c.id == task_id)
        .values(status=payload.status, updated_at=updated_at)
    )
    if payload.status != task_row["status"]:
        base_event = {
            "connection": connection,
            "task_id": task_id,
            "occurred_at": updated_at,
            "actor_user_id": current_user.id,
            "assignee_user_id": task_row["primary_assignee_user_id"],
            "due_at": task_row["due_at"],
            "old_value": {"status": task_row["status"]},
            "new_value": {"status": payload.status},
        }
        if payload.status == "cancelled":
            await record_task_event(
                event_type="task_cancelled", reason_code="cancelled", **base_event
            )
        else:
            await record_task_event(event_type="task_status_changed", **base_event)
    return await _task_response(connection, task_id)


async def _ensure_task_can_be_submitted(
    connection: AsyncConnection,
    task_id: UUID,
) -> None:
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
            "Task cannot be submitted until its blocking dependencies are completed",
        )


async def _ensure_subtasks_are_closed(
    connection: AsyncConnection,
    task_id: UUID,
) -> None:
    incomplete_subtasks = await connection.scalar(
        select(func.count())
        .select_from(tasks)
        .where(
            tasks.c.parent_task_id == task_id,
            tasks.c.status.not_in({"completed", "cancelled"}),
        )
    )
    if incomplete_subtasks:
        raise WorkspaceRepositoryError(
            409,
            "Complete or cancel every subtask before accepting the parent task",
        )


async def submit_task_result(
    connection: AsyncConnection,
    current_user: AuthenticatedUser,
    task_id: UUID,
    payload: SubmitTaskResultRequest,
) -> TaskResponse:
    task_row = await _task_access_row(connection, current_user, task_id, edit=True)
    participant_roles = set(
        (
            await connection.execute(
                select(task_participants.c.participant_role).where(
                    task_participants.c.task_id == task_id,
                    task_participants.c.user_id == current_user.id,
                )
            )
        ).scalars()
    )
    can_submit = (
        task_row["primary_assignee_user_id"] == current_user.id
        or "co_assignee" in participant_roles
        or _is_privileged(current_user)
    )
    if not can_submit:
        raise WorkspaceRepositoryError(403, "Only an assignee can submit the result")
    if task_row["status"] not in {"new", "in_progress", "overdue"}:
        raise WorkspaceRepositoryError(409, "This task cannot be submitted for review")
    await _ensure_task_can_be_submitted(connection, task_id)
    now = datetime.now(UTC)
    await connection.execute(
        update(tasks)
        .where(tasks.c.id == task_id)
        .values(
            status="awaiting_review",
            result_text=payload.result_text,
            updated_at=now,
        )
    )
    event_id = await record_task_event(
        connection,
        task_id=task_id,
        event_type="result_submitted_for_review",
        occurred_at=now,
        actor_user_id=current_user.id,
        assignee_user_id=task_row["primary_assignee_user_id"],
        due_at=task_row["due_at"],
        old_value={"status": task_row["status"]},
        new_value={"status": "awaiting_review"},
        metadata={"resultLength": len(payload.result_text)},
    )
    if task_row["author_user_id"] != current_user.id:
        await _upsert_notification(
            connection,
            user_id=task_row["author_user_id"],
            event_key=f"task:review:{event_id}",
            kind="task",
            priority="attention",
            title="Результат ожидает проверки",
            body=task_row["title"],
            section="tasks",
            entity_id=task_id,
            requires_action=True,
            occurred_at=now,
        )
    return await _task_response(connection, task_id)


async def accept_task_result(
    connection: AsyncConnection,
    current_user: AuthenticatedUser,
    task_id: UUID,
) -> TaskResponse:
    task_row = await _task_access_row(connection, current_user, task_id, manage=True)
    if task_row["status"] != "awaiting_review":
        raise WorkspaceRepositoryError(409, "Only a submitted result can be accepted")
    await _ensure_task_can_be_submitted(connection, task_id)
    await _ensure_subtasks_are_closed(connection, task_id)
    now = datetime.now(UTC)
    await connection.execute(
        update(tasks).where(tasks.c.id == task_id).values(status="completed", updated_at=now)
    )
    event_values = {
        "connection": connection,
        "task_id": task_id,
        "occurred_at": now,
        "actor_user_id": current_user.id,
        "assignee_user_id": task_row["primary_assignee_user_id"],
        "due_at": task_row["due_at"],
        "old_value": {"status": "awaiting_review"},
        "new_value": {"status": "completed"},
    }
    event_id = await record_task_event(event_type="result_accepted", **event_values)
    await record_task_event(event_type="task_completed", **event_values)
    if task_row["primary_assignee_user_id"] != current_user.id:
        await _upsert_notification(
            connection,
            user_id=task_row["primary_assignee_user_id"],
            event_key=f"task:accepted:{event_id}",
            kind="task",
            priority="normal",
            title="Результат принят",
            body=task_row["title"],
            section="tasks",
            entity_id=task_id,
            requires_action=False,
            occurred_at=now,
        )
    return await _task_response(connection, task_id)


async def return_task_for_revision(
    connection: AsyncConnection,
    current_user: AuthenticatedUser,
    task_id: UUID,
    payload: ReturnTaskForRevisionRequest,
) -> TaskResponse:
    task_row = await _task_access_row(connection, current_user, task_id, manage=True)
    if task_row["status"] != "awaiting_review":
        raise WorkspaceRepositoryError(409, "Only a submitted result can be returned for revision")
    now = datetime.now(UTC)
    await connection.execute(
        update(tasks).where(tasks.c.id == task_id).values(status="in_progress", updated_at=now)
    )
    event_id = await record_task_event(
        connection,
        task_id=task_id,
        event_type="result_returned_for_revision",
        occurred_at=now,
        actor_user_id=current_user.id,
        assignee_user_id=task_row["primary_assignee_user_id"],
        due_at=task_row["due_at"],
        old_value={"status": task_row["status"]},
        new_value={"status": "in_progress"},
        reason_code=payload.reason_code,
        reason_text=payload.reason_text.strip() or None,
    )
    reason_labels = {
        "incomplete_result": "результат неполный",
        "requirements_not_met": "требования не выполнены",
        "corrections_required": "нужны исправления",
        "other": "указана другая причина",
    }
    await _upsert_notification(
        connection,
        user_id=task_row["primary_assignee_user_id"],
        event_key=f"efficiency:return:{event_id}:{METHODOLOGY_VERSION}",
        kind="task",
        priority="attention",
        title="Задача возвращена на доработку",
        body=f"{task_row['title']} · {reason_labels[payload.reason_code]}",
        section="tasks",
        entity_id=task_id,
        requires_action=True,
        occurred_at=now,
    )
    return await _task_response(connection, task_id)


async def set_task_efficiency_exclusion(
    connection: AsyncConnection,
    current_user: AuthenticatedUser,
    task_id: UUID,
    payload: TaskEfficiencyExclusionRequest,
) -> TaskResponse:
    task_row = await _task_access_row(connection, current_user, task_id, manage=True)
    latest = (
        (
            await connection.execute(
                select(task_efficiency_events)
                .where(
                    task_efficiency_events.c.task_id == task_id,
                    task_efficiency_events.c.event_type.in_(
                        {"efficiency_excluded", "efficiency_exclusion_changed"}
                    ),
                )
                .order_by(task_efficiency_events.c.occurred_at.desc())
                .limit(1)
            )
        )
        .mappings()
        .first()
    )
    previously_excluded = bool((latest["new_value"] or {}).get("excluded")) if latest else False
    if previously_excluded == payload.excluded and (
        not payload.excluded
        or (
            latest
            and latest["reason_code"] == payload.reason_code
            and (latest["reason_text"] or "") == payload.reason_text.strip()
        )
    ):
        return await _task_response(connection, task_id)
    now = datetime.now(UTC)
    await record_task_event(
        connection,
        task_id=task_id,
        event_type="efficiency_exclusion_changed" if latest else "efficiency_excluded",
        occurred_at=now,
        actor_user_id=current_user.id,
        assignee_user_id=task_row["primary_assignee_user_id"],
        due_at=task_row["due_at"],
        old_value={"excluded": previously_excluded},
        new_value={"excluded": payload.excluded},
        reason_code=payload.reason_code if payload.excluded else None,
        reason_text=payload.reason_text.strip() or None,
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
    await _sync_task_chat(
        connection,
        task_id=task_id,
        title=task_row["title"],
        description=task_row["description"],
        author_user_id=task_row["author_user_id"],
        assignee_user_id=task_row["primary_assignee_user_id"],
    )
    return await _task_response(connection, task_id)


async def remove_task_participant(
    connection: AsyncConnection,
    current_user: AuthenticatedUser,
    task_id: UUID,
    user_id: UUID,
) -> TaskResponse:
    task_row = await _task_access_row(connection, current_user, task_id, manage=True)
    await connection.execute(
        delete(task_participants).where(
            task_participants.c.task_id == task_id,
            task_participants.c.user_id == user_id,
        )
    )
    await _sync_task_chat(
        connection,
        task_id=task_id,
        title=task_row["title"],
        description=task_row["description"],
        author_user_id=task_row["author_user_id"],
        assignee_user_id=task_row["primary_assignee_user_id"],
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
        select(func.count())
        .select_from(task_checklist_items)
        .where(
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


def _next_calendar_occurrence(
    value: datetime,
    config: Mapping[str, Any],
    timezone: str,
    *,
    include_current: bool = False,
) -> datetime:
    zone = ZoneInfo(timezone)
    aware_value = value if value.tzinfo is not None else value.replace(tzinfo=UTC)
    local_value = aware_value.astimezone(zone)
    weekdays = {int(day) for day in config.get("weekdays", [])}
    month_days = {int(day) for day in config.get("monthDays", [])}
    rule = config.get("calendarRule")
    start_offset = 0 if include_current else 1
    for offset in range(start_offset, 366 * 8):
        candidate = local_value + timedelta(days=offset)
        matches = (rule == "weekdays" and candidate.weekday() in weekdays) or (
            rule == "month_days" and candidate.day in month_days
        )
        if matches:
            return candidate.astimezone(UTC)
    raise WorkspaceRepositoryError(422, "Calendar rule has no future occurrence")


def _advance_cycle_time(
    value: datetime,
    schedule_kind: str,
    interval: int,
    config: Mapping[str, Any] | None = None,
    timezone: str = "Asia/Tashkent",
) -> datetime:
    if schedule_kind == "daily":
        return value + timedelta(days=interval)
    if schedule_kind == "weekly":
        return value + timedelta(weeks=interval)
    if schedule_kind == "calendar":
        return _next_calendar_occurrence(value, config or {}, timezone)
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
    try:
        ZoneInfo(payload.timezone)
    except (KeyError, ValueError) as error:
        raise WorkspaceRepositoryError(422, "Unknown cycle timezone") from error
    schedule_config: dict[str, Any] = {
        "interval": payload.interval,
        "calendarRule": payload.calendar_rule,
        "weekdays": payload.weekdays,
        "monthDays": payload.month_days,
    }
    if payload.schedule_kind == "calendar":
        next_run_at = _next_calendar_occurrence(
            payload.next_run_at or now + timedelta(minutes=1),
            schedule_config,
            payload.timezone,
            include_current=True,
        )
    else:
        next_run_at = payload.next_run_at or _advance_cycle_time(
            now, payload.schedule_kind, payload.interval
        )
    cycle_id = task_row["cycle_id"] or uuid4()
    values = {
        "title": payload.title,
        "schedule_kind": payload.schedule_kind,
        "schedule_config": schedule_config,
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
        (
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
        )
        .mappings()
        .all()
    )
    created = 0
    for cycle in cycle_rows:
        scheduled_at = cycle["next_run_at"]
        schedule_config = cycle["schedule_config"] or {}
        interval = int(schedule_config.get("interval", 1))
        next_run_at = _advance_cycle_time(
            scheduled_at,
            cycle["schedule_kind"],
            interval,
            schedule_config,
            cycle["timezone"],
        )
        template = (
            (
                await connection.execute(
                    select(tasks)
                    .where(tasks.c.cycle_id == cycle["id"])
                    .order_by(tasks.c.created_at.desc())
                    .limit(1)
                )
            )
            .mappings()
            .first()
        )
        occurrence_key = scheduled_at.isoformat()
        exists = await connection.scalar(
            select(func.count())
            .select_from(tasks)
            .where(
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
            generated_due_at = scheduled_at + duration if duration is not None else None
            await record_task_event(
                connection,
                task_id=task_id,
                event_type="task_created",
                occurred_at=current_time,
                actor_user_id=cycle["created_by_user_id"],
                assignee_user_id=template["primary_assignee_user_id"],
                due_at=generated_due_at,
                new_value={
                    "status": "new",
                    "assigneeId": str(template["primary_assignee_user_id"]),
                    "dueAt": generated_due_at.isoformat() if generated_due_at else None,
                    "source": "task_cycle",
                },
            )
            participant_rows = (
                (
                    await connection.execute(
                        select(task_participants).where(
                            task_participants.c.task_id == template["id"]
                        )
                    )
                )
                .mappings()
                .all()
            )
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
                (
                    await connection.execute(
                        select(task_checklist_items).where(
                            task_checklist_items.c.task_id == template["id"]
                        )
                    )
                )
                .mappings()
                .all()
            )
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
            await _sync_task_chat(
                connection,
                task_id=task_id,
                title=cycle["title"],
                description=template["description"],
                author_user_id=cycle["created_by_user_id"],
                assignee_user_id=template["primary_assignee_user_id"],
                occurred_at=current_time,
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
    routes = [(edge.source, edge.outcome, edge.sort_order) for edge in payload.edges]
    if len(routes) != len(set(routes)):
        raise WorkspaceRepositoryError(
            422,
            "Outgoing workflow routes must have unique sort order per outcome",
        )
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
    if current_user.role not in {"admin", "superadmin"}:
        raise WorkspaceRepositoryError(403, "Only administrators can edit workflows")
    _validate_graph(payload)
    template = (
        (
            await connection.execute(
                select(approval_templates)
                .where(approval_templates.c.id == template_id)
                .with_for_update()
            )
        )
        .mappings()
        .first()
    )
    if template is None:
        raise WorkspaceRepositoryError(404, "Workflow was not found")
    if template["status"] != "draft":
        raise WorkspaceRepositoryError(409, "Published workflow versions cannot be edited")
    referenced = await connection.scalar(
        select(func.count())
        .select_from(approval_requests)
        .where(approval_requests.c.template_id == template_id)
    )
    if referenced:
        raise WorkspaceRepositoryError(409, "A workflow used by requests cannot be edited")
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
    return await _workflow_response(connection, template)


async def publish_workflow(
    connection: AsyncConnection,
    current_user: AuthenticatedUser,
    template_id: UUID,
) -> WorkflowResponse:
    if current_user.role not in {"admin", "superadmin"}:
        raise WorkspaceRepositoryError(403, "Only administrators can publish workflows")
    template = (
        (
            await connection.execute(
                select(approval_templates)
                .where(approval_templates.c.id == template_id)
                .with_for_update()
            )
        )
        .mappings()
        .first()
    )
    if template is None:
        raise WorkspaceRepositoryError(404, "Workflow was not found")
    if template["status"] != "draft":
        raise WorkspaceRepositoryError(409, "Only a draft workflow can be published")
    referenced = await connection.scalar(
        select(func.count())
        .select_from(approval_requests)
        .where(approval_requests.c.template_id == template_id)
    )
    if referenced:
        raise WorkspaceRepositoryError(409, "A workflow used by requests cannot be published")

    node_rows = (
        (
            await connection.execute(
                select(approval_nodes).where(approval_nodes.c.template_id == template_id)
            )
        )
        .mappings()
        .all()
    )
    edge_rows = (
        (
            await connection.execute(
                select(approval_edges).where(approval_edges.c.template_id == template_id)
            )
        )
        .mappings()
        .all()
    )
    _validate_graph(
        SaveWorkflowRequest(
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
    )
    now = datetime.now(UTC)
    await connection.execute(
        update(approval_templates)
        .where(
            approval_templates.c.template_key == template["template_key"],
            approval_templates.c.status == "published",
        )
        .values(status="archived")
    )
    await connection.execute(
        update(approval_templates)
        .where(approval_templates.c.id == template_id)
        .values(status="published", published_at=now)
    )

    next_version = (
        int(
            await connection.scalar(
                select(func.max(approval_templates.c.version)).where(
                    approval_templates.c.template_key == template["template_key"]
                )
            )
            or template["version"]
        )
        + 1
    )
    draft_id = uuid4()
    draft_values = {
        "id": draft_id,
        "template_key": template["template_key"],
        "name": template["name"],
        "request_kind": template["request_kind"],
        "version": next_version,
        "status": "draft",
        "form_schema": template["form_schema"] or {},
        "created_by_user_id": current_user.id,
        "created_at": now,
        "published_at": None,
    }
    await connection.execute(insert(approval_templates).values(**draft_values))
    if node_rows:
        await connection.execute(
            insert(approval_nodes),
            [
                {
                    "id": uuid4(),
                    "template_id": draft_id,
                    "node_key": row["node_key"],
                    "kind": row["kind"],
                    "title": row["title"],
                    "config": row["config"] or {},
                    "position_x": row["position_x"],
                    "position_y": row["position_y"],
                }
                for row in node_rows
            ],
        )
    if edge_rows:
        await connection.execute(
            insert(approval_edges),
            [
                {
                    "id": uuid4(),
                    "template_id": draft_id,
                    "source_node_key": row["source_node_key"],
                    "target_node_key": row["target_node_key"],
                    "outcome": row["outcome"],
                    "label": row["label"],
                    "condition": row["condition"] or {},
                    "sort_order": row["sort_order"],
                }
                for row in edge_rows
            ],
        )
    return await _workflow_response(connection, draft_values)


PAYMENT_DETAIL_FIELDS = {
    "transfer_type",
    "project_name",
    "project_code",
    "source_account",
    "destination_account",
    "request_priority",
    "deadline",
    "comment",
    "trip_purpose",
    "trip_start_date",
    "trip_end_date",
    "employee_ids",
    "payment_purpose",
    "payment_reason",
    "responsible_user_id",
}


def _payment_payload(model: CreateApprovalRequest | UpdateApprovalRequest) -> dict[str, Any]:
    return model.model_dump(mode="json", include=PAYMENT_DETAIL_FIELDS)


async def _validate_request_people(
    connection: AsyncConnection,
    current_user: AuthenticatedUser,
    responsible_user_id: str | None,
    employee_ids: Sequence[str],
) -> tuple[UUID, list[str]]:
    responsible_id = (
        await _active_user_id(connection, responsible_user_id)
        if responsible_user_id
        else current_user.id
    )
    validated_employees: list[str] = []
    for value in dict.fromkeys(employee_ids):
        validated_employees.append(str(await _active_user_id(connection, value)))
    return responsible_id, validated_employees


async def _can_create_payment_request(
    connection: AsyncConnection,
    current_user: AuthenticatedUser,
    template_id: UUID,
) -> bool:
    if current_user.role == "superadmin":
        return True
    start_config = await connection.scalar(
        select(approval_nodes.c.config).where(
            approval_nodes.c.template_id == template_id,
            approval_nodes.c.kind == "start",
        )
    )
    creator_position_ids = (start_config or {}).get("creatorPositionIds")
    if not isinstance(creator_position_ids, list):
        return True
    position_id = str(current_user.position_id) if current_user.position_id else None
    return position_id is not None and position_id in {str(value) for value in creator_position_ids}


async def create_approval_request(
    connection: AsyncConnection,
    current_user: AuthenticatedUser,
    payload: CreateApprovalRequest,
) -> ApprovalRequestResponse:
    template = await _published_payment_template(connection)
    if not await _can_create_payment_request(connection, current_user, template["id"]):
        raise WorkspaceRepositoryError(
            403,
            "This position cannot create payment requests",
        )
    try:
        source_task_id = UUID(payload.source_task_id) if payload.source_task_id else None
    except ValueError as error:
        raise WorkspaceRepositoryError(422, "Invalid source task identifier") from error
    if source_task_id is not None:
        try:
            await _task_access_row(connection, current_user, source_task_id)
        except WorkspaceRepositoryError as error:
            raise WorkspaceRepositoryError(422, "Source task is not accessible") from error
    responsible_id, employee_ids = await _validate_request_people(
        connection,
        current_user,
        payload.responsible_user_id,
        payload.employee_ids,
    )
    request_id = uuid4()
    now = datetime.now(UTC)
    number = str(int(now.timestamp() * 1000))[-6:]
    request_payload = {
        **_payment_payload(payload),
        "amount": payload.amount,
        "currency": payload.currency.upper(),
        "purpose": payload.purpose,
        "number": number,
        "responsible_user_id": str(responsible_id),
        "employee_ids": employee_ids,
    }
    targets = await _resolve_workflow_targets(
        connection,
        template["id"],
        "start",
        "submit",
        request_payload,
    )
    active_node_keys = [key for key, kind in targets if kind != "end"]
    if not active_node_keys:
        raise WorkspaceRepositoryError(409, "Workflow start is not connected")
    values = {
        "id": request_id,
        "template_id": template["id"],
        "requester_user_id": current_user.id,
        "responsible_user_id": responsible_id,
        "title": payload.title.strip(),
        "payload": request_payload,
        "status": "running",
        "active_node_keys": active_node_keys,
        "actor_overrides": {},
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
    return await _request_response(connection, request_id, current_user)


async def _attachment_ids_for_request(
    connection: AsyncConnection,
    request_id: UUID,
) -> list[str]:
    values = (
        (
            await connection.execute(
                select(attachments.c.id)
                .where(
                    attachments.c.owner_type == "approval_request",
                    attachments.c.owner_id == request_id,
                )
                .order_by(attachments.c.created_at)
            )
        )
        .scalars()
        .all()
    )
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
        (
            await connection.execute(
                select(approval_requests)
                .where(approval_requests.c.id == request_id)
                .with_for_update()
            )
        )
        .mappings()
        .first()
    )
    if row is None:
        raise WorkspaceRepositoryError(404, "Request was not found")
    if row["status"] != "needs_revision":
        raise WorkspaceRepositoryError(409, "Only a returned request can be edited")
    can_revise = row["requester_user_id"] == current_user.id or any(
        [
            await _can_act_on_node(connection, current_user, row, node_key)
            for node_key in row["active_node_keys"] or []
        ]
    )
    if not can_revise:
        raise WorkspaceRepositoryError(403, "This user cannot edit the returned request")

    responsible_id, employee_ids = await _validate_request_people(
        connection,
        current_user,
        payload.responsible_user_id or str(row["responsible_user_id"]),
        payload.employee_ids,
    )
    updated_payload = {
        **(row["payload"] or {}),
        **_payment_payload(payload),
        "amount": payload.amount,
        "currency": payload.currency.upper(),
        "purpose": payload.purpose,
        "responsible_user_id": str(responsible_id),
        "employee_ids": employee_ids,
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
        .values(
            title=title,
            payload=updated_payload,
            responsible_user_id=responsible_id,
            current_version=next_version,
        )
    )
    return await _request_response(connection, request_id, current_user)


async def delete_approval_request(
    connection: AsyncConnection,
    current_user: AuthenticatedUser,
    request_id: UUID,
) -> None:
    """Permanently remove a payment request; only administrators may do so."""
    if current_user.role not in {"admin", "superadmin"}:
        raise WorkspaceRepositoryError(403, "Only administrators can delete payment requests")
    row = (
        (
            await connection.execute(
                select(approval_requests)
                .where(approval_requests.c.id == request_id)
                .with_for_update()
            )
        )
        .mappings()
        .first()
    )
    if row is None:
        raise WorkspaceRepositoryError(404, "Request was not found")

    # Request history and deadline/action rows cascade from approval_requests. The
    # attachment table intentionally has a polymorphic owner, so clean its rows
    # explicitly to avoid leaving metadata that points at a deleted request.
    await connection.execute(
        delete(attachments).where(
            attachments.c.owner_type == "approval_request",
            attachments.c.owner_id == request_id,
        )
    )
    await connection.execute(delete(approval_requests).where(approval_requests.c.id == request_id))
    await connection.execute(
        insert(audit_events).values(
            id=uuid4(),
            actor_user_id=current_user.id,
            action="approval_request.deleted",
            target_type="approval_request",
            target_id=request_id,
            details={"number": (row["payload"] or {}).get("number"), "title": row["title"]},
            created_at=datetime.now(UTC),
        )
    )


async def validate_attachment_owner(
    connection: AsyncConnection,
    current_user: AuthenticatedUser,
    owner_type: AttachmentOwnerType,
    owner_id: UUID,
    *,
    write: bool,
) -> None:
    if owner_type == "message":
        if write:
            chat_id = await connection.scalar(
                select(messages.c.chat_id).where(messages.c.id == owner_id)
            )
            if chat_id is None:
                raise WorkspaceRepositoryError(404, "Message was not found")
            _, member = await messenger_service.chat_access(
                connection, current_user, chat_id, lock=True
            )
            permissions = messenger_service.member_permissions(member)
            if not permissions.send_messages or not permissions.upload_files:
                raise WorkspaceRepositoryError(403, "Нет права отправлять файлы в этой группе")
        row = (
            (
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
            )
            .mappings()
            .first()
        )
        if row is None or (write and row["author_user_id"] != current_user.id):
            raise WorkspaceRepositoryError(404, "Message was not found")
        return

    if owner_type == "task":
        await _task_access_row(connection, current_user, owner_id, edit=write)
        return

    if owner_type == "absence":
        absence = (
            (
                await connection.execute(
                    select(absence_requests).where(absence_requests.c.id == owner_id)
                )
            )
            .mappings()
            .first()
        )
        if absence is None:
            raise WorkspaceRepositoryError(404, "Больничный документ не найден")
        allowed = (
            current_user.role in {"admin", "superadmin"}
            or absence["requester_user_id"] == current_user.id
        )
        writable = (
            allowed
            and absence["requester_user_id"] == current_user.id
            and absence["kind"] == "sick_leave"
        )
        if not allowed or (write and not writable):
            raise WorkspaceRepositoryError(404, "Больничный документ не найден")
        return

    row = (
        (
            await connection.execute(
                select(approval_requests).where(approval_requests.c.id == owner_id)
            )
        )
        .mappings()
        .first()
    )
    assigned_actor = False
    if row is not None:
        assigned_actor = any(
            [
                await _can_act_on_node(connection, current_user, row, node_key)
                for node_key in row["active_node_keys"] or []
            ]
        )
    accessible = row is not None and (
        current_user.role in {"manager", "admin", "superadmin"}
        or row["requester_user_id"] == current_user.id
        or row["responsible_user_id"] == current_user.id
        or assigned_actor
    )
    writable = (
        row is not None
        and row["status"] in {"running", "needs_revision"}
        and (
            row["requester_user_id"] == current_user.id
            or (row["status"] == "needs_revision" and assigned_actor)
        )
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
    document_role: str = "general",
    media_kind: str = "file",
    media_duration_ms: int | None = None,
    media_codec: str | None = None,
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
        "document_role": document_role,
        "media_kind": media_kind,
        "media_duration_ms": media_duration_ms,
        "media_codec": media_codec,
        "created_at": now,
    }
    await connection.execute(insert(attachments).values(**values))
    if owner_type == "approval_request":
        request_row = (
            (
                await connection.execute(
                    select(approval_requests)
                    .where(approval_requests.c.id == owner_id)
                    .with_for_update()
                )
            )
            .mappings()
            .one()
        )
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
        (await connection.execute(select(attachments).where(attachments.c.id == attachment_id)))
        .mappings()
        .first()
    )
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


async def _project_response(
    connection: AsyncConnection,
    current_user: AuthenticatedUser,
    project_id: UUID,
) -> ProjectResponse:
    row = (
        (
            await connection.execute(
                select(workspace_projects).where(workspace_projects.c.id == project_id)
            )
        )
        .mappings()
        .first()
    )
    if row is None:
        raise WorkspaceRepositoryError(404, "Project was not found")
    history = await _project_action_map(connection, [project_id])
    return _project(row, current_user, history.get(project_id, []))


async def create_project(
    connection: AsyncConnection,
    current_user: AuthenticatedUser,
    payload: CreateProjectRequest,
) -> ProjectResponse:
    if not _is_privileged(current_user):
        raise WorkspaceRepositoryError(403, "Only managers can create projects")
    manager_id = await _active_user_id(connection, payload.manager_user_id)
    normalized_code = payload.code.upper()
    duplicate = await connection.scalar(
        select(workspace_projects.c.id).where(
            func.lower(workspace_projects.c.code) == normalized_code.lower()
        )
    )
    if duplicate is not None:
        raise WorkspaceRepositoryError(409, "Project code is already in use")
    project_id = uuid4()
    action_id = uuid4()
    now = datetime.now(UTC)
    await connection.execute(
        insert(workspace_projects).values(
            id=project_id,
            code=normalized_code,
            title=payload.title,
            description=payload.description,
            manager_user_id=manager_id,
            start_date=payload.start_date,
            end_date=payload.end_date,
            budget=payload.budget,
            spent_budget=payload.spent_budget,
            currency=payload.currency,
            status="new",
            stage="start",
            created_by_user_id=current_user.id,
            created_at=now,
            updated_at=now,
        )
    )
    await connection.execute(
        insert(project_stage_actions).values(
            id=action_id,
            project_id=project_id,
            actor_user_id=current_user.id,
            from_stage=None,
            to_stage="start",
            action="created",
            comment=None,
            created_at=now,
        )
    )
    return await _project_response(connection, current_user, project_id)


async def update_project(
    connection: AsyncConnection,
    current_user: AuthenticatedUser,
    project_id: UUID,
    payload: UpdateProjectRequest,
) -> ProjectResponse:
    if not _is_privileged(current_user):
        raise WorkspaceRepositoryError(403, "Only managers can edit projects")
    exists = await connection.scalar(
        select(workspace_projects.c.id).where(workspace_projects.c.id == project_id)
    )
    if exists is None:
        raise WorkspaceRepositoryError(404, "Project was not found")
    manager_id = await _active_user_id(connection, payload.manager_user_id)
    normalized_code = payload.code.upper()
    duplicate = await connection.scalar(
        select(workspace_projects.c.id).where(
            func.lower(workspace_projects.c.code) == normalized_code.lower(),
            workspace_projects.c.id != project_id,
        )
    )
    if duplicate is not None:
        raise WorkspaceRepositoryError(409, "Project code is already in use")
    await connection.execute(
        update(workspace_projects)
        .where(workspace_projects.c.id == project_id)
        .values(
            code=normalized_code,
            title=payload.title,
            description=payload.description,
            manager_user_id=manager_id,
            start_date=payload.start_date,
            end_date=payload.end_date,
            budget=payload.budget,
            spent_budget=payload.spent_budget,
            currency=payload.currency,
            updated_at=datetime.now(UTC),
        )
    )
    return await _project_response(connection, current_user, project_id)


async def change_project_stage(
    connection: AsyncConnection,
    current_user: AuthenticatedUser,
    project_id: UUID,
    payload: ChangeProjectStageRequest,
) -> ProjectResponse:
    if not _is_privileged(current_user):
        raise WorkspaceRepositoryError(403, "Only managers can move projects")
    row = (
        (
            await connection.execute(
                select(workspace_projects)
                .where(workspace_projects.c.id == project_id)
                .with_for_update()
            )
        )
        .mappings()
        .first()
    )
    if row is None:
        raise WorkspaceRepositoryError(404, "Project was not found")
    if payload.stage not in PROJECT_TRANSITIONS[row["stage"]]:
        raise WorkspaceRepositoryError(409, "Project cannot move between these stages")
    comment = payload.comment.strip() or None
    if payload.stage == "failure" and comment is None:
        raise WorkspaceRepositoryError(422, "A failure comment is required")
    now = datetime.now(UTC)
    await connection.execute(
        update(workspace_projects)
        .where(workspace_projects.c.id == project_id)
        .values(
            stage=payload.stage,
            status=PROJECT_STAGE_STATUS[payload.stage],
            updated_at=now,
        )
    )
    await connection.execute(
        insert(project_stage_actions).values(
            id=uuid4(),
            project_id=project_id,
            actor_user_id=current_user.id,
            from_stage=row["stage"],
            to_stage=payload.stage,
            action="moved",
            comment=comment,
            created_at=now,
        )
    )
    return await _project_response(connection, current_user, project_id)


async def _trip_response(
    connection: AsyncConnection,
    current_user: AuthenticatedUser,
    request_id: UUID,
) -> TripRequestResponse:
    row = (
        (await connection.execute(select(trip_requests).where(trip_requests.c.id == request_id)))
        .mappings()
        .first()
    )
    if row is None:
        raise WorkspaceRepositoryError(404, "Trip request was not found")
    employees, actions = await _trip_detail_maps(connection, [request_id])
    if (
        current_user.role == "employee"
        and row["requester_user_id"] != current_user.id
        and current_user.id not in employees.get(request_id, [])
    ):
        raise WorkspaceRepositoryError(404, "Trip request was not found")
    return _trip_request(
        row,
        current_user,
        employees.get(request_id, []),
        actions.get(request_id, []),
    )


async def _validate_trip_employees(
    connection: AsyncConnection,
    current_user: AuthenticatedUser,
    values: Sequence[str],
) -> list[UUID]:
    try:
        employee_ids = list(dict.fromkeys(UUID(value) for value in values))
    except ValueError as error:
        raise WorkspaceRepositoryError(422, "Invalid trip employee identifier") from error
    rows = (
        await connection.execute(
            select(users.c.id).where(users.c.id.in_(employee_ids), users.c.status == "active")
        )
    ).all()
    if len(rows) != len(employee_ids):
        raise WorkspaceRepositoryError(422, "Every trip employee must be active")
    if current_user.role == "employee" and employee_ids != [current_user.id]:
        raise WorkspaceRepositoryError(
            403, "Employees can create trip requests only for themselves"
        )
    return employee_ids


async def create_trip_request(
    connection: AsyncConnection,
    current_user: AuthenticatedUser,
    payload: CreateTripRequest,
) -> TripRequestResponse:
    employee_ids = await _validate_trip_employees(connection, current_user, payload.employee_ids)
    request_id = uuid4()
    now = datetime.now(UTC)
    await connection.execute(
        insert(trip_requests).values(
            id=request_id,
            requester_user_id=current_user.id,
            purpose=payload.purpose,
            destination=payload.destination,
            start_date=payload.start_date,
            end_date=payload.end_date,
            stage="launch",
            status="draft",
            created_at=now,
            updated_at=now,
            finished_at=None,
        )
    )
    await connection.execute(
        insert(trip_request_employees),
        [{"request_id": request_id, "user_id": user_id} for user_id in employee_ids],
    )
    await connection.execute(
        insert(trip_request_actions).values(
            id=uuid4(),
            request_id=request_id,
            actor_user_id=current_user.id,
            from_stage=None,
            to_stage="launch",
            action="created",
            comment=None,
            created_at=now,
        )
    )
    return await _trip_response(connection, current_user, request_id)


async def update_trip_request(
    connection: AsyncConnection,
    current_user: AuthenticatedUser,
    request_id: UUID,
    payload: UpdateTripRequest,
) -> TripRequestResponse:
    row = (
        (
            await connection.execute(
                select(trip_requests).where(trip_requests.c.id == request_id).with_for_update()
            )
        )
        .mappings()
        .first()
    )
    if row is None:
        raise WorkspaceRepositoryError(404, "Trip request was not found")
    if row["requester_user_id"] != current_user.id:
        raise WorkspaceRepositoryError(403, "Only the requester can edit this trip")
    if row["stage"] != "launch" or row["status"] not in {"draft", "needs_revision"}:
        raise WorkspaceRepositoryError(409, "Only a draft or returned trip can be edited")
    employee_ids = await _validate_trip_employees(connection, current_user, payload.employee_ids)
    await connection.execute(
        update(trip_requests)
        .where(trip_requests.c.id == request_id)
        .values(
            purpose=payload.purpose,
            destination=payload.destination,
            start_date=payload.start_date,
            end_date=payload.end_date,
            updated_at=datetime.now(UTC),
        )
    )
    await connection.execute(
        delete(trip_request_employees).where(trip_request_employees.c.request_id == request_id)
    )
    await connection.execute(
        insert(trip_request_employees),
        [{"request_id": request_id, "user_id": user_id} for user_id in employee_ids],
    )
    return await _trip_response(connection, current_user, request_id)


async def act_on_trip_request(
    connection: AsyncConnection,
    current_user: AuthenticatedUser,
    request_id: UUID,
    payload: TripActionRequest,
) -> TripRequestResponse:
    row = (
        (
            await connection.execute(
                select(trip_requests).where(trip_requests.c.id == request_id).with_for_update()
            )
        )
        .mappings()
        .first()
    )
    if row is None:
        raise WorkspaceRepositoryError(404, "Trip request was not found")
    allowed = _trip_allowed_actions(row, current_user)
    if payload.action not in allowed:
        raise WorkspaceRepositoryError(403, "This trip action is not allowed for the user")
    comment = payload.comment.strip() or None
    if payload.action in {"return", "reject"} and comment is None:
        raise WorkspaceRepositoryError(422, "A decision comment is required")

    from_stage = row["stage"]
    if payload.action in {"submit", "resubmit"}:
        to_stage, status, finished_at = "manager_approval", "running", None
    elif payload.action == "approve" and from_stage == "manager_approval":
        to_stage, status, finished_at = "hr", "running", None
    elif payload.action == "approve":
        to_stage, status, finished_at = "approved", "approved", datetime.now(UTC)
    elif payload.action == "return":
        to_stage, status, finished_at = "launch", "needs_revision", None
    else:
        to_stage, status, finished_at = "rejected", "rejected", datetime.now(UTC)

    now = datetime.now(UTC)
    await connection.execute(
        update(trip_requests)
        .where(trip_requests.c.id == request_id)
        .values(stage=to_stage, status=status, updated_at=now, finished_at=finished_at)
    )
    await connection.execute(
        insert(trip_request_actions).values(
            id=uuid4(),
            request_id=request_id,
            actor_user_id=current_user.id,
            from_stage=from_stage,
            to_stage=to_stage,
            action=payload.action,
            comment=comment,
            created_at=now,
        )
    )
    return await _trip_response(connection, current_user, request_id)


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


async def _resolve_workflow_targets(
    connection: AsyncConnection,
    template_id: UUID,
    source: str,
    outcome: str,
    request_payload: Mapping[str, Any],
    visited: set[str] | None = None,
) -> list[tuple[str, str]]:
    seen = set() if visited is None else set(visited)
    if source in seen:
        raise WorkspaceRepositoryError(409, "Workflow routing contains an endless cycle")
    seen.add(source)
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
            return []
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
        return [(correction, "correction")] if correction is not None else []

    resolved: list[tuple[str, str]] = []
    for edge in edges:
        target = edge["target_node_key"]
        target_row = (
            (
                await connection.execute(
                    select(approval_nodes).where(
                        approval_nodes.c.template_id == template_id,
                        approval_nodes.c.node_key == target,
                    )
                )
            )
            .mappings()
            .first()
        )
        if target_row is None:
            continue
        target_kind = target_row["kind"]
        if target_kind == "condition":
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
                    candidate
                    for candidate in condition_edges
                    if _condition_outcome(candidate["condition"] or {}, request_payload)
                ),
                None,
            )
            if chosen is not None:
                resolved.extend(
                    await _resolve_workflow_targets(
                        connection,
                        template_id,
                        target,
                        chosen["outcome"],
                        request_payload,
                        seen,
                    )
                )
            continue
        if target_kind == "parallel":
            branch_edges = (
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
            for branch in branch_edges:
                branch_target = branch["target_node_key"]
                branch_kind = await connection.scalar(
                    select(approval_nodes.c.kind).where(
                        approval_nodes.c.template_id == template_id,
                        approval_nodes.c.node_key == branch_target,
                    )
                )
                if branch_kind is not None:
                    resolved.append((branch_target, str(branch_kind)))
            continue
        if target_kind == "start":
            resolved.extend(
                await _resolve_workflow_targets(
                    connection,
                    template_id,
                    target,
                    "submit",
                    request_payload,
                    seen,
                )
            )
            continue
        resolved.append((target, str(target_kind)))
    return list(dict.fromkeys(resolved))


async def _parallel_context(
    connection: AsyncConnection,
    template_id: UUID,
    node_key: str,
) -> tuple[str, set[str]] | None:
    parallel_rows = (
        (
            await connection.execute(
                select(approval_nodes).where(
                    approval_nodes.c.template_id == template_id,
                    approval_nodes.c.kind == "parallel",
                )
            )
        )
        .mappings()
        .all()
    )
    for parallel in parallel_rows:
        siblings = set(
            (
                await connection.execute(
                    select(approval_edges.c.target_node_key).where(
                        approval_edges.c.template_id == template_id,
                        approval_edges.c.source_node_key == parallel["node_key"],
                    )
                )
            )
            .scalars()
            .all()
        )
        if node_key in siblings:
            mode = str((parallel["config"] or {}).get("decisionMode", "all"))
            return mode, siblings
    return None


async def _can_act_on_node(
    connection: AsyncConnection,
    current_user: AuthenticatedUser,
    request_row: Record,
    node_key: str,
) -> bool:
    config = (
        await connection.scalar(
            select(approval_nodes.c.config).where(
                approval_nodes.c.template_id == request_row["template_id"],
                approval_nodes.c.node_key == node_key,
            )
        )
        or {}
    )
    return _can_act_from_config(current_user, request_row, node_key, config)


async def act_on_request(
    connection: AsyncConnection,
    current_user: AuthenticatedUser,
    request_id: UUID,
    payload: ApprovalActionRequest,
) -> ApprovalRequestResponse:
    row = (
        (
            await connection.execute(
                select(approval_requests)
                .where(approval_requests.c.id == request_id)
                .with_for_update()
            )
        )
        .mappings()
        .first()
    )
    if row is None:
        raise WorkspaceRepositoryError(404, "Request was not found")
    if payload.action == "move":
        if not payload.node_key:
            raise WorkspaceRepositoryError(422, "A destination workflow stage is required")
        target = (
            (
                await connection.execute(
                    select(approval_nodes.c.node_key, approval_nodes.c.kind)
                    .where(
                        approval_nodes.c.template_id == row["template_id"],
                        approval_nodes.c.node_key == payload.node_key,
                    )
                )
            )
            .mappings()
            .first()
        )
        if target is None or target["kind"] not in {"approval", "correction"}:
            raise WorkspaceRepositoryError(422, "The destination is not a movable workflow stage")
        is_administrator = current_user.role in {"admin", "superadmin"}
        move_active_nodes: Sequence[str] = row["active_node_keys"] or []
        can_move_current = any(
            [
                await _can_act_on_node(connection, current_user, row, node)
                for node in move_active_nodes
            ]
        )
        if not is_administrator and not can_move_current:
            raise WorkspaceRepositoryError(403, "This user cannot move the request")
        now = datetime.now(UTC)
        await connection.execute(
            insert(approval_actions).values(
                id=uuid4(),
                request_id=request_id,
                node_key=payload.node_key,
                actor_user_id=current_user.id,
                delegated_to_user_id=None,
                action="move",
                comment=payload.comment,
                created_at=now,
            )
        )
        await connection.execute(
            update(approval_requests)
            .where(approval_requests.c.id == request_id)
            .values(
                status="needs_revision" if target["kind"] == "correction" else "running",
                active_node_keys=[payload.node_key],
                actor_overrides={},
                updated_at=now,
                finished_at=None,
            )
        )
        return await _request_response(connection, request_id, current_user)
    if row["status"] not in {"running", "needs_revision"}:
        raise WorkspaceRepositoryError(409, "Request is already finished")
    if payload.action in {"return", "reject"} and not (payload.comment or "").strip():
        raise WorkspaceRepositoryError(422, "A decision comment is required")
    resubmitting = payload.action == "resubmit"
    if not resubmitting and (
        payload.action == "cancel"
        and row["requester_user_id"] != current_user.id
        and current_user.role
        not in {
            "admin",
            "superadmin",
        }
    ):
        raise WorkspaceRepositoryError(403, "Only the requester can cancel this request")
    active_nodes: Sequence[str] = row["active_node_keys"] or []
    if not active_nodes:
        raise WorkspaceRepositoryError(409, "Request has no active workflow node")
    active_node = payload.node_key or active_nodes[0]
    if active_node not in active_nodes:
        raise WorkspaceRepositoryError(409, "The selected workflow stage is not active")
    if resubmitting and (
        row["status"] != "needs_revision"
        or (
            row["requester_user_id"] != current_user.id
            and not await _can_act_on_node(connection, current_user, row, active_node)
        )
    ):
        raise WorkspaceRepositoryError(403, "This user cannot resubmit the correction")
    if (
        not resubmitting
        and payload.action != "cancel"
        and not await _can_act_on_node(connection, current_user, row, active_node)
    ):
        raise WorkspaceRepositoryError(403, "This user cannot decide on the selected stage")
    delegated_to_user_id = None
    if payload.action == "delegate":
        if not payload.delegate_to_user_id:
            raise WorkspaceRepositoryError(422, "A delegation target is required")
        delegated_to_user_id = await _active_user_id(connection, payload.delegate_to_user_id)
    now = datetime.now(UTC)
    await connection.execute(
        insert(approval_actions).values(
            id=uuid4(),
            request_id=request_id,
            node_key=active_node,
            actor_user_id=current_user.id,
            delegated_to_user_id=delegated_to_user_id,
            action=payload.action,
            comment=payload.comment,
            created_at=now,
        )
    )
    status = row["status"]
    finished_at = None
    next_nodes = list(active_nodes)
    actor_overrides = dict(row.get("actor_overrides") or {})
    if payload.action == "delegate":
        actor_overrides[active_node] = str(delegated_to_user_id)
    elif payload.action == "cancel":
        status = "cancelled"
        next_nodes = []
        finished_at = now
    elif payload.action == "reject":
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
        targets = await _resolve_workflow_targets(
            connection,
            row["template_id"],
            active_node,
            outcome,
            row["payload"] or {},
        )
        if not targets:
            raise WorkspaceRepositoryError(409, f"No route for action {payload.action}")
        next_nodes = [node for node in active_nodes if node != active_node]
        parallel = await _parallel_context(connection, row["template_id"], active_node)
        if parallel is not None:
            mode, siblings = parallel
            active_siblings = siblings.intersection(active_nodes)
            if mode == "any":
                next_nodes = [node for node in next_nodes if node not in siblings]
                for sibling in siblings:
                    actor_overrides.pop(sibling, None)
            elif remaining_siblings := active_siblings - {active_node}:
                pending_join_targets = set(
                    (
                        await connection.execute(
                            select(approval_edges.c.target_node_key).where(
                                approval_edges.c.template_id == row["template_id"],
                                approval_edges.c.source_node_key.in_(remaining_siblings),
                                approval_edges.c.outcome == "approve",
                            )
                        )
                    )
                    .scalars()
                    .all()
                )
                targets = [
                    target
                    for target in targets
                    if target[1] != "end" and target[0] not in pending_join_targets
                ]

        non_terminal = [target for target in targets if target[1] != "end"]
        corrections = [target for target in targets if target[1] == "correction"]
        next_nodes.extend(target[0] for target in non_terminal)
        next_nodes = list(dict.fromkeys(next_nodes))
        actor_overrides.pop(active_node, None)
        if corrections:
            status = "needs_revision"
            next_nodes = [corrections[0][0]]
            actor_overrides = {}
        elif any(target[1] == "end" for target in targets) and not next_nodes:
            status = "approved"
            next_nodes = []
            finished_at = now
        else:
            status = "running"
    await connection.execute(
        update(approval_requests)
        .where(approval_requests.c.id == request_id)
        .values(
            status=status,
            active_node_keys=next_nodes,
            actor_overrides=actor_overrides,
            updated_at=now,
            finished_at=finished_at,
        )
    )
    return await _request_response(connection, request_id, current_user)
