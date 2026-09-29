"""Start EFF-2 with immediate, reversible credit for every task executor."""

import json
from collections.abc import Sequence
from datetime import UTC, datetime
from uuid import uuid4

import sqlalchemy as sa
from alembic import op

revision: str = "0068_task_review_efficiency"
down_revision: str = "0067_merge_workspace_features"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

VERSION = "EFF-2.0"


def upgrade() -> None:
    connection = op.get_bind()
    started_at = datetime.now(UTC)
    op.drop_constraint("ck_task_efficiency_events_type", "task_efficiency_events", type_="check")
    op.create_check_constraint(
        "ck_task_efficiency_events_type",
        "task_efficiency_events",
        "event_type IN ('initial_snapshot', 'task_created', 'task_status_changed', "
        "'assignee_changed', 'task_executors_changed', 'deadline_changed', "
        "'result_submitted_for_review', 'result_accepted', "
        "'result_returned_for_revision', 'task_completed', 'task_cancelled', "
        "'efficiency_excluded', 'efficiency_exclusion_changed')",
    )
    connection.execute(
        sa.text(
            "INSERT INTO employee_efficiency_methodologies "
            "(version, timezone, tracking_started_at, rules, created_at) "
            "VALUES (:version, 'Asia/Tashkent', :started, CAST(:rules AS jsonb), :started)"
        ),
        {
            "version": VERSION,
            "started": started_at,
            "rules": json.dumps({
                "metric": "on_time_task_submission",
                "equalWeight": True,
                "executorScope": "primary_and_co_assignees_at_submission",
                "creditAtSubmission": True,
                "returnRevokesSubmission": True,
                "historyBeforeSnapshotKnown": False,
            }),
        },
    )
    task_rows = connection.execute(sa.text(
        "SELECT id, status, due_at, primary_assignee_user_id, created_at FROM tasks"
    )).mappings()
    for task in task_rows:
        co_assignees = connection.execute(
            sa.text(
                "SELECT user_id FROM tasks_participants "
                "WHERE task_id = :task_id AND participant_role = 'co_assignee'"
            ),
            {"task_id": task["id"]},
        ).scalars()
        executor_ids = {task["primary_assignee_user_id"], *co_assignees}
        connection.execute(
            sa.text(
                "INSERT INTO task_efficiency_events "
                "(id, task_id, event_type, occurred_at, actor_user_id, assignee_user_id, "
                "due_at, old_value, new_value, reason_code, reason_text, metadata, "
                "methodology_version, created_at) VALUES "
                "(:id, :task_id, 'initial_snapshot', :started, NULL, :assignee_id, "
                ":due_at, CAST(:old_value AS jsonb), CAST(:new_value AS jsonb), NULL, NULL, "
                "CAST(:metadata AS jsonb), :version, :started)"
            ),
            {
                "id": uuid4(),
                "task_id": task["id"],
                "started": started_at,
                "assignee_id": task["primary_assignee_user_id"],
                "due_at": task["due_at"],
                "old_value": json.dumps({}),
                "new_value": json.dumps({
                    "status": task["status"],
                    "assigneeId": str(task["primary_assignee_user_id"]),
                    "dueAt": task["due_at"].isoformat() if task["due_at"] else None,
                    "createdAt": task["created_at"].isoformat(),
                }),
                "metadata": json.dumps({
                    "executorIds": [str(item) for item in executor_ids],
                    "historyBeforeSnapshotKnown": False,
                }),
                "version": VERSION,
            },
        )


def downgrade() -> None:
    connection = op.get_bind()
    connection.execute(sa.text(
        "DELETE FROM task_efficiency_events "
        "WHERE methodology_version = :version AND event_type = 'initial_snapshot'"
    ), {"version": VERSION})
    # A database that has recorded EFF-2 task events/snapshots must not silently
    # discard them. The foreign keys prevent removal of their methodology row.
    connection.execute(sa.text(
        "DELETE FROM employee_efficiency_methodologies WHERE version = :version"
    ), {"version": VERSION})
    op.drop_constraint("ck_task_efficiency_events_type", "task_efficiency_events", type_="check")
    op.create_check_constraint(
        "ck_task_efficiency_events_type",
        "task_efficiency_events",
        "event_type IN ('initial_snapshot', 'task_created', 'task_status_changed', "
        "'assignee_changed', 'deadline_changed', 'result_submitted_for_review', "
        "'result_accepted', 'result_returned_for_revision', 'task_completed', "
        "'task_cancelled', 'efficiency_excluded', 'efficiency_exclusion_changed')",
    )
