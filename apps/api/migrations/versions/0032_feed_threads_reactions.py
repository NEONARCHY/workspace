"""Add threaded feed comments and reactions.

Revision ID: 0032_feed_threads_reactions
Revises: 0031_messenger_chat_deletion
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0032_feed_threads_reactions"
down_revision: str | None = "0031_messenger_chat_deletion"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("feed_comments", sa.Column("parent_comment_id", sa.UUID()))
    op.create_foreign_key(
        "fk_feed_comments_parent",
        "feed_comments",
        "feed_comments",
        ["parent_comment_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.create_index("ix_feed_comments_parent", "feed_comments", ["parent_comment_id"])
    op.drop_constraint("ck_feed_reactions_kind", "feed_reactions", type_="check")
    op.execute("UPDATE feed_reactions SET kind = '👍' WHERE kind = 'like'")
    op.drop_constraint("feed_reactions_pkey", "feed_reactions", type_="primary")
    op.create_primary_key("feed_reactions_pkey", "feed_reactions", ["post_id", "user_id", "kind"])
    op.create_check_constraint(
        "ck_feed_reactions_kind",
        "feed_reactions",
        "kind IN ('👍', '❤️', '👏', '🎉', '👀', '✅', '🔥', "
        "'😂', '😮', '😢', '🙏', '🤝', '💯', '❗')",
    )
    op.create_table(
        "feed_comment_reactions",
        sa.Column("comment_id", sa.UUID(), nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("emoji", sa.String(16), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["comment_id"], ["feed_comments.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["core_users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("comment_id", "user_id", "emoji"),
    )


def downgrade() -> None:
    op.drop_table("feed_comment_reactions")
    op.drop_constraint("ck_feed_reactions_kind", "feed_reactions", type_="check")
    op.drop_constraint("feed_reactions_pkey", "feed_reactions", type_="primary")
    op.execute("DELETE FROM feed_reactions WHERE kind <> '👍'")
    op.execute("UPDATE feed_reactions SET kind = 'like' WHERE kind = '👍'")
    op.create_primary_key("feed_reactions_pkey", "feed_reactions", ["post_id", "user_id"])
    op.create_check_constraint("ck_feed_reactions_kind", "feed_reactions", "kind = 'like'")
    op.drop_index("ix_feed_comments_parent", table_name="feed_comments")
    op.drop_constraint("fk_feed_comments_parent", "feed_comments", type_="foreignkey")
    op.drop_column("feed_comments", "parent_comment_id")
