"""Store each user's interface language independently."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0038_interface_locale"
down_revision: str | None = "0037_project_trip_workflows"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "workspace_personal_preferences",
        sa.Column("locale", sa.String(length=16), nullable=False, server_default="ru"),
    )
    op.create_check_constraint(
        "ck_personal_preferences_locale",
        "workspace_personal_preferences",
        "locale IN ('ru', 'uz_cyrl', 'uz_latn')",
    )


def downgrade() -> None:
    op.drop_constraint(
        "ck_personal_preferences_locale",
        "workspace_personal_preferences",
        type_="check",
    )
    op.drop_column("workspace_personal_preferences", "locale")
