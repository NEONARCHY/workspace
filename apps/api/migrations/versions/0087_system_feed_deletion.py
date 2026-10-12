"""Keep annual system-post tombstones so deleted announcements stay deleted."""

import sqlalchemy as sa
from alembic import op

revision = "0087_system_feed_deletion"
down_revision = "0086_survey_analytics"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("feed_posts", sa.Column("deleted_at", sa.DateTime(timezone=True)))
    op.add_column("feed_posts", sa.Column("deleted_by_user_id", sa.Uuid()))


def downgrade() -> None:
    # Refuse a rollback that would resurrect announcements or erase their audit.
    if op.get_bind().scalar(sa.text(
        "SELECT EXISTS (SELECT 1 FROM feed_posts WHERE deleted_at IS NOT NULL)"
    )):
        raise RuntimeError("Cannot remove system-post tombstones while deleted announcements exist")
    op.drop_column("feed_posts", "deleted_by_user_id")
    op.drop_column("feed_posts", "deleted_at")
