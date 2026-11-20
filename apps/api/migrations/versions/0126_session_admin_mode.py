"""Allow administrators to suspend privileges in their own session."""

import sqlalchemy as sa
from alembic import op

revision = "0126_session_admin_mode"
down_revision = "0125_trip_order_revisions"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("auth_sessions", sa.Column(
        "admin_mode_enabled", sa.Boolean(), nullable=False, server_default=sa.true(),
    ))


def downgrade() -> None:
    op.drop_column("auth_sessions", "admin_mode_enabled")
