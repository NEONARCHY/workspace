"""Add workstream dates and auditable project work transitions."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0059_project_workstream_details"
down_revision: str = "0058_project_hisobot_merge"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_constraint("ck_project_hub_item_status", "project_hub_items", type_="check")
    op.create_check_constraint(
        "ck_project_hub_item_status", "project_hub_items",
        "status IN ('planned','active','completed','rejected','cancelled')",
    )
    op.add_column("project_hub_workstreams", sa.Column("start_date", sa.Date()))
    op.add_column("project_hub_workstreams", sa.Column("end_date", sa.Date()))
    op.create_check_constraint(
        "ck_project_hub_workstream_dates",
        "project_hub_workstreams",
        "start_date IS NULL OR end_date IS NULL OR end_date >= start_date",
    )
    op.create_table(
        "project_hub_item_actions",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "item_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("project_hub_items.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "actor_user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("core_users.id"),
            nullable=False,
        ),
        sa.Column("action", sa.String(16), nullable=False),
        sa.Column("from_status", sa.String(16)),
        sa.Column("to_status", sa.String(16)),
        sa.Column("comment", sa.Text()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("action IN ('status','comment')", name="ck_project_hub_item_action"),
    )
    op.create_index(
        "ix_project_hub_item_actions_item", "project_hub_item_actions", ["item_id", "created_at"]
    )


def downgrade() -> None:
    connection = op.get_bind()
    has_new_records = connection.scalar(sa.text(
        "SELECT EXISTS (SELECT 1 FROM project_hub_item_actions) OR "
        "EXISTS (SELECT 1 FROM project_hub_workstreams "
        "WHERE start_date IS NOT NULL OR end_date IS NOT NULL) OR "
        "EXISTS (SELECT 1 FROM project_hub_items WHERE status = 'rejected')"
    ))
    if has_new_records:
        raise RuntimeError(
            "Export project work history, dates and rejected tasks before downgrading"
        )
    op.drop_index("ix_project_hub_item_actions_item", table_name="project_hub_item_actions")
    op.drop_table("project_hub_item_actions")
    op.drop_constraint("ck_project_hub_workstream_dates", "project_hub_workstreams")
    op.drop_column("project_hub_workstreams", "end_date")
    op.drop_column("project_hub_workstreams", "start_date")
    op.drop_constraint("ck_project_hub_item_status", "project_hub_items", type_="check")
    op.create_check_constraint(
        "ck_project_hub_item_status", "project_hub_items",
        "status IN ('planned','active','completed','cancelled')",
    )
