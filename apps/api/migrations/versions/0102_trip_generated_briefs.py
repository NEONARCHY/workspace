"""Record whether a trip brief was generated from structured facts.

Revision ID: 0102_trip_generated_briefs
Revises: 0101_leave_approval
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0102_trip_generated_briefs"
down_revision: str = "0101_leave_approval"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "trip_requests",
        sa.Column("brief_format", sa.String(16), nullable=False, server_default="manual"),
    )
    op.create_check_constraint(
        "ck_trip_requests_brief_format", "trip_requests",
        "brief_format IN ('manual', 'generated')",
    )


def downgrade() -> None:
    connection = op.get_bind()
    if connection.execute(sa.text(
        "SELECT 1 FROM trip_requests WHERE brief_format = 'generated' LIMIT 1"
    )).first():
        raise RuntimeError("Generated trip briefs must be resolved before downgrading")
    op.drop_constraint("ck_trip_requests_brief_format", "trip_requests", type_="check")
    op.drop_column("trip_requests", "brief_format")
