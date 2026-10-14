"""Allow audited edits in payment request activity.

Revision ID: 0093_approval_request_edit_action
Revises: 0092_trip_order_documents
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0093_approval_request_edit_action"
down_revision: str | None = "0092_trip_order_documents"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_constraint("ck_approval_actions_action", "approval_actions", type_="check")
    op.create_check_constraint(
        "ck_approval_actions_action",
        "approval_actions",
        "action IN ('approve', 'reject', 'return', 'clarify', 'delegate', "
        "'resubmit', 'cancel', 'move', 'edit')",
    )


def downgrade() -> None:
    op.drop_constraint("ck_approval_actions_action", "approval_actions", type_="check")
    op.create_check_constraint(
        "ck_approval_actions_action",
        "approval_actions",
        "action IN ('approve', 'reject', 'return', 'clarify', 'delegate', "
        "'resubmit', 'cancel', 'move')",
    )
