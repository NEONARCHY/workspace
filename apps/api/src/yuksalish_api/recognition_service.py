from __future__ import annotations

# ruff: noqa: RUF001 - Russian user-facing copy intentionally uses Cyrillic.
import calendar
from datetime import UTC, date, datetime, timedelta
from typing import Any, Literal
from uuid import UUID, uuid4
from zoneinfo import ZoneInfo

from sqlalchemy import func, insert, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncConnection

from .auth import AuthenticatedUser
from .hr_service import service_parts
from .position_policy import is_executive_leader, is_human_resources_position
from .recognition_schemas import (
    EmployeeAchievementResponse,
    EmployeeRecognitionProfileResponse,
    EmployeeRewardCreate,
    EmployeeRewardResponse,
    PublicEmployeeResponse,
    RecognitionSettingsResponse,
    RecognitionSettingsWrite,
)
from .tables import (
    ai_referent_letters,
    approval_requests,
    approval_templates,
    audit_events,
    chats,
    departments,
    employee_efficiency_snapshots,
    employee_rewards,
    feed_comment_reactions,
    feed_comments,
    feed_posts,
    feed_reactions,
    hr_employee_profiles,
    hr_settings,
    message_reactions,
    messages,
    recognition_settings,
    task_comment_reactions,
    task_comments,
    tasks,
    trip_request_employees,
    trip_requests,
    users,
    workspace_projects,
    zoom_meetings,
)

TZ = ZoneInfo("Asia/Tashkent")
RewardIcon = Literal[
    "appreciation", "leadership", "rescue", "mentorship", "innovation", "reliability"
]


class RecognitionError(ValueError):
    def __init__(self, status_code: int, detail: str) -> None:
        super().__init__(detail)
        self.status_code, self.detail = status_code, detail


def _add_months(value: date, months: int) -> date:
    target = value.month - 1 + months
    year, month = value.year + target // 12, target % 12 + 1
    return date(year, month, min(value.day, calendar.monthrange(year, month)[1]))


def _whole_months(start: date, end: date) -> int:
    months = (end.year - start.year) * 12 + end.month - start.month
    return max(0, months - int(end.day < start.day))


def _initials(name: str) -> str:
    return "".join(part[0] for part in name.split()[:2]).upper()


def _person(row: Any) -> PublicEmployeeResponse:
    return PublicEmployeeResponse(
        id=str(row["id"]),
        name=row["full_name"],
        initials=_initials(row["full_name"]),
        role=row["role"],
        department_id=str(row["department_id"]) if row["department_id"] else None,
        position_id=str(row["position_id"]) if row["position_id"] else None,
        job_title=row["job_title"],
        color="#0091A8",
        status=row["status"],
        avatar_version=(
            row["avatar_updated_at"].isoformat() if row["avatar_updated_at"] else None
        ),
    )


async def _settings(connection: AsyncConnection) -> RecognitionSettingsResponse:
    row = (
        (
            await connection.execute(
                select(recognition_settings).where(recognition_settings.c.id == 1)
            )
        )
        .mappings()
        .first()
    )
    return RecognitionSettingsResponse(
        active_task_count_visible=(
            bool(row["active_task_count_visible"]) if row is not None else True
        ),
        updated_at=row["updated_at"] if row is not None else None,
    )


async def _can_issue_reward(
    connection: AsyncConnection, actor: AuthenticatedUser
) -> bool:
    if actor.role in {"manager", "admin", "superadmin"}:
        return True
    if is_executive_leader(actor.job_title) or is_human_resources_position(actor.job_title):
        return True
    row = (
        (
            await connection.execute(
                select(hr_settings.c.hr_user_id, hr_settings.c.chair_user_id).where(
                    hr_settings.c.id == 1
                )
            )
        )
        .mappings()
        .first()
    )
    return bool(row and actor.id in {row["hr_user_id"], row["chair_user_id"]})


def _longest_month_streak(periods: list[str]) -> int:
    values = sorted({int(value[:4]) * 12 + int(value[5:7]) for value in periods})
    longest = current = 0
    previous: int | None = None
    for value in values:
        current = current + 1 if previous is not None and value == previous + 1 else 1
        longest = max(longest, current)
        previous = value
    return longest


