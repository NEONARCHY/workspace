"""Consent is immutable, private to the two parties, and atomically creates one task."""

from datetime import UTC, datetime
from uuid import UUID, uuid4
from zoneinfo import ZoneInfo

from sqlalchemy import insert, or_, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.engine import RowMapping
from sqlalchemy.ext.asyncio import AsyncConnection

from .access_control import ensure_module_action
from .auth import AuthenticatedUser, load_authenticated_user
from .repository import (
    WorkspaceRepositoryError,
    _active_user_id,
    _selected_task_project,
    _task_access_row,
    _upsert_notification,
    create_task,
)
from .tables import audit_events, task_proposals, workspace_notifications
from .task_proposal_schemas import (
    TaskProposalDecision,
    TaskProposalResponse,
    TaskProposalWrite,
)
from .workspace_schemas import CreateTaskRequest


def _response(row: RowMapping) -> TaskProposalResponse:
    return TaskProposalResponse(
        id=str(row["id"]), creator_user_id=str(row["creator_user_id"]),
        author_user_id=str(row["author_user_id"]), status=row["status"],
        task=CreateTaskRequest.model_validate(row["payload"]),
        task_id=str(row["task_id"]) if row["task_id"] else None,
        reason=row["reason"], created_at=row["created_at"], decided_at=row["decided_at"],
        import_batch_id=str(row["import_batch_id"]) if row.get("import_batch_id") else None,
        import_source_key=row.get("import_source_key"),
    )


async def _row(connection: AsyncConnection, proposal_id: UUID) -> RowMapping:
    row = (await connection.execute(select(task_proposals).where(
        task_proposals.c.id == proposal_id,
    ).with_for_update())).mappings().first()
    if row is None:
        raise WorkspaceRepositoryError(404, "Заявка на постановку не найдена")
    return row


async def _audit(
    connection: AsyncConnection, user: AuthenticatedUser, proposal_id: UUID,
    action: str, task_id: str | None = None,
    details: dict[str, object] | None = None,
) -> None:
    await connection.execute(insert(audit_events).values(
        id=uuid4(), actor_user_id=user.id, action=f"task_proposal.{action}",
        target_type="task_proposal", target_id=proposal_id,
        details={"taskId": task_id, **(details or {})}, created_at=datetime.now(UTC),
    ))


async def _validate(
    connection: AsyncConnection, creator: AuthenticatedUser, task: CreateTaskRequest,
    *, allow_other_assignee: bool = False,
    allow_unassigned_pending: bool = False,
) -> None:
    await ensure_module_action(connection, creator, "tasks", "create")
    if allow_other_assignee:
        if creator.role not in {"admin", "superadmin"}:
            raise WorkspaceRepositoryError(403, "Импорт заявок доступен только администраторам")
        if not task.assignee_id and not allow_unassigned_pending:
            raise WorkspaceRepositoryError(422, "Выберите исполнителя каждой заявки")
        if task.assignee_id:
            await _active_user_id(connection, task.assignee_id)
    elif task.assignee_id != str(creator.id):
        raise WorkspaceRepositoryError(422, "Исполнителем заявки должны быть вы сами")
    if task.parent_task_id or task.calendar_event_id or task.source_message_id:
        raise WorkspaceRepositoryError(422, "Создайте самостоятельную заявку в разделе задач")
    if task.due_at and (
        task.due_at.tzinfo is None or task.due_at <= datetime.now(UTC)
    ):
        raise WorkspaceRepositoryError(
            409, "Срок уже истёк. Отправьте новую заявку: нужен будущий срок",
        )
    if task.cycle and task.cycle.next_run_at and (
        task.cycle.next_run_at.tzinfo is None or task.cycle.next_run_at <= datetime.now(UTC)
    ):
        raise WorkspaceRepositoryError(409, "Дата повторения уже истекла. Отправьте новую заявку")
    if task.cycle:
        try:
            ZoneInfo(task.cycle.timezone)
        except (KeyError, ValueError) as error:
            raise WorkspaceRepositoryError(422, "Неизвестный часовой пояс повторения") from error
    seen = {UUID(task.assignee_id)} if task.assignee_id else (
        set() if allow_other_assignee else {creator.id}
    )
    for participant in task.participants:
        participant_id = await _active_user_id(connection, participant.user_id)
        if participant_id in seen:
            raise WorkspaceRepositoryError(409, "Повторяющиеся роли участников недопустимы")
        seen.add(participant_id)
    if task.project_id:
        await _selected_task_project(connection, creator, task.project_id)
    dependencies: set[UUID] = set()
    for dependency in task.dependencies:
        try:
            dependency_id = UUID(dependency.depends_on_task_id)
        except ValueError as error:
            raise WorkspaceRepositoryError(422, "Некорректная зависимость") from error
        if dependency_id in dependencies:
            raise WorkspaceRepositoryError(409, "Зависимость повторяется")
        await _task_access_row(connection, creator, dependency_id)
        dependencies.add(dependency_id)


