"""Add HR personnel service-tenure registers.

Revision ID: 0042_hr_service_tenure
Revises: 0041_expand_message_reactions
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0042_hr_service_tenure"
down_revision: str | None = "0041_expand_message_reactions"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    uuid = postgresql.UUID(as_uuid=True)
    op.create_table(
        "hr_settings",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("hr_user_id", uuid),
        sa.Column("chair_user_id", uuid),
        sa.Column("accountant_user_id", uuid),
        sa.Column("updated_by_user_id", uuid),
        sa.Column("updated_at", sa.DateTime(timezone=True)),
    )
    op.create_table(
        "hr_employee_profiles",
        sa.Column("id", uuid, primary_key=True),
        sa.Column("user_id", uuid, nullable=False, unique=True),
        sa.Column("employment_date", sa.Date(), nullable=False),
        sa.Column("service_anchor_date", sa.Date(), nullable=False),
        sa.Column("service_years", sa.Integer(), nullable=False),
        sa.Column("service_months", sa.Integer(), nullable=False),
        sa.Column("service_days", sa.Integer(), nullable=False),
        sa.Column("service_reason", sa.Text(), nullable=False),
        sa.Column("employment_status", sa.String(24), nullable=False),
        sa.Column("terminated_on", sa.Date()),
        sa.Column("termination_reason", sa.Text()),
        sa.Column(
            "hidden_after_year", sa.Boolean(), nullable=False, server_default=sa.text("false")
        ),
        sa.Column("created_by_user_id", uuid, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "service_years >= 0 AND service_months BETWEEN 0 AND 11 "
            "AND service_days BETWEEN 0 AND 30",
            name="ck_hr_service_parts",
        ),
    )
    op.create_table(
        "hr_service_history",
        sa.Column("id", uuid, primary_key=True),
        sa.Column("profile_id", uuid, nullable=False),
        sa.Column("actor_user_id", uuid, nullable=False),
        sa.Column("service_anchor_date", sa.Date(), nullable=False),
        sa.Column("service_years", sa.Integer(), nullable=False),
        sa.Column("service_months", sa.Integer(), nullable=False),
        sa.Column("service_days", sa.Integer(), nullable=False),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_table(
        "hr_monthly_registers",
        sa.Column("id", uuid, primary_key=True),
        sa.Column("period", sa.String(7), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(32), nullable=False),
        sa.Column("created_by_user_id", uuid, nullable=False),
        sa.Column("submitted_at", sa.DateTime(timezone=True)),
        sa.Column("approved_at", sa.DateTime(timezone=True)),
        sa.Column("accounted_at", sa.DateTime(timezone=True)),
        sa.Column("return_comment", sa.Text()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("period", "version", name="uq_hr_register_period_version"),
    )
    op.create_table(
        "hr_monthly_register_items",
        sa.Column("id", uuid, primary_key=True),
        sa.Column("register_id", uuid, nullable=False),
        sa.Column("user_id", uuid, nullable=False),
        sa.Column("full_name", sa.String(200), nullable=False),
        sa.Column("job_title", sa.String(160)),
        sa.Column("service_years", sa.Integer(), nullable=False),
        sa.Column("service_months", sa.Integer(), nullable=False),
        sa.Column("service_days", sa.Integer(), nullable=False),
        sa.Column("allowance_percent", sa.Numeric(5, 2), nullable=False),
        sa.UniqueConstraint("register_id", "user_id", name="uq_hr_register_item_user"),
    )


def downgrade() -> None:
    op.drop_table("hr_monthly_register_items")
    op.drop_table("hr_monthly_registers")
    op.drop_table("hr_service_history")
    op.drop_table("hr_employee_profiles")
    op.drop_table("hr_settings")
