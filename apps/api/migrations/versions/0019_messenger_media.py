"""Add message reactions, pins and compact voice attachment metadata.

Revision ID: 0019_messenger_media
Revises: 0018_employee_efficiency
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0019_messenger_media"
down_revision: str | None = "0018_employee_efficiency"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """
        UPDATE messenger_chat_members
        SET permissions = COALESCE(permissions, '{}'::jsonb) ||
            jsonb_build_object(
                'manage_messages', member_role IN ('owner', 'moderator')
            )
        """
    )
    op.create_table(
        "messenger_message_reactions",
        sa.Column(
            "message_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("messenger_messages.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("core_users.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("emoji", sa.String(length=8), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "emoji IN ('👍', '❤️', '👏', '🎉', '👀', '✅')",
            name="ck_messenger_message_reactions_emoji",
        ),
    )
    op.create_index(
        "ix_messenger_message_reactions_message",
        "messenger_message_reactions",
        ["message_id", "created_at"],
    )
    op.create_table(
        "messenger_pinned_messages",
        sa.Column(
            "message_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("messenger_messages.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "chat_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("messenger_chats.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "pinned_by_user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("core_users.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("pinned_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index(
        "ix_messenger_pinned_messages_chat",
        "messenger_pinned_messages",
        ["chat_id", "pinned_at"],
    )
    op.add_column(
        "workspace_attachments",
        sa.Column("media_kind", sa.String(length=16), nullable=False, server_default="file"),
    )
    op.add_column(
        "workspace_attachments",
        sa.Column("media_duration_ms", sa.Integer(), nullable=True),
    )
    op.add_column(
        "workspace_attachments",
        sa.Column("media_codec", sa.String(length=32), nullable=True),
    )
    op.create_check_constraint(
        "ck_workspace_attachments_media_kind",
        "workspace_attachments",
        "media_kind IN ('file', 'voice')",
    )
    op.create_check_constraint(
        "ck_workspace_attachments_voice_metadata",
        "workspace_attachments",
        "(media_kind = 'file' AND media_duration_ms IS NULL AND media_codec IS NULL) OR "
        "(media_kind = 'voice' AND owner_type = 'message' "
        "AND media_duration_ms BETWEEN 500 AND 600000 AND media_codec = 'opus')",
    )


def downgrade() -> None:
    op.drop_constraint(
        "ck_workspace_attachments_voice_metadata",
        "workspace_attachments",
        type_="check",
    )
    op.drop_constraint(
        "ck_workspace_attachments_media_kind",
        "workspace_attachments",
        type_="check",
    )
    op.drop_column("workspace_attachments", "media_codec")
    op.drop_column("workspace_attachments", "media_duration_ms")
    op.drop_column("workspace_attachments", "media_kind")
    op.drop_index(
        "ix_messenger_pinned_messages_chat",
        table_name="messenger_pinned_messages",
    )
    op.drop_table("messenger_pinned_messages")
    op.drop_index(
        "ix_messenger_message_reactions_message",
        table_name="messenger_message_reactions",
    )
    op.drop_table("messenger_message_reactions")
    op.execute(
        """
        UPDATE messenger_chat_members
        SET permissions = permissions - 'manage_messages'
        """
    )
