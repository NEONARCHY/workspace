"""Add task hierarchy for subtasks.

Revision ID: 0020_task_review_subtasks
Revises: 0019_messenger_media
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0020_task_review_subtasks"
down_revision: str | None = "0019_messenger_media"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "tasks",
        sa.Column(
            "parent_task_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("tasks.id", ondelete="CASCADE"),
            nullable=True,
        ),
    )
    op.create_index("ix_tasks_parent_task_id", "tasks", ["parent_task_id"])
    op.create_check_constraint(
        "ck_tasks_parent_not_self",
        "tasks",
        "parent_task_id IS NULL OR parent_task_id <> id",
    )


def downgrade() -> None:
    op.drop_constraint("ck_tasks_parent_not_self", "tasks", type_="check")
    op.drop_index("ix_tasks_parent_task_id", table_name="tasks")
    op.drop_column("tasks", "parent_task_id")
