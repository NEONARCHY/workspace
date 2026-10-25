"""Account-owned, additive acknowledgements of bundled release history entries."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0116_account_release_reads"
down_revision = "0115_dossier_monthly_reviews"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "workspace_release_read_entries",
        sa.Column("user_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("core_users.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("entry_id", sa.String(220), primary_key=True),
        sa.Column("acknowledged_at", sa.DateTime(timezone=True), nullable=False),
    )


def downgrade() -> None:
    raise RuntimeError("Preserve account release acknowledgements when rolling back the UI")
