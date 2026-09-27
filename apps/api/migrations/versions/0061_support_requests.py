"""Add employee support requests, replies and notification routing."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0061_support_requests"
down_revision: str | None = "0060_project_funding_drafts"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_constraint("ck_workspace_notifications_kind", "workspace_notifications", type_="check")
    op.create_check_constraint(
        "ck_workspace_notifications_kind",
        "workspace_notifications",
        "kind IN ('message','task','approval','trip','calendar','absence','zoom',"
        "'hisobot','support')",
    )
    op.drop_constraint(
        "ck_workspace_notifications_section", "workspace_notifications", type_="check"
    )
    op.create_check_constraint(
        "ck_workspace_notifications_section",
        "workspace_notifications",
        "section IN ('messenger','tasks','payment_requests','trip_approvals',"
        "'calendar','absences','zoom_meetings','hr','team_overview','ai_referent',"
        "'project_hub','project_funding','ai_hisobot','notifications')",
    )
    op.create_table(
        "workspace_support_requests",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "author_user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("core_users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("category", sa.String(24), nullable=False),
        sa.Column("subject", sa.String(160), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("status", sa.String(24), nullable=False, server_default="open"),
        sa.Column("resolution_code", sa.String(40)),
        sa.Column("response_unread", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("latest_response_tone", sa.String(16)),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("resolved_at", sa.DateTime(timezone=True)),
        sa.CheckConstraint(
            "category IN ('comment','bug','improvement')",
            name="ck_workspace_support_category",
        ),
        sa.CheckConstraint(
            "status IN ('open','implemented','rejected')",
            name="ck_workspace_support_status",
        ),
        sa.CheckConstraint(
            "resolution_code IS NULL OR resolution_code IN "
            "('implemented','insufficient_information','not_needed','already_implemented')",
            name="ck_workspace_support_resolution",
        ),
        sa.CheckConstraint(
            "latest_response_tone IS NULL OR latest_response_tone IN ('positive','negative')",
            name="ck_workspace_support_tone",
        ),
    )
    op.create_index(
        "ix_workspace_support_author_updated",
        "workspace_support_requests",
        ["author_user_id", "updated_at"],
    )
    op.create_index(
        "ix_workspace_support_status_updated",
        "workspace_support_requests",
        ["status", "updated_at"],
    )
    op.create_table(
        "workspace_support_request_messages",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "request_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("workspace_support_requests.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "author_user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("core_users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("kind", sa.String(24), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "kind IN ('submission','comment','implemented','rejected')",
            name="ck_workspace_support_message_kind",
        ),
    )
    op.create_index(
        "ix_workspace_support_message_request_created",
        "workspace_support_request_messages",
        ["request_id", "created_at"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_workspace_support_message_request_created",
        table_name="workspace_support_request_messages",
    )
    op.drop_table("workspace_support_request_messages")
    op.drop_index("ix_workspace_support_status_updated", table_name="workspace_support_requests")
    op.drop_index("ix_workspace_support_author_updated", table_name="workspace_support_requests")
    op.drop_table("workspace_support_requests")
    op.drop_constraint(
        "ck_workspace_notifications_section", "workspace_notifications", type_="check"
    )
    op.create_check_constraint(
        "ck_workspace_notifications_section",
        "workspace_notifications",
        "section IN ('messenger','tasks','payment_requests','trip_approvals',"
        "'calendar','absences','zoom_meetings','hr','team_overview','ai_referent',"
        "'project_hub','project_funding','ai_hisobot')",
    )
    op.drop_constraint("ck_workspace_notifications_kind", "workspace_notifications", type_="check")
    op.create_check_constraint(
        "ck_workspace_notifications_kind",
        "workspace_notifications",
        "kind IN ('message','task','approval','trip','calendar','absence','zoom','hisobot')",
    )
