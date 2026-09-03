"""Add projects and trip approvals.

Revision ID: 0013_projects_trips
Revises: 0012_latin_positions
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0013_projects_trips"
down_revision: str | None = "0012_latin_positions"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "workspace_projects",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("code", sa.String(length=48), nullable=False),
        sa.Column("title", sa.String(length=240), nullable=False),
        sa.Column("description", sa.Text(), nullable=False, server_default=""),
        sa.Column(
            "manager_user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("core_users.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("start_date", sa.Date(), nullable=True),
        sa.Column("end_date", sa.Date(), nullable=True),
        sa.Column("budget", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("spent_budget", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("currency", sa.String(length=3), nullable=False, server_default="UZS"),
        sa.Column("status", sa.String(length=24), nullable=False, server_default="new"),
        sa.Column("stage", sa.String(length=24), nullable=False, server_default="start"),
        sa.Column(
            "created_by_user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("core_users.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("budget >= 0", name="ck_workspace_projects_budget"),
        sa.CheckConstraint(
            "spent_budget >= 0 AND spent_budget <= budget",
            name="ck_workspace_projects_spent_budget",
        ),
        sa.CheckConstraint("currency IN ('UZS', 'USD', 'EUR')", name="ck_projects_currency"),
        sa.CheckConstraint(
            "status IN ('new', 'in_progress', 'completed')",
            name="ck_workspace_projects_status",
        ),
        sa.CheckConstraint(
            "stage IN ('start', 'preparation', 'approval', 'success', 'failure')",
            name="ck_workspace_projects_stage",
        ),
        sa.CheckConstraint(
            "end_date IS NULL OR start_date IS NULL OR end_date >= start_date",
            name="ck_workspace_projects_dates",
        ),
        sa.UniqueConstraint("code", name="uq_workspace_projects_code"),
    )
    op.create_index("ix_workspace_projects_stage", "workspace_projects", ["stage"])
    op.create_index("ix_workspace_projects_manager", "workspace_projects", ["manager_user_id"])
    op.create_table(
        "project_stage_actions",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "project_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("workspace_projects.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "actor_user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("core_users.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("from_stage", sa.String(length=24), nullable=True),
        sa.Column("to_stage", sa.String(length=24), nullable=False),
        sa.Column("action", sa.String(length=24), nullable=False),
        sa.Column("comment", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("action IN ('created', 'moved')", name="ck_project_actions_action"),
    )
    op.create_index(
        "ix_project_stage_actions_project_created",
        "project_stage_actions",
        ["project_id", "created_at"],
    )
    op.create_table(
        "trip_requests",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "requester_user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("core_users.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("purpose", sa.Text(), nullable=False),
        sa.Column("destination", sa.String(length=240), nullable=False),
        sa.Column("start_date", sa.Date(), nullable=False),
        sa.Column("end_date", sa.Date(), nullable=False),
        sa.Column("stage", sa.String(length=32), nullable=False, server_default="launch"),
        sa.Column("status", sa.String(length=24), nullable=False, server_default="draft"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "stage IN ('launch', 'manager_approval', 'hr', 'approved', 'rejected')",
            name="ck_trip_requests_stage",
        ),
        sa.CheckConstraint(
            "status IN ('draft', 'running', 'needs_revision', 'approved', 'rejected')",
            name="ck_trip_requests_status",
        ),
        sa.CheckConstraint("end_date >= start_date", name="ck_trip_requests_dates"),
    )
    op.create_index("ix_trip_requests_stage", "trip_requests", ["stage"])
    op.create_index("ix_trip_requests_requester", "trip_requests", ["requester_user_id"])
    op.create_table(
        "trip_request_employees",
        sa.Column(
            "request_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("trip_requests.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("core_users.id", ondelete="RESTRICT"),
            primary_key=True,
        ),
    )
    op.create_index("ix_trip_request_employees_user", "trip_request_employees", ["user_id"])
    op.create_table(
        "trip_request_actions",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "request_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("trip_requests.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "actor_user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("core_users.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("from_stage", sa.String(length=32), nullable=True),
        sa.Column("to_stage", sa.String(length=32), nullable=False),
        sa.Column("action", sa.String(length=24), nullable=False),
        sa.Column("comment", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "action IN ('created', 'submit', 'approve', 'return', 'reject', 'resubmit')",
            name="ck_trip_request_actions_action",
        ),
    )
    op.create_index(
        "ix_trip_request_actions_request_created",
        "trip_request_actions",
        ["request_id", "created_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_trip_request_actions_request_created", table_name="trip_request_actions")
    op.drop_table("trip_request_actions")
    op.drop_index("ix_trip_request_employees_user", table_name="trip_request_employees")
    op.drop_table("trip_request_employees")
    op.drop_index("ix_trip_requests_requester", table_name="trip_requests")
    op.drop_index("ix_trip_requests_stage", table_name="trip_requests")
    op.drop_table("trip_requests")
    op.drop_index("ix_project_stage_actions_project_created", table_name="project_stage_actions")
    op.drop_table("project_stage_actions")
    op.drop_index("ix_workspace_projects_manager", table_name="workspace_projects")
    op.drop_index("ix_workspace_projects_stage", table_name="workspace_projects")
    op.drop_table("workspace_projects")
