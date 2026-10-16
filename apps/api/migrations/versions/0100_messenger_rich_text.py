"""Structured message formatting, selected replies and personal pin dismissal."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0100_messenger_rich_text"
down_revision = "0099_merge_attachment_trip_heads"
branch_labels = None
depends_on = None
EXECUTIVE_TITLE = (
    '"Yuksalish" harakati raisi, Qonunchilik palatasi qo'
    "'mita raisi"
)


def upgrade() -> None:
    for table in ("messenger_messages", "messenger_message_versions"):
        op.add_column(
            table,
            sa.Column(
                "entities",
                postgresql.JSONB(),
                nullable=False,
                server_default=sa.text("'[]'::jsonb"),
            ),
        )
    op.add_column("messenger_messages", sa.Column("reply_quote", postgresql.JSONB()))
    op.add_column(
        "messenger_pinned_messages",
        sa.Column("protected", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.create_table(
        "messenger_pin_dismissals",
        sa.Column(
            "message_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("messenger_pinned_messages.message_id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("core_users.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("pinned_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_pin_dismissals_user", "messenger_pin_dismissals", ["user_id", "message_id"])
    # Existing pins use the same authoritative executive-position policy as Auth.

    op.get_bind().execute(
        sa.text(
            "UPDATE messenger_pinned_messages SET protected = true WHERE pinned_by_user_id IN "
            "(SELECT id FROM core_users WHERE lower(trim(job_title)) = lower(:title))"
        ),
        {"title": EXECUTIVE_TITLE},
    )


def downgrade() -> None:
    op.drop_table("messenger_pin_dismissals")
    op.drop_column("messenger_pinned_messages", "protected")
    op.drop_column("messenger_messages", "reply_quote")
    op.drop_column("messenger_message_versions", "entities")
    op.drop_column("messenger_messages", "entities")
