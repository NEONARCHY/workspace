"""Durable per-employee EDO delivery state."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0083_edo_employee_sync"
down_revision: str = "0082_assistant_chat_pins"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "edo_employee_sync",
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("core_users.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("payload", postgresql.JSONB(), nullable=False),
        sa.Column("payload_hash", sa.String(64), nullable=False),
        sa.Column("revision", sa.BigInteger(), nullable=False),
        sa.Column("delivered_revision", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("edo_user_id", sa.BigInteger()),
        sa.Column("state", sa.String(16), nullable=False, server_default="pending"),
        sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("next_attempt_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("lease_token", postgresql.UUID(as_uuid=True)),
        sa.Column("lease_until", sa.DateTime(timezone=True)),
        sa.Column("last_error_code", sa.String(48)),
        sa.Column("last_synced_at", sa.DateTime(timezone=True)),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "revision > 0 AND delivered_revision >= 0 AND delivered_revision <= revision",
            name="ck_edo_sync_revision",
        ),
        sa.CheckConstraint(
            "state IN ('pending','synced','retry','conflict')", name="ck_edo_sync_state"
        ),
    )
    op.create_index("ix_edo_employee_sync_due", "edo_employee_sync", ["state", "next_attempt_at"])


def downgrade() -> None:
    op.drop_table("edo_employee_sync")
