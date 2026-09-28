"""Keep user-visible context labels beside each assistant answer."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0065_assistant_source_labels"
down_revision: str | None = "0064_assistant_and_birthdays"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "assistant_messages",
        sa.Column("source_labels", postgresql.JSONB()),
    )


def downgrade() -> None:
    op.drop_column("assistant_messages", "source_labels")
