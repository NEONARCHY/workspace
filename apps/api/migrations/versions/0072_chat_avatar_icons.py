"""Persist optional curated chat icons without changing existing conversations."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0072_chat_avatar_icons"
down_revision: str = "0071_task_chat_purge"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("messenger_chats", sa.Column("avatar_icon_key", sa.String(24), nullable=True))
    op.create_check_constraint(
        "ck_messenger_chat_avatar_icon",
        "messenger_chats",
        "avatar_icon_key IS NULL OR avatar_icon_key IN "
        "('team','plane','project','briefcase','building','globe',"
        "'calendar','document','target','compass','star','sparkles')",
    )


def downgrade() -> None:
    op.drop_constraint("ck_messenger_chat_avatar_icon", "messenger_chats", type_="check")
    op.drop_column("messenger_chats", "avatar_icon_key")
