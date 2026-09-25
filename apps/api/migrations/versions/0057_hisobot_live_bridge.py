"""Add shared Hisobot reports and per-user reporting placement.

Revision ID: 0057_hisobot_live_bridge
Revises: 0056_project_hub
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0057_hisobot_live_bridge"
down_revision: str | None = "0056_project_hub"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_constraint("ck_workspace_notifications_kind", "workspace_notifications", type_="check")
    op.create_check_constraint(
        "ck_workspace_notifications_kind", "workspace_notifications",
        "kind IN ('message','task','approval','trip','calendar','absence','zoom','hisobot')",
    )
    op.drop_constraint(
        "ck_workspace_notifications_section", "workspace_notifications", type_="check"
    )
    op.create_check_constraint(
        "ck_workspace_notifications_section", "workspace_notifications",
        "section IN ('messenger','tasks','payment_requests','trip_approvals',"
        "'calendar','absences','zoom_meetings','hr','team_overview','ai_referent',"
        "'project_hub','project_funding','ai_hisobot')",
    )
    op.add_column(
        "core_telegram_bot_grants", sa.Column("report_scope", sa.String(16), nullable=True)
    )
    op.add_column(
        "core_telegram_bot_grants", sa.Column("region_name", sa.String(100), nullable=True)
    )
    op.add_column(
        "core_telegram_bot_grants", sa.Column("report_required", sa.Boolean(), nullable=True)
    )
    op.add_column(
        "core_telegram_bot_grants", sa.Column("hisobot_manager", sa.Boolean(), nullable=True)
    )
    op.execute(
        "UPDATE core_telegram_bot_grants SET report_scope = 'central' "
        "WHERE bot_key = 'hisobot' AND report_scope IS NULL"
    )
    op.execute(
        "UPDATE core_telegram_bot_grants SET report_required = false, hisobot_manager = false "
        "WHERE bot_key = 'hisobot'"
    )
    op.create_check_constraint(
        "ck_telegram_bot_grants_hisobot_scope",
        "core_telegram_bot_grants",
        "bot_key <> 'hisobot' OR report_scope IN ('central', 'hudud')",
    )
    op.create_table(
        "hisobot_live_reports",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "user_id", postgresql.UUID(as_uuid=True),
            sa.ForeignKey("core_users.id"), nullable=True,
        ),
        sa.Column("telegram_id", sa.String(20), nullable=False),
        sa.Column("employee_key", sa.String(100), nullable=False),
        sa.Column("full_name", sa.String(200), nullable=False),
        sa.Column("position", sa.String(500), nullable=False),
        sa.Column("report_scope", sa.String(16), nullable=False),
        sa.Column("region_name", sa.String(100), nullable=True),
        sa.Column("report_date", sa.Date(), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("submitted_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("is_late", sa.Boolean(), nullable=False),
        sa.Column("source", sa.String(12), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("telegram_id", "report_date", name="uq_hisobot_live_telegram_date"),
        sa.CheckConstraint("report_scope IN ('central', 'hudud')", name="ck_hisobot_live_scope"),
        sa.CheckConstraint("source IN ('telegram', 'workspace')", name="ck_hisobot_live_source"),
    )
    op.create_index("ix_hisobot_live_user_date", "hisobot_live_reports", ["user_id", "report_date"])
    op.create_index("ix_hisobot_live_date", "hisobot_live_reports", ["report_date"])
    op.create_table(
        "hisobot_live_vacations",
        sa.Column("telegram_id", sa.String(20), primary_key=True),
        sa.Column("starts_date", sa.Date(), nullable=False),
        sa.Column("through_date", sa.Date(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("hisobot_live_vacations")
    op.drop_index("ix_hisobot_live_date", table_name="hisobot_live_reports")
    op.drop_index("ix_hisobot_live_user_date", table_name="hisobot_live_reports")
    op.drop_table("hisobot_live_reports")
    op.drop_constraint("ck_telegram_bot_grants_hisobot_scope", "core_telegram_bot_grants")
    op.drop_column("core_telegram_bot_grants", "hisobot_manager")
    op.drop_column("core_telegram_bot_grants", "report_required")
    op.drop_column("core_telegram_bot_grants", "region_name")
    op.drop_column("core_telegram_bot_grants", "report_scope")
    op.drop_constraint(
        "ck_workspace_notifications_section", "workspace_notifications", type_="check"
    )
    op.create_check_constraint(
        "ck_workspace_notifications_section", "workspace_notifications",
        "section IN ('messenger','tasks','payment_requests','trip_approvals',"
        "'calendar','absences','zoom_meetings','hr','team_overview','ai_referent',"
        "'project_hub','project_funding')",
    )
    op.drop_constraint("ck_workspace_notifications_kind", "workspace_notifications", type_="check")
    op.create_check_constraint(
        "ck_workspace_notifications_kind", "workspace_notifications",
        "kind IN ('message','task','approval','trip','calendar','absence','zoom')",
    )
