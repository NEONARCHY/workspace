"""Per-employee monthly dossier responses, independent of questionnaire contents."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0115_dossier_monthly_reviews"
down_revision = "0114_hr_personnel_dossiers"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "hr_dossier_monthly_reviews",
        sa.Column("user_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("core_users.id"), primary_key=True),
        sa.Column("period", sa.Date(), primary_key=True),
        sa.Column("status", sa.String(24), nullable=False),
        sa.Column("responded_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("dossier_revision", sa.Integer()),
        sa.CheckConstraint("EXTRACT(DAY FROM period) = 1", name="ck_dossier_review_month"),
        sa.CheckConstraint("status IN ('update_requested','no_changes','skipped','updated')",
                           name="ck_dossier_review_status"),
        sa.CheckConstraint("(status = 'updated' AND dossier_revision IS NOT NULL "
                           "AND dossier_revision > 0) OR "
                           "(status != 'updated' AND dossier_revision IS NULL)",
                           name="ck_dossier_review_revision"),
    )


def downgrade() -> None:
    raise RuntimeError("Monthly dossier responses are audit data; preserve the records")
