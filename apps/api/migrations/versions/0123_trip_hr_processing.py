"""Chair resolution and explicit HR completion for new and unfinished trips."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0123_trip_hr_processing"
down_revision: str = "0122_monthly_reports"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("trip_requests", sa.Column(
        "hr_processing_required", sa.Boolean(), nullable=False, server_default=sa.true(),
    ))
    op.execute("UPDATE trip_requests SET hr_processing_required = false "
               "WHERE status IN ('approved', 'rejected', 'annulled') OR deleted_at IS NOT NULL")
    for name in ("hr_processor_user_id", "resolution_actor_user_id"):
        op.add_column("trip_requests", sa.Column(name, postgresql.UUID(as_uuid=True)))
        op.create_foreign_key(f"fk_trip_{name}", "trip_requests", "core_users", [name], ["id"])
    for name in ("resolved_brief_key", "resolved_brief_sha256"):
        op.add_column("trip_requests", sa.Column(
            name, sa.String(300 if name.endswith("key") else 64),
        ))
    op.add_column("trip_requests", sa.Column("resolution_at", sa.DateTime(timezone=True)))
    op.add_column("trip_requests", sa.Column(
        "resolution_snapshot", postgresql.JSONB(), nullable=False, server_default="{}",
    ))
    op.add_column("trip_requests", sa.Column(
        "order_series", sa.String(24), nullable=False, server_default="",
    ))
    op.add_column("trip_requests", sa.Column(
        "order_purpose", sa.Text(), nullable=False, server_default="",
    ))
    op.create_table(
        "trip_document_revisions",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("request_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("trip_requests.id"), nullable=False),
        sa.Column("actor_user_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("core_users.id"), nullable=False),
        sa.Column("kind", sa.String(16), nullable=False),
        sa.Column("storage_key", sa.String(300), nullable=False),
        sa.Column("sha256", sa.String(64), nullable=False),
        sa.Column("facts", postgresql.JSONB(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    # Manual HR numbers are scoped by series; retain the original rule for old orders only.
    op.drop_constraint("uq_trip_order_number", "trip_requests", type_="unique")
    op.execute("CREATE UNIQUE INDEX uq_trip_order_number ON trip_requests "
               "(order_number, order_year) WHERE NOT hr_processing_required")
    op.execute("CREATE UNIQUE INDEX uq_trip_hr_order_number ON trip_requests "
               "(order_year, lower(btrim(order_number)), lower(btrim(order_series))) "
               "WHERE hr_processing_required AND order_pdf_key IS NOT NULL")
    op.drop_constraint("ck_trip_request_actions_action", "trip_request_actions", type_="check")
    op.create_check_constraint(
        "ck_trip_request_actions_action", "trip_request_actions",
        "action IN ('created','submit','approve','return','reject','resubmit',"
        "'move','withdraw','annul','deleted','complete')",
    )


def downgrade() -> None:
    if op.get_bind().execute(sa.text(
        "SELECT 1 FROM trip_document_revisions LIMIT 1"
    )).first():
        raise RuntimeError("Archive HR trip documents before downgrading")
    op.drop_constraint("ck_trip_request_actions_action", "trip_request_actions", type_="check")
    op.create_check_constraint(
        "ck_trip_request_actions_action", "trip_request_actions",
        "action IN ('created','submit','approve','return','reject','resubmit',"
        "'move','withdraw','annul','deleted')",
    )
    op.drop_index("uq_trip_hr_order_number", table_name="trip_requests")
    op.drop_index("uq_trip_order_number", table_name="trip_requests")
    op.create_unique_constraint(
        "uq_trip_order_number", "trip_requests", ["order_number", "order_year"],
    )
    op.drop_table("trip_document_revisions")
    for name in ("hr_processor_user_id", "resolution_actor_user_id"):
        op.drop_constraint(f"fk_trip_{name}", "trip_requests", type_="foreignkey")
    for name in ("hr_processing_required", "hr_processor_user_id", "resolution_actor_user_id",
                 "resolved_brief_key", "resolved_brief_sha256", "resolution_at",
                 "resolution_snapshot", "order_series", "order_purpose"):
        op.drop_column("trip_requests", name)
