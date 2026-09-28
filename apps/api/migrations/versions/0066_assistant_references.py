"""Store server-vetted Workspace references and unsent assistant drafts."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0066_assistant_references"
down_revision: str | None = "0065_assistant_source_labels"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("assistant_messages", sa.Column("references", postgresql.JSONB()))
    op.add_column("assistant_messages", sa.Column("action_draft", postgresql.JSONB()))


def downgrade() -> None:
    op.drop_column("assistant_messages", "action_draft")
    op.drop_column("assistant_messages", "references")
