"""Add time-limited, auditable administrative chat inspections.

Revision ID: 0024_admin_controls
Revises: 0023_department_access
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0024_admin_controls"
down_revision: str | None = "0023_department_access"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "messenger_admin_inspections",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "chat_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("messenger_chats.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "actor_user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("core_users.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_accessed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "char_length(trim(reason)) >= 12",
            name="ck_messenger_admin_inspections_reason",
        ),
        sa.CheckConstraint(
            "expires_at > created_at",
            name="ck_messenger_admin_inspections_expiry",
        ),
    )
    op.create_index(
        "ix_messenger_admin_inspections_actor_expiry",
        "messenger_admin_inspections",
        ["actor_user_id", "expires_at"],
    )
    op.create_index(
        "ix_messenger_admin_inspections_chat",
        "messenger_admin_inspections",
        ["chat_id", "created_at"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_messenger_admin_inspections_chat",
        table_name="messenger_admin_inspections",
    )
    op.drop_index(
        "ix_messenger_admin_inspections_actor_expiry",
        table_name="messenger_admin_inspections",
    )
    op.drop_table("messenger_admin_inspections")
