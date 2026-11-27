"""Record HR-only registration corrections without altering travel approvals."""

import sqlalchemy as sa
from alembic import op

revision = "0131_trip_order_details"
down_revision = "0130_project_payment_routes"
branch_labels = None
depends_on = None

_EXISTING = (
    "'created','submit','approve','return','reject','resubmit','move','withdraw',"
    "'annul','deleted','complete','revise_order','approve_revision',"
    "'complete_revision','cancel_revision'"
)


def upgrade() -> None:
    op.drop_constraint("ck_trip_request_actions_action", "trip_request_actions", type_="check")
    op.create_check_constraint(
        "ck_trip_request_actions_action", "trip_request_actions",
        f"action IN ({_EXISTING},'update_order_details')",
    )


def downgrade() -> None:
    if op.get_bind().execute(sa.text(
        "SELECT 1 FROM trip_request_actions WHERE action='update_order_details' LIMIT 1"
    )).first():
        raise RuntimeError("Preserve HR order registration history before downgrading")
    op.drop_constraint("ck_trip_request_actions_action", "trip_request_actions", type_="check")
    op.create_check_constraint(
        "ck_trip_request_actions_action", "trip_request_actions", f"action IN ({_EXISTING})",
    )
