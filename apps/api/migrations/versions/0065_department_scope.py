"""Classify central and regional departments for employee directories."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0065_department_scope"
down_revision: str | None = "0064_assistant_and_birthdays"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "core_departments",
        sa.Column("scope", sa.String(16), server_default="central", nullable=False),
    )
    op.execute(
        "UPDATE core_departments SET scope = 'regional' "
        "WHERE lower(name) LIKE '%hududiy bo%' OR lower(name) LIKE '%ҳудудий бў%'"
    )
    op.create_check_constraint(
        "ck_core_departments_scope", "core_departments", "scope IN ('central', 'regional')"
    )


def downgrade() -> None:
    op.drop_constraint("ck_core_departments_scope", "core_departments", type_="check")
    op.drop_column("core_departments", "scope")
