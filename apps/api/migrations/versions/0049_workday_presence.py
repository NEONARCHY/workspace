"""Persist individual schedules and auditable workday check-in sessions."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0049_workday_presence"
down_revision: str | None = "0048_ai_referent_shared"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "workday_schedules",
        sa.Column("user_id", sa.UUID(), sa.ForeignKey("core_users.id"), primary_key=True),
        sa.Column("starts_at", sa.Time(), nullable=False),
        sa.Column("ends_at", sa.Time(), nullable=False),
        sa.Column("updated_by_user_id", sa.UUID(), sa.ForeignKey("core_users.id")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("starts_at < ends_at", name="ck_workday_schedule_order"),
    )
    op.create_table(
        "workday_sessions",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column("user_id", sa.UUID(), sa.ForeignKey("core_users.id"), nullable=False),
        sa.Column("work_date", sa.Date(), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("ended_at", sa.DateTime(timezone=True)),
        sa.Column("scheduled_start_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("scheduled_end_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("closed_at", sa.DateTime(timezone=True)),
        sa.Column("close_source", sa.String(16)),
        sa.CheckConstraint(
            "close_source IS NULL OR close_source IN ('manual', 'automatic')",
            name="ck_workday_close_source",
        ),
    )
    op.create_index(
        "uq_workday_one_open_session",
        "workday_sessions",
        ["user_id"],
        unique=True,
        postgresql_where=sa.text("ended_at IS NULL"),
    )
    op.create_index("ix_workday_sessions_date_user", "workday_sessions", ["work_date", "user_id"])


def downgrade() -> None:
    op.drop_index("ix_workday_sessions_date_user", table_name="workday_sessions")
    op.drop_index("uq_workday_one_open_session", table_name="workday_sessions")
    op.drop_table("workday_sessions")
    op.drop_table("workday_schedules")
