"""Preserve legacy grants and require the chairman's launch decision for new grants."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0113_grant_launch_approval"
down_revision = "0112_hisobot_activity_drafts"
branch_labels = None
depends_on = None


def upgrade() -> None:
    uid = postgresql.UUID(as_uuid=True)
    op.add_column("grant_requests", sa.Column("initiator_user_id", uid))
    op.execute("UPDATE grant_requests SET initiator_user_id = author_user_id")
    op.alter_column("grant_requests", "initiator_user_id", nullable=False)
    op.create_foreign_key(
        "fk_grant_initiator", "grant_requests", "core_users", ["initiator_user_id"], ["id"]
    )
    op.create_index("ix_grant_requests_initiator_user_id", "grant_requests", ["initiator_user_id"])
    op.add_column(
        "grant_requests",
        sa.Column("workflow_version", sa.SmallInteger(), nullable=False, server_default="1"),
    )
    op.add_column("grant_requests", sa.Column("launch_approved_at", sa.DateTime(timezone=True)))
    op.add_column(
        "grant_requests",
        sa.Column("launch_approved_by_user_id", uid, sa.ForeignKey("core_users.id")),
    )
    op.alter_column("grant_requests", "author_user_id", existing_type=uid, nullable=True)
    op.drop_constraint("ck_grant_status", "grant_requests", type_="check")
    op.create_check_constraint(
        "ck_grant_status", "grant_requests",
        "status IN ('launch_review','launch_revision','launch_rejected','in_progress',"
        "'needs_revision','author_review','leader_review','chair_review','completed')",
    )
    op.create_check_constraint(
        "ck_grant_workflow_version", "grant_requests", "workflow_version IN (1,2)"
    )
    op.create_check_constraint(
        "ck_grant_launch_owner", "grant_requests",
        "(workflow_version = 1 AND author_user_id IS NOT NULL) OR (workflow_version = 2 AND ("
        "(status IN ('launch_review','launch_revision','launch_rejected') "
        "AND author_user_id IS NULL "
        "AND launch_approved_at IS NULL AND launch_approved_by_user_id IS NULL) OR "
        "(status IN ('in_progress','needs_revision','leader_review','chair_review','completed') "
        "AND author_user_id = chair_user_id AND author_user_id IS NOT NULL "
        "AND launch_approved_at IS NOT NULL AND launch_approved_by_user_id IS NOT NULL)))",
    )


def downgrade() -> None:
    raise RuntimeError(
        "Grant initiators and launch decisions must be preserved; downgrade is disabled"
    )
