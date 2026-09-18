"""add soft deletion for messenger chats

Revision ID: 0031_messenger_chat_deletion
Revises: 0030_profile_avatars
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0031_messenger_chat_deletion"
down_revision: str | None = "0030_profile_avatars"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("messenger_chats", sa.Column("deleted_at", sa.DateTime(timezone=True)))
    op.add_column("messenger_chats", sa.Column("deleted_by_user_id", sa.Uuid()))


def downgrade() -> None:
    op.drop_column("messenger_chats", "deleted_by_user_id")
    op.drop_column("messenger_chats", "deleted_at")
