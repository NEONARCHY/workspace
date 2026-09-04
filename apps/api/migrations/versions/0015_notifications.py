"""Add durable workspace notifications and delivery preferences.

Revision ID: 0015_notifications
Revises: 0014_feed_calendar
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0015_notifications"
down_revision: str | None = "0014_feed_calendar"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "workspace_notifications",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("core_users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("event_key", sa.String(length=320), nullable=False),
        sa.Column("kind", sa.String(length=24), nullable=False),
        sa.Column("priority", sa.String(length=16), nullable=False, server_default="normal"),
        sa.Column("title", sa.String(length=240), nullable=False),
        sa.Column("body", sa.Text(), nullable=False, server_default=""),
        sa.Column("section", sa.String(length=32), nullable=False),
        sa.Column("entity_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("requires_action", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("is_reminder", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("occurred_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("read_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("desktop_delivered_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint("user_id", "event_key", name="uq_workspace_notification_event"),
        sa.CheckConstraint(
            "kind IN ('message', 'task', 'approval', 'trip', 'calendar')",
            name="ck_workspace_notifications_kind",
        ),
        sa.CheckConstraint(
            "priority IN ('normal', 'attention', 'urgent')",
            name="ck_workspace_notifications_priority",
        ),
        sa.CheckConstraint(
            "section IN ('messenger', 'tasks', 'payment_requests', 'trip_approvals', 'calendar')",
            name="ck_workspace_notifications_section",
        ),
    )
    op.create_index(
        "ix_workspace_notifications_user_occurred",
        "workspace_notifications",
        ["user_id", "occurred_at"],
    )
    op.create_index(
        "ix_workspace_notifications_user_unread",
        "workspace_notifications",
        ["user_id", "read_at"],
    )
    op.create_table(
        "workspace_notification_preferences",
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("core_users.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("desktop_enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("messages_enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("tasks_enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("approvals_enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("trips_enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("calendar_enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("reminders_enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("workspace_notification_preferences")
    op.drop_index("ix_workspace_notifications_user_unread", table_name="workspace_notifications")
    op.drop_index("ix_workspace_notifications_user_occurred", table_name="workspace_notifications")
    op.drop_table("workspace_notifications")
