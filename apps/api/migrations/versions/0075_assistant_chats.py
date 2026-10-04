"""Separate private assistant conversations without discarding legacy history."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0075_assistant_chats"
down_revision: str = "0074_sidebar_visibility"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "assistant_chats",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("core_users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("title", sa.String(100), nullable=False),
        sa.Column("is_default", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
    )
    op.create_index(
        "uq_assistant_default_chat",
        "assistant_chats",
        ["user_id"],
        unique=True,
        postgresql_where=sa.text("is_default"),
    )
    op.create_index("ix_assistant_chats_user_updated", "assistant_chats", ["user_id", "updated_at"])
    op.add_column("assistant_messages", sa.Column("chat_id", postgresql.UUID(as_uuid=True)))
    op.add_column("assistant_messages", sa.Column("cleared_at", sa.DateTime(timezone=True)))
    op.create_foreign_key(
        "fk_assistant_messages_chat",
        "assistant_messages",
        "assistant_chats",
        ["chat_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.create_index(
        "ix_assistant_messages_chat_created",
        "assistant_messages",
        ["user_id", "chat_id", "created_at"],
    )
    # NULL chat_id is the legacy/default chat. Old clients remain isolated there.
    op.execute(
        sa.text("""
        INSERT INTO assistant_chats (id, user_id, title, is_default, created_at, updated_at)
        SELECT gen_random_uuid(), user_id, 'Первый чат', true, min(created_at), max(created_at)
        FROM assistant_messages GROUP BY user_id
    """)
    )


def downgrade() -> None:
    # Do not merge unrelated conversations back into an old client's context.
    if (
        op.get_bind()
        .execute(
            sa.text("SELECT EXISTS (SELECT 1 FROM assistant_messages WHERE chat_id IS NOT NULL)")
        )
        .scalar()
    ):
        raise RuntimeError("Cannot downgrade while separate assistant chat messages exist")
    op.drop_index("ix_assistant_messages_chat_created", table_name="assistant_messages")
    op.drop_constraint("fk_assistant_messages_chat", "assistant_messages", type_="foreignkey")
    op.drop_column("assistant_messages", "chat_id")
    op.drop_column("assistant_messages", "cleared_at")
    op.drop_index("ix_assistant_chats_user_updated", table_name="assistant_chats")
    op.drop_index("uq_assistant_default_chat", table_name="assistant_chats")
    op.drop_table("assistant_chats")
