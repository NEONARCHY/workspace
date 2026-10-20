"""Grant preparation, assigned reviewers and append-only business history."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0110_grants_workflow"
down_revision = "0109_trip_brief_typography"
branch_labels = None
depends_on = None

NOTIFICATION_SECTIONS = (
    "'messenger','tasks','payment_requests','trip_approvals','leave_approvals',"
    "'calendar','absences','zoom_meetings','hr','team_overview','ai_referent',"
    "'project_hub','project_funding','ai_hisobot','notifications','feed'"
)


def upgrade() -> None:
    op.drop_constraint(
        "ck_workspace_notifications_section",
        "workspace_notifications",
        type_="check",
    )
    op.create_check_constraint(
        "ck_workspace_notifications_section",
        "workspace_notifications",
        f"section IN ({NOTIFICATION_SECTIONS},'grants')",
    )
    uid = postgresql.UUID(as_uuid=True)
    op.create_table(
        "grant_settings",
        sa.Column("id", sa.SmallInteger(), primary_key=True),
        sa.Column("leader_user_id", uid, sa.ForeignKey("core_users.id"), nullable=False),
        sa.Column("chair_user_id", uid, sa.ForeignKey("core_users.id"), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("updated_by_user_id", uid, sa.ForeignKey("core_users.id"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("id = 1", name="ck_grant_settings_singleton"),
    )
    op.create_table(
        "grant_requests",
        sa.Column("id", uid, primary_key=True),
        sa.Column("creation_hash", sa.String(64), nullable=False),
        sa.Column("title", sa.String(240), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("author_user_id", uid, sa.ForeignKey("core_users.id"), nullable=False),
        sa.Column("assignee_id", uid, sa.ForeignKey("core_users.id"), nullable=False),
        sa.Column("co_assignee_ids", postgresql.JSONB(), nullable=False),
        sa.Column("leader_user_id", uid, sa.ForeignKey("core_users.id"), nullable=False),
        sa.Column("chair_user_id", uid, sa.ForeignKey("core_users.id"), nullable=False),
        sa.Column("due_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("status", sa.String(24), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("checklist", postgresql.JSONB(), nullable=False),
        sa.Column("result_text", sa.Text(), nullable=False),
        sa.Column("chat_id", uid, sa.ForeignKey("messenger_chats.id")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "status IN ('in_progress','needs_revision','author_review',"
            "'leader_review','chair_review','completed')",
            name="ck_grant_status",
        ),
        sa.CheckConstraint("revision >= 1", name="ck_grant_revision"),
    )
    for field in ("author_user_id", "assignee_id", "leader_user_id", "chair_user_id", "status"):
        op.create_index(f"ix_grant_requests_{field}", "grant_requests", [field])
    op.create_table(
        "grant_events",
        sa.Column("id", uid, primary_key=True),
        sa.Column("grant_id", uid, sa.ForeignKey("grant_requests.id"), nullable=False),
        sa.Column("actor_user_id", uid, sa.ForeignKey("core_users.id"), nullable=False),
        sa.Column("action", sa.String(32), nullable=False),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("from_status", sa.String(24), nullable=False),
        sa.Column("to_status", sa.String(24), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_grant_events_grant_time", "grant_events", ["grant_id", "created_at"])
    op.drop_constraint(
        "ck_workspace_attachments_owner_type",
        "workspace_attachments",
        type_="check",
    )
    op.create_check_constraint(
        "ck_workspace_attachments_owner_type",
        "workspace_attachments",
        "owner_type IN ('message','task','approval_request','absence',"
        "'ai_referent_letter','project_funding_request','grant')",
    )


def downgrade() -> None:
    if op.get_bind().scalar(sa.text("SELECT EXISTS(SELECT 1 FROM grant_requests)")):
        raise RuntimeError("Preserve grant records before downgrading this migration")
    op.drop_constraint(
        "ck_workspace_notifications_section",
        "workspace_notifications",
        type_="check",
    )
    op.create_check_constraint(
        "ck_workspace_notifications_section",
        "workspace_notifications",
        f"section IN ({NOTIFICATION_SECTIONS})",
    )
    op.drop_constraint(
        "ck_workspace_attachments_owner_type",
        "workspace_attachments",
        type_="check",
    )
    op.create_check_constraint(
        "ck_workspace_attachments_owner_type",
        "workspace_attachments",
        "owner_type IN ('message','task','approval_request','absence',"
        "'ai_referent_letter','project_funding_request')",
    )
    op.drop_table("grant_events")
    op.drop_table("grant_requests")
    op.drop_table("grant_settings")