async def _counts(connection: AsyncConnection, user_id: UUID) -> dict[str, int]:
    completed_tasks = int(
        await connection.scalar(
            select(func.count()).select_from(tasks).where(
                tasks.c.primary_assignee_user_id == user_id,
                tasks.c.status == "completed",
            )
        )
        or 0
    )
    completed_projects = int(
        await connection.scalar(
            select(func.count()).select_from(workspace_projects).where(
                workspace_projects.c.manager_user_id == user_id,
                workspace_projects.c.stage == "success",
            )
        )
        or 0
    )
    approved_trips = int(
        await connection.scalar(
            select(func.count(func.distinct(trip_request_employees.c.request_id)))
            .select_from(
                trip_request_employees.join(
                    trip_requests,
                    trip_requests.c.id == trip_request_employees.c.request_id,
                )
            )
            .where(
                trip_request_employees.c.user_id == user_id,
                trip_requests.c.status == "approved",
            )
        )
        or 0
    )
    created_meetings = int(
        await connection.scalar(
            select(func.count()).select_from(zoom_meetings).where(
                zoom_meetings.c.organizer_user_id == user_id,
                zoom_meetings.c.status != "failed",
            )
        )
        or 0
    )
    sent_letters = int(
        await connection.scalar(
            select(func.count()).select_from(ai_referent_letters).where(
                ai_referent_letters.c.created_by_user_id == user_id,
                ai_referent_letters.c.status == "sent",
                ai_referent_letters.c.sent_at.is_not(None),
            )
        )
        or 0
    )
    published_news = int(
        await connection.scalar(
            select(func.count()).select_from(feed_posts).where(
                feed_posts.c.author_user_id == user_id,
            )
        )
        or 0
    )
    payment_source = approval_requests.join(
        approval_templates,
        approval_templates.c.id == approval_requests.c.template_id,
    )
    created_payments = int(
        await connection.scalar(
            select(func.count()).select_from(payment_source).where(
                approval_requests.c.requester_user_id == user_id,
                approval_templates.c.request_kind == "payment",
            )
        )
        or 0
    )
    completed_payments = int(
        await connection.scalar(
            select(func.count()).select_from(payment_source).where(
                approval_requests.c.requester_user_id == user_id,
                approval_templates.c.request_kind == "payment",
                approval_requests.c.status == "approved",
                approval_requests.c.finished_at.is_not(None),
            )
        )
        or 0
    )
    group_messages = int(
        await connection.scalar(
            select(func.count())
            .select_from(messages.join(chats, chats.c.id == messages.c.chat_id))
            .where(
                messages.c.author_user_id == user_id,
                messages.c.deleted_at.is_(None),
                chats.c.deleted_at.is_(None),
                chats.c.kind != "direct",
            )
        )
        or 0
    )
    messenger_reactions = int(
        await connection.scalar(
            select(func.count())
            .select_from(
                message_reactions.join(
                    messages, messages.c.id == message_reactions.c.message_id
                ).join(chats, chats.c.id == messages.c.chat_id)
            )
            .where(
                messages.c.author_user_id == user_id,
                message_reactions.c.user_id != user_id,
                messages.c.deleted_at.is_(None),
                chats.c.deleted_at.is_(None),
                chats.c.kind != "direct",
            )
        )
        or 0
    )
    task_reactions = int(
        await connection.scalar(
            select(func.count())
            .select_from(
                task_comment_reactions.join(
                    task_comments,
                    task_comments.c.id == task_comment_reactions.c.comment_id,
                )
            )
            .where(
                task_comments.c.author_user_id == user_id,
                task_comment_reactions.c.user_id != user_id,
            )
        )
        or 0
    )
    feed_post_reactions = int(
        await connection.scalar(
            select(func.count())
            .select_from(
                feed_reactions.join(feed_posts, feed_posts.c.id == feed_reactions.c.post_id)
            )
            .where(
                feed_posts.c.author_user_id == user_id,
                feed_reactions.c.user_id != user_id,
            )
        )
        or 0
    )
    feed_comment_reaction_count = int(
        await connection.scalar(
            select(func.count())
            .select_from(
                feed_comment_reactions.join(
                    feed_comments,
                    feed_comments.c.id == feed_comment_reactions.c.comment_id,
                )
            )
            .where(
                feed_comments.c.author_user_id == user_id,
                feed_comment_reactions.c.user_id != user_id,
            )
        )
        or 0
    )
    qualified_periods = list(
        (
            await connection.execute(
                select(employee_efficiency_snapshots.c.period)
                .where(
                    employee_efficiency_snapshots.c.user_id == user_id,
                    employee_efficiency_snapshots.c.percentage >= 90,
                    employee_efficiency_snapshots.c.eligible_count >= 5,
                )
                .distinct()
            )
        ).scalars()
    )
    return {
        "tasks": completed_tasks,
        "projects": completed_projects,
        "trips": approved_trips,
        "meetings": created_meetings,
        "letters": sent_letters,
        "feed_posts": published_news,
        "payments_created": created_payments,
        "payments_completed": completed_payments,
        "messages": group_messages,
        "reactions": (
            messenger_reactions
            + task_reactions
            + feed_post_reactions
            + feed_comment_reaction_count
        ),
        "efficiency_months": len(qualified_periods),
        "efficiency_streak": _longest_month_streak(qualified_periods),
    }


