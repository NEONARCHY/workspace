"""Store user-facing notes with desktop releases.

Revision ID: 0035_desktop_release_notes
Revises: 0034_trip_admin_stage_move
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0035_desktop_release_notes"
down_revision: str | None = "0034_trip_admin_stage_move"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "workspace_update_releases",
        sa.Column("title", sa.String(120), nullable=False, server_default="Обновление Yuksalish"),
    )
    op.add_column(
        "workspace_update_releases",
        sa.Column(
            "notes",
            postgresql.JSONB(),
            nullable=False,
            server_default=sa.text("'[\"Улучшили стабильность и удобство работы.\"]'::jsonb"),
        ),
    )
    op.alter_column("workspace_update_releases", "title", server_default=None)
    op.alter_column("workspace_update_releases", "notes", server_default=None)


def downgrade() -> None:
    op.drop_column("workspace_update_releases", "notes")
    op.drop_column("workspace_update_releases", "title")
