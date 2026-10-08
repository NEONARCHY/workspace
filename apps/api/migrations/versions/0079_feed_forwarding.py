"""Structured forwarding and individually controllable feed notification sounds."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0079_feed_forwarding"
down_revision = "0078_calendar_project_links"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("messenger_messages", sa.Column("forwarded", postgresql.JSONB()))
    op.add_column(
        "workspace_notification_preferences",
        sa.Column(
            "feed_enabled",
            sa.Boolean(),
            nullable=False,
            server_default=sa.true(),
        ),
    )
    op.add_column(
        "workspace_notification_preferences",
        sa.Column(
            "sound_enabled",
            sa.Boolean(),
            nullable=False,
            server_default=sa.true(),
        ),
    )
    op.add_column(
        "workspace_notification_preferences",
        sa.Column(
            "sound_volume",
            sa.SmallInteger(),
            nullable=False,
            server_default="20",
        ),
    )
    op.create_check_constraint(
        "ck_notification_sound_volume",
        "workspace_notification_preferences",
        "sound_volume BETWEEN 0 AND 100",
    )
    op.drop_constraint("ck_workspace_notifications_kind", "workspace_notifications", type_="check")
    op.create_check_constraint(
        "ck_workspace_notifications_kind",
        "workspace_notifications",
        "kind IN ('message','task','approval','trip','calendar','absence','zoom',"
        "'hisobot','support','birthday','feed')",
    )


def downgrade() -> None:
    op.execute("DELETE FROM workspace_notifications WHERE kind = 'feed'")
    op.drop_constraint("ck_workspace_notifications_kind", "workspace_notifications", type_="check")
    op.create_check_constraint(
        "ck_workspace_notifications_kind",
        "workspace_notifications",
        "kind IN ('message','task','approval','trip','calendar','absence','zoom',"
        "'hisobot','support','birthday')",
    )
    op.drop_constraint(
        "ck_notification_sound_volume", "workspace_notification_preferences", type_="check"
    )
    for column in ("sound_volume", "sound_enabled", "feed_enabled"):
        op.drop_column("workspace_notification_preferences", column)
    op.drop_column("messenger_messages", "forwarded")
