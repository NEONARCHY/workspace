"""Add signed trip briefs and separately numbered trip orders.

Revision ID: 0092_trip_order_documents
Revises: 0091_task_plan_settings
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0092_trip_order_documents"
down_revision: str = "0091_task_plan_settings"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("trip_requests", sa.Column(
        "workflow_version", sa.Integer(), nullable=False, server_default="1",
    ))
    op.add_column("trip_requests", sa.Column("brief_text", sa.Text(), nullable=True))
    op.add_column("trip_requests", sa.Column("expense_source", sa.String(300), nullable=True))
    op.add_column("trip_requests", sa.Column("brief_attachment_key", sa.String(300)))
    op.add_column("trip_requests", sa.Column("brief_attachment_name", sa.String(240)))
    op.add_column("trip_requests", sa.Column("brief_attachment_type", sa.String(100)))
    op.add_column("trip_requests", sa.Column("brief_attachment_sha256", sa.String(64)))
    op.add_column("trip_requests", sa.Column("employee_signature_key", sa.String(300)))
    op.add_column("trip_requests", sa.Column("employee_signature_sha256", sa.String(64)))
    op.add_column("trip_requests", sa.Column("signed_brief_key", sa.String(300)))
    op.add_column("trip_requests", sa.Column("signed_brief_sha256", sa.String(64)))
    op.add_column("trip_requests", sa.Column("order_pdf_key", sa.String(300)))
    op.add_column("trip_requests", sa.Column("order_pdf_sha256", sa.String(64)))
    op.add_column("trip_requests", sa.Column("order_number", sa.String(40)))
    op.add_column("trip_requests", sa.Column("order_year", sa.Integer()))
    op.add_column("trip_requests", sa.Column("order_sequence", sa.Integer()))
    op.add_column("trip_requests", sa.Column("order_signer_user_id", sa.Uuid()))
    op.add_column("trip_requests", sa.Column("order_issued_at", sa.DateTime(timezone=True)))
    op.create_unique_constraint(
        "uq_trip_order_number", "trip_requests", ["order_number", "order_year"],
    )
    op.create_unique_constraint(
        "uq_trip_order_sequence", "trip_requests", ["order_year", "order_sequence"],
    )
    op.create_table(
        "trip_order_counters",
        sa.Column("year", sa.Integer(), primary_key=True),
        sa.Column("last_sequence", sa.Integer(), nullable=False),
        sa.CheckConstraint("last_sequence >= 0", name="ck_trip_order_counter_nonnegative"),
    )


def downgrade() -> None:
    op.drop_table("trip_order_counters")
    op.drop_constraint("uq_trip_order_sequence", "trip_requests", type_="unique")
    op.drop_constraint("uq_trip_order_number", "trip_requests", type_="unique")
    for name in (
        "order_issued_at", "order_signer_user_id", "order_sequence", "order_year",
        "order_number", "order_pdf_sha256", "order_pdf_key", "signed_brief_sha256",
        "signed_brief_key", "employee_signature_sha256", "employee_signature_key",
        "brief_attachment_sha256", "brief_attachment_type", "brief_attachment_name",
        "brief_attachment_key", "expense_source", "brief_text", "workflow_version",
    ):
        op.drop_column("trip_requests", name)
