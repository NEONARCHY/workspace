"""Join the independent project and Hisobot migrations.

Both 0057 revisions were released from 0056_project_hub. This no-op merge
lets Alembic apply either branch first without changing an applied revision.
"""

from collections.abc import Sequence

revision: str = "0058_project_hisobot_merge"
down_revision: tuple[str, str] = (
    "0057_project_workstreams",
    "0057_hisobot_live_bridge",
)
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
