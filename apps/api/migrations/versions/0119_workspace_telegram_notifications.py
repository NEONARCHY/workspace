"""Durable, explicitly granted Workspace notifications through the Hisobot bot."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

revision = "0119_workspace_telegram"
down_revision = "0118_task_proposal_imports"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "workspace_telegram_deliveries",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "user_id",
            UUID(as_uuid=True),
            sa.ForeignKey("core_users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("event_key", sa.String(320), nullable=False),
        sa.Column("kind", sa.String(32), nullable=False),
        sa.Column("entity_id", UUID(as_uuid=True), nullable=False),
        sa.Column("stage_key", sa.String(160)),
        sa.Column("entity_version", sa.Integer()),
        sa.Column("title", sa.String(240), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("state", sa.String(24), nullable=False, server_default="pending"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("retry_at", sa.DateTime(timezone=True)),
        sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("lease_token", UUID(as_uuid=True)),
        sa.Column("lease_until", sa.DateTime(timezone=True)),
        sa.Column("telegram_id", sa.String(20)),
        sa.Column("identity_revision", sa.Integer()),
        sa.Column("telegram_message_id", sa.BigInteger()),
        sa.Column("delivery_mode", sa.String(16)),
        sa.Column("finished_at", sa.DateTime(timezone=True)),
        sa.Column("last_error", sa.String(64)),
        sa.UniqueConstraint("user_id", "event_key", name="uq_workspace_telegram_event"),
        sa.CheckConstraint(
            "state IN ('pending','leased','sending','sent','previewed',"
            "'failed','unknown','skipped')",
            name="ck_workspace_telegram_state",
        ),
        sa.CheckConstraint(
            "kind IN ('task_assigned','payment_action')", name="ck_workspace_telegram_kind"
        ),
    )
    op.create_index(
        "ix_workspace_telegram_pending",
        "workspace_telegram_deliveries",
        ["state", "retry_at", "created_at"],
    )


def downgrade() -> None:
    if op.get_bind().scalar(sa.text("SELECT count(*) FROM workspace_telegram_deliveries")):
        raise RuntimeError(
            "Preserve delivery receipts; roll back application without dropping data"
        )
    op.drop_table("workspace_telegram_deliveries")
