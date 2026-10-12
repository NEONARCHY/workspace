"""Join the project-budget and employee-sync migration branches without rewriting either."""

revision = "0085_merge_edo_employee_sync"
down_revision = ("0084_project_budget_expenses", "0083_edo_employee_sync")
branch_labels = None
depends_on = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
