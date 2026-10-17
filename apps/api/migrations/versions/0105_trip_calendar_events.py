"""Link approved trips to all-day calendar events and backfill existing approvals.

Revision ID: 0105_trip_calendar_events
Revises: 0104_trip_edited_briefs
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0105_trip_calendar_events"
down_revision: str = "0104_trip_edited_briefs"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "calendar_events",
        sa.Column("trip_request_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_foreign_key(
        "fk_calendar_events_trip_request", "calendar_events", "trip_requests",
        ["trip_request_id"], ["id"],
    )
    op.create_unique_constraint(
        "uq_calendar_events_trip_request", "calendar_events", ["trip_request_id"],
    )
    op.execute(sa.text("""
        INSERT INTO calendar_events (
            id, trip_request_id, organizer_user_id, title, description,
            event_type, color, icon_key, starts_at, ends_at, all_day,
            location, status, created_at, updated_at
        )
        SELECT gen_random_uuid(), trip.id, trip.requester_user_id,
               left('Командировка · ' || trip.destination, 240),
               CASE WHEN trip.order_number IS NOT NULL
                    THEN 'Приказ № ' || trip.order_number
                    ELSE 'Утверждённая командировка' END,
               'trip', '#0091A8', 'trip',
               trip.start_date::timestamp AT TIME ZONE 'Asia/Tashkent',
               (trip.end_date + 1)::timestamp AT TIME ZONE 'Asia/Tashkent',
               true, trip.destination, 'scheduled',
               coalesce(trip.finished_at, trip.updated_at, trip.created_at),
               coalesce(trip.finished_at, trip.updated_at, trip.created_at)
          FROM trip_requests AS trip
         WHERE trip.status = 'approved' AND trip.deleted_at IS NULL
        ON CONFLICT (trip_request_id) DO NOTHING
    """))
    op.execute(sa.text("""
        INSERT INTO calendar_event_attendees (event_id, user_id, status, responded_at)
        SELECT event.id, traveler.user_id, 'accepted',
               coalesce(trip.finished_at, trip.updated_at, trip.created_at)
          FROM calendar_events AS event
          JOIN trip_requests AS trip ON trip.id = event.trip_request_id
          JOIN trip_request_employees AS traveler ON traveler.request_id = trip.id
         WHERE trip.status = 'approved' AND trip.deleted_at IS NULL
        ON CONFLICT (event_id, user_id) DO NOTHING
    """))


def downgrade() -> None:
    if op.get_bind().execute(sa.text(
        "SELECT 1 FROM calendar_events WHERE trip_request_id IS NOT NULL LIMIT 1"
    )).first():
        raise RuntimeError("Linked trip calendar events must be resolved before downgrading")
    op.drop_constraint("uq_calendar_events_trip_request", "calendar_events", type_="unique")
    op.drop_constraint("fk_calendar_events_trip_request", "calendar_events", type_="foreignkey")
    op.drop_column("calendar_events", "trip_request_id")
