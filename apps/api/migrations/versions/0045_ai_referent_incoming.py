"""Add incoming correspondence and referent-agent journal state.

Revision ID: 0045_ai_referent_incoming
Revises: 0044_ai_referent
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0045_ai_referent_incoming"
down_revision: str | None = "0044_ai_referent"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "ai_referent_agents",
        sa.Column("agent_id", sa.String(128), primary_key=True),
        sa.Column("display_name", sa.String(200), nullable=False),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("journal_storage_key", sa.String(500), nullable=True),
        sa.Column("journal_file_name", sa.String(255), nullable=True),
        sa.Column("journal_content_type", sa.String(160), nullable=True),
        sa.Column("journal_byte_size", sa.BigInteger(), nullable=True),
        sa.Column("journal_sha256", sa.String(64), nullable=True),
        sa.Column("journal_updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "journal_byte_size IS NULL OR journal_byte_size >= 0",
            name="ck_ai_agent_journal_size_nonnegative",
        ),
    )

    op.create_table(
        "ai_referent_incoming_letters",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("agent_id", sa.String(128), nullable=False),
        sa.Column("external_id", sa.String(160), nullable=False),
        sa.Column("sequence_number", sa.String(32), nullable=False),
        sa.Column("platform_incoming_number", sa.String(80), nullable=False, server_default=""),
        sa.Column("sender_letter_number", sa.String(160), nullable=False, server_default=""),
        sa.Column("platform_incoming_date", sa.Date(), nullable=True),
        sa.Column("platform_outgoing_date", sa.Date(), nullable=True),
        sa.Column("received_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("processed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("registered_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("sender_organization", sa.String(300), nullable=False, server_default=""),
        sa.Column("sender_person", sa.String(300), nullable=False, server_default=""),
        sa.Column("subject", sa.String(500), nullable=False, server_default=""),
        sa.Column("responsible_external_id", sa.String(160), nullable=False, server_default=""),
        sa.Column("responsible_display_name", sa.String(300), nullable=False, server_default=""),
        sa.Column("responsible_user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("urgency", sa.String(32), nullable=False, server_default="normal"),
        sa.Column("has_attachments", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("attachments_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("main_document_filename", sa.String(500), nullable=False, server_default=""),
        sa.Column("platform_record_id", sa.String(160), nullable=False, server_default=""),
        sa.Column("status", sa.String(64), nullable=False),
        sa.Column("fallback_used", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("error_message", sa.Text(), nullable=False, server_default=""),
        sa.Column("source", sa.String(24), nullable=False),
        sa.Column("payload_sha256", sa.String(64), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["agent_id"], ["ai_referent_agents.agent_id"], ondelete="RESTRICT"
        ),
        sa.ForeignKeyConstraint(
            ["responsible_user_id"], ["core_users.id"], ondelete="SET NULL"
        ),
        sa.UniqueConstraint(
            "agent_id", "external_id", name="uq_ai_incoming_agent_external"
        ),
        sa.CheckConstraint(
            "attachments_count >= 0", name="ck_ai_incoming_attachments_nonnegative"
        ),
        sa.CheckConstraint("revision >= 1", name="ck_ai_incoming_revision_positive"),
        sa.CheckConstraint(
            "source IN ('exat', 'webmail', 'import')", name="ck_ai_incoming_source"
        ),
    )
    op.create_index(
        "ix_ai_incoming_received", "ai_referent_incoming_letters", ["received_at"]
    )
    op.create_index(
        "ix_ai_incoming_status_updated",
        "ai_referent_incoming_letters",
        ["status", "updated_at"],
    )
    op.create_index(
        "ix_ai_incoming_responsible",
        "ai_referent_incoming_letters",
        ["responsible_user_id", "updated_at"],
    )


def downgrade() -> None:
    op.drop_table("ai_referent_incoming_letters")
    op.drop_table("ai_referent_agents")
