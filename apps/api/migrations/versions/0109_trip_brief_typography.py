"""Store safe typography settings for editable trip briefs.

Revision ID: 0109_trip_brief_typography
Revises: 0108_reference_directory
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0109_trip_brief_typography"
down_revision: str = "0108_reference_directory"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("trip_requests", sa.Column(
        "brief_font_size", sa.Integer(), nullable=False, server_default="11"
    ))
    op.add_column("trip_requests", sa.Column(
        "brief_font_weight", sa.String(8), nullable=False, server_default="regular"
    ))
    op.create_check_constraint(
        "ck_trip_brief_font_size", "trip_requests", "brief_font_size BETWEEN 9 AND 14"
    )
    op.create_check_constraint(
        "ck_trip_brief_font_weight", "trip_requests",
        "brief_font_weight IN ('regular', 'bold')",
    )


def downgrade() -> None:
    op.drop_constraint("ck_trip_brief_font_weight", "trip_requests", type_="check")
    op.drop_constraint("ck_trip_brief_font_size", "trip_requests", type_="check")
    op.drop_column("trip_requests", "brief_font_weight")
    op.drop_column("trip_requests", "brief_font_size")
