"""Store optional context for repeatable preset employee rewards."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0062_reward_catalog_and_context"
down_revision: str | None = "0061_support_requests"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("employee_rewards", sa.Column("context_note", sa.String(240)))


def downgrade() -> None:
    op.drop_column("employee_rewards", "context_note")
