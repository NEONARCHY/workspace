"""Persist grant deadline requests and exact before/after dates without changing grants."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0129_grant_deadline_requests"
down_revision = "0128_merge_incoming_telegram"
branch_labels = None
depends_on = None


def upgrade() -> None:
    uid = postgresql.UUID(as_uuid=True)
    op.create_table(
        "grant_deadline_requests",
        sa.Column("id", uid, primary_key=True),
        sa.Column("grant_id", uid, sa.ForeignKey("grant_requests.id"), nullable=False),
        sa.Column("requested_by_user_id", uid, sa.ForeignKey("core_users.id"), nullable=False),
        sa.Column("old_due_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("due_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("decided_by_user_id", uid, sa.ForeignKey("core_users.id")),
        sa.Column("decision_reason", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("decided_at", sa.DateTime(timezone=True)),
        sa.CheckConstraint("due_at > old_due_at", name="ck_grant_deadline_extension"),
        sa.CheckConstraint("char_length(trim(reason)) >= 3", name="ck_grant_deadline_reason"),
        sa.CheckConstraint(
            "status IN ('pending','approved','rejected','superseded')",
            name="ck_grant_deadline_status",
        ),
        sa.CheckConstraint(
            "(status = 'pending' AND decided_at IS NULL AND decided_by_user_id IS NULL) OR "
            "(status <> 'pending' AND decided_at IS NOT NULL AND decided_by_user_id IS NOT NULL)",
            name="ck_grant_deadline_decision",
        ),
    )
    op.create_index(
        "ix_grant_deadline_history", "grant_deadline_requests", ["grant_id", "created_at"],
    )
    op.create_index(
        "uq_grant_deadline_pending", "grant_deadline_requests", ["grant_id"], unique=True,
        postgresql_where=sa.text("status = 'pending'"),
    )
    op.add_column("grant_events", sa.Column("old_due_at", sa.DateTime(timezone=True)))
    op.add_column("grant_events", sa.Column("due_at", sa.DateTime(timezone=True)))


def downgrade() -> None:
    if op.get_bind().scalar(sa.text("SELECT EXISTS(SELECT 1 FROM grant_deadline_requests)")):
        raise RuntimeError("Preserve grant deadline requests before downgrading")
    if op.get_bind().scalar(sa.text(
        "SELECT EXISTS(SELECT 1 FROM grant_events WHERE old_due_at IS NOT NULL)",
    )):
        raise RuntimeError("Preserve grant deadline history before downgrading")
    op.drop_column("grant_events", "due_at")
    op.drop_column("grant_events", "old_due_at")
    op.drop_table("grant_deadline_requests")
