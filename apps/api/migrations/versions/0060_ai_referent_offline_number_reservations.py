"""Reserve disjoint outgoing-number ranges for a disconnected Referent agent."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0060_ai_referent_offline_number_reservations"
down_revision: str = "0059a_alembic_version_128"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "ai_referent_offline_number_reservations",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("agent_id", sa.String(128), nullable=False),
        sa.Column("year_suffix", sa.String(2), nullable=False),
        sa.Column("first_number", sa.Integer(), nullable=False),
        sa.Column("last_number", sa.Integer(), nullable=False),
        sa.Column("valid_until", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("first_number > 0", name="ck_ai_offline_number_positive"),
        sa.CheckConstraint(
            "last_number >= first_number", name="ck_ai_offline_number_order"
        ),
    )
    op.create_index(
        "ix_ai_offline_numbers_agent_year",
        "ai_referent_offline_number_reservations",
        ["agent_id", "year_suffix"],
    )


def downgrade() -> None:
    connection = op.get_bind()
    if connection.scalar(sa.text(
        "SELECT EXISTS (SELECT 1 FROM ai_referent_offline_number_reservations)"
    )):
        raise RuntimeError("Export offline number reservations before downgrading")
    op.drop_index(
        "ix_ai_offline_numbers_agent_year",
        table_name="ai_referent_offline_number_reservations",
    )
    op.drop_table("ai_referent_offline_number_reservations")
