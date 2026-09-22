"""Add invitation decisions and safe availability checks to calendar events.

Revision ID: 0047_calendar_collaboration
Revises: 0046_ai_referent_reviewers
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0047_calendar_collaboration"
down_revision: str | None = "0046_ai_referent_reviewers"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("tasks", sa.Column("calendar_event_id", sa.UUID(), nullable=True))
    op.create_index("ix_tasks_calendar_event", "tasks", ["calendar_event_id"])
    op.add_column("approval_requests", sa.Column("calendar_event_id", sa.UUID(), nullable=True))
    op.create_index(
        "ix_approval_requests_calendar_event", "approval_requests", ["calendar_event_id"]
    )
    op.add_column(
        "calendar_event_attendees",
        sa.Column("status", sa.String(16), nullable=False, server_default="accepted"),
    )
    op.add_column(
        "calendar_event_attendees",
        sa.Column("responded_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_check_constraint(
        "ck_calendar_attendee_status",
        "calendar_event_attendees",
        "status IN ('pending', 'accepted', 'declined')",
    )
    op.create_index(
        "ix_calendar_attendees_user_status",
        "calendar_event_attendees",
        ["user_id", "status"],
    )


def downgrade() -> None:
    op.drop_index("ix_calendar_attendees_user_status", table_name="calendar_event_attendees")
    op.drop_constraint(
        "ck_calendar_attendee_status", "calendar_event_attendees", type_="check"
    )
    op.drop_column("calendar_event_attendees", "responded_at")
    op.drop_column("calendar_event_attendees", "status")
    op.drop_index("ix_approval_requests_calendar_event", table_name="approval_requests")
    op.drop_column("approval_requests", "calendar_event_id")
    op.drop_index("ix_tasks_calendar_event", table_name="tasks")
    op.drop_column("tasks", "calendar_event_id")
