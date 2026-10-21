"""Private, factual daily report suggestions; never a submission or an AI inference."""

from datetime import UTC, date, datetime, time
from typing import Any, Literal
from uuid import UUID
from zoneinfo import ZoneInfo

from pydantic import BaseModel
from sqlalchemy import and_, or_, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncConnection

from .access_control import module_permissions_for_user
from .auth import AuthenticatedUser
from .hisobot_schemas import HisobotActivityDraft
from .tables import (
    approval_actions,
    approval_requests,
    hisobot_activity_drafts,
    project_hub_item_actions,
    project_hub_items,
    project_hub_projects,
    project_hub_request_actions,
    project_hub_requests,
    project_stage_actions,
    task_checklist_items,
    task_efficiency_events,
    tasks,
    trip_request_actions,
    trip_requests,
    workspace_projects,
)

TASHKENT = ZoneInfo("Asia/Tashkent")
MAX_CONTENT = 20_000
ACTION_LABELS = {
    "approve": "согласование",
    "approved": "согласование",
    "reject": "отклонение",
    "rejected": "отклонение",
    "return": "возврат на доработку",
    "request_changes": "возврат на доработку",
    "revise": "доработка",
    "revision": "доработка",
    "revised": "доработка",
    "submit": "отправка на согласование",
    "submitted": "отправка на согласование",
    "resubmit": "повторная отправка на согласование",
    "created": "создание",
    "delegate": "делегирование",
    "cancel": "отмена",
    "withdraw": "отзыв заявки",
    "annul": "аннулирование заявки",
    "move": "смена стадии",
    "edit": "обновление",
    "updated": "обновление",
    "paid": "подтверждение оплаты",
}
STAGE_LABELS = {
    "start": "Запуск",
    "launch": "Запуск",
    "preparation": "Подготовка",
    "approval": "Согласование",
    "success": "Успешно завершён",
    "failure": "Завершён без реализации",
    "deputy_approval": "Первый заместитель",
    "manager_approval": "Председатель",
    "hr": "Кадровая служба",
    "approved": "Утверждено",
    "rejected": "Отклонено",
    "new": "Новая",
    "in_progress": "В работе",  # noqa: RUF001 - Russian status label.
    "active": "В работе",  # noqa: RUF001 - Russian status label.
    "completed": "Завершена",
    "cancelled": "Отменена",
    "planned": "Запланировано",
    "done": "Выполнено",
}


class ActivityFact(BaseModel):
    module: str
    key: str
    text: str
    source_type: (
        Literal["task", "payment", "trip", "project", "hub_project", "hub_funding"] | None
    ) = None
    source_id: str = ""


def clean_title(value: object) -> str:
    # Object titles are untrusted text, not report instructions or extra numbered rows.
    return " ".join(str(value or "Без названия").split())[:240]


def render_report(day: date, facts: list[ActivityFact]) -> tuple[str, int]:
    """Deduplicate retries, keep report size valid and disclose any omitted facts."""
    unique = list({fact.key: fact for fact in facts}.values())
    if not unique:
        return "", 0
    lines = [f"Отчёт за {day:%d.%m.%Y}", ""]
    used = 0
    for index, fact in enumerate(unique, 1):
        line = f"{index}. {fact.text}"
        if len("\n".join([*lines, line])) > MAX_CONTENT - 100:
            break
        lines.append(line)
        used += 1
    omitted = len(unique) - used
    if omitted:
        lines.append(
            f"\nДополнительно не включено действий: {omitted} (ограничение длины отчёта)."  # noqa: RUF001
        )
    return "\n".join(lines), omitted


