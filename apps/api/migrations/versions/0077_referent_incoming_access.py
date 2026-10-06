"""Per-employee incoming mail visibility, independent of the Exat robot."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0077_referent_incoming_access"
down_revision: str = "0076_swipe_dismissals"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "ai_referent_incoming_access",
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("core_users.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("mode", sa.String(16), nullable=False),
        sa.Column(
            "responsibles",
            postgresql.JSONB(),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
        sa.Column("revision", sa.Integer(), nullable=False, server_default="1"),
        sa.Column(
            "updated_by_user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("core_users.id", ondelete="SET NULL"),
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.CheckConstraint(
            "mode IN ('default', 'none', 'assigned', 'all')", name="ck_ai_incoming_access_mode"
        ),
    )
    op.create_index(
        "ix_ai_incoming_agent_responsible",
        "ai_referent_incoming_letters",
        ["agent_id", "responsible_external_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_ai_incoming_agent_responsible", table_name="ai_referent_incoming_letters")
    op.drop_table("ai_referent_incoming_access")
