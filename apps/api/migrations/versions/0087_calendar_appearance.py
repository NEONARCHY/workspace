"""Persist a bounded calendar palette and stock event icon."""

import sqlalchemy as sa
from alembic import op

revision = "0087_calendar_appearance"
down_revision = "0086_system_feed_deletion"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("calendar_events", sa.Column("color", sa.String(7)))
    op.add_column("calendar_events", sa.Column("icon_key", sa.String(24)))
    op.create_check_constraint(
        "ck_calendar_event_color", "calendar_events", "color IS NULL OR color ~ '^#[0-9A-Fa-f]{6}$'"
    )


def downgrade() -> None:
    op.drop_constraint("ck_calendar_event_color", "calendar_events", type_="check")
    op.drop_column("calendar_events", "icon_key")
    op.drop_column("calendar_events", "color")
