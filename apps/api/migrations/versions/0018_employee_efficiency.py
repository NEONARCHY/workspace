"""Add the EFF-1 task event ledger and reproducible efficiency snapshots.

Revision ID: 0018_employee_efficiency
Revises: 0017_personal_organization
"""

import json
from collections.abc import Sequence
from datetime import UTC, datetime
from uuid import uuid4

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0018_employee_efficiency"
down_revision: str | None = "0017_personal_organization"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

METHODOLOGY_VERSION = "EFF-1.0"
TIMEZONE = "Asia/Tashkent"


def upgrade() -> None:
    op.create_table(
        "employee_efficiency_methodologies",
        sa.Column("version", sa.String(length=32), primary_key=True),
        sa.Column("timezone", sa.String(length=64), nullable=False),
        sa.Column("tracking_started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("rules", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_table(
        "task_efficiency_events",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "task_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("tasks.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("event_type", sa.String(length=48), nullable=False),
        sa.Column("occurred_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "actor_user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("core_users.id", ondelete="RESTRICT"),
            nullable=True,
        ),
        sa.Column(
            "assignee_user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("core_users.id", ondelete="RESTRICT"),
            nullable=True,
        ),
        sa.Column("due_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("old_value", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("new_value", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("reason_code", sa.String(length=48), nullable=True),
        sa.Column("reason_text", sa.Text(), nullable=True),
        sa.Column("metadata", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column(
            "methodology_version",
            sa.String(length=32),
            sa.ForeignKey("employee_efficiency_methodologies.version", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "event_type IN ('initial_snapshot', 'task_created', 'task_status_changed', "
            "'assignee_changed', 'deadline_changed', 'result_submitted_for_review', "
            "'result_accepted', "
            "'result_returned_for_revision', 'task_completed', 'task_cancelled', "
            "'efficiency_excluded', 'efficiency_exclusion_changed')",
            name="ck_task_efficiency_events_type",
        ),
    )
    op.create_index(
        "ix_task_efficiency_events_task_occurred",
        "task_efficiency_events",
        ["task_id", "occurred_at"],
    )
    op.create_index(
        "ix_task_efficiency_events_assignee_occurred",
        "task_efficiency_events",
        ["assignee_user_id", "occurred_at"],
    )
    op.create_index(
        "ix_task_efficiency_events_type_occurred",
        "task_efficiency_events",
        ["event_type", "occurred_at"],
    )
    op.create_table(
        "employee_efficiency_snapshots",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("core_users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("snapshot_date", sa.Date(), nullable=False),
        sa.Column("period", sa.String(length=7), nullable=False),
        sa.Column("percentage", sa.Numeric(7, 3), nullable=True),
        sa.Column("on_time_count", sa.Integer(), nullable=False),
        sa.Column("eligible_count", sa.Integer(), nullable=False),
        sa.Column("overdue_count", sa.Integer(), nullable=False),
        sa.Column("methodology_version", sa.String(length=32), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint(
            "user_id",
            "snapshot_date",
            "methodology_version",
            name="uq_employee_efficiency_daily_snapshot",
        ),
    )
    op.create_index(
        "ix_employee_efficiency_snapshots_user_period",
        "employee_efficiency_snapshots",
        ["user_id", "period", "snapshot_date"],
    )

    tracking_started_at = datetime.now(UTC)
    connection = op.get_bind()
    connection.execute(
        sa.text(
            "INSERT INTO employee_efficiency_methodologies "
            "(version, timezone, tracking_started_at, rules, created_at) "
            "VALUES (:version, :timezone, :started, CAST(:rules AS jsonb), :created)"
        ),
        {
            "version": METHODOLOGY_VERSION,
            "timezone": TIMEZONE,
            "started": tracking_started_at,
            "created": tracking_started_at,
            "rules": (
                '{"metric":"on_time_task_completion","equalWeight":true,'
                '"returnsAffectPercentage":false,"futureDeadlinesEligible":false}'
            ),
        },
    )
    existing_tasks = connection.execute(
        sa.text(
            "SELECT id, status, due_at, primary_assignee_user_id, created_at FROM tasks"
        )
    ).mappings()
    for task in existing_tasks:
        connection.execute(
            sa.text(
                "INSERT INTO task_efficiency_events "
                "(id, task_id, event_type, occurred_at, actor_user_id, assignee_user_id, "
                "due_at, old_value, new_value, reason_code, reason_text, metadata, "
                "methodology_version, created_at) VALUES "
                "(:id, :task_id, 'initial_snapshot', :occurred_at, NULL, :assignee_id, "
                ":due_at, '{}'::jsonb, CAST(:new_value AS jsonb), NULL, NULL, "
                "'{\"historyBeforeSnapshotKnown\":false}'::jsonb, :version, :created_at)"
            ),
            {
                "id": uuid4(),
                "task_id": task["id"],
                "occurred_at": tracking_started_at,
                "assignee_id": task["primary_assignee_user_id"],
                "due_at": task["due_at"],
                "new_value": json.dumps(
                    {
                        "status": task["status"],
                        "assigneeId": str(task["primary_assignee_user_id"]),
                        "dueAt": task["due_at"].isoformat() if task["due_at"] else None,
                        "createdAt": task["created_at"].isoformat(),
                    }
                ),
                "version": METHODOLOGY_VERSION,
                "created_at": tracking_started_at,
            },
        )


def downgrade() -> None:
    op.drop_index(
        "ix_employee_efficiency_snapshots_user_period",
        table_name="employee_efficiency_snapshots",
    )
    op.drop_table("employee_efficiency_snapshots")
    op.drop_index("ix_task_efficiency_events_type_occurred", table_name="task_efficiency_events")
    op.drop_index(
        "ix_task_efficiency_events_assignee_occurred", table_name="task_efficiency_events"
    )
    op.drop_index("ix_task_efficiency_events_task_occurred", table_name="task_efficiency_events")
    op.drop_table("task_efficiency_events")
    op.drop_table("employee_efficiency_methodologies")
