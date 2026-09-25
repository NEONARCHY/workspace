"""Group project work and add deadlines and files to project funding."""

from collections.abc import Sequence
from datetime import UTC, datetime
from uuid import uuid4

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0057_project_workstreams"
down_revision: str | None = "0056_project_hub"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "project_hub_workstreams",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "project_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("project_hub_projects.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("title", sa.String(240), nullable=False),
        sa.Column("description", sa.Text(), nullable=False, server_default=""),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column(
            "created_by_user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("core_users.id"),
            nullable=False,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("project_id", "title", name="uq_project_hub_workstream_title"),
    )
    op.create_index(
        "ix_project_hub_workstreams_project",
        "project_hub_workstreams",
        ["project_id", "sort_order"],
    )
    op.add_column(
        "project_hub_items",
        sa.Column("workstream_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    connection = op.get_bind()
    project_ids = connection.execute(
        sa.text("SELECT DISTINCT project_id FROM project_hub_items")
    ).scalars().all()
    now = datetime.now(UTC)
    for project_id in project_ids:
        workstream_id = uuid4()
        connection.execute(
            sa.text(
                """INSERT INTO project_hub_workstreams
                   (id, project_id, title, description, sort_order, created_by_user_id,
                    created_at, updated_at)
                   SELECT :id, id, 'Ранее добавленные работы', '', 0, manager_user_id,
                          :created_at, :updated_at
                   FROM project_hub_projects WHERE id = :project_id"""
            ),
            {
                "id": workstream_id,
                "project_id": project_id,
                "created_at": now,
                "updated_at": now,
            },
        )
        connection.execute(
            sa.text(
                "UPDATE project_hub_items SET workstream_id = :workstream_id "
                "WHERE project_id = :project_id"
            ),
            {"workstream_id": workstream_id, "project_id": project_id},
        )
    op.alter_column("project_hub_items", "workstream_id", nullable=False)
    op.create_foreign_key(
        "fk_project_hub_items_workstream",
        "project_hub_items",
        "project_hub_workstreams",
        ["workstream_id"],
        ["id"],
    )
    op.create_index(
        "ix_project_hub_items_workstream", "project_hub_items", ["workstream_id"]
    )
    op.add_column(
        "project_hub_requests", sa.Column("approval_due_at", sa.DateTime(timezone=True))
    )
    op.drop_constraint(
        "ck_workspace_attachments_owner_type", "workspace_attachments", type_="check"
    )
    op.create_check_constraint(
        "ck_workspace_attachments_owner_type",
        "workspace_attachments",
        "owner_type IN ('message','task','approval_request','absence',"
        "'ai_referent_letter','project_funding_request')",
    )


def downgrade() -> None:
    connection = op.get_bind()
    has_new_work = connection.scalar(
        sa.text(
            "SELECT EXISTS (SELECT 1 FROM project_hub_workstreams "
            "WHERE title <> 'Ранее добавленные работы')"
        )
    )
    has_deadlines = connection.scalar(
        sa.text(
            "SELECT EXISTS (SELECT 1 FROM project_hub_requests "
            "WHERE approval_due_at IS NOT NULL)"
        )
    )
    if has_new_work or has_deadlines:
        raise RuntimeError("Export project directions and approval deadlines before downgrading")
    has_files = connection.scalar(
        sa.text(
            "SELECT EXISTS (SELECT 1 FROM workspace_attachments "
            "WHERE owner_type = 'project_funding_request')"
        )
    )
    if has_files:
        raise RuntimeError("Export project funding attachments before downgrading")
    op.drop_constraint(
        "ck_workspace_attachments_owner_type", "workspace_attachments", type_="check"
    )
    op.create_check_constraint(
        "ck_workspace_attachments_owner_type",
        "workspace_attachments",
        "owner_type IN ('message','task','approval_request','absence','ai_referent_letter')",
    )
    op.drop_column("project_hub_requests", "approval_due_at")
    op.drop_index("ix_project_hub_items_workstream", table_name="project_hub_items")
    op.drop_constraint(
        "fk_project_hub_items_workstream", "project_hub_items", type_="foreignkey"
    )
    op.drop_column("project_hub_items", "workstream_id")
    op.drop_index(
        "ix_project_hub_workstreams_project", table_name="project_hub_workstreams"
    )
    op.drop_table("project_hub_workstreams")
