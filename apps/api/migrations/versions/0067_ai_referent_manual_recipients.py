"""Keep administrator-added recipients separate from the robot's address-book snapshot."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0067_ai_referent_manual_recipients"
down_revision: str = "0066_merge_main_and_referent_offline"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "ai_referent_manual_recipient_state",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("id = 1", name="ck_ai_manual_recipient_state_singleton"),
    )
    op.create_table(
        "ai_referent_manual_recipients",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("name", sa.String(300), nullable=False),
        sa.Column("address", sa.String(500), nullable=False, unique=True),
        sa.Column("route", sa.String(16), nullable=False),
        sa.Column("category_key", sa.String(30), nullable=False),
        sa.Column("created_by_user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("route IN ('exat', 'webmail')", name="ck_ai_manual_recipient_route"),
    )


def downgrade() -> None:
    connection = op.get_bind()
    if connection.scalar(sa.text("SELECT EXISTS (SELECT 1 FROM ai_referent_manual_recipients)")):
        raise RuntimeError("Export administrator-added recipients before downgrading")
    op.drop_table("ai_referent_manual_recipients")
    op.drop_table("ai_referent_manual_recipient_state")
