"""Add durable reminders and escalations for approval deadlines.

Revision ID: 0022_approval_deadlines
Revises: 0021_task_calendar_chats
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0022_approval_deadlines"
down_revision: str | None = "0021_task_calendar_chats"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "approval_deadline_events",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "request_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("approval_requests.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "recipient_user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("core_users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("node_key", sa.String(length=96), nullable=False),
        sa.Column("event_type", sa.String(length=32), nullable=False),
        sa.Column("recipient_role", sa.String(length=32), nullable=False),
        sa.Column("threshold_hours", sa.Integer(), nullable=False),
        sa.Column("deadline_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "event_type IN ('reminder', 'overdue', 'escalation')",
            name="ck_approval_deadline_events_type",
        ),
        sa.CheckConstraint(
            "recipient_role IN ('approver', 'requester', 'process_owner')",
            name="ck_approval_deadline_events_recipient_role",
        ),
        sa.UniqueConstraint(
            "request_id",
            "recipient_user_id",
            "node_key",
            "event_type",
            "threshold_hours",
            "deadline_at",
            name="uq_approval_deadline_delivery",
        ),
    )
    op.create_index(
        "ix_approval_deadline_events_request_created",
        "approval_deadline_events",
        ["request_id", "created_at"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_approval_deadline_events_request_created",
        table_name="approval_deadline_events",
    )
    op.drop_table("approval_deadline_events")
