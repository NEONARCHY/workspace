"""Add shared task plans and their many-to-many task links.

Revision ID: 0090_task_plans
Revises: 0089_merge_hr_hiring
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0090_task_plans"
down_revision: str = "0089_merge_hr_hiring"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "task_plans",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("title", sa.String(240), nullable=False),
        sa.Column("kind", sa.String(24), nullable=False),
        sa.Column("period_start", sa.Date(), nullable=True),
        sa.Column("period_end", sa.Date(), nullable=True),
        sa.Column("created_by_user_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("core_users.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("kind IN ('work', 'regional', 'other')", name="task_plans_kind_ck"),
        sa.CheckConstraint(
            "period_end IS NULL OR period_start IS NULL OR period_end >= period_start",
            name="task_plans_period_ck",
        ),
    )
    op.create_table(
        "task_plan_links",
        sa.Column("plan_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("task_plans.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("task_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("tasks.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("linked_by_user_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("core_users.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("task_plan_links_task_id_idx", "task_plan_links", ["task_id"])


def downgrade() -> None:
    op.drop_index("task_plan_links_task_id_idx", table_name="task_plan_links")
    op.drop_table("task_plan_links")
    op.drop_table("task_plans")
