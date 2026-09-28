"""Record replayed bot operations atomically with their letter mutations."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0065_ai_referent_offline_operation_receipts"
down_revision: str = "0064_agent_audit_actor_nullable"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "ai_referent_offline_operation_receipts",
        sa.Column("operation_id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("agent_id", sa.String(128), nullable=False),
        sa.Column("epoch", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("sequence", sa.BigInteger(), nullable=False),
        sa.Column("letter_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("kind", sa.String(80), nullable=False),
        sa.Column("fingerprint", sa.String(64), nullable=False),
        sa.Column("result_revision", sa.Integer(), nullable=False),
        sa.Column("occurred_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("accepted_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("agent_id", "sequence", name="uq_ai_offline_replay_sequence"),
        sa.CheckConstraint("sequence > 0", name="ck_ai_offline_replay_sequence"),
        sa.CheckConstraint("result_revision > 0", name="ck_ai_offline_replay_revision"),
    )


def downgrade() -> None:
    connection = op.get_bind()
    if connection.scalar(sa.text(
        "SELECT EXISTS (SELECT 1 FROM ai_referent_offline_operation_receipts)"
    )):
        raise RuntimeError("Export AI Referent replay receipts before downgrading")
    op.drop_table("ai_referent_offline_operation_receipts")
