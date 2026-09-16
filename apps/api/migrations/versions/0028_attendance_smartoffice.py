"""Add attendance, schedules, and the Smart Office integration boundary.

Revision ID: 0028_attendance_smartoffice
Revises: 0027_absences
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0028_attendance_smartoffice"
down_revision: str | None = "0027_absences"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("core_users", sa.Column("date_of_birth", sa.Date(), nullable=True))
    op.add_column("core_users", sa.Column("smartoffice_staff_key", sa.String(128), nullable=True))
    op.create_index(
        "uq_core_users_smartoffice_staff_key",
        "core_users",
        ["smartoffice_staff_key"],
        unique=True,
        postgresql_where=sa.text("smartoffice_staff_key IS NOT NULL"),
    )
    op.add_column("feed_posts", sa.Column("system_author_label", sa.String(80), nullable=True))
    op.add_column(
        "workspace_notification_preferences",
        sa.Column("attendance_enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
    )
    op.execute(
        "ALTER TABLE workspace_notifications DROP CONSTRAINT ck_workspace_notifications_kind"
    )
    op.execute(
        "ALTER TABLE workspace_notifications ADD CONSTRAINT ck_workspace_notifications_kind "
        "CHECK (kind IN ('message', 'task', 'approval', 'trip', 'calendar', 'absence', "
        "'attendance'))"
    )
    op.execute(
        "ALTER TABLE workspace_notifications DROP CONSTRAINT ck_workspace_notifications_section"
    )
    op.execute(
        "ALTER TABLE workspace_notifications ADD CONSTRAINT ck_workspace_notifications_section "
        "CHECK (section IN ('messenger', 'tasks', 'payment_requests', 'trip_approvals', "
        "'calendar', 'absences', 'attendance'))"
    )
    op.create_table(
        "attendance_schedule_periods",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("core_users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("starts_on", sa.Date(), nullable=False),
        sa.Column("ends_on", sa.Date(), nullable=False),
        sa.Column("weekdays", postgresql.JSONB(), nullable=False),
        sa.Column("starts_at", sa.Time(), nullable=False),
        sa.Column("ends_at", sa.Time(), nullable=False),
        sa.Column(
            "created_by_user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("core_users.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("ends_on >= starts_on", name="ck_attendance_schedule_period_dates"),
        sa.CheckConstraint("ends_at > starts_at", name="ck_attendance_schedule_period_times"),
    )
    op.create_index(
        "ix_attendance_schedule_period_user_dates",
        "attendance_schedule_periods",
        ["user_id", "starts_on", "ends_on"],
    )
    op.create_table(
        "attendance_schedule_exceptions",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("core_users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("work_date", sa.Date(), nullable=False),
        sa.Column("kind", sa.String(16), nullable=False),
        sa.Column("starts_at", sa.Time(), nullable=True),
        sa.Column("ends_at", sa.Time(), nullable=True),
        sa.Column(
            "created_by_user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("core_users.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("kind IN ('day_off', 'workday')", name="ck_attendance_exception_kind"),
        sa.UniqueConstraint("user_id", "work_date", name="uq_attendance_exception_user_date"),
    )
    op.create_table(
        "attendance_days",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("core_users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("work_date", sa.Date(), nullable=False),
        sa.Column("status", sa.String(24), nullable=False),
        sa.Column("scheduled_starts_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("scheduled_ends_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("arrived_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("ended_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("absence_kind", sa.String(32), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("user_id", "work_date", name="uq_attendance_day_user_date"),
    )
    op.create_table(
        "attendance_events",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("event_key", sa.String(128), nullable=False),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("core_users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("source", sa.String(24), nullable=False),
        sa.Column("kind", sa.String(24), nullable=False),
        sa.Column("occurred_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("event_key", name="uq_attendance_event_key"),
    )
    op.create_table(
        "attendance_corrections",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("core_users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "direct_manager_user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("core_users.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("event_kind", sa.String(16), nullable=False),
        sa.Column("requested_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("comment", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "event_kind IN ('arrival', 'start', 'end')", name="ck_attendance_correction_event_kind"
        ),
        sa.CheckConstraint(
            "status IN ('pending', 'approved', 'rejected', 'cancelled')",
            name="ck_attendance_correction_status",
        ),
    )
    op.create_index(
        "ix_attendance_correction_manager_status",
        "attendance_corrections",
        ["direct_manager_user_id", "status"],
    )
    op.create_table(
        "attendance_correction_actions",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "correction_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("attendance_corrections.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "actor_user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("core_users.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("action", sa.String(24), nullable=False),
        sa.Column("comment", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_table(
        "attendance_birthday_events",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("core_users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("work_date", sa.Date(), nullable=False),
        sa.Column(
            "feed_post_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("feed_posts.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("user_id", "work_date", name="uq_attendance_birthday_user_date"),
    )


def downgrade() -> None:
    op.drop_table("attendance_birthday_events")
    op.drop_table("attendance_correction_actions")
    op.drop_index("ix_attendance_correction_manager_status", table_name="attendance_corrections")
    op.drop_table("attendance_corrections")
    op.drop_table("attendance_events")
    op.drop_table("attendance_days")
    op.drop_table("attendance_schedule_exceptions")
    op.drop_index(
        "ix_attendance_schedule_period_user_dates", table_name="attendance_schedule_periods"
    )
    op.drop_table("attendance_schedule_periods")
    op.execute(
        "ALTER TABLE workspace_notifications DROP CONSTRAINT ck_workspace_notifications_section"
    )
    op.execute(
        "ALTER TABLE workspace_notifications ADD CONSTRAINT "
        "ck_workspace_notifications_section CHECK (section IN ('messenger', 'tasks', "
        "'payment_requests', 'trip_approvals', 'calendar', 'absences'))"
    )
    op.execute(
        "ALTER TABLE workspace_notifications DROP CONSTRAINT ck_workspace_notifications_kind"
    )
    op.execute(
        "ALTER TABLE workspace_notifications ADD CONSTRAINT ck_workspace_notifications_kind "
        "CHECK (kind IN ('message', 'task', 'approval', 'trip', 'calendar', 'absence'))"
    )
    op.drop_column("workspace_notification_preferences", "attendance_enabled")
    op.drop_column("feed_posts", "system_author_label")
    op.drop_index("uq_core_users_smartoffice_staff_key", table_name="core_users")
    op.drop_column("core_users", "smartoffice_staff_key")
    op.drop_column("core_users", "date_of_birth")
