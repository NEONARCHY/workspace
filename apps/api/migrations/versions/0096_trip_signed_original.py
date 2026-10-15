"""Allow the requester to confirm a signature already present on the original brief."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0096_trip_signed_original"
down_revision: str | None = "0095_zoom_messenger_invitations"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("trip_requests", sa.Column("brief_attachment_size", sa.Integer()))
    op.add_column("trip_requests", sa.Column(
        "original_signature_confirmed_at", sa.DateTime(timezone=True),
    ))


def downgrade() -> None:
    op.drop_column("trip_requests", "original_signature_confirmed_at")
    op.drop_column("trip_requests", "brief_attachment_size")
