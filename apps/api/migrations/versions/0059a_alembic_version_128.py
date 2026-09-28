"""Allow descriptive migration IDs beyond Alembic's default 32 characters."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0059a_alembic_version_128"
down_revision: str = "0059_project_workstream_details"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.alter_column(
        "alembic_version", "version_num",
        existing_type=sa.String(32), type_=sa.String(128),
        existing_nullable=False,
    )


def downgrade() -> None:
    op.alter_column(
        "alembic_version", "version_num",
        existing_type=sa.String(128), type_=sa.String(32),
        existing_nullable=False,
    )
