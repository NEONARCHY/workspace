"""Separate document corrections for approved trips, retaining approvals and numbers."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0125_trip_order_revisions"
down_revision: str = "0124_task_reopen_permission"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_OLD_ACTIONS = (
    "'created','submit','approve','return','reject','resubmit','move',"
    "'withdraw','annul','deleted','complete'"
)
_NEW_ACTIONS = "'revise_order','approve_revision','complete_revision','cancel_revision'"


def upgrade() -> None:
    op.add_column("trip_requests", sa.Column(
        "order_manually_registered", sa.Boolean(), nullable=False, server_default=sa.false(),
    ))
    op.execute("UPDATE trip_requests SET order_manually_registered = true "
               "WHERE hr_processing_required AND order_pdf_key IS NOT NULL")
    op.drop_index("uq_trip_order_number", table_name="trip_requests")
    op.drop_index("uq_trip_hr_order_number", table_name="trip_requests")
    op.execute("CREATE UNIQUE INDEX uq_trip_order_number ON trip_requests "
               "(order_number,order_year) WHERE NOT order_manually_registered")
    op.execute("CREATE UNIQUE INDEX uq_trip_hr_order_number ON trip_requests "
               "(order_year,lower(btrim(order_number)),lower(btrim(order_series))) "
               "WHERE order_manually_registered AND order_pdf_key IS NOT NULL")
    op.add_column("trip_requests", sa.Column("order_revision_stage", sa.String(16)))
    op.add_column("trip_requests", sa.Column(
        "order_revision_snapshot", postgresql.JSONB(), nullable=False, server_default="{}",
    ))
    op.create_check_constraint(
        "ck_trip_order_revision_stage", "trip_requests",
        "order_revision_stage IS NULL OR "
        "(status = 'approved' AND order_revision_stage IN ('chair','hr'))",
    )
    op.create_table(
        "trip_order_registrations",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("request_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("trip_requests.id"), nullable=False),
        sa.Column("order_year", sa.Integer(), nullable=False),
        sa.Column("order_number", sa.String(40), nullable=False),
        sa.Column("order_series", sa.String(24), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("uq_trip_order_registration", "trip_order_registrations", [
        "order_year", sa.text("lower(btrim(order_number))"), sa.text("lower(btrim(order_series))"),
    ], unique=True)
    # Reserve every already issued manual number before any corrections are possible.
    op.execute(
        "INSERT INTO trip_order_registrations "
        "(id,request_id,order_year,order_number,order_series,created_at) "
        "SELECT id,id,order_year,order_number,order_series,COALESCE(order_issued_at,updated_at) "
        "FROM trip_requests WHERE order_manually_registered AND order_pdf_key IS NOT NULL"
    )
    op.drop_constraint("ck_trip_request_actions_action", "trip_request_actions", type_="check")
    op.create_check_constraint(
        "ck_trip_request_actions_action", "trip_request_actions",
        f"action IN ({_OLD_ACTIONS},{_NEW_ACTIONS})",
    )


def downgrade() -> None:
    if op.get_bind().execute(sa.text(
        f"SELECT 1 FROM trip_request_actions WHERE action IN ({_NEW_ACTIONS}) LIMIT 1"
    )).first():
        raise RuntimeError("Archive trip order correction history before downgrading")
    op.drop_constraint("ck_trip_request_actions_action", "trip_request_actions", type_="check")
    op.create_check_constraint(
        "ck_trip_request_actions_action", "trip_request_actions", f"action IN ({_OLD_ACTIONS})",
    )
    op.drop_table("trip_order_registrations")
    op.drop_constraint("ck_trip_order_revision_stage", "trip_requests", type_="check")
    op.drop_column("trip_requests", "order_revision_snapshot")
    op.drop_column("trip_requests", "order_revision_stage")
    op.drop_index("uq_trip_order_number", table_name="trip_requests")
    op.drop_index("uq_trip_hr_order_number", table_name="trip_requests")
    op.execute("CREATE UNIQUE INDEX uq_trip_order_number ON trip_requests "
               "(order_number,order_year) WHERE NOT hr_processing_required")
    op.execute("CREATE UNIQUE INDEX uq_trip_hr_order_number ON trip_requests "
               "(order_year,lower(btrim(order_number)),lower(btrim(order_series))) "
               "WHERE hr_processing_required AND order_pdf_key IS NOT NULL")
    op.drop_column("trip_requests", "order_manually_registered")
