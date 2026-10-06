"""Persist personal dismissals without deleting events or managed conversations."""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0076_swipe_dismissals"
down_revision: str = "0075_assistant_chats"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("workspace_notifications", sa.Column(
        "dismissed_at", sa.DateTime(timezone=True), nullable=True,
    ))
    op.create_table(
        "messenger_chat_dismissals",
        sa.Column("chat_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("messenger_chats.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("user_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("core_users.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("dismissed_at", sa.DateTime(timezone=True), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("messenger_chat_dismissals")
    op.drop_column("workspace_notifications", "dismissed_at")
