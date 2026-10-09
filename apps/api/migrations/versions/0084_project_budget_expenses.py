"""Immutable budget plans and once-only completed payment expenses."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0084_project_budget_expenses"
down_revision = "0083_project_document_imports"
branch_labels = None
depends_on = None


def upgrade() -> None:
    uuid = postgresql.UUID(as_uuid=True)
    op.create_table(
        "project_budget_articles",
        sa.Column("id", uuid, primary_key=True),
        sa.Column("project_id", uuid, sa.ForeignKey("project_hub_projects.id"), nullable=False),
        sa.Column("title", sa.String(500), nullable=False),
        sa.Column("planned_amount", sa.String(30), nullable=False),
        sa.Column("currency", sa.String(3), nullable=False),
        sa.Column("funding", sa.String(16), nullable=False),
        sa.Column("import_id", uuid, sa.ForeignKey("project_document_imports.id")),
        sa.Column("created_by_user_id", uuid, sa.ForeignKey("core_users.id"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_project_budget_articles_project", "project_budget_articles", ["project_id"])
    op.create_table(
        "project_payment_expenses",
        sa.Column("id", uuid, primary_key=True),
        sa.Column("request_id", uuid, sa.ForeignKey("approval_requests.id"), nullable=False,
                  unique=True),
        sa.Column("project_id", uuid, sa.ForeignKey("project_hub_projects.id"), nullable=False),
        sa.Column("article_id", uuid, sa.ForeignKey("project_budget_articles.id")),
        sa.Column("amount", sa.Numeric(30, 0), nullable=False),
        sa.Column("currency", sa.String(3), nullable=False),
        sa.Column("request_version", sa.Integer(), nullable=False),
        sa.Column("snapshot", postgresql.JSONB(), nullable=False),
        sa.Column("actor_user_id", uuid, sa.ForeignKey("core_users.id"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("amount > 0", name="project_expense_positive"),
    )
    op.create_index("ix_project_payment_expenses_project", "project_payment_expenses",
                    ["project_id"])


def downgrade() -> None:
    # Deliberately refuse destructive rollback of financial history.
    raise RuntimeError("Disable new budget operations; preserve plans and expense history")