def _achievement(
    *,
    code: str,
    title: str,
    description: str,
    category: str,
    tier: str,
    icon_key: str,
    progress: int,
    target: int,
    earned_at: datetime | date | None = None,
) -> EmployeeAchievementResponse:
    return EmployeeAchievementResponse(
        code=code,
        title=title,
        description=description,
        category=category,  # type: ignore[arg-type]
        tier=tier,  # type: ignore[arg-type]
        icon_key=icon_key,
        progress=progress,
        target=target,
        unlocked=progress >= target,
        earned_at=earned_at if progress >= target else None,
    )


def _achievements(
    counts: dict[str, int], employment_date: date | None, today: date
) -> list[EmployeeAchievementResponse]:
    values: list[EmployeeAchievementResponse] = []
    process_levels = (
        (1, "bronze"),
        (5, "silver"),
        (10, "gold"),
        (15, "platinum"),
        (20, "sapphire"),
        (30, "amethyst"),
        (50, "prism"),
        (100, "cosmic"),
    )
    ladders = (
        (
            "tasks", "Завершённые задачи", "Принятые рабочие задачи", "tasks", "check",
            ((1, "bronze"), (10, "silver"), (50, "gold"), (100, "prism")),
        ),
        (
            "projects", "Проекты", "Успешно завершённые проекты под руководством сотрудника",
            "projects", "layers", process_levels,
        ),
        (
            "trips", "Поездки", "Согласованные рабочие поездки", "trips", "compass",
            process_levels,
        ),
        (
            "meetings", "Организатор встреч",
            "Созданные Zoom-встречи без технических ошибок", "meetings", "camera",
            process_levels,
        ),
        (
            "letters", "Деловая переписка",
            "Письма, отправка которых подтверждена в AI-референте",
            "correspondence", "mail", process_levels,
        ),
        (
            "feed_posts", "Голос Ленты", "Опубликованные новости в корпоративной Ленте",
            "feed", "megaphone", process_levels,
        ),
        (
            "payments_created", "Инициатор оплат",
            "Созданные заявки на оплату", "payment_creation", "receipt", process_levels,
        ),
        (
            "payments_completed", "Оплата доведена до результата",
            "Собственные заявки на оплату, прошедшие маршрут до утверждения",
            "payment_completion", "target", process_levels,
        ),
        (
            "messages", "Голос команды", "Сообщения в рабочих группах и контекстных чатах",
            "communication", "signal",
            ((100, "bronze"), (500, "silver"), (2_000, "gold"), (5_000, "prism")),
        ),
        (
            "reactions", "Поддержка коллег", "Реакции коллег на публичные рабочие сообщения",
            "support", "spark",
            ((10, "bronze"), (50, "silver"), (250, "gold"), (1_000, "prism")),
        ),
        (
            "efficiency_months", "Стабильная эффективность",
            "Месяцы с результатом от 90% при выборке от пяти задач", "efficiency", "pulse",
            ((1, "gold"), (3, "prism")),
        ),
        (
            "efficiency_streak", "Серия эффективности",
            "Последовательные месяцы с результатом от 90%", "efficiency", "orbit",
            ((2, "gold"), (4, "prism")),
        ),
    )
    for metric, title, description, category, icon, levels in ladders:
        for target, tier in levels:
            values.append(_achievement(
                code=f"{metric}_{target}",
                title=f"{title} · {target}",
                description=description,
                category=category,
                tier=tier,
                icon_key=icon,
                progress=counts[metric],
                target=target,
            ))
    if employment_date is not None:
        service_months = _whole_months(employment_date, today)
        tenure_levels = (
            (1, "Первый месяц", "bronze"),
            (6, "Полгода вместе", "silver"),
            (12, "Год в команде", "gold"),
            (24, "Два года в команде", "gold"),
            (36, "Три года в команде", "prism"),
            (48, "Четыре года в команде", "prism"),
            (60, "Пять лет в команде", "prism"),
        )
        for target, title, tier in tenure_levels:
            values.append(_achievement(
                code=f"tenure_{target}",
                title=title,
                description="Подтверждённый кадровой службой стаж работы",
                category="tenure",
                tier=tier,
                icon_key="gem",
                progress=service_months,
                target=target,
                earned_at=_add_months(employment_date, target),
            ))
    return values


