"""Track the bot's write lease before enabling disconnected operation."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0061_ai_referent_authority"
down_revision: str = "0060_ai_referent_offline_number_reservations"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "ai_referent_authority",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("agent_id", sa.String(128), nullable=False),
        sa.Column("epoch", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("mode", sa.String(24), nullable=False),
        sa.Column("lease_until", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("id = 1", name="ck_ai_authority_singleton"),
        sa.CheckConstraint(
            "mode IN ('online','replay_required')", name="ck_ai_authority_mode"
        ),
    )


def downgrade() -> None:
    connection = op.get_bind()
    if connection.scalar(sa.text("SELECT EXISTS (SELECT 1 FROM ai_referent_authority)")):
        raise RuntimeError("Disable and export AI Referent authority before downgrading")
    op.drop_table("ai_referent_authority")
