"""Add first-deputy approval stage for newly created trips.

Revision ID: 0097_trip_deputy_approval
Revises: 0096_trip_signed_original
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0097_trip_deputy_approval"
down_revision: str = "0096_trip_signed_original"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_constraint("ck_trip_requests_stage", "trip_requests", type_="check")
    op.create_check_constraint(
        "ck_trip_requests_stage", "trip_requests",
        "stage IN ('launch', 'deputy_approval', 'manager_approval', 'hr', 'approved', 'rejected')",
    )


def downgrade() -> None:
    # A downgrade cannot silently discard requests awaiting the deputy.
    connection = op.get_bind()
    pending = connection.execute(sa.text(
        "SELECT 1 FROM trip_requests WHERE stage = 'deputy_approval' LIMIT 1"
    )).first()
    if pending:
        raise RuntimeError("Resolve deputy approvals before downgrading")
    op.drop_constraint("ck_trip_requests_stage", "trip_requests", type_="check")
    op.create_check_constraint(
        "ck_trip_requests_stage", "trip_requests",
        "stage IN ('launch', 'manager_approval', 'hr', 'approved', 'rejected')",
    )
