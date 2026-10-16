"""Explicit consent before creating a task under another employee's name."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0101_task_proposals"
down_revision = "0100_messenger_rich_text"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "task_proposals",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("creator_user_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("core_users.id"), nullable=False),
        sa.Column("author_user_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("core_users.id"), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("payload", postgresql.JSONB(), nullable=False),
        sa.Column("task_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("tasks.id", ondelete="SET NULL")),
        sa.Column("reason", sa.Text(), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("decided_at", sa.DateTime(timezone=True)),
        sa.CheckConstraint("status IN ('pending', 'approved', 'rejected', 'cancelled')",
                           name="ck_task_proposal_status"),
        sa.CheckConstraint("creator_user_id <> author_user_id",
                           name="ck_task_proposal_distinct_author"),
    )
    op.create_index("ix_task_proposals_author", "task_proposals", ["author_user_id", "created_at"])
    op.create_index(
        "ix_task_proposals_creator", "task_proposals", ["creator_user_id", "created_at"],
    )


def downgrade() -> None:
    op.drop_table("task_proposals")
