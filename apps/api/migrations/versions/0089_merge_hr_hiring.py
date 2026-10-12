"""Join hiring and calendar branches without rewriting either migration history."""

from collections.abc import Sequence

revision: str = "0089_merge_hr_hiring"
down_revision: tuple[str, str] = ("0087_hr_hiring", "0088_calendar_appearance")
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
