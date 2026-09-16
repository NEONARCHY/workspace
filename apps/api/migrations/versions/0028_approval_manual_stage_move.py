"""Allow audited manual moves between payment approval stages.

Revision ID: 0028_approval_manual_stage_move
Revises: 0027_absences
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0028_approval_manual_stage_move"
down_revision: str | None = "0027_absences"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_constraint("ck_approval_actions_action", "approval_actions", type_="check")
    op.create_check_constraint(
        "ck_approval_actions_action",
        "approval_actions",
        "action IN ('approve', 'reject', 'return', 'clarify', 'delegate', "
        "'resubmit', 'cancel', 'move')",
    )


def downgrade() -> None:
    op.drop_constraint("ck_approval_actions_action", "approval_actions", type_="check")
    op.create_check_constraint(
        "ck_approval_actions_action",
        "approval_actions",
        "action IN ('approve', 'reject', 'return', 'clarify', 'delegate', 'resubmit', 'cancel')",
    )
