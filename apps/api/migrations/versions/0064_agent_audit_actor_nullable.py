"""Allow authenticated machine actions to carry no human actor in the audit ledger."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0064_agent_audit_actor_nullable"
down_revision: str = "0063_ai_referent_offline_blobs"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.alter_column(
        "core_audit_events", "actor_user_id",
        existing_type=sa.UUID(), nullable=True,
    )


def downgrade() -> None:
    connection = op.get_bind()
    if connection.scalar(sa.text(
        "SELECT EXISTS (SELECT 1 FROM core_audit_events WHERE actor_user_id IS NULL)"
    )):
        raise RuntimeError("Export machine audit events before downgrading")
    op.alter_column(
        "core_audit_events", "actor_user_id",
        existing_type=sa.UUID(), nullable=False,
    )
