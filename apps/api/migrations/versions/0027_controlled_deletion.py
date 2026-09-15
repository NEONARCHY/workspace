"""Add auditable soft deletion for core work records.

Revision ID: 0027_controlled_deletion
Revises: 0026_web_sessions
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0027_controlled_deletion"
down_revision: str | None = "0026_web_sessions"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

TARGETS = ("tasks", "workspace_projects", "approval_requests")


def upgrade() -> None:
    for table_name in TARGETS:
        op.add_column(table_name, sa.Column("deleted_at", sa.DateTime(timezone=True)))
        op.add_column(
            table_name,
            sa.Column(
                "deleted_by_user_id",
                postgresql.UUID(as_uuid=True),
                sa.ForeignKey("core_users.id", ondelete="RESTRICT"),
            ),
        )
        op.add_column(table_name, sa.Column("deletion_reason", sa.Text()))
        op.create_index(
            f"ix_{table_name}_active",
            table_name,
            ["deleted_at"],
            postgresql_where=sa.text("deleted_at IS NULL"),
        )


def downgrade() -> None:
    for table_name in reversed(TARGETS):
        op.drop_index(f"ix_{table_name}_active", table_name=table_name)
        op.drop_column(table_name, "deletion_reason")
        op.drop_column(table_name, "deleted_by_user_id")
        op.drop_column(table_name, "deleted_at")
