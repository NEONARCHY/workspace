"""Create the shared outgoing-letter register for AI Referent.

Revision ID: 0044_ai_referent
Revises: 0043_hr_standalone_cards
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0044_ai_referent"
down_revision: str | None = "0043_hr_standalone_cards"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_constraint(
        "ck_workspace_attachments_owner_type",
        "workspace_attachments",
        type_="check",
    )
    op.create_check_constraint(
        "ck_workspace_attachments_owner_type",
        "workspace_attachments",
        "owner_type IN ('message', 'task', 'approval_request', 'absence', "
        "'ai_referent_letter')",
    )

    op.create_table(
        "ai_referent_letters",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("outgoing_number", sa.Integer(), nullable=True),
        sa.Column("year_suffix", sa.String(2), nullable=True),
        sa.Column("subject", sa.String(300), nullable=False),
        sa.Column("recipient_organization", sa.String(300), nullable=False),
        sa.Column("recipient_address", sa.String(500), nullable=False, server_default=""),
        sa.Column("route", sa.String(16), nullable=False),
        sa.Column("note", sa.Text(), nullable=False, server_default=""),
        sa.Column("status", sa.String(32), nullable=False),
        sa.Column("source", sa.String(24), nullable=False),
        sa.Column("created_by_user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("reviewer_user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("legacy_id", sa.String(128), nullable=True),
        sa.Column("revision", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("sent_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["created_by_user_id"], ["core_users.id"], ondelete="RESTRICT"
        ),
        sa.ForeignKeyConstraint(
            ["reviewer_user_id"], ["core_users.id"], ondelete="SET NULL"
        ),
        sa.CheckConstraint("route IN ('exat', 'webmail')", name="ck_ai_letters_route"),
        sa.CheckConstraint(
            "status IN ('draft', 'pending_review', 'needs_revision', 'approved', "
            "'queued', 'sending', 'sent', 'failed', 'cancelled')",
            name="ck_ai_letters_status",
        ),
        sa.CheckConstraint(
            "source IN ('workspace', 'telegram', 'import')", name="ck_ai_letters_source"
        ),
        sa.CheckConstraint(
            "(outgoing_number IS NULL AND year_suffix IS NULL) OR "
            "(outgoing_number IS NOT NULL AND year_suffix IS NOT NULL)",
            name="ck_ai_letters_number_pair",
        ),
        sa.UniqueConstraint(
            "outgoing_number", "year_suffix", name="uq_ai_letters_number_year"
        ),
        sa.UniqueConstraint("legacy_id", name="uq_ai_letters_legacy_id"),
    )
    op.create_index(
        "ix_ai_letters_status_updated", "ai_referent_letters", ["status", "updated_at"]
    )
    op.create_index(
        "ix_ai_letters_creator_updated",
        "ai_referent_letters",
        ["created_by_user_id", "updated_at"],
    )

    op.create_table(
        "ai_referent_number_counters",
        sa.Column("year_suffix", sa.String(2), primary_key=True),
        sa.Column("last_number", sa.Integer(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("last_number >= 0", name="ck_ai_number_counter_nonnegative"),
    )

    op.create_table(
        "ai_referent_events",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("letter_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("actor_user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("event_type", sa.String(64), nullable=False),
        sa.Column("from_status", sa.String(32), nullable=True),
        sa.Column("to_status", sa.String(32), nullable=True),
        sa.Column("comment", sa.Text(), nullable=False, server_default=""),
        sa.Column("metadata", postgresql.JSONB(), nullable=False, server_default="{}"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["letter_id"], ["ai_referent_letters.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(["actor_user_id"], ["core_users.id"], ondelete="SET NULL"),
    )
    op.create_index(
        "ix_ai_events_letter_created", "ai_referent_events", ["letter_id", "created_at"]
    )

    op.create_table(
        "ai_referent_delivery_commands",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("letter_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("route", sa.String(16), nullable=False),
        sa.Column("status", sa.String(24), nullable=False),
        sa.Column("idempotency_key", sa.String(160), nullable=False),
        sa.Column("claimed_by", sa.String(160), nullable=True),
        sa.Column("lease_until", sa.DateTime(timezone=True), nullable=True),
        sa.Column("attempt_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("last_error", sa.Text(), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(
            ["letter_id"], ["ai_referent_letters.id"], ondelete="CASCADE"
        ),
        sa.UniqueConstraint("idempotency_key", name="uq_ai_delivery_idempotency"),
        sa.CheckConstraint("route IN ('exat', 'webmail')", name="ck_ai_delivery_route"),
        sa.CheckConstraint(
            "status IN ('pending', 'claimed', 'completed', 'failed', 'cancelled')",
            name="ck_ai_delivery_status",
        ),
    )
    op.create_index(
        "ix_ai_delivery_status_created",
        "ai_referent_delivery_commands",
        ["status", "created_at"],
    )


def downgrade() -> None:
    op.drop_table("ai_referent_delivery_commands")
    op.drop_table("ai_referent_events")
    op.drop_table("ai_referent_number_counters")
    op.drop_table("ai_referent_letters")
    op.execute(
        "DELETE FROM workspace_attachments "
        "WHERE owner_type = 'ai_referent_letter'"
    )
    op.drop_constraint(
        "ck_workspace_attachments_owner_type",
        "workspace_attachments",
        type_="check",
    )
    op.create_check_constraint(
        "ck_workspace_attachments_owner_type",
        "workspace_attachments",
        "owner_type IN ('message', 'task', 'approval_request', 'absence')",
    )
