"""Persist private assistant chat pins without changing existing conversations."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0082_assistant_chat_pins"
down_revision: str = "0081_edo_incoming_access"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "assistant_chats",
        sa.Column("is_pinned", sa.Boolean(), nullable=False, server_default=sa.false()),
    )


def downgrade() -> None:
    op.drop_column("assistant_chats", "is_pinned")
