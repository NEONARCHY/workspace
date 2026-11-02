"""Private free-text memoranda to the chair, with immutable submitted PDFs."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

revision = "0117_chairman_memoranda"
down_revision = "0116_account_release_reads"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_constraint(
        "ck_workspace_notifications_section", "workspace_notifications", type_="check"
    )
    op.create_check_constraint(
        "ck_workspace_notifications_section",
        "workspace_notifications",
        "section IN ('messenger','tasks','payment_requests','trip_approvals','leave_approvals',"
        "'calendar','absences','zoom_meetings','hr','team_overview','ai_referent','project_hub',"
        "'project_funding','ai_hisobot','notifications','feed','grants','home')",
    )
    op.create_table(
        "chairman_memoranda",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "requester_user_id", UUID(as_uuid=True), sa.ForeignKey("core_users.id"), nullable=False
        ),
        sa.Column(
            "chair_user_id", UUID(as_uuid=True), sa.ForeignKey("core_users.id"), nullable=False
        ),
        sa.Column("title", sa.String(160), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("status", sa.String(24), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("requester_name", sa.String(200), nullable=False),
        sa.Column("requester_title", sa.String(240), nullable=False),
        sa.Column("chair_name", sa.String(200), nullable=False),
        sa.Column("decision_comment", sa.Text(), nullable=False),
        sa.Column("pdf_content", sa.LargeBinary()),
        sa.Column("pdf_sha256", sa.String(64)),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("submitted_at", sa.DateTime(timezone=True)),
        sa.Column("decided_at", sa.DateTime(timezone=True)),
        sa.CheckConstraint(
            "status IN ('draft','pending','approved','needs_revision')",
            name="ck_chairman_memo_status",
        ),
        sa.CheckConstraint("revision > 0", name="ck_chairman_memo_revision"),
        sa.CheckConstraint("requester_user_id <> chair_user_id", name="ck_chairman_memo_no_self"),
    )
    op.create_index(
        "ix_chairman_memo_owner", "chairman_memoranda", ["requester_user_id", "created_at"]
    )
    op.create_index("ix_chairman_memo_inbox", "chairman_memoranda", ["chair_user_id", "status"])


def downgrade() -> None:
    raise RuntimeError(
        "Preserve memoranda and approved documents when rolling back the application"
    )
