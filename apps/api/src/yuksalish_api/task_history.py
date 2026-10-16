"""Safe, read-only task lifecycle projection; no private metadata is exposed."""
from collections.abc import Mapping, Sequence
from typing import Any
from uuid import UUID

from sqlalchemy.engine import RowMapping

from .workspace_schemas import TaskHistoryEventResponse, TaskHistoryResponse

Record = Mapping[str, Any] | RowMapping


def task_history_page(
    task: Record, events: Sequence[Record],
    requests: Sequence[Record], names: Mapping[UUID, str], *, offset: int = 0,
) -> TaskHistoryResponse:
    items: list[TaskHistoryEventResponse] = []

    def entry(**values: Any) -> None:
        actor = values.get("actor_user_id")
        if actor is not None:
            values["actor_name"] = names.get(actor)
            values["actor_user_id"] = str(actor)
        items.append(TaskHistoryEventResponse(**values))

    decided = {str(row["id"]) for row in requests if row.get("decided_at") is not None}
    for event in events:
        metadata = event.get("metadata") or {}
        if event["event_type"] == "deadline_changed" and str(metadata.get("requestId")) in decided:
            continue  # One visible approval includes the deadline change itself.
        old, new = event.get("old_value") or {}, event.get("new_value") or {}
        entry(
            id=str(event["id"]), kind=event["event_type"], occurred_at=event["occurred_at"],
            actor_user_id=event.get("actor_user_id"),
            old_due_at=old.get("dueAt"), due_at=new.get("dueAt"),
            old_status=old.get("status"), status=new.get("status"),
            reason_code=event.get("reason_code"), reason=event.get("reason_text"),
        )
    complete = any(event["event_type"] == "task_created" for event in events)
    if not complete:
        # Only creation time and author are known; do not fabricate the old due date.
        entry(id=f"created:{task['id']}", kind="task_created", occurred_at=task["created_at"],
              actor_user_id=task["author_user_id"])
    for row in requests:
        entry(id=f"requested:{row['id']}", kind="deadline_requested",
              occurred_at=row["created_at"], actor_user_id=row["requester_user_id"],
              old_due_at=row["old_due_at"], due_at=row["proposed_due_at"], reason=row["reason"])
        if row.get("decided_at") is not None:
            entry(id=f"decision:{row['id']}", kind=f"deadline_{row['status']}",
                  occurred_at=row["decided_at"], actor_user_id=row["decided_by_user_id"],
                  old_due_at=row["old_due_at"], due_at=row["proposed_due_at"], reason=row["reason"])
    order = {"task_created": 0, "result_accepted": 1, "task_completed": 2}
    items.sort(key=lambda item: (item.occurred_at, order.get(item.kind, 0), item.id), reverse=True)
    page_size = 50
    return TaskHistoryResponse(
        events=items[offset:offset + page_size], history_complete=complete,
        next_offset=offset + page_size if offset + page_size < len(items) else None,
    )