async def load_profile(
    connection: AsyncConnection,
    actor: AuthenticatedUser,
    user_id: UUID,
) -> EmployeeRecognitionProfileResponse:
    row = (
        (
            await connection.execute(
                select(users).where(users.c.id == user_id, users.c.status != "archived")
            )
        )
        .mappings()
        .first()
    )
    if row is None:
        raise RecognitionError(404, "Сотрудник не найден")
    department_name = None
    if row["department_id"] is not None:
        department_name = await connection.scalar(
            select(departments.c.name).where(departments.c.id == row["department_id"])
        )
    hr_row = (
        (
            await connection.execute(
                select(hr_employee_profiles).where(hr_employee_profiles.c.user_id == user_id)
            )
        )
        .mappings()
        .first()
    )
    today = datetime.now(TZ).date()
    employment_date = hr_row["employment_date"] if hr_row is not None else None
    years = months = days = None
    if hr_row is not None:
        years, months, days = service_parts(
            hr_row["service_anchor_date"],
            hr_row["service_years"],
            hr_row["service_months"],
            hr_row["service_days"],
            min(today, hr_row["terminated_on"]) if hr_row["terminated_on"] else today,
        )
    settings = await _settings(connection)
    may_manage = actor.role in {"admin", "superadmin"}
    active_tasks = int(
        await connection.scalar(
            select(func.count()).select_from(tasks).where(
                tasks.c.primary_assignee_user_id == user_id,
                tasks.c.status.not_in(("completed", "cancelled")),
            )
        )
        or 0
    )
    reward_rows = (
        (
            await connection.execute(
                select(
                    employee_rewards,
                    users.c.full_name.label("issuer_name"),
                )
                .join(users, users.c.id == employee_rewards.c.issuer_user_id)
                .where(employee_rewards.c.recipient_user_id == user_id)
                .order_by(employee_rewards.c.created_at.desc())
            )
        )
        .mappings()
        .all()
    )
    counts = await _counts(connection, user_id)
    return EmployeeRecognitionProfileResponse(
        person=_person(row),
        department_name=department_name,
        employment_date=employment_date,
        service_years=years,
        service_months=months,
        service_days=days,
        active_task_count=(
            active_tasks if settings.active_task_count_visible or may_manage else None
        ),
        active_task_count_visible=settings.active_task_count_visible,
        achievements=_achievements(counts, employment_date, today),
        rewards=[
            EmployeeRewardResponse(
                id=str(reward["id"]),
                icon_key=reward["icon_key"],
                title=reward["title"],
                description=reward["description"],
                recipient_user_id=str(reward["recipient_user_id"]),
                issuer_user_id=str(reward["issuer_user_id"]),
                issuer_name=reward["issuer_name"],
                created_at=reward["created_at"],
            )
            for reward in reward_rows
        ],
        can_issue_reward=await _can_issue_reward(connection, actor) and actor.id != user_id,
        can_manage_settings=may_manage,
    )


