"""Store authenticated profile avatars in object storage.

Revision ID: 0030_profile_avatars
Revises: 0029_zoom_meetings
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0030_profile_avatars"
down_revision: str | None = "0029_zoom_meetings"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("core_users", sa.Column("avatar_storage_key", sa.String(500)))
    op.add_column("core_users", sa.Column("avatar_content_type", sa.String(80)))
    op.add_column("core_users", sa.Column("avatar_updated_at", sa.DateTime(timezone=True)))


def downgrade() -> None:
    op.drop_column("core_users", "avatar_updated_at")
    op.drop_column("core_users", "avatar_content_type")
    op.drop_column("core_users", "avatar_storage_key")
