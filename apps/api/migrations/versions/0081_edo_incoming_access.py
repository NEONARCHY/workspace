"""Read visibility for EDO letters, independent of execution permissions."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0081_edo_incoming_access"
down_revision: str = "0080_feed_forwarding"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "edo_incoming_access",
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("core_users.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("mode", sa.String(16), nullable=False),
        sa.Column(
            "department_ids",
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
            "mode IN ('assigned', 'departments', 'all')", name="ck_edo_incoming_access_mode"
        ),
        sa.CheckConstraint("revision > 0", name="ck_edo_incoming_access_revision"),
    )


def downgrade() -> None:
    op.drop_table("edo_incoming_access")
