"""Add browser session metadata without changing existing desktop sessions.

Revision ID: 0026_web_sessions
Revises: 0025_desktop_updates
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0026_web_sessions"
down_revision: str | None = "0025_desktop_updates"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "auth_sessions",
        sa.Column(
            "client_kind",
            sa.String(length=16),
            nullable=False,
            server_default="desktop",
        ),
    )
    op.add_column(
        "auth_sessions",
        sa.Column("csrf_token_hash", sa.String(length=64), nullable=True),
    )
    op.create_check_constraint(
        "ck_auth_sessions_client_kind",
        "auth_sessions",
        "client_kind IN ('desktop', 'web')",
    )


def downgrade() -> None:
    op.drop_constraint("ck_auth_sessions_client_kind", "auth_sessions", type_="check")
    op.drop_column("auth_sessions", "csrf_token_hash")
    op.drop_column("auth_sessions", "client_kind")
