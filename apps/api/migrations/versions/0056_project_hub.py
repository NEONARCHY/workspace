"""Standalone project work and project funding requests."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0056_project_hub"
down_revision: str | None = "0055_ai_referent_preflight"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_constraint(
        "ck_workspace_notifications_section", "workspace_notifications", type_="check"
    )
    op.create_check_constraint(
        "ck_workspace_notifications_section",
        "workspace_notifications",
        "section IN ('messenger','tasks','payment_requests','trip_approvals',"
        "'calendar','absences','zoom_meetings','hr','team_overview','ai_referent',"
        "'project_hub','project_funding')",
    )
    op.create_table(
        "project_hub_projects",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("code", sa.String(48), nullable=False, unique=True),
        sa.Column("title", sa.String(240), nullable=False),
        sa.Column("description", sa.Text(), nullable=False, server_default=""),
        sa.Column(
            "manager_user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("core_users.id"),
            nullable=False,
        ),
        sa.Column("start_date", sa.Date()),
        sa.Column("end_date", sa.Date()),
        sa.Column("budget", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("currency", sa.String(3), nullable=False, server_default="UZS"),
        sa.Column("access_status", sa.String(16), nullable=False, server_default="open"),
        sa.Column("lifecycle_status", sa.String(16), nullable=False, server_default="active"),
        sa.Column(
            "created_by_user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("core_users.id"),
            nullable=False,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("budget >= 0", name="ck_project_hub_budget"),
        sa.CheckConstraint("access_status IN ('open','closed')", name="ck_project_hub_access"),
        sa.CheckConstraint(
            "lifecycle_status IN ('active','completed')", name="ck_project_hub_lifecycle"
        ),
    )
    op.create_table(
        "project_hub_people",
        sa.Column(
            "project_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("project_hub_projects.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("core_users.id"),
            primary_key=True,
        ),
        sa.Column("kind", sa.String(16), primary_key=True),
        sa.Column("sort_order", sa.Integer()),
        sa.CheckConstraint("kind IN ('responsible','approver')", name="ck_project_hub_person_kind"),
        sa.UniqueConstraint(
            "project_id", "kind", "sort_order", name="uq_project_hub_approver_order"
        ),
    )
    op.create_table(
        "project_hub_items",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "project_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("project_hub_projects.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("kind", sa.String(16), nullable=False),
        sa.Column("title", sa.String(240), nullable=False),
        sa.Column("description", sa.Text(), nullable=False, server_default=""),
        sa.Column("starts_at", sa.DateTime(timezone=True)),
        sa.Column("due_at", sa.DateTime(timezone=True)),
        sa.Column("budget", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("status", sa.String(16), nullable=False, server_default="planned"),
        sa.Column(
            "calendar_event_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("calendar_events.id")
        ),
        sa.Column(
            "created_by_user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("core_users.id"),
            nullable=False,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("kind IN ('task','event')", name="ck_project_hub_item_kind"),
        sa.CheckConstraint(
            "status IN ('planned','active','completed','cancelled')",
            name="ck_project_hub_item_status",
        ),
        sa.CheckConstraint("budget >= 0", name="ck_project_hub_item_budget"),
        sa.CheckConstraint(
            "starts_at IS NULL OR due_at IS NULL OR due_at > starts_at",
            name="ck_project_hub_item_dates",
        ),
    )
    op.create_index("ix_project_hub_items_due", "project_hub_items", ["due_at"])
    op.create_table(
        "project_hub_item_assignees",
        sa.Column(
            "item_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("project_hub_items.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("core_users.id"),
            primary_key=True,
        ),
    )
    op.create_table(
        "project_hub_requests",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "project_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("project_hub_projects.id"),
            nullable=False,
        ),
        sa.Column(
            "item_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("project_hub_items.id"),
            nullable=False,
        ),
        sa.Column("title", sa.String(240), nullable=False),
        sa.Column("purpose", sa.Text(), nullable=False, server_default=""),
        sa.Column("amount", sa.BigInteger(), nullable=False),
        sa.Column("currency", sa.String(3), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("approver_ids", postgresql.JSONB(), nullable=False),
        sa.Column("current_step", sa.Integer(), nullable=False, server_default="0"),
        sa.Column(
            "requester_user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("core_users.id"),
            nullable=False,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("amount > 0", name="ck_project_hub_request_amount"),
        sa.CheckConstraint(
            "status IN ('pending','approved','rejected')", name="ck_project_hub_request_status"
        ),
    )
    op.create_index("ix_project_hub_requests_project", "project_hub_requests", ["project_id"])
    op.create_table(
        "project_hub_request_actions",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "request_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("project_hub_requests.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "actor_user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("core_users.id"),
            nullable=False,
        ),
        sa.Column("action", sa.String(16), nullable=False),
        sa.Column("step", sa.Integer(), nullable=False),
        sa.Column("comment", sa.Text()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("project_hub_request_actions")
    op.drop_index("ix_project_hub_requests_project", table_name="project_hub_requests")
    op.drop_table("project_hub_requests")
    op.drop_table("project_hub_item_assignees")
    op.drop_index("ix_project_hub_items_due", table_name="project_hub_items")
    op.drop_table("project_hub_items")
    op.drop_table("project_hub_people")
    op.drop_table("project_hub_projects")
    op.drop_constraint(
        "ck_workspace_notifications_section", "workspace_notifications", type_="check"
    )
    op.create_check_constraint(
        "ck_workspace_notifications_section",
        "workspace_notifications",
        "section IN ('messenger','tasks','payment_requests','trip_approvals',"
        "'calendar','absences','zoom_meetings','hr','team_overview','ai_referent')",
    )
