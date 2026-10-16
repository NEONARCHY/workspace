"""Add a separate, auditable leave approval route without changing legacy absences.

Revision ID: 0101_leave_approval
Revises: 0100_messenger_rich_text
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

revision: str = "0101_leave_approval"
down_revision: str = "0100_messenger_rich_text"
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
        "'leave_approvals','calendar','absences','zoom_meetings','hr',"
        "'team_overview','ai_referent','project_hub','project_funding',"
        "'ai_hisobot','notifications','feed')",
    )
    op.create_table(
        "leave_requests",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("requester_user_id", UUID(as_uuid=True), nullable=False),
        sa.Column("application_text", sa.Text(), nullable=False),
        sa.Column("application_key", sa.String(240), nullable=False),
        sa.Column("application_sha256", sa.String(64), nullable=False),
        sa.Column("requested_starts_on", sa.Date(), nullable=False),
        sa.Column("requested_ends_on", sa.Date()),
        sa.Column("starts_on", sa.Date()),
        sa.Column("ends_on", sa.Date()),
        sa.Column("work_year_starts_on", sa.Date()),
        sa.Column("work_year_ends_on", sa.Date()),
        sa.Column("calendar_days", sa.SmallInteger()),
        sa.Column("paid_days", sa.SmallInteger()),
        sa.Column("return_on", sa.Date()),
        sa.Column("accounting_officer", sa.String(200)),
        sa.Column("order_employee_name", sa.String(200)),
        sa.Column("order_job_title", sa.String(240)),
        sa.Column("order_signer_name", sa.String(200)),
        sa.Column("status", sa.String(24), nullable=False),
        sa.Column("order_number", sa.String(40)),
        sa.Column("order_year", sa.Integer()),
        sa.Column("order_key", sa.String(240)),
        sa.Column("order_sha256", sa.String(64)),
        sa.Column("signed_by_user_id", UUID(as_uuid=True)),
        sa.Column("approved_at", sa.DateTime(timezone=True)),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "requested_ends_on IS NULL OR requested_ends_on >= requested_starts_on",
            name="ck_leave_requested_period",
        ),
        sa.CheckConstraint(
            "(starts_on IS NULL AND ends_on IS NULL) OR "
            "(starts_on IS NOT NULL AND ends_on >= starts_on)",
            name="ck_leave_period",
        ),
        sa.CheckConstraint(
            "(work_year_starts_on IS NULL AND work_year_ends_on IS NULL) OR "
            "(work_year_starts_on IS NOT NULL AND "
            "work_year_ends_on >= work_year_starts_on)",
            name="ck_leave_work_year",
        ),
        sa.CheckConstraint("paid_days IS NULL OR paid_days > 0", name="ck_leave_paid_days"),
        sa.CheckConstraint(
            "calendar_days IS NULL OR calendar_days > 0", name="ck_leave_calendar_days"
        ),
        sa.CheckConstraint(
            "status IN ('pending_hr', 'pending_deputy', 'needs_revision', "
            "'approved', 'rejected', 'withdrawn')",
            name="ck_leave_status",
        ),
        sa.CheckConstraint(
            "(order_number IS NULL AND order_year IS NULL) OR "
            "(order_number IS NOT NULL AND order_year IS NOT NULL)",
            name="ck_leave_order_identity",
        ),
        sa.CheckConstraint(
            "status <> 'approved' OR "
            "(starts_on IS NOT NULL AND ends_on IS NOT NULL AND "
            "work_year_starts_on IS NOT NULL AND work_year_ends_on IS NOT NULL AND "
            "calendar_days IS NOT NULL AND paid_days IS NOT NULL AND "
            "return_on IS NOT NULL AND "
            "order_employee_name IS NOT NULL AND order_job_title IS NOT NULL AND "
            "order_signer_name IS NOT NULL AND "
            "order_key IS NOT NULL AND order_sha256 IS NOT NULL AND "
            "signed_by_user_id IS NOT NULL AND approved_at IS NOT NULL)",
            name="ck_leave_approved_document",
        ),
    )
    op.create_index("ix_leave_requester", "leave_requests", ["requester_user_id"])
    op.create_index("ix_leave_status_updated", "leave_requests", ["status", "updated_at"])
    op.create_index(
        "uq_leave_order_number",
        "leave_requests",
        ["order_year", "order_number"],
        unique=True,
        postgresql_where=sa.text("order_number IS NOT NULL"),
    )
    op.create_table(
        "leave_request_actions",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("request_id", UUID(as_uuid=True), nullable=False),
        sa.Column("actor_user_id", UUID(as_uuid=True), nullable=False),
        sa.Column("from_status", sa.String(24)),
        sa.Column("to_status", sa.String(24), nullable=False),
        sa.Column("action", sa.String(24), nullable=False),
        sa.Column("comment", sa.Text()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["request_id"], ["leave_requests.id"], ondelete="CASCADE"),
    )
    op.create_index(
        "ix_leave_actions_request", "leave_request_actions", ["request_id", "created_at"]
    )


def downgrade() -> None:
    connection = op.get_bind()
    if connection.execute(sa.text("SELECT 1 FROM leave_requests LIMIT 1")).first():
        raise RuntimeError("Resolve leave requests before downgrading")
    op.execute("DELETE FROM workspace_notifications WHERE section = 'leave_approvals'")
    op.drop_index("ix_leave_actions_request", table_name="leave_request_actions")
    op.drop_table("leave_request_actions")
    op.drop_index("uq_leave_order_number", table_name="leave_requests")
    op.drop_index("ix_leave_status_updated", table_name="leave_requests")
    op.drop_index("ix_leave_requester", table_name="leave_requests")
    op.drop_table("leave_requests")
    op.drop_constraint(
        "ck_workspace_notifications_section", "workspace_notifications", type_="check"
    )
    op.create_check_constraint(
        "ck_workspace_notifications_section",
        "workspace_notifications",
        "section IN ('messenger','tasks','payment_requests','trip_approvals',"
        "'calendar','absences','zoom_meetings','hr','team_overview','ai_referent',"
        "'project_hub','project_funding','ai_hisobot','notifications','feed')",
    )