async def list_proposals(
    connection: AsyncConnection, user: AuthenticatedUser,
) -> list[TaskProposalResponse]:
    await ensure_module_action(connection, user, "tasks", "view")
    rows = (await connection.execute(select(task_proposals).where(or_(
        task_proposals.c.creator_user_id == user.id,
        task_proposals.c.author_user_id == user.id,
    )).order_by(task_proposals.c.created_at.desc()))).mappings().all()
    return [_response(row) for row in rows]


async def propose_task(
    connection: AsyncConnection, user: AuthenticatedUser, payload: TaskProposalWrite,
) -> TaskProposalResponse:
    await ensure_module_action(connection, user, "tasks", "create")
    if payload.author_user_id == user.id:
        raise WorkspaceRepositoryError(422, "Для себя используйте обычное создание задачи")
    # Stable client request ID makes an unknown network outcome safe to retry.
    existing = (await connection.execute(select(task_proposals).where(
        task_proposals.c.id == payload.request_id,
    ))).mappings().first()
    snapshot = payload.task.model_dump(mode="json", by_alias=True)
    if existing:
        if (existing["creator_user_id"] == user.id
            and existing["author_user_id"] == payload.author_user_id
            and existing["payload"] == snapshot):
            return _response(existing)
        raise WorkspaceRepositoryError(409, "Этот номер заявки уже использован")
    author = await load_authenticated_user(connection, payload.author_user_id)
    if author is None:
        raise WorkspaceRepositoryError(422, "Выберите активного постановщика")
    await ensure_module_action(connection, author, "tasks", "create")
    await _validate(connection, user, payload.task)
    inserted = await connection.scalar(pg_insert(task_proposals).values(
        id=payload.request_id, creator_user_id=user.id, author_user_id=author.id,
        status="pending", payload=snapshot, task_id=None, reason="",
        created_at=datetime.now(UTC), decided_at=None,
    ).on_conflict_do_nothing(index_elements=[task_proposals.c.id]).returning(task_proposals.c.id))
    if inserted is None:
        # A concurrent identical retry has committed while this insert waited.
        row = await _row(connection, payload.request_id)
        if (row["creator_user_id"] == user.id and row["author_user_id"] == author.id
            and row["payload"] == snapshot):
            return _response(row)
        raise WorkspaceRepositoryError(409, "Этот номер заявки уже использован")
    await _upsert_notification(
        connection, user_id=author.id, event_key=f"task-proposal:{payload.request_id}",
        kind="task", priority="attention", title="Подтвердите постановку задачи",
        body=f"{user.full_name}: {payload.task.title}", section="tasks",
        entity_id=payload.request_id, requires_action=True, occurred_at=datetime.now(UTC),
    )
    await _audit(connection, user, payload.request_id, "submitted")
    return _response(await _row(connection, payload.request_id))


