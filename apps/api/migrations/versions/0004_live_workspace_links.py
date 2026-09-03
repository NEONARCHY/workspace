"""Add links required by the first live corporate workflow.

Revision ID: 0004_live_workspace_links
Revises: 0003_corporate_core
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0004_live_workspace_links"
down_revision: str | None = "0003_corporate_core"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "tasks",
        sa.Column("source_message_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_foreign_key(
        "fk_tasks_source_message",
        "tasks",
        "messenger_messages",
        ["source_message_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.add_column(
        "approval_requests",
        sa.Column("source_task_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_foreign_key(
        "fk_approval_requests_source_task",
        "approval_requests",
        "tasks",
        ["source_task_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint(
        "fk_approval_requests_source_task",
        "approval_requests",
        type_="foreignkey",
    )
    op.drop_column("approval_requests", "source_task_id")
    op.drop_constraint("fk_tasks_source_message", "tasks", type_="foreignkey")
    op.drop_column("tasks", "source_message_id")
