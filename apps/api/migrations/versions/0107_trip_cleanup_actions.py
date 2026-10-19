"""Allow the auditable withdraw, annul and delete actions for trip requests.

Revision ID: 0107_trip_cleanup_actions
Revises: 0106_leave_tenure_order_draft
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0107_trip_cleanup_actions"
down_revision: str = "0106_leave_tenure_order_draft"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_constraint("ck_trip_request_actions_action", "trip_request_actions", type_="check")
    op.create_check_constraint(
        "ck_trip_request_actions_action",
        "trip_request_actions",
        "action IN ('created', 'submit', 'approve', 'return', 'reject', 'resubmit', "
        "'move', 'withdraw', 'annul', 'deleted')",
    )


def downgrade() -> None:
    connection = op.get_bind()
    if connection.execute(sa.text(
        "SELECT 1 FROM trip_request_actions WHERE action IN "
        "('withdraw', 'annul', 'deleted') LIMIT 1"
    )).first():
        raise RuntimeError("Restore withdrawn, annulled and deleted trip audit before downgrading")
    op.drop_constraint("ck_trip_request_actions_action", "trip_request_actions", type_="check")
    op.create_check_constraint(
        "ck_trip_request_actions_action",
        "trip_request_actions",
        "action IN ('created', 'submit', 'approve', 'return', 'reject', 'resubmit', 'move')",
    )