async def load_settings(
    connection: AsyncConnection, actor: AuthenticatedUser
) -> RecognitionSettingsResponse:
    if actor.role not in {"admin", "superadmin"}:
        raise RecognitionError(403, "Настройки признания доступны только администраторам")
    return await _settings(connection)


async def save_settings(
    connection: AsyncConnection,
    actor: AuthenticatedUser,
    payload: RecognitionSettingsWrite,
) -> RecognitionSettingsResponse:
    if actor.role not in {"admin", "superadmin"}:
        raise RecognitionError(403, "Настройки признания доступны только администраторам")
    now = datetime.now(UTC)
    await connection.execute(
        pg_insert(recognition_settings)
        .values(
            id=1,
            active_task_count_visible=payload.active_task_count_visible,
            updated_by_user_id=actor.id,
            updated_at=now,
        )
        .on_conflict_do_update(
            index_elements=[recognition_settings.c.id],
            set_={
                "active_task_count_visible": payload.active_task_count_visible,
                "updated_by_user_id": actor.id,
                "updated_at": now,
            },
        )
    )
    await connection.execute(
        insert(audit_events).values(
            id=uuid4(),
            actor_user_id=actor.id,
            action="recognition.settings.updated",
            target_type="recognition_settings",
            target_id=None,
            details={"activeTaskCountVisible": payload.active_task_count_visible},
            created_at=now,
        )
    )
    return RecognitionSettingsResponse(
        active_task_count_visible=payload.active_task_count_visible,
        updated_at=now,
    )


async def issue_reward(
    connection: AsyncConnection,
    actor: AuthenticatedUser,
    user_id: UUID,
    payload: EmployeeRewardCreate,
) -> EmployeeRewardResponse:
    if not await _can_issue_reward(connection, actor):
        raise RecognitionError(
            403, "Выдавать награды могут руководители, кадровики и администраторы"
        )
    if actor.id == user_id:
        raise RecognitionError(422, "Нельзя выдать награду самому себе")
    recipient = (
        (
            await connection.execute(
                select(users.c.id, users.c.full_name).where(
                    users.c.id == user_id, users.c.status == "active"
                )
            )
        )
        .mappings()
        .first()
    )
    if recipient is None:
        raise RecognitionError(404, "Активный сотрудник не найден")
    now = datetime.now(UTC)
    month_start = now.astimezone(TZ).replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    issued_this_month = int(
        await connection.scalar(
            select(func.count()).select_from(employee_rewards).where(
                employee_rewards.c.issuer_user_id == actor.id,
                employee_rewards.c.created_at >= month_start.astimezone(UTC),
            )
        )
        or 0
    )
    if issued_this_month >= 12:
        raise RecognitionError(429, "Лимит — 12 наград от одного автора за календарный месяц")
    duplicate = await connection.scalar(
        select(employee_rewards.c.id).where(
            employee_rewards.c.issuer_user_id == actor.id,
            employee_rewards.c.recipient_user_id == user_id,
            employee_rewards.c.icon_key == payload.icon_key,
            func.lower(employee_rewards.c.title) == payload.title.casefold(),
            employee_rewards.c.created_at >= now - timedelta(days=30),
        ).limit(1)
    )
    if duplicate is not None:
        raise RecognitionError(
            409, "Такую же награду этому сотруднику можно повторить через 30 дней"
        )
    reward_id = uuid4()
    await connection.execute(
        insert(employee_rewards).values(
            id=reward_id,
            recipient_user_id=user_id,
            issuer_user_id=actor.id,
            icon_key=payload.icon_key,
            title=payload.title,
            description=payload.description,
            created_at=now,
        )
    )
    await connection.execute(
        insert(audit_events).values(
            id=uuid4(),
            actor_user_id=actor.id,
            action="recognition.reward.issued",
            target_type="employee",
            target_id=user_id,
            details={
                "rewardId": str(reward_id),
                "iconKey": payload.icon_key,
                "title": payload.title,
            },
            created_at=now,
        )
    )
    return EmployeeRewardResponse(
        id=str(reward_id),
        icon_key=payload.icon_key,
        title=payload.title,
        description=payload.description,
        recipient_user_id=str(user_id),
        issuer_user_id=str(actor.id),
        issuer_name=actor.full_name,
        created_at=now,
    )
