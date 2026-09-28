"""Retain the exact Telegram rights verified before an offline interval."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0062_ai_referent_offline_rights_snapshots"
down_revision: str = "0061_ai_referent_authority"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "ai_referent_offline_rights_snapshots",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("agent_id", sa.String(128), nullable=False),
        sa.Column("epoch", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("reviewer_revision", sa.Integer(), nullable=False),
        sa.Column("actors", postgresql.JSONB(), nullable=False),
        sa.Column("content_sha256", sa.String(64), nullable=False),
        sa.Column("verified_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index(
        "ix_ai_offline_rights_epoch_verified",
        "ai_referent_offline_rights_snapshots",
        ["epoch", "verified_at"],
    )


def downgrade() -> None:
    connection = op.get_bind()
    if connection.scalar(sa.text(
        "SELECT EXISTS (SELECT 1 FROM ai_referent_offline_rights_snapshots)"
    )):
        raise RuntimeError("Export AI Referent rights evidence before downgrading")
    op.drop_index(
        "ix_ai_offline_rights_epoch_verified",
        table_name="ai_referent_offline_rights_snapshots",
    )
    op.drop_table("ai_referent_offline_rights_snapshots")
