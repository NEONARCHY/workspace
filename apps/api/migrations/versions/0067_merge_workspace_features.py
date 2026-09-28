"""Join Hisobot, department scope, assistant, and Referent migration branches."""

from collections.abc import Sequence

revision: str = "0067_merge_workspace_features"
down_revision: tuple[str, str, str, str] = (
    "0060_hisobot_department_units",
    "0065_department_scope",
    "0066_assistant_references",
    "0067_ai_referent_manual_recipients",
)
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
