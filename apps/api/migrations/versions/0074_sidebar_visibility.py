"""Persist administrator-managed per-user sidebar presentation."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0074_sidebar_visibility"
down_revision: str = "0073_project_hub_chats"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "workspace_sidebar_visibility",
        sa.Column("user_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("core_users.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("hidden_keys", postgresql.JSONB(), nullable=False,
                  server_default=sa.text("'[]'::jsonb")),
        sa.Column("revision", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("updated_by_user_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("core_users.id", ondelete="SET NULL")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.func.now()),
    )


def downgrade() -> None:
    op.drop_table("workspace_sidebar_visibility")
