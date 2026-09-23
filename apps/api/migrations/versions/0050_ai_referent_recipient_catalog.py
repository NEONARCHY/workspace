"""Synchronize the referent PC's outgoing address book for Workspace lookup."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0050_ai_referent_recipient_catalog"
down_revision: str | None = "0049_workday_presence"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "ai_referent_recipient_catalog",
        sa.Column("agent_id", sa.String(128), primary_key=True),
        sa.Column("revision", sa.String(64), nullable=False),
        sa.Column("entries", postgresql.JSONB(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("ai_referent_recipient_catalog")
