from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

import pytest
from pydantic import ValidationError

from yuksalish_api.efficiency_service import (
    calculate_aggregate,
    period_bounds,
    period_for,
    previous_periods,
    replay_task_events,
)
from yuksalish_api.workspace_schemas import (
    ReturnTaskForRevisionRequest,
    TaskEfficiencyExclusionRequest,
)

TRACKING = datetime(2026, 9, 7, 6, 0, tzinfo=UTC)  # 11:00 in Tashkent
IVAN = uuid4()
ANNA = uuid4()


def event(
    task_id: UUID,
    event_type: str,
    occurred_at: datetime,
    *,
    assignee: UUID | None = IVAN,
    due_at: datetime | None = None,
    old: dict[str, object] | None = None,
    new: dict[str, object] | None = None,
) -> dict[str, object]:
    return {
        "id": uuid4(),
        "task_id": task_id,
        "event_type": event_type,
        "occurred_at": occurred_at,
        "assignee_user_id": assignee,
        "due_at": due_at,
        "old_value": old or {},
        "new_value": new or {},
    }


def created(task_id: UUID, due_at: datetime | None, assignee: UUID = IVAN) -> dict[str, object]:
    return event(
        task_id,
        "task_created",
        TRACKING + timedelta(minutes=1),
        assignee=assignee,
        due_at=due_at,
        new={
            "status": "new",
            "assigneeId": str(assignee),
            "dueAt": due_at.isoformat() if due_at else None,
        },
    )


def aggregate(events: list[dict[str, object]], user_id: UUID = IVAN, as_of: datetime | None = None):
    return calculate_aggregate(
        events,
        user_id=user_id,
        period="2026-09",
        tracking_started_at=TRACKING,
        as_of=as_of or datetime(2026, 9, 30, 18, 0, tzinfo=UTC),
    )


def test_tashkent_month_boundaries_and_period_helpers() -> None:
    start, end = period_bounds("2026-09")

    assert start == datetime(2026, 8, 31, 19, 0, tzinfo=UTC)
    assert end == datetime(2026, 9, 30, 19, 0, tzinfo=UTC)
    assert period_for(datetime(2026, 8, 31, 19, 0, tzinfo=UTC)) == "2026-09"
    assert previous_periods("2026-01", 3) == ["2025-11", "2025-12", "2026-01"]
    with pytest.raises(ValueError, match="YYYY-MM"):
        period_bounds("September")


def test_last_minute_of_tashkent_month_is_included_but_midnight_is_next_period() -> None:
    last_minute = datetime(2026, 9, 30, 18, 59, tzinfo=UTC)
    midnight = datetime(2026, 9, 30, 19, 0, tzinfo=UTC)
    result = aggregate(
        [created(uuid4(), last_minute), created(uuid4(), midnight)],
        as_of=datetime(2026, 9, 30, 18, 59, 59, tzinfo=UTC),
    )

    assert result["eligible_count"] == 1
    assert result["overdue_count"] == 1


def test_zero_denominator_is_none_and_future_deadline_is_not_eligible() -> None:
    task_id = uuid4()
    future_due = datetime(2026, 9, 20, 8, 0, tzinfo=UTC)
    result = aggregate(
        [created(task_id, future_due)],
        as_of=datetime(2026, 9, 10, 8, 0, tzinfo=UTC),
    )

    assert result["percentage"] is None
    assert result["eligible_count"] == 0
    assert result["sample_size"] == 0


def test_task_without_deadline_is_separate_and_not_in_denominator() -> None:
    result = aggregate([created(uuid4(), None)])

    assert result["percentage"] is None
    assert result["eligible_count"] == 0
    assert result["no_due_date_count"] == 1


def test_submission_before_deadline_is_on_time_even_when_accepted_later() -> None:
    task_id = uuid4()
    due = datetime(2026, 9, 10, 12, 0, tzinfo=UTC)
    result = aggregate([
        created(task_id, due),
        event(task_id, "result_submitted_for_review", due - timedelta(minutes=1), due_at=due),
        event(task_id, "result_accepted", due + timedelta(days=2), due_at=due),
        event(task_id, "task_completed", due + timedelta(days=2), due_at=due),
    ])

    assert result["percentage"] == 100
    assert result["on_time_count"] == 1
    assert result["overdue_count"] == 0


