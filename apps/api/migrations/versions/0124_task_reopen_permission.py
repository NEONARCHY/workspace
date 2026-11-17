"""Allow administrators to delegate reopening completed tasks by position."""

import sqlalchemy as sa
from alembic import op

revision = "0124_task_reopen_permission"
down_revision = "0123_trip_hr_processing"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("core_positions", sa.Column(
        "can_reopen_completed_tasks", sa.Boolean(), nullable=False, server_default=sa.false(),
    ))


def downgrade() -> None:
    op.drop_column("core_positions", "can_reopen_completed_tasks")
