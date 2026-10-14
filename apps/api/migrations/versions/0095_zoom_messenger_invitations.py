"""Personal Zoom invitations and durable per-attendee delivery state."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0095_zoom_messenger_invitations"
down_revision: str | None = "0094_notification_volume_default"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("messenger_messages", sa.Column("zoom_meeting_id", postgresql.UUID()))
    op.create_foreign_key(
        "fk_message_zoom_meeting", "messenger_messages", "zoom_meetings",
        ["zoom_meeting_id"], ["id"], ondelete="SET NULL",
    )
    op.create_index("ix_message_zoom_meeting", "messenger_messages", ["zoom_meeting_id"])
    op.add_column("zoom_meetings", sa.Column(
        "messenger_invitations_enabled", sa.Boolean(), nullable=False, server_default=sa.false(),
    ))
    op.add_column("zoom_meeting_participants", sa.Column(
        "response", sa.String(16), nullable=False, server_default="pending",
    ))
    op.create_check_constraint(
        "ck_zoom_participant_response", "zoom_meeting_participants",
        "response IN ('pending', 'accepted', 'declined')",
    )
    op.add_column("zoom_meeting_participants", sa.Column(
        "invitation_message_id", postgresql.UUID(),
    ))
    op.create_foreign_key(
        "fk_zoom_participant_invitation", "zoom_meeting_participants", "messenger_messages",
        ["invitation_message_id"], ["id"], ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint("fk_zoom_participant_invitation", "zoom_meeting_participants")
    op.drop_column("zoom_meeting_participants", "invitation_message_id")
    op.drop_constraint("ck_zoom_participant_response", "zoom_meeting_participants")
    op.drop_column("zoom_meeting_participants", "response")
    op.drop_column("zoom_meetings", "messenger_invitations_enabled")
    op.drop_index("ix_message_zoom_meeting", "messenger_messages")
    op.drop_constraint("fk_message_zoom_meeting", "messenger_messages")
    op.drop_column("messenger_messages", "zoom_meeting_id")
