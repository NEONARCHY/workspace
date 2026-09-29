"""Store a controlled vector icon choice for departments."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0069_department_icons"
down_revision: str | None = "0068_task_review_efficiency"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "core_departments",
        sa.Column("icon_key", sa.String(32), server_default="building", nullable=False),
    )
    op.create_check_constraint(
        "ck_core_departments_icon_key", "core_departments",
        "icon_key IN ('building', 'team', 'briefcase', 'document', 'globe', 'finance')",
    )


def downgrade() -> None:
    op.drop_constraint("ck_core_departments_icon_key", "core_departments", type_="check")
    op.drop_column("core_departments", "icon_key")
