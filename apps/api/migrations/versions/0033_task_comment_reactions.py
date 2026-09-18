"""Add reactions to task comments.

Revision ID: 0033_task_comment_reactions
Revises: 0032_feed_threads_reactions
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0033_task_comment_reactions"
down_revision: str | None = "0032_feed_threads_reactions"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "task_comment_reactions",
        sa.Column("comment_id", sa.UUID(), nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("emoji", sa.String(16), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["comment_id"], ["task_comments.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["core_users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("comment_id", "user_id", "emoji"),
    )


def downgrade() -> None:
    op.drop_table("task_comment_reactions")
