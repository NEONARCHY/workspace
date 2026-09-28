"""Join the current Workspace main line with the AI Referent offline branch."""

from collections.abc import Sequence

revision: str = "0066_merge_main_and_referent_offline"
down_revision: tuple[str, str] = (
    "0064_assistant_and_birthdays",
    "0065_ai_referent_offline_operation_receipts",
)
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
