"""Configurable organization tenure days and editable leave order clauses.

Revision ID: 0106_leave_tenure_order_draft
Revises: 0105_trip_calendar_events
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0106_leave_tenure_order_draft"
down_revision: str = "0105_trip_calendar_events"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("hr_settings", sa.Column("leave_tenure_rules", sa.JSON(), nullable=True))
    op.add_column("leave_requests", sa.Column("tenure_additional_days", sa.SmallInteger()))
    op.add_column("leave_requests", sa.Column("organization_employment_date", sa.Date()))
    for number in (1, 2, 3):
        op.add_column("leave_requests", sa.Column(f"order_clause_{number}", sa.Text()))


def downgrade() -> None:
    for number in (3, 2, 1):
        op.drop_column("leave_requests", f"order_clause_{number}")
    op.drop_column("leave_requests", "organization_employment_date")
    op.drop_column("leave_requests", "tenure_additional_days")
    op.drop_column("hr_settings", "leave_tenure_rules")
