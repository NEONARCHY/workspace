"""Allow employee-reviewed edits to generated trip briefs.

Revision ID: 0104_trip_edited_briefs
Revises: 0103_trip_generated_briefs
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0104_trip_edited_briefs"
down_revision: str = "0103_trip_generated_briefs"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_constraint("ck_trip_requests_brief_format", "trip_requests", type_="check")
    op.create_check_constraint(
        "ck_trip_requests_brief_format", "trip_requests",
        "brief_format IN ('manual', 'generated', 'edited')",
    )


def downgrade() -> None:
    connection = op.get_bind()
    if connection.execute(sa.text(
        "SELECT 1 FROM trip_requests WHERE brief_format = 'edited' LIMIT 1"
    )).first():
        raise RuntimeError("Edited trip briefs must be resolved before downgrading")
    op.drop_constraint("ck_trip_requests_brief_format", "trip_requests", type_="check")
    op.create_check_constraint(
        "ck_trip_requests_brief_format", "trip_requests",
        "brief_format IN ('manual', 'generated')",
    )
