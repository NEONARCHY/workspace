"""Add employee absences and direct-manager assignments.

Revision ID: 0027_absences
Revises: 0026_web_sessions
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0027_absences"
down_revision: str | None = "0026_web_sessions"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "workspace_notification_preferences",
        sa.Column("absences_enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
    )
    op.add_column(
        "core_users",
        sa.Column("direct_manager_user_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_foreign_key(
        "fk_core_users_direct_manager",
        "core_users",
        "core_users",
        ["direct_manager_user_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_table(
        "absence_requests",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "requester_user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("core_users.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column(
            "direct_manager_user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("core_users.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("kind", sa.String(32), nullable=False),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("starts_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("ends_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("status", sa.String(24), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("ends_at > starts_at", name="ck_absence_period"),
    )
    op.create_index(
        "ix_absence_requests_requester_period",
        "absence_requests",
        ["requester_user_id", "starts_at", "ends_at"],
    )
    op.create_index(
        "ix_absence_requests_manager_status",
        "absence_requests",
        ["direct_manager_user_id", "status"],
    )
    op.create_table(
        "absence_request_actions",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "request_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("absence_requests.id", ondelete="CASCADE"),
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
    op.create_index(
        "ix_absence_request_actions_request",
        "absence_request_actions",
        ["request_id", "created_at"],
    )


def downgrade() -> None:
    op.drop_column("workspace_notification_preferences", "absences_enabled")
    op.drop_index("ix_absence_request_actions_request", table_name="absence_request_actions")
    op.drop_table("absence_request_actions")
    op.drop_index("ix_absence_requests_manager_status", table_name="absence_requests")
    op.drop_index("ix_absence_requests_requester_period", table_name="absence_requests")
    op.drop_table("absence_requests")
    op.drop_constraint("fk_core_users_direct_manager", "core_users", type_="foreignkey")
    op.drop_column("core_users", "direct_manager_user_id")
