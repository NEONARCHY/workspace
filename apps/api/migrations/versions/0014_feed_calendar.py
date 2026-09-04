"""Add corporate feed and calendar.

Revision ID: 0014_feed_calendar
Revises: 0013_projects_trips
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0014_feed_calendar"
down_revision: str | None = "0013_projects_trips"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "feed_posts",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "author_user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("core_users.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("title", sa.String(length=240), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("is_pinned", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_feed_posts_pinned_created", "feed_posts", ["is_pinned", "created_at"])
    op.create_table(
        "feed_comments",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "post_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("feed_posts.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "author_user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("core_users.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_feed_comments_post_created", "feed_comments", ["post_id", "created_at"])
    op.create_table(
        "feed_reactions",
        sa.Column(
            "post_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("feed_posts.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("core_users.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("kind", sa.String(length=16), nullable=False, server_default="like"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("kind = 'like'", name="ck_feed_reactions_kind"),
    )
    op.create_table(
        "calendar_events",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "organizer_user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("core_users.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("title", sa.String(length=240), nullable=False),
        sa.Column("description", sa.Text(), nullable=False, server_default=""),
        sa.Column("event_type", sa.String(length=24), nullable=False, server_default="general"),
        sa.Column("starts_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("ends_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("all_day", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("location", sa.String(length=240), nullable=False, server_default=""),
        sa.Column("status", sa.String(length=16), nullable=False, server_default="scheduled"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "event_type IN ('meeting', 'deadline', 'trip', 'task', 'general')",
            name="ck_calendar_events_type",
        ),
        sa.CheckConstraint(
            "status IN ('scheduled', 'cancelled')",
            name="ck_calendar_events_status",
        ),
        sa.CheckConstraint("ends_at > starts_at", name="ck_calendar_events_period"),
    )
    op.create_index("ix_calendar_events_period", "calendar_events", ["starts_at", "ends_at"])
    op.create_table(
        "calendar_event_attendees",
        sa.Column(
            "event_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("calendar_events.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("core_users.id", ondelete="RESTRICT"),
            primary_key=True,
        ),
    )
    op.create_index("ix_calendar_event_attendees_user", "calendar_event_attendees", ["user_id"])
    op.execute(
        """
        INSERT INTO messenger_message_receipts (message_id, user_id, delivered_at, read_at)
        SELECT
            message.id,
            member.user_id,
            message.created_at,
            CASE
                WHEN message.author_user_id = member.user_id THEN message.created_at
                ELSE NULL
            END
        FROM messenger_messages AS message
        JOIN messenger_chat_members AS member ON member.chat_id = message.chat_id
        WHERE message.deleted_at IS NULL
        ON CONFLICT (message_id, user_id) DO NOTHING
        """
    )


def downgrade() -> None:
    op.drop_index("ix_calendar_event_attendees_user", table_name="calendar_event_attendees")
    op.drop_table("calendar_event_attendees")
    op.drop_index("ix_calendar_events_period", table_name="calendar_events")
    op.drop_table("calendar_events")
    op.drop_table("feed_reactions")
    op.drop_index("ix_feed_comments_post_created", table_name="feed_comments")
    op.drop_table("feed_comments")
    op.drop_index("ix_feed_posts_pinned_created", table_name="feed_posts")
    op.drop_table("feed_posts")
