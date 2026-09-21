"""Allow HR cards that are not yet Workspace accounts.

Revision ID: 0043_hr_standalone_cards
Revises: 0042_hr_service_tenure
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0043_hr_standalone_cards"
down_revision: str | None = "0042_hr_service_tenure"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "hr_employee_profiles", sa.Column("full_name", sa.String(200), nullable=True)
    )
    op.add_column(
        "hr_employee_profiles", sa.Column("job_title", sa.String(160), nullable=True)
    )
    op.add_column(
        "hr_employee_profiles", sa.Column("import_key", sa.String(200), nullable=True)
    )
    op.execute(
        "UPDATE hr_employee_profiles AS profile "
        "SET full_name = user_record.full_name, job_title = user_record.job_title "
        "FROM core_users AS user_record WHERE user_record.id = profile.user_id"
    )
    op.alter_column("hr_employee_profiles", "full_name", nullable=False)
    op.alter_column("hr_employee_profiles", "user_id", nullable=True)
    op.create_unique_constraint("uq_hr_profile_import_key", "hr_employee_profiles", ["import_key"])
    op.alter_column("hr_monthly_register_items", "user_id", nullable=True)


def downgrade() -> None:
    op.alter_column("hr_monthly_register_items", "user_id", nullable=False)
    op.drop_constraint("uq_hr_profile_import_key", "hr_employee_profiles", type_="unique")
    op.alter_column("hr_employee_profiles", "user_id", nullable=False)
    op.drop_column("hr_employee_profiles", "import_key")
    op.drop_column("hr_employee_profiles", "job_title")
    op.drop_column("hr_employee_profiles", "full_name")