def test_late_submission_is_overdue_and_awaiting_review_is_separate() -> None:
    task_id = uuid4()
    due = datetime(2026, 9, 10, 12, 0, tzinfo=UTC)
    result = aggregate([
        created(task_id, due),
        event(task_id, "result_submitted_for_review", due + timedelta(seconds=1), due_at=due),
    ])

    assert result["percentage"] == 0
    assert result["overdue_count"] == 1
    assert result["awaiting_review_count"] == 1
    assert result["small_sample"] is True


def test_deadline_changed_before_due_replaces_old_deadline() -> None:
    task_id = uuid4()
    old_due = datetime(2026, 9, 10, 12, 0, tzinfo=UTC)
    new_due = datetime(2026, 9, 20, 12, 0, tzinfo=UTC)
    result = aggregate([
        created(task_id, old_due),
        event(
            task_id,
            "deadline_changed",
            old_due - timedelta(days=2),
            due_at=new_due,
            old={"dueAt": old_due.isoformat()},
            new={"dueAt": new_due.isoformat()},
        ),
        event(task_id, "task_completed", new_due - timedelta(hours=1), due_at=new_due),
    ])

    assert result["eligible_count"] == 1
    assert result["on_time_count"] == 1


def test_deadline_changed_after_overdue_does_not_erase_missed_deadline() -> None:
    task_id = uuid4()
    old_due = datetime(2026, 9, 10, 12, 0, tzinfo=UTC)
    new_due = datetime(2026, 9, 20, 12, 0, tzinfo=UTC)
    result = aggregate([
        created(task_id, old_due),
        event(
            task_id,
            "deadline_changed",
            old_due + timedelta(days=2),
            due_at=new_due,
            old={"dueAt": old_due.isoformat()},
            new={"dueAt": new_due.isoformat()},
        ),
        event(task_id, "task_completed", new_due - timedelta(hours=1), due_at=new_due),
    ])

    assert result["eligible_count"] == 1
    assert result["on_time_count"] == 0
    assert result["overdue_count"] == 1


def test_multiple_pre_deadline_changes_replay_to_the_last_agreed_deadline() -> None:
    task_id = uuid4()
    first_due = datetime(2026, 9, 12, 12, 0, tzinfo=UTC)
    second_due = datetime(2026, 9, 18, 12, 0, tzinfo=UTC)
    final_due = datetime(2026, 9, 24, 12, 0, tzinfo=UTC)
    result = aggregate([
        created(task_id, first_due),
        event(
            task_id,
            "deadline_changed",
            first_due - timedelta(days=4),
            due_at=second_due,
            old={"dueAt": first_due.isoformat()},
            new={"dueAt": second_due.isoformat()},
        ),
        event(
            task_id,
            "deadline_changed",
            second_due - timedelta(days=3),
            due_at=final_due,
            old={"dueAt": second_due.isoformat()},
            new={"dueAt": final_due.isoformat()},
        ),
        event(task_id, "task_completed", final_due - timedelta(minutes=1), due_at=final_due),
    ])

    assert result["eligible_count"] == 1
    assert result["percentage"] == 100


def test_assignee_change_after_due_does_not_transfer_previous_overdue() -> None:
    task_id = uuid4()
    due = datetime(2026, 9, 10, 12, 0, tzinfo=UTC)
    events = [
        created(task_id, due),
        event(
            task_id,
            "assignee_changed",
            due + timedelta(days=2),
            assignee=ANNA,
            due_at=due,
            old={"assigneeId": str(IVAN)},
            new={"assigneeId": str(ANNA)},
        ),
        event(task_id, "task_completed", due + timedelta(days=3), assignee=ANNA, due_at=due),
    ]

    assert aggregate(events, IVAN)["overdue_count"] == 1
    assert aggregate(events, ANNA)["eligible_count"] == 0


def test_assignee_change_before_due_attributes_deadline_to_new_assignee() -> None:
    task_id = uuid4()
    due = datetime(2026, 9, 10, 12, 0, tzinfo=UTC)
    events = [
        created(task_id, due),
        event(
            task_id,
            "assignee_changed",
            due - timedelta(days=2),
            assignee=ANNA,
            due_at=due,
            new={"assigneeId": str(ANNA)},
        ),
        event(task_id, "task_completed", due - timedelta(hours=1), assignee=ANNA, due_at=due),
    ]

    assert aggregate(events, IVAN)["eligible_count"] == 0
    assert aggregate(events, ANNA)["percentage"] == 100


