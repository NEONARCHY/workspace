"""Add department leads and independently stored Hisobot unit reports."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0060_hisobot_department_units"
down_revision: str | None = "0059_project_workstream_details"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "core_departments",
        sa.Column(
            "lead_user_id", postgresql.UUID(as_uuid=True),
            sa.ForeignKey("core_users.id", ondelete="SET NULL"), nullable=True,
        ),
    )
    op.create_index("ix_core_departments_lead", "core_departments", ["lead_user_id"])
    op.create_table(
        "hisobot_unit_reports",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("department_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("department_name", sa.String(200), nullable=False),
        sa.Column("reporter_user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("reporter_telegram_id", sa.String(20), nullable=False),
        sa.Column("reporter_employee_key", sa.String(100), nullable=False),
        sa.Column("reporter_name", sa.String(200), nullable=False),
        sa.Column("reporter_position", sa.String(500), nullable=False),
        sa.Column("report_scope", sa.String(16), nullable=False),
        sa.Column("region_name", sa.String(100), nullable=True),
        sa.Column("covered_telegram_ids", postgresql.JSONB(), nullable=False),
        sa.Column("report_date", sa.Date(), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("submitted_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("is_late", sa.Boolean(), nullable=False),
        sa.Column("source", sa.String(12), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("department_id", "report_date", name="uq_hisobot_unit_department_date"),
        sa.CheckConstraint("report_scope IN ('central', 'hudud')", name="ck_hisobot_unit_scope"),
        sa.CheckConstraint("source IN ('telegram', 'workspace')", name="ck_hisobot_unit_source"),
    )
    op.create_index("ix_hisobot_unit_date", "hisobot_unit_reports", ["report_date"])
    op.create_index(
        "ix_hisobot_unit_reporter_date", "hisobot_unit_reports",
        ["reporter_telegram_id", "report_date"],
    )


def downgrade() -> None:
    op.drop_index("ix_hisobot_unit_reporter_date", table_name="hisobot_unit_reports")
    op.drop_index("ix_hisobot_unit_date", table_name="hisobot_unit_reports")
    op.drop_table("hisobot_unit_reports")
    op.drop_index("ix_core_departments_lead", table_name="core_departments")
    op.drop_column("core_departments", "lead_user_id")
