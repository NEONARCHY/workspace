from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest

from yuksalish_api.auth import AuthenticatedUser
from yuksalish_api.repository import WorkspaceRepositoryError, load_task_history
from yuksalish_api.task_history import task_history_page


def test_history_combines_decisions_and_returns_without_private_metadata() -> None:
    task_id, actor, request_id = uuid4(), uuid4(), uuid4()
    created = datetime(2026, 10, 1, tzinfo=UTC)
    old_due, new_due = created + timedelta(days=4), created + timedelta(days=10)
    data = task_history_page(
        {"id": task_id, "created_at": created, "author_user_id": actor},
        [{"id": uuid4(), "event_type": "result_returned_for_revision",
          "occurred_at": created + timedelta(days=8), "actor_user_id": actor,
          "reason_code": "corrections_required", "reason_text": "Add attachment",
          "metadata": {"private": "DO NOT EXPOSE"}},
         {"id": uuid4(), "event_type": "deadline_changed",
          "occurred_at": created + timedelta(days=2), "metadata": {"requestId": str(request_id)}}],
        [{"id": request_id, "requester_user_id": actor, "old_due_at": old_due,
          "proposed_due_at": new_due, "reason": "Need more time", "status": "approved",
          "created_at": created + timedelta(days=1), "decided_at": created + timedelta(days=2),
          "decided_by_user_id": actor}], {actor: "Employee"},
    )
    assert [event.kind for event in data.events] == [
        "result_returned_for_revision", "deadline_approved", "deadline_requested", "task_created",
    ]
    assert data.events[1].old_due_at == old_due
    assert data.events[1].due_at == new_due
    assert data.events[1].actor_name == "Employee"
    assert data.events[-1].due_at is None  # unknown creation deadline is not fabricated
    assert not data.history_complete
    assert "DO NOT EXPOSE" not in data.model_dump_json()


def test_history_pages_do_not_silently_truncate_older_events() -> None:
    actor, task_id = uuid4(), uuid4()
    created = datetime(2026, 10, 1, tzinfo=UTC)
    events = [{"id": uuid4(), "event_type": "task_created" if index == 0 else "deadline_changed",
               "occurred_at": created + timedelta(minutes=index)} for index in range(60)]
    task = {"id": task_id, "created_at": created, "author_user_id": actor}
    first = task_history_page(task, events, [], {})
    second = task_history_page(task, events, [], {}, offset=first.next_offset or 0)
    assert first.history_complete
    assert len(first.events) == 50
    assert len(second.events) == 10
    assert second.next_offset is None
    assert not {item.id for item in first.events} & {item.id for item in second.events}


@pytest.mark.anyio
async def test_history_checks_task_access_before_reading_any_events(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from yuksalish_api import repository

    connection = AsyncMock()
    user = AuthenticatedUser(uuid4(), "employee", "Employee", None, None, "employee")
    access = AsyncMock(side_effect=WorkspaceRepositoryError(404, "Task was not found"))
    monkeypatch.setattr(repository, "_task_access_row", access)
    with pytest.raises(WorkspaceRepositoryError):
        await load_task_history(connection, user, uuid4())
    connection.execute.assert_not_awaited()
