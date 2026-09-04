"""Private groups, delegated permissions and versioned message editing."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0016_messenger_groups"
down_revision: str | None = "0015_notifications"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("messenger_chats", sa.Column("direct_key", sa.String(73), nullable=True))
    op.create_unique_constraint("uq_messenger_direct_pair", "messenger_chats", ["direct_key"])
    op.add_column(
        "messenger_chats", sa.Column("description", sa.Text(), nullable=False, server_default="")
    )
    op.add_column(
        "messenger_chat_members",
        sa.Column(
            "permissions",
            postgresql.JSONB(),
            nullable=False,
            server_default=sa.text(
                "'{\"send_messages\": true, \"upload_files\": true, "
                "\"invite_members\": false, \"manage_members\": false, "
                "\"edit_info\": false}'::jsonb"
            ),
        ),
    )
    # Legacy demo dialogs had four members; preserve their data as explicit groups.
    op.execute("""
        UPDATE messenger_chats SET kind = 'group'
        WHERE kind = 'direct' AND id IN (
            SELECT chat_id FROM messenger_chat_members GROUP BY chat_id HAVING count(*) <> 2
        )
    """)
    op.execute("""
        UPDATE messenger_chat_members AS member SET member_role = 'owner'
        FROM messenger_chats AS chat
        WHERE member.chat_id = chat.id AND chat.kind = 'group'
          AND member.user_id = chat.created_by_user_id
    """)
    op.create_index(
        "uq_messenger_group_owner",
        "messenger_chat_members",
        ["chat_id"],
        unique=True,
        postgresql_where=sa.text("member_role = 'owner'"),
    )
    op.add_column(
        "messenger_messages",
        sa.Column("revision", sa.Integer(), nullable=False, server_default="1"),
    )
    op.add_column(
        "messenger_messages",
        sa.Column(
            "mention_user_ids",
            postgresql.JSONB(),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
    )
    op.add_column(
        "messenger_message_versions",
        sa.Column(
            "mention_user_ids",
            postgresql.JSONB(),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
    )
    op.add_column(
        "messenger_message_versions",
        sa.Column(
            "actor_user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("core_users.id"),
            nullable=True,
        ),
    )
    op.execute("""
        UPDATE messenger_message_versions AS version SET actor_user_id = message.author_user_id
        FROM messenger_messages AS message WHERE message.id = version.message_id
    """)
    op.execute("""
        CREATE FUNCTION protect_messenger_versions() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN RAISE EXCEPTION 'Message history is append-only'; END $$
    """)
    op.execute("""
        CREATE TRIGGER messenger_versions_append_only
        BEFORE UPDATE OR DELETE ON messenger_message_versions
        FOR EACH ROW EXECUTE FUNCTION protect_messenger_versions()
    """)


def downgrade() -> None:
    op.execute("DROP TRIGGER messenger_versions_append_only ON messenger_message_versions")
    op.execute("DROP FUNCTION protect_messenger_versions()")
    op.drop_column("messenger_message_versions", "actor_user_id")
    op.drop_column("messenger_message_versions", "mention_user_ids")
    op.drop_column("messenger_messages", "mention_user_ids")
    op.drop_column("messenger_messages", "revision")
    op.drop_index("uq_messenger_group_owner", table_name="messenger_chat_members")
    op.drop_column("messenger_chat_members", "permissions")
    op.drop_column("messenger_chats", "description")
    op.drop_constraint("uq_messenger_direct_pair", "messenger_chats", type_="unique")
    op.drop_column("messenger_chats", "direct_key")
