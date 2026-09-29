"""Persist interactive task deadline extension requests."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0070_task_deadline_requests"
down_revision: str = "0069_department_icons"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "task_deadline_requests",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "task_id", postgresql.UUID(as_uuid=True),
            sa.ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False,
        ),
        sa.Column(
            "message_id", postgresql.UUID(as_uuid=True),
            sa.ForeignKey("messenger_messages.id", ondelete="CASCADE"),
            nullable=False, unique=True,
        ),
        sa.Column(
            "requester_user_id", postgresql.UUID(as_uuid=True),
            sa.ForeignKey("core_users.id"), nullable=False,
        ),
        sa.Column("old_due_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("proposed_due_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("status", sa.String(16), nullable=False, server_default="pending"),
        sa.Column(
            "decided_by_user_id", postgresql.UUID(as_uuid=True),
            sa.ForeignKey("core_users.id"),
        ),
        sa.Column("decided_at", sa.DateTime(timezone=True)),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "status IN ('pending', 'approved', 'rejected', 'superseded')",
            name="ck_task_deadline_request_status",
        ),
        sa.CheckConstraint("proposed_due_at > old_due_at", name="ck_task_deadline_request_forward"),
    )
    op.create_index(
        "uq_task_deadline_request_pending", "task_deadline_requests", ["task_id"],
        unique=True, postgresql_where=sa.text("status = 'pending'"),
    )


def downgrade() -> None:
    op.drop_index("uq_task_deadline_request_pending", table_name="task_deadline_requests")
    op.drop_table("task_deadline_requests")