async def collect_activity(
    connection: AsyncConnection,
    user: AuthenticatedUser,
    now: datetime,
) -> list[ActivityFact]:
    """Only dated evidence of this employee's actions, never their whole task list."""
    day = now.astimezone(TASHKENT).date()
    start = datetime.combine(day, time.min, TASHKENT).astimezone(UTC)
    end = now.astimezone(UTC)
    permissions = await module_permissions_for_user(connection, user)
    facts: dict[str, ActivityFact] = {}

    def add(
        module: str,
        key: str,
        text: str,
        source_type: Literal["task", "payment", "trip", "project", "hub_project", "hub_funding"],
        source_id: object,
    ) -> None:
        facts[key] = ActivityFact(
            module=module,
            key=key,
            text=text,
            source_type=source_type,
            source_id=str(source_id),
        )

    def allowed(module: str) -> bool:
        return permissions.get(module, {}).get("view", False)

    if allowed("tasks"):
        events = (
            (
                await connection.execute(
                    select(task_efficiency_events, tasks.c.title)
                    .join(tasks, tasks.c.id == task_efficiency_events.c.task_id)
                    .where(
                        task_efficiency_events.c.occurred_at >= start,
                        task_efficiency_events.c.occurred_at <= end,
                        task_efficiency_events.c.event_type.in_(
                            ["task_completed", "result_submitted_for_review", "task_status_changed"]
                        ),
                        or_(
                            task_efficiency_events.c.actor_user_id == user.id,
                            and_(
                                task_efficiency_events.c.event_type == "task_completed",
                                task_efficiency_events.c.assignee_user_id == user.id,
                            ),
                        ),
                    )
                    .order_by(task_efficiency_events.c.occurred_at, task_efficiency_events.c.id)
                )
            )
            .mappings()
            .all()
        )
        for event in events:
            if event.get("reason_code") == "historical_plan_import":
                # Importing an old completed plan is not today's execution/review.
                continue
            title = clean_title(event["title"])
            kind = event["event_type"]
            if kind == "task_completed":
                text = (
                    f"Проверен и принят результат по задаче «{title}»."
                    if event["actor_user_id"] == user.id and event["assignee_user_id"] != user.id
                    else f"Завершена задача «{title}»; результат принят постановщиком."
                )
            elif kind == "result_submitted_for_review":
                text = f"Подготовлен и отправлен на проверку результат по задаче «{title}»."
            elif (event["new_value"] or {}).get("status") == "in_progress":
                text = f"Взята в работу задача «{title}»."
            else:
                continue
            add("tasks", f"task:{event['task_id']}:{kind}", text, "task", event["task_id"])
        checklist = (
            (
                await connection.execute(
                    select(task_checklist_items, tasks.c.title.label("task_title"))
                    .join(tasks, tasks.c.id == task_checklist_items.c.task_id)
                    .where(
                        task_checklist_items.c.completed_by_user_id == user.id,
                        task_checklist_items.c.is_completed.is_(True),
                        task_checklist_items.c.completed_at >= start,
                        task_checklist_items.c.completed_at <= end,
                    )
                    .order_by(task_checklist_items.c.completed_at, task_checklist_items.c.id)
                )
            )
            .mappings()
            .all()
        )
        for item in checklist:
            add(
                "tasks",
                f"checklist:{item['id']}",
                f"Выполнен пункт «{clean_title(item['title'])}» "
                f"в задаче «{clean_title(item['task_title'])}».",
                "task",
                item["task_id"],
            )

    if allowed("payment_requests"):
        actions = (
            (
                await connection.execute(
                    select(approval_actions, approval_requests.c.title)
                    .join(
                        approval_requests, approval_requests.c.id == approval_actions.c.request_id
                    )
                    .where(
                        approval_actions.c.actor_user_id == user.id,
                        approval_actions.c.created_at >= start,
                        approval_actions.c.created_at <= end,
                    )
                    .order_by(approval_actions.c.created_at, approval_actions.c.id)
                )
            )
            .mappings()
            .all()
        )
        for action in actions:
            label = ACTION_LABELS.get(action["action"], "обработка этапа маршрута")
            key = f"payment:{action['request_id']}:{action['node_key']}:{action['action']}"
            add(
                "payment_requests",
                key,
                f"Заявка на оплату «{clean_title(action['title'])}»: {label}.",
                "payment",
                action["request_id"],
            )

    if allowed("trip_approvals"):
        actions = (
            (
                await connection.execute(
                    select(
                        trip_request_actions, trip_requests.c.destination, trip_requests.c.purpose
                    )
                    .join(trip_requests, trip_requests.c.id == trip_request_actions.c.request_id)
                    .where(
                        trip_request_actions.c.actor_user_id == user.id,
                        trip_request_actions.c.created_at >= start,
                        trip_request_actions.c.created_at <= end,
                    )
                    .order_by(trip_request_actions.c.created_at, trip_request_actions.c.id)
                )
            )
            .mappings()
            .all()
        )
        for action in actions:
            label = ACTION_LABELS.get(action["action"], "обработка маршрута")
            stage = STAGE_LABELS.get(action["to_stage"], "следующий этап маршрута")
            key = f"trip:{action['request_id']}:{action['action']}:{action['to_stage']}"
            add(
                "trip_approvals",
                key,
                f"Заявка на поездку «{clean_title(action['destination'])} — "
                f"{clean_title(action['purpose'])}»: {label}, стадия «{stage}».",
                "trip",
                action["request_id"],
            )

    if allowed("projects"):
        actions = (
            (
                await connection.execute(
                    select(project_stage_actions, workspace_projects.c.title)
                    .join(
                        workspace_projects,
                        workspace_projects.c.id == project_stage_actions.c.project_id,
                    )
                    .where(
                        project_stage_actions.c.actor_user_id == user.id,
                        project_stage_actions.c.created_at >= start,
                        project_stage_actions.c.created_at <= end,
                    )
                    .order_by(project_stage_actions.c.created_at, project_stage_actions.c.id)
                )
            )
            .mappings()
            .all()
        )
        for action in actions:
            stage = STAGE_LABELS.get(action["to_stage"], "следующий этап")
            key = f"project:{action['project_id']}:{action['action']}:{action['to_stage']}"
            add(
                "projects",
                key,
                f"Проект «{clean_title(action['title'])}»: "
                f"{'создан' if action['action'] == 'created' else 'переведён на этап'} «{stage}».",
                "project",
                action["project_id"],
            )

    if allowed("project_hub"):
        projects = (
            (
                await connection.execute(
                    select(project_hub_projects)
                    .where(
                        project_hub_projects.c.created_by_user_id == user.id,
                        project_hub_projects.c.created_at >= start,
                        project_hub_projects.c.created_at <= end,
                    )
                    .order_by(project_hub_projects.c.created_at, project_hub_projects.c.id)
                )
            )
            .mappings()
            .all()
        )
        for project in projects:
            add(
                "project_hub",
                f"hub-created:{project['id']}",
                f"Создан проект «{clean_title(project['title'])}».",
                "hub_project",
                project["id"],
            )
        actions = (
            (
                await connection.execute(
                    select(
                        project_hub_item_actions,
                        project_hub_items.c.title,
                        project_hub_items.c.project_id,
                        project_hub_projects.c.title.label("project_title"),
                    )
                    .join(
                        project_hub_items,
                        project_hub_items.c.id == project_hub_item_actions.c.item_id,
                    )
                    .join(
                        project_hub_projects,
                        project_hub_projects.c.id == project_hub_items.c.project_id,
                    )
                    .where(
                        project_hub_item_actions.c.actor_user_id == user.id,
                        project_hub_item_actions.c.action == "status",
                        project_hub_item_actions.c.created_at >= start,
                        project_hub_item_actions.c.created_at <= end,
                    )
                    .order_by(project_hub_item_actions.c.created_at, project_hub_item_actions.c.id)
                )
            )
            .mappings()
            .all()
        )
        for action in actions:
            stage = STAGE_LABELS.get(action["to_status"], "изменён статус")
            add(
                "project_hub",
                f"hub-item:{action['item_id']}:{action['to_status']}",
                f"Работа «{clean_title(action['title'])}» в проекте "
                f"«{clean_title(action['project_title'])}»: {stage.lower()}.",
                "hub_project",
                action["project_id"],
            )
        funding = (
            (
                await connection.execute(
                    select(project_hub_request_actions, project_hub_requests.c.title)
                    .join(
                        project_hub_requests,
                        project_hub_requests.c.id == project_hub_request_actions.c.request_id,
                    )
                    .where(
                        project_hub_request_actions.c.actor_user_id == user.id,
                        project_hub_request_actions.c.created_at >= start,
                        project_hub_request_actions.c.created_at <= end,
                    )
                    .order_by(
                        project_hub_request_actions.c.created_at, project_hub_request_actions.c.id
                    )
                )
            )
            .mappings()
            .all()
        )
        for action in funding:
            label = ACTION_LABELS.get(action["action"], "обработка этапа согласования")
            key = f"hub-funding:{action['request_id']}:{action['step']}:{action['action']}"
            add(
                "project_hub",
                key,
                f"Финансирование проекта «{clean_title(action['title'])}»: {label}.",
                "hub_funding",
                action["request_id"],
            )
    return list(facts.values())


