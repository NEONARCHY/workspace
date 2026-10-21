"""Private daily work-activity snapshots for the first Hisobot reminder."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0112_hisobot_activity_drafts"
down_revision = "0111_personal_mail"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "hisobot_activity_drafts",
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("core_users.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("report_date", sa.Date(), primary_key=True),
        sa.Column("generated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("facts", postgresql.JSONB(), nullable=False),
        sa.Column("seen_at", sa.DateTime(timezone=True)),
    )


def downgrade() -> None:
    op.drop_table("hisobot_activity_drafts")
