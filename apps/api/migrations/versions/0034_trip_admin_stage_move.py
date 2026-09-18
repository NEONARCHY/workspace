"""Allow audited administrative moves between trip stages.

Revision ID: 0034_trip_admin_stage_move
Revises: 0033_task_comment_reactions
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0034_trip_admin_stage_move"
down_revision: str | None = "0033_task_comment_reactions"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_constraint("ck_trip_request_actions_action", "trip_request_actions", type_="check")
    op.create_check_constraint(
        "ck_trip_request_actions_action",
        "trip_request_actions",
        "action IN ('created', 'submit', 'approve', 'return', 'reject', 'resubmit', 'move')",
    )


def downgrade() -> None:
    op.drop_constraint("ck_trip_request_actions_action", "trip_request_actions", type_="check")
    op.create_check_constraint(
        "ck_trip_request_actions_action",
        "trip_request_actions",
        "action IN ('created', 'submit', 'approve', 'return', 'reject', 'resubmit')",
    )
