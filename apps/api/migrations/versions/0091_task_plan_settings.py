"""Add plan owner and lifecycle without changing linked tasks.

Revision ID: 0091_task_plan_settings
Revises: 0090_task_plans
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0091_task_plan_settings"
down_revision: str = "0090_task_plans"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("task_plans", sa.Column(
        "owner_user_id", postgresql.UUID(as_uuid=True), nullable=True,
    ))
    op.execute("UPDATE task_plans SET owner_user_id = created_by_user_id")
    # Keep nullable during rollout: an older API process may still insert a plan.
    # The new API treats a missing owner as the immutable creator.
    op.create_foreign_key(
        "task_plans_owner_user_id_fkey", "task_plans", "core_users",
        ["owner_user_id"], ["id"], ondelete="RESTRICT",
    )
    op.add_column("task_plans", sa.Column(
        "status", sa.String(16), nullable=False, server_default="active",
    ))
    op.create_check_constraint(
        "task_plans_status_ck", "task_plans", "status IN ('active', 'completed')",
    )


def downgrade() -> None:
    op.drop_constraint("task_plans_status_ck", "task_plans", type_="check")
    op.drop_column("task_plans", "status")
    op.drop_constraint("task_plans_owner_user_id_fkey", "task_plans", type_="foreignkey")
    op.drop_column("task_plans", "owner_user_id")
