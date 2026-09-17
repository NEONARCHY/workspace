"""Add Zoom conference booking on the shared corporate host.

Revision ID: 0029_zoom_meetings
Revises: 0028_approval_manual_stage_move
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0029_zoom_meetings"
down_revision: str | None = "0028_approval_manual_stage_move"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_ACTIVE_STATUSES = "status IN ('provisioning', 'scheduled', 'cancellation_pending')"


def upgrade() -> None:
    op.add_column(
        "workspace_notification_preferences",
        sa.Column("zoom_enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
    )
    op.drop_constraint("ck_workspace_notifications_kind", "workspace_notifications", type_="check")
    op.create_check_constraint(
        "ck_workspace_notifications_kind",
        "workspace_notifications",
        "kind IN ('message', 'task', 'approval', 'trip', 'calendar', 'absence', 'zoom')",
    )
    op.drop_constraint(
        "ck_workspace_notifications_section", "workspace_notifications", type_="check"
    )
    op.create_check_constraint(
        "ck_workspace_notifications_section",
        "workspace_notifications",
        "section IN ('messenger', 'tasks', 'payment_requests', 'trip_approvals', "
        "'calendar', 'absences', 'zoom_meetings')",
    )
    op.create_table(
        "zoom_meetings",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        # Imported bot bookings may have no matching Workspace account yet.
        sa.Column(
            "organizer_user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("core_users.id", ondelete="RESTRICT"),
            nullable=True,
        ),
        sa.Column("organizer_display_name", sa.String(240), nullable=True),
        sa.Column("topic", sa.String(200), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("starts_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("ends_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("duration_minutes", sa.Integer(), nullable=False),
        sa.Column("timezone", sa.String(64), nullable=False),
        sa.Column("zoom_meeting_id", sa.String(64), nullable=True, unique=True),
        sa.Column("join_url", sa.Text(), nullable=True),
        sa.Column("passcode", sa.String(64), nullable=True),
        sa.Column("status", sa.String(24), nullable=False),
        sa.Column("source", sa.String(16), nullable=False, server_default="workspace"),
        sa.Column("reminders_enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("technical_error", sa.String(120), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("ends_at > starts_at", name="ck_zoom_meeting_period"),
        sa.CheckConstraint(
            "duration_minutes BETWEEN 15 AND 480 AND duration_minutes % 15 = 0",
            name="ck_zoom_meeting_duration",
        ),
        sa.CheckConstraint(
            "status IN ('provisioning', 'scheduled', 'cancellation_pending', "
            "'cancelled', 'failed')",
            name="ck_zoom_meeting_status",
        ),
        sa.CheckConstraint(
            "source IN ('workspace', 'zoombot')",
            name="ck_zoom_meeting_source",
        ),
        sa.CheckConstraint(
            "organizer_user_id IS NOT NULL OR organizer_display_name IS NOT NULL",
            name="ck_zoom_meeting_organizer",
        ),
    )
    # A single corporate host means a single calendar. The database, not the
    # application, guarantees that two live bookings never overlap; the range
    # operator alone needs no btree_gist extension.
    op.execute(
        "ALTER TABLE zoom_meetings ADD CONSTRAINT ex_zoom_meetings_no_overlap "
        "EXCLUDE USING gist (tstzrange(starts_at, ends_at) WITH &&) "
        f"WHERE ({_ACTIVE_STATUSES})"
    )
    op.create_index("ix_zoom_meetings_period", "zoom_meetings", ["starts_at", "ends_at"])
    op.create_index(
        "ix_zoom_meetings_organizer_status", "zoom_meetings", ["organizer_user_id", "status"]
    )
    op.create_table(
        "zoom_meeting_participants",
        sa.Column(
            "meeting_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("zoom_meetings.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("core_users.id", ondelete="CASCADE"),
            primary_key=True,
        ),
    )


def downgrade() -> None:
    op.drop_table("zoom_meeting_participants")
    op.drop_index("ix_zoom_meetings_organizer_status", table_name="zoom_meetings")
    op.drop_index("ix_zoom_meetings_period", table_name="zoom_meetings")
    # The exclusion constraint goes away with the table it belongs to.
    op.drop_table("zoom_meetings")
    op.drop_constraint(
        "ck_workspace_notifications_section", "workspace_notifications", type_="check"
    )
    op.create_check_constraint(
        "ck_workspace_notifications_section",
        "workspace_notifications",
        "section IN ('messenger', 'tasks', 'payment_requests', 'trip_approvals', "
        "'calendar', 'absences')",
    )
    op.drop_constraint("ck_workspace_notifications_kind", "workspace_notifications", type_="check")
    op.create_check_constraint(
        "ck_workspace_notifications_kind",
        "workspace_notifications",
        "kind IN ('message', 'task', 'approval', 'trip', 'calendar', 'absence')",
    )
    op.drop_column("workspace_notification_preferences", "zoom_enabled")
