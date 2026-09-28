"""Stage bot-originated files before replaying offline letter operations."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0063_ai_referent_offline_blobs"
down_revision: str = "0062_ai_referent_offline_rights_snapshots"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "ai_referent_offline_blobs",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("agent_id", sa.String(128), nullable=False),
        sa.Column("epoch", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("sha256", sa.String(64), nullable=False),
        sa.Column("byte_size", sa.BigInteger(), nullable=False),
        sa.Column("storage_key", sa.String(300), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("agent_id", "epoch", "sha256", name="uq_ai_offline_blob_identity"),
        sa.CheckConstraint("byte_size > 0", name="ck_ai_offline_blob_nonempty"),
    )
    op.create_index(
        "ix_ai_offline_blobs_epoch", "ai_referent_offline_blobs", ["epoch", "created_at"]
    )


def downgrade() -> None:
    connection = op.get_bind()
    if connection.scalar(sa.text("SELECT EXISTS (SELECT 1 FROM ai_referent_offline_blobs)")):
        raise RuntimeError("Export AI Referent staged files before downgrading")
    op.drop_index("ix_ai_offline_blobs_epoch", table_name="ai_referent_offline_blobs")
    op.drop_table("ai_referent_offline_blobs")
