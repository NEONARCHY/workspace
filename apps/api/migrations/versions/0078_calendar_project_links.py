"""Link calendar meetings and events to project directions and work."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0078_calendar_project_links"
down_revision: str = "0077_referent_incoming_access"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    for name in ("project_id", "workstream_id", "project_item_id"):
        op.add_column(
            "calendar_events",
            sa.Column(name, postgresql.UUID(as_uuid=True), nullable=True),
        )
    op.create_check_constraint(
        "ck_calendar_project_link_hierarchy",
        "calendar_events",
        "(project_id IS NULL AND workstream_id IS NULL AND project_item_id IS NULL) "
        "OR (project_id IS NOT NULL AND workstream_id IS NOT NULL)",
    )
    op.create_index(
        "ix_calendar_events_project_direction",
        "calendar_events",
        ["project_id", "workstream_id"],
    )
    # Events already published from project work keep their existing identity and gain the link.
    op.execute("""
        UPDATE calendar_events AS event
        SET project_id = item.project_id,
            workstream_id = item.workstream_id,
            project_item_id = item.id
        FROM project_hub_items AS item
        WHERE item.calendar_event_id = event.id
    """)


def downgrade() -> None:
    op.drop_index("ix_calendar_events_project_direction", table_name="calendar_events")
    op.drop_constraint("ck_calendar_project_link_hierarchy", "calendar_events", type_="check")
    for name in ("project_item_id", "workstream_id", "project_id"):
        op.drop_column("calendar_events", name)
