"""Per-user chat organization and navigation, independent of shared chat data."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0017_personal_organization"
down_revision: str | None = "0016_messenger_groups"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "workspace_personal_preferences",
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("core_users.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "pinned_chat_ids",
            postgresql.JSONB(),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
        sa.Column(
            "archived_chat_ids",
            postgresql.JSONB(),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
        sa.Column(
            "navigation_order",
            postgresql.JSONB(),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
        sa.Column("revision", sa.Integer(), nullable=False, server_default="0"),
        sa.CheckConstraint("revision >= 0", name="ck_personal_preferences_revision"),
    )


def downgrade() -> None:
    op.drop_table("workspace_personal_preferences")
