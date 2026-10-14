"""Default new employees' notification volume to 100 percent.

Existing saved preferences are deliberately preserved.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0094_notification_volume_default"
down_revision: str | None = "0093_approval_request_edit_action"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.alter_column(
        "workspace_notification_preferences",
        "sound_volume",
        existing_type=sa.SmallInteger(),
        existing_nullable=False,
        server_default="100",
    )


def downgrade() -> None:
    op.alter_column(
        "workspace_notification_preferences",
        "sound_volume",
        existing_type=sa.SmallInteger(),
        existing_nullable=False,
        server_default="20",
    )