async def ensure_activity_draft(
    connection: AsyncConnection,
    user: AuthenticatedUser,
    now: datetime,
) -> None:
    """One immutable source snapshot per recipient/day; retry/concurrent-safe."""
    day = now.astimezone(TASHKENT).date()
    if await connection.scalar(
        select(hisobot_activity_drafts.c.user_id).where(
            hisobot_activity_drafts.c.user_id == user.id,
            hisobot_activity_drafts.c.report_date == day,
        )
    ):
        return
    facts = await collect_activity(connection, user, now)
    await connection.execute(
        pg_insert(hisobot_activity_drafts)
        .values(
            user_id=user.id,
            report_date=day,
            generated_at=now,
            facts=[fact.model_dump() for fact in facts],
            seen_at=None,
        )
        .on_conflict_do_nothing(
            index_elements=[
                hisobot_activity_drafts.c.user_id,
                hisobot_activity_drafts.c.report_date,
            ]
        )
    )


async def source_is_visible(
    connection: AsyncConnection,
    user: AuthenticatedUser,
    fact: ActivityFact,
) -> bool:
    """Reuse domain guards; a daily diary must not restore revoked object access."""
    from .project_hub_service import _require_project
    from .repository import (
        WorkspaceRepositoryError,
        _active_stages_for_requests,
        _task_access_row,
        get_trip_request,
    )

    try:
        source_id = UUID(fact.source_id)
    except ValueError:
        return False
    try:
        if fact.source_type == "task":
            await _task_access_row(connection, user, source_id)
            return True
        if fact.source_type == "trip":
            await get_trip_request(connection, user, source_id)
            return True
        if fact.source_type == "hub_project":
            await _require_project(connection, user, source_id)
            return True
        if fact.source_type == "hub_funding":
            row = (
                (
                    await connection.execute(
                        select(project_hub_requests).where(
                            project_hub_requests.c.id == source_id,
                        )
                    )
                )
                .mappings()
                .first()
            )
            if row is None or (row["status"] == "draft" and row["requester_user_id"] != user.id):
                return False
            project = await _require_project(connection, user, row["project_id"])
            return (
                user.role in {"admin", "superadmin"}
                or user.id in {project["manager_user_id"], row["requester_user_id"]}
                or str(user.id) in row["approver_ids"]
            )
        if fact.source_type == "payment":
            row = (
                (
                    await connection.execute(
                        select(approval_requests).where(
                            approval_requests.c.id == source_id,
                        )
                    )
                )
                .mappings()
                .first()
            )
            if row is None:
                return False
            if user.role != "employee" or user.id in {
                row["requester_user_id"],
                row["responsible_user_id"],
            }:
                return True
            stages = await _active_stages_for_requests(connection, [row], user)
            return any(stage.can_act for stage in stages.get(source_id, []))
        if fact.source_type == "project":
            # Legacy projects have module-wide read access; still exclude deleted rows.
            return (
                await connection.scalar(
                    select(workspace_projects.c.id).where(
                        workspace_projects.c.id == source_id,
                    )
                )
                is not None
            )
        return False
    except WorkspaceRepositoryError as error:
        if error.status_code in {403, 404}:
            return False
        raise


