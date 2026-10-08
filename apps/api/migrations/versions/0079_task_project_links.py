"""Optionally link ordinary tasks to current projects."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0079_task_project_links"
down_revision: str = "0078_calendar_project_links"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.alter_column("tasks", "project_key", type_=sa.String(240), existing_type=sa.String(96))
    op.add_column("tasks", sa.Column("project_hub_project_id", postgresql.UUID(as_uuid=True)))
    op.create_foreign_key(
        "fk_tasks_project_hub_project",
        "tasks",
        "project_hub_projects",
        ["project_hub_project_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index("ix_tasks_project_hub_project", "tasks", ["project_hub_project_id"])


def downgrade() -> None:
    op.execute("""
        DO $$ BEGIN
          IF EXISTS (SELECT 1 FROM tasks WHERE length(project_key) > 96) THEN
            RAISE EXCEPTION 'Cannot narrow task project labels without losing data';
          END IF;
        END $$;
    """)
    op.drop_index("ix_tasks_project_hub_project", table_name="tasks")
    op.drop_constraint("fk_tasks_project_hub_project", "tasks", type_="foreignkey")
    op.drop_column("tasks", "project_hub_project_id")
    op.alter_column("tasks", "project_key", type_=sa.String(96), existing_type=sa.String(240))