async def decide_proposal(
    connection: AsyncConnection, user: AuthenticatedUser, proposal_id: UUID,
    payload: TaskProposalDecision,
) -> TaskProposalResponse:
    await ensure_module_action(connection, user, "tasks", "view")
    row = await _row(connection, proposal_id)
    # Even administrators cannot silently consent for the named author.
    required_user = row["creator_user_id"] if payload.action == "cancel" else row["author_user_id"]
    if user.id != required_user:
        raise WorkspaceRepositoryError(403, "Это решение доступно только выбранному сотруднику")
    changed_fields = payload.model_fields_set & {"assignee_id", "due_at"}
    if (changed_fields or payload.import_reviewed) and (
        not row.get("import_batch_id") or payload.action != "approve"
    ):
        raise WorkspaceRepositoryError(
            422, "Корректировки допустимы при одобрении импортированной заявки",
        )
    final_status = {
        "approve": "approved", "reject": "rejected", "cancel": "cancelled",
    }[payload.action]
    if row["status"] != "pending":
        if row["status"] == final_status:
            saved = CreateTaskRequest.model_validate(row["payload"])
            if (("assignee_id" in changed_fields
                 and str(payload.assignee_id) != saved.assignee_id)
                    or ("due_at" in changed_fields and payload.due_at != saved.due_at)):
                raise WorkspaceRepositoryError(
                    409, "Сохранённое решение уже содержит другие условия",
                )
            return _response(row)
        raise WorkspaceRepositoryError(409, "По заявке уже принято другое решение")
    if payload.action == "reject" and not payload.reason.strip():
        raise WorkspaceRepositoryError(422, "Укажите причину отклонения")
    task_id: UUID | None = None
    decision_details: dict[str, object] = {}
    approved_payload: dict[str, object] | None = None
    if payload.action == "approve":
        await ensure_module_action(connection, user, "tasks", "create")
        creator = await load_authenticated_user(connection, row["creator_user_id"])
        if creator is None:
            raise WorkspaceRepositoryError(409, "Создатель заявки больше не активен")
        draft = CreateTaskRequest.model_validate(row["payload"])
        if row.get("import_batch_id"):
            from .task_proposal_import_service import validate_import_decision

            if not payload.import_reviewed:
                raise WorkspaceRepositoryError(
                    409, "Обновите Workspace и проверьте исполнителя импортированной заявки",
                )
            await validate_import_decision(connection, user, row)
            decision_details["importReviewed"] = True
            if "assignee_id" in changed_fields:
                previous = draft.assignee_id
                draft.assignee_id = str(payload.assignee_id) if payload.assignee_id else None
                draft.participants = [part for part in draft.participants
                                      if part.user_id != draft.assignee_id]
                decision_details.update(originalAssigneeId=previous,
                                        approvedAssigneeId=draft.assignee_id)
            if "due_at" in changed_fields:
                decision_details.update(originalDueAt=draft.due_at.isoformat()
                                        if draft.due_at else None,
                                        approvedDueAt=payload.due_at.isoformat()
                                        if payload.due_at else None)
                draft.due_at = payload.due_at
            approved_payload = draft.model_dump(mode="json", by_alias=True)
        await _validate(connection, creator, draft,
                        allow_other_assignee=bool(row.get("import_batch_id")))
        # The employee remains the recorded creation actor; the approver becomes
        # the task author only through this access-checked, locked transition.
        task = await create_task(connection, creator, draft, author_user_id=user.id)
        task_id = UUID(task.id)
    now = datetime.now(UTC)
    await connection.execute(update(task_proposals).where(
        task_proposals.c.id == proposal_id,
    ).values(status=final_status, task_id=task_id, reason=payload.reason.strip(), decided_at=now,
             **({"payload": approved_payload} if approved_payload is not None else {})))
    await connection.execute(update(workspace_notifications).where(
        workspace_notifications.c.event_key == f"task-proposal:{proposal_id}",
        workspace_notifications.c.user_id == row["author_user_id"],
    ).values(resolved_at=now, requires_action=False))
    recipient = row["author_user_id"] if payload.action == "cancel" else row["creator_user_id"]
    labels = {"approve": "Постановка задачи подтверждена", "reject": "Заявка отклонена",
              "cancel": "Заявка отозвана"}
    await _upsert_notification(
        connection, user_id=recipient, event_key=f"task-proposal:{proposal_id}:{final_status}",
        kind="task", priority="normal", title=labels[payload.action],
        body=CreateTaskRequest.model_validate(row["payload"]).title,
        section="tasks", entity_id=proposal_id, requires_action=False, occurred_at=now,
    )
    await _audit(connection, user, proposal_id, final_status, str(task_id) if task_id else None,
                 details=decision_details)
    return _response(await _row(connection, proposal_id))