async def read_activity_draft(
    connection: AsyncConnection,
    user: AuthenticatedUser,
    day: date,
) -> HisobotActivityDraft | None:
    row = (
        (
            await connection.execute(
                select(hisobot_activity_drafts).where(
                    hisobot_activity_drafts.c.user_id == user.id,
                    hisobot_activity_drafts.c.report_date == day,
                )
            )
        )
        .mappings()
        .one_or_none()
    )
    if row is None:
        return None
    permissions = await module_permissions_for_user(connection, user)
    if not permissions.get("ai_hisobot", {}).get("view", False):
        return None
    # Recheck module and object access after reassignment, deletion or team changes.
    raw_facts: list[dict[str, Any]] = row["facts"]
    candidates = [
        ActivityFact.model_validate(fact)
        for fact in raw_facts
        if permissions.get(fact["module"], {}).get("view", False)
    ]
    facts: list[ActivityFact] = []
    visible: dict[tuple[str | None, str], bool] = {}
    for fact in candidates:
        source = (fact.source_type, fact.source_id)
        if source not in visible:
            visible[source] = await source_is_visible(connection, user, fact)
        if visible[source]:
            facts.append(fact)
    content, omitted = render_report(day, facts)
    return HisobotActivityDraft(
        report_date=day,
        generated_at=row["generated_at"],
        seen_at=row["seen_at"],
        content=content,
        activity_count=len(facts),
        omitted_count=omitted,
    )
