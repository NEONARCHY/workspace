"""Configure future project payments without rewriting any submitted request."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0130_project_payment_routes"
down_revision = "0129_grant_deadline_requests"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("project_hub_projects", sa.Column(
        "payment_approver_user_ids", postgresql.JSONB(), nullable=True,
    ))
    # NULL retains the legacy ordinary/subsidy route; [] skips only the deputy stage.
    # Explicit, exact title variants only. Existing requests and their snapshots are untouched.
    op.execute(sa.text("""
        UPDATE project_hub_projects SET payment_approver_user_ids = '[]'::jsonb
        WHERE lower(trim(title)) IN ('асосий хисоб', 'асосий ҳисоб', 'asosiy hisob')
    """))


def downgrade() -> None:
    op.drop_column("project_hub_projects", "payment_approver_user_ids")
