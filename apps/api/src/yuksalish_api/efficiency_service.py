"""EFF-1 task deadline analytics built from an append-only task event ledger."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from datetime import UTC, datetime
from decimal import Decimal
from typing import Any
from uuid import UUID, uuid4
from zoneinfo import ZoneInfo

from sqlalchemy import insert, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.engine import RowMapping
from sqlalchemy.ext.asyncio import AsyncConnection

from .auth import AuthenticatedUser
from .tables import (
    employee_efficiency_methodologies,
    employee_efficiency_snapshots,
    task_efficiency_events,
    users,
    workspace_notifications,
)

METHODOLOGY_VERSION = "EFF-1.0"
EFFICIENCY_TIMEZONE = "Asia/Tashkent"
SMALL_SAMPLE_LIMIT = 5

Record = Mapping[str, Any] | RowMapping


@dataclass
class _Deadline:
    due_at: datetime
    set_at: datetime
    replaced_at: datetime | None = None


@dataclass
class _TaskState:
    task_id: UUID
    known_from: datetime
    assignments: list[tuple[datetime, UUID]] = field(default_factory=list)
    deadlines: list[_Deadline] = field(default_factory=list)
    results: list[tuple[datetime, UUID | None, str]] = field(default_factory=list)
    statuses: list[tuple[datetime, str]] = field(default_factory=list)
    exclusions: list[tuple[datetime, bool]] = field(default_factory=list)
    return_events: list[tuple[datetime, UUID | None]] = field(default_factory=list)
    cancelled_at: datetime | None = None


def _aware(value: datetime) -> datetime:
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value


def _parse_datetime(value: object) -> datetime | None:
    if isinstance(value, datetime):
        return _aware(value)
    if not isinstance(value, str) or not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return _aware(parsed)


def _parse_uuid(value: object) -> UUID | None:
    if isinstance(value, UUID):
        return value
    if not isinstance(value, str):
        return None
    try:
        return UUID(value)
    except ValueError:
        return None


def period_bounds(period: str, timezone: str = EFFICIENCY_TIMEZONE) -> tuple[datetime, datetime]:
    """Return UTC bounds for a YYYY-MM calendar month in the configured timezone."""
    try:
        year_text, month_text = period.split("-", 1)
        year, month = int(year_text), int(month_text)
        start_local = datetime(year, month, 1, tzinfo=ZoneInfo(timezone))
    except (ValueError, TypeError) as error:
        raise ValueError("Period must use YYYY-MM format") from error
    if month == 12:
        end_local = datetime(year + 1, 1, 1, tzinfo=ZoneInfo(timezone))
    else:
        end_local = datetime(year, month + 1, 1, tzinfo=ZoneInfo(timezone))
    return start_local.astimezone(UTC), end_local.astimezone(UTC)


def period_for(value: datetime, timezone: str = EFFICIENCY_TIMEZONE) -> str:
    return _aware(value).astimezone(ZoneInfo(timezone)).strftime("%Y-%m")


def _assignee_at(state: _TaskState, moment: datetime) -> UUID | None:
    relevant = [item for item in state.assignments if item[0] <= moment]
    return max(relevant, key=lambda item: item[0])[1] if relevant else None


def _status_at(state: _TaskState, moment: datetime) -> str:
    relevant = [item for item in state.statuses if item[0] <= moment]
    return max(relevant, key=lambda item: item[0])[1] if relevant else "new"


def _excluded_at(state: _TaskState, moment: datetime) -> bool:
    relevant = [item for item in state.exclusions if item[0] <= moment]
    return max(relevant, key=lambda item: item[0])[1] if relevant else False


def _event_values(row: Record) -> tuple[Record, Record]:
    old_value = row.get("old_value")
    new_value = row.get("new_value")
    return (
        old_value if isinstance(old_value, Mapping) else {},
        new_value if isinstance(new_value, Mapping) else {},
    )


def replay_task_events(events: Sequence[Record], tracking_started_at: datetime) -> list[_TaskState]:
    """Rebuild only facts recorded after tracking started; never infer from tasks.updated_at."""
    states: dict[UUID, _TaskState] = {}
    tracking_started_at = _aware(tracking_started_at)
    ordered = sorted(events, key=lambda row: (_aware(row["occurred_at"]), str(row["id"])))
    for row in ordered:
        task_id = row["task_id"]
        occurred_at = _aware(row["occurred_at"])
        event_type = str(row["event_type"])
        old_value, new_value = _event_values(row)
        state = states.setdefault(task_id, _TaskState(task_id=task_id, known_from=occurred_at))
        assignee = row.get("assignee_user_id") or _parse_uuid(new_value.get("assigneeId"))
        due_at = _aware(row["due_at"]) if isinstance(row.get("due_at"), datetime) else None

        if event_type in {"initial_snapshot", "task_created"}:
            if isinstance(assignee, UUID):
                state.assignments.append((occurred_at, assignee))
            status = new_value.get("status")
            if isinstance(status, str):
                state.statuses.append((occurred_at, status))
            due_at = due_at or _parse_datetime(new_value.get("dueAt"))
            # A snapshot knows a future obligation for active work, but must not invent a
            # submission/completion date for work that was already terminal or under review.
            if due_at is not None and (
                event_type == "task_created" or due_at >= tracking_started_at
            ) and (event_type == "task_created" or status in {"new", "in_progress"}):
                state.deadlines.append(_Deadline(due_at=due_at, set_at=occurred_at))
            continue

        if event_type == "task_status_changed":
            status = new_value.get("status")
            if isinstance(status, str):
                state.statuses.append((occurred_at, status))
            continue

        if event_type == "assignee_changed":
            new_assignee = _parse_uuid(new_value.get("assigneeId")) or (
                assignee if isinstance(assignee, UUID) else None
            )
            if new_assignee is not None:
                state.assignments.append((occurred_at, new_assignee))
            continue

        if event_type == "deadline_changed":
            old_due = _parse_datetime(old_value.get("dueAt"))
            new_due = due_at or _parse_datetime(new_value.get("dueAt"))
            for deadline in reversed(state.deadlines):
                if deadline.replaced_at is None and (old_due is None or deadline.due_at == old_due):
                    if occurred_at <= deadline.due_at:
                        deadline.replaced_at = occurred_at
                    break
            if new_due is not None:
                state.deadlines.append(_Deadline(due_at=new_due, set_at=occurred_at))
            continue

        if event_type == "result_submitted_for_review":
            state.results.append(
                (occurred_at, assignee if isinstance(assignee, UUID) else None, event_type)
            )
            state.statuses.append((occurred_at, "awaiting_review"))
        elif event_type == "result_accepted":
            state.statuses.append((occurred_at, "completed"))
        elif event_type == "task_completed":
            state.results.append(
                (occurred_at, assignee if isinstance(assignee, UUID) else None, event_type)
            )
            state.statuses.append((occurred_at, "completed"))
        elif event_type == "result_returned_for_revision":
            state.return_events.append(
                (occurred_at, assignee if isinstance(assignee, UUID) else None)
            )
            state.statuses.append((occurred_at, "in_progress"))
        elif event_type == "task_cancelled":
            state.cancelled_at = occurred_at
            state.statuses.append((occurred_at, "cancelled"))
        elif event_type in {"efficiency_excluded", "efficiency_exclusion_changed"}:
            state.exclusions.append((occurred_at, bool(new_value.get("excluded", True))))
    return list(states.values())


def _calculate_aggregate_from_states(
    states: Sequence[_TaskState],
    *,
    user_id: UUID,
    period: str,
    tracking_started_at: datetime,
    as_of: datetime | None = None,
    timezone: str = EFFICIENCY_TIMEZONE,
) -> dict[str, Any]:
    """Calculate one employee aggregate from recorded facts with equal task weight."""
    period_start, period_end = period_bounds(period, timezone)
    tracking_started_at = _aware(tracking_started_at)
    current_time = _aware(as_of or datetime.now(UTC))
    effective_end = min(period_end, current_time)
    if period_end <= tracking_started_at:
        completeness = "unavailable"
    elif period_start < tracking_started_at:
        completeness = "partial"
    else:
        completeness = "complete"

    counters = {
        "on_time_count": 0,
        "eligible_count": 0,
        "overdue_count": 0,
        "awaiting_review_count": 0,
        "no_due_date_count": 0,
        "returned_for_revision_count": 0,
        "excluded_count": 0,
    }
    if completeness == "unavailable" or effective_end <= period_start:
        return {
            "percentage": None,
            **counters,
            "sample_size": 0,
            "history_completeness": completeness,
            "small_sample": False,
        }

    for state in states:
        if state.known_from >= effective_end:
            continue
        current_assignee = _assignee_at(state, effective_end)
        current_status = _status_at(state, effective_end)
        current_deadlines = [
            deadline
            for deadline in state.deadlines
            if deadline.set_at < effective_end
            and (deadline.replaced_at is None or deadline.replaced_at >= effective_end)
        ]
        if (
            current_assignee == user_id
            and current_status not in {"completed", "cancelled"}
            and not current_deadlines
        ):
            counters["no_due_date_count"] += 1
        if current_assignee == user_id and current_status == "awaiting_review":
            counters["awaiting_review_count"] += 1
        counters["returned_for_revision_count"] += sum(
            1
            for occurred_at, assignee in state.return_events
            if assignee == user_id and period_start <= occurred_at < effective_end
        )

        seen_for_user = False
        for deadline in sorted(state.deadlines, key=lambda item: item.due_at):
            if seen_for_user or not (period_start <= deadline.due_at < effective_end):
                continue
            if deadline.set_at > deadline.due_at:
                continue
            if deadline.replaced_at is not None and deadline.replaced_at <= deadline.due_at:
                continue
            assignee_at_due = _assignee_at(state, deadline.due_at)
            if assignee_at_due != user_id:
                continue
            seen_for_user = True
            excluded = _excluded_at(state, effective_end)
            cancelled = state.cancelled_at is not None and state.cancelled_at < effective_end
            if excluded or cancelled:
                counters["excluded_count"] += 1
                continue
            counters["eligible_count"] += 1
            completed_in_time = any(
                assignee == user_id and occurred_at <= deadline.due_at
                for occurred_at, assignee, _event_type in state.results
            )
            if completed_in_time:
                counters["on_time_count"] += 1
            else:
                counters["overdue_count"] += 1

        if (
            current_assignee == user_id
            and _excluded_at(state, effective_end)
            and not seen_for_user
        ):
            counters["excluded_count"] += 1

    eligible = counters["eligible_count"]
    percentage = round(counters["on_time_count"] / eligible * 100, 3) if eligible else None
    return {
        "percentage": percentage,
        **counters,
        "sample_size": eligible,
        "history_completeness": completeness,
        "small_sample": 0 < eligible < SMALL_SAMPLE_LIMIT,
    }


def calculate_aggregate(
    events: Sequence[Record],
    *,
    user_id: UUID,
    period: str,
    tracking_started_at: datetime,
    as_of: datetime | None = None,
    timezone: str = EFFICIENCY_TIMEZONE,
) -> dict[str, Any]:
    """Calculate one employee aggregate from recorded facts with equal task weight."""
    return _calculate_aggregate_from_states(
        replay_task_events(events, tracking_started_at),
        user_id=user_id,
        period=period,
        tracking_started_at=tracking_started_at,
        as_of=as_of,
        timezone=timezone,
    )


def previous_periods(period: str, count: int) -> list[str]:
    year, month = (int(part) for part in period.split("-"))
    result: list[str] = []
    for offset in range(count - 1, -1, -1):
        month_index = year * 12 + month - 1 - offset
        result.append(f"{month_index // 12:04d}-{month_index % 12 + 1:02d}")
    return result


async def record_task_event(
    connection: AsyncConnection,
    *,
    task_id: UUID,
    event_type: str,
    occurred_at: datetime,
    actor_user_id: UUID | None,
    assignee_user_id: UUID | None,
    due_at: datetime | None,
    old_value: Mapping[str, object] | None = None,
    new_value: Mapping[str, object] | None = None,
    reason_code: str | None = None,
    reason_text: str | None = None,
    metadata: Mapping[str, object] | None = None,
) -> UUID:
    event_id = uuid4()
    await connection.execute(
        insert(task_efficiency_events).values(
            id=event_id,
            task_id=task_id,
            event_type=event_type,
            occurred_at=occurred_at,
            actor_user_id=actor_user_id,
            assignee_user_id=assignee_user_id,
            due_at=due_at,
            old_value=dict(old_value or {}),
            new_value=dict(new_value or {}),
            reason_code=reason_code,
            reason_text=reason_text,
            metadata=dict(metadata or {}),
            methodology_version=METHODOLOGY_VERSION,
            created_at=datetime.now(UTC),
        )
    )
    return event_id


async def load_efficiency_overview(
    connection: AsyncConnection,
    current_user: AuthenticatedUser,
    period: str | None = None,
    *,
    as_of: datetime | None = None,
) -> dict[str, Any]:
    """Return aggregate-only data. No task identifier or content leaves this boundary."""
    current_time = _aware(as_of or datetime.now(UTC))
    requested_period = period or period_for(current_time)
    period_bounds(requested_period)
    methodology = (
        (
            await connection.execute(
                select(employee_efficiency_methodologies)
                .where(employee_efficiency_methodologies.c.version == METHODOLOGY_VERSION)
                .limit(1)
            )
        )
        .mappings()
        .one()
    )
    employee_rows = (
        (
            await connection.execute(
                select(users.c.id, users.c.full_name, users.c.job_title)
                .where(users.c.status == "active")
                .order_by(users.c.full_name)
            )
        )
        .mappings()
        .all()
    )
    event_rows = (
        (
            await connection.execute(
                select(task_efficiency_events).order_by(
                    task_efficiency_events.c.occurred_at,
                    task_efficiency_events.c.created_at,
                )
            )
        )
        .mappings()
        .all()
    )
    tracking_started_at = methodology["tracking_started_at"]
    states = replay_task_events(event_rows, tracking_started_at)
    history_periods = previous_periods(requested_period, 6)
    aggregates: list[dict[str, Any]] = []
    for employee in employee_rows:
        aggregate = _calculate_aggregate_from_states(
            states,
            user_id=employee["id"],
            period=requested_period,
            tracking_started_at=tracking_started_at,
            as_of=current_time,
        )
        history = []
        for history_period in history_periods:
            point = _calculate_aggregate_from_states(
                states,
                user_id=employee["id"],
                period=history_period,
                tracking_started_at=tracking_started_at,
                as_of=current_time,
            )
            history.append(
                {
                    "period": history_period,
                    "percentage": point["percentage"],
                    "on_time_count": point["on_time_count"],
                    "eligible_count": point["eligible_count"],
                    "history_completeness": point["history_completeness"],
                }
            )
        aggregates.append(
            {
                "user_id": str(employee["id"]),
                "name": employee["full_name"],
                "job_title": employee["job_title"] or "Должность не указана",
                "period": requested_period,
                "timezone": methodology["timezone"],
                "methodology_version": methodology["version"],
                "tracking_started_at": tracking_started_at,
                **aggregate,
                "history": history,
            }
        )
    return {
        "period": requested_period,
        "timezone": methodology["timezone"],
        "methodology_version": methodology["version"],
        "tracking_started_at": tracking_started_at,
        "current_user_id": str(current_user.id),
        "employees": aggregates,
    }


async def materialize_efficiency_digest_notifications(
    connection: AsyncConnection,
    *,
    now: datetime | None = None,
) -> int:
    """Persist one daily snapshot and at most one explanatory digest per employee/day."""
    current_time = _aware(now or datetime.now(UTC))
    local_time = current_time.astimezone(ZoneInfo(EFFICIENCY_TIMEZONE))
    if local_time.hour < 18:
        return 0
    local_date = local_time.date()
    # The aggregate has no viewer-dependent task details, so a synthetic active user is unnecessary:
    # load the methodology/events once and calculate directly for all active employees.
    methodology = (
        (
            await connection.execute(
                select(employee_efficiency_methodologies)
                .where(employee_efficiency_methodologies.c.version == METHODOLOGY_VERSION)
            )
        )
        .mappings()
        .one()
    )
    event_rows = (
        (await connection.execute(select(task_efficiency_events)))
        .mappings()
        .all()
    )
    states = replay_task_events(event_rows, methodology["tracking_started_at"])
    user_ids = (
        (await connection.execute(select(users.c.id).where(users.c.status == "active")))
        .scalars()
        .all()
    )
    created = 0
    current_period = period_for(current_time)
    for user_id in user_ids:
        aggregate = _calculate_aggregate_from_states(
            states,
            user_id=user_id,
            period=current_period,
            tracking_started_at=methodology["tracking_started_at"],
            as_of=current_time,
        )
        previous = (
            (
                await connection.execute(
                    select(employee_efficiency_snapshots)
                    .where(
                        employee_efficiency_snapshots.c.user_id == user_id,
                        employee_efficiency_snapshots.c.snapshot_date < local_date,
                    )
                    .order_by(employee_efficiency_snapshots.c.snapshot_date.desc())
                    .limit(1)
                )
            )
            .mappings()
            .first()
        )
        await connection.execute(
            pg_insert(employee_efficiency_snapshots)
            .values(
                id=uuid4(),
                user_id=user_id,
                snapshot_date=local_date,
                period=current_period,
                percentage=aggregate["percentage"],
                on_time_count=aggregate["on_time_count"],
                eligible_count=aggregate["eligible_count"],
                overdue_count=aggregate["overdue_count"],
                methodology_version=METHODOLOGY_VERSION,
                created_at=current_time,
            )
            .on_conflict_do_nothing(
                index_elements=[
                    employee_efficiency_snapshots.c.user_id,
                    employee_efficiency_snapshots.c.snapshot_date,
                    employee_efficiency_snapshots.c.methodology_version,
                ]
            )
        )
        if previous is None or (
            int(previous["eligible_count"]) == aggregate["eligible_count"]
            and int(previous["on_time_count"]) == aggregate["on_time_count"]
        ):
            continue
        previous_label = (
            "Нет данных"
            if previous["percentage"] is None
            else f"{Decimal(previous['percentage']):.0f}%"
        )
        current_label = (
            "Нет данных"
            if aggregate["percentage"] is None
            else f"{aggregate['percentage']:.0f}%"
        )
        statement = (
            pg_insert(workspace_notifications)
            .values(
                id=uuid4(),
                user_id=user_id,
                event_key=f"efficiency:daily:{local_date.isoformat()}:{METHODOLOGY_VERSION}",
                kind="task",
                priority="normal",
                title="Сводка по выполнению задач в срок",
                body=(
                    f"Показатель был {previous_label}, сейчас {current_label}. "
                    f"Сейчас вовремя: {aggregate['on_time_count']} из "
                    f"{aggregate['eligible_count']} задач."
                ),
                section="tasks",
                entity_id=None,
                requires_action=False,
                is_reminder=False,
                occurred_at=current_time,
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
    return created