def test_motivated_return_is_separate_and_does_not_reduce_percentage() -> None:
    task_id = uuid4()
    due = datetime(2026, 9, 10, 12, 0, tzinfo=UTC)
    result = aggregate([
        created(task_id, due),
        event(task_id, "result_submitted_for_review", due - timedelta(hours=1), due_at=due),
        event(task_id, "result_returned_for_revision", due + timedelta(hours=2), due_at=due),
    ])

    assert result["percentage"] == 100
    assert result["returned_for_revision_count"] == 1


def test_plain_status_change_is_not_a_motivated_return() -> None:
    task_id = uuid4()
    due = datetime(2026, 9, 10, 12, 0, tzinfo=UTC)
    result = aggregate([
        created(task_id, due),
        event(
            task_id,
            "task_status_changed",
            due - timedelta(hours=2),
            due_at=due,
            new={"status": "in_progress"},
        ),
    ])

    assert result["returned_for_revision_count"] == 0
    assert result["overdue_count"] == 1


def test_explicit_exclusion_removes_task_from_denominator() -> None:
    task_id = uuid4()
    due = datetime(2026, 9, 10, 12, 0, tzinfo=UTC)
    result = aggregate([
        created(task_id, due),
        event(
            task_id,
            "efficiency_excluded",
            due + timedelta(hours=1),
            due_at=due,
            new={"excluded": True},
        ),
    ])

    assert result["percentage"] is None
    assert result["eligible_count"] == 0
    assert result["excluded_count"] == 1


def test_cancelled_task_is_explicitly_excluded_from_denominator() -> None:
    task_id = uuid4()
    due = datetime(2026, 9, 10, 12, 0, tzinfo=UTC)
    result = aggregate([
        created(task_id, due),
        event(task_id, "task_cancelled", due - timedelta(hours=1), due_at=due),
    ])

    assert result["eligible_count"] == 0
    assert result["excluded_count"] == 1


@pytest.mark.parametrize(
    "reason",
    ["cancelled", "external_dependency", "requirements_changed", "duplicate"],
)
def test_structured_exclusion_reasons_are_accepted(reason: str) -> None:
    payload = TaskEfficiencyExclusionRequest(excluded=True, reasonCode=reason)

    assert payload.reason_code == reason


def test_other_return_and_exclusion_reasons_require_explanation() -> None:
    with pytest.raises(ValidationError):
        ReturnTaskForRevisionRequest(reasonCode="other")
    with pytest.raises(ValidationError):
        TaskEfficiencyExclusionRequest(excluded=True, reasonCode="other")

    assert ReturnTaskForRevisionRequest(
        reasonCode="other", reasonText="Новая подтверждённая причина"
    ).reason_text
    assert TaskEfficiencyExclusionRequest(
        excluded=True,
        reasonCode="other",
        reasonText="Внешнее решение владельца",
    ).reason_text


def test_initial_snapshot_does_not_invent_past_deadline_or_completion() -> None:
    task_id = uuid4()
    state = replay_task_events([
        event(
            task_id,
            "initial_snapshot",
            TRACKING,
            due_at=TRACKING - timedelta(days=1),
            new={"status": "completed", "assigneeId": str(IVAN)},
        )
    ], TRACKING)[0]

    assert state.deadlines == []
    assert state.results == []
    assert aggregate([
        event(
            task_id,
            "initial_snapshot",
            TRACKING,
            due_at=TRACKING - timedelta(days=1),
            new={"status": "completed", "assigneeId": str(IVAN)},
        )
    ])["eligible_count"] == 0


def test_initial_snapshot_does_not_invent_existing_review_submission_time() -> None:
    task_id = uuid4()
    future_due = TRACKING + timedelta(days=2)
    state = replay_task_events([
        event(
            task_id,
            "initial_snapshot",
            TRACKING,
            due_at=future_due,
            new={"status": "awaiting_review", "assigneeId": str(IVAN)},
        )
    ], TRACKING)[0]

    assert state.deadlines == []
    assert state.results == []


def test_period_before_tracking_is_unavailable() -> None:
    result = calculate_aggregate(
        [],
        user_id=IVAN,
        period="2026-08",
        tracking_started_at=TRACKING,
        as_of=datetime(2026, 9, 30, tzinfo=UTC),
    )

    assert result["history_completeness"] == "unavailable"
    assert result["percentage"] is None
