"""Private hiring packages; existing tenure and register records are untouched."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB, UUID

revision: str = "0087_hr_hiring"
down_revision: str = "0086_survey_analytics"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "hr_hiring_cases",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("created_by", UUID(as_uuid=True), sa.ForeignKey("core_users.id"), nullable=False),
        sa.Column("signer_id", UUID(as_uuid=True), sa.ForeignKey("core_users.id"), nullable=False),
        sa.Column("signer_name", sa.String(200), nullable=False),
        sa.Column("fields", JSONB, nullable=False),
        sa.Column("application_box", JSONB, nullable=False),
        sa.Column("status", sa.String(24), nullable=False),
        sa.Column("revision", sa.Integer, nullable=False),
        sa.Column("contract_number", sa.String(40), nullable=False),
        sa.Column("order_number", sa.String(40), nullable=False),
        sa.Column("document_year", sa.Integer, nullable=False),
        sa.Column("application_key", sa.String(200)),
        sa.Column("application_original_key", sa.String(200)),
        sa.Column("application_pages", sa.Integer, nullable=False),
        sa.Column("employee_scan_key", sa.String(200)),
        sa.Column("signed_keys", JSONB, nullable=False),
        sa.Column("preview_keys", JSONB, nullable=False),
        sa.Column("document_hashes", JSONB, nullable=False),
        sa.Column("return_comment", sa.Text, nullable=False),
        sa.Column("approved_at", sa.DateTime(timezone=True)),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("document_year", "contract_number", name="uq_hiring_contract_number"),
        sa.UniqueConstraint("document_year", "order_number", name="uq_hiring_order_number"),
        sa.CheckConstraint("revision > 0", name="hiring_revision_positive"),
        sa.CheckConstraint(
            "status IN ('draft','pending','returned','awaiting_employee','completed')",
            name="hiring_status",
        ),
    )
    op.create_index("ix_hiring_updated", "hr_hiring_cases", ["updated_at"])
    op.create_table(
        "hr_hiring_signatures",
        sa.Column("user_id", UUID(as_uuid=True), sa.ForeignKey("core_users.id"), primary_key=True),
        sa.Column("storage_key", sa.String(200), nullable=False),
        sa.Column("sha256", sa.String(64), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_table(
        "hr_hiring_receipts",
        sa.Column(
            "case_id", UUID(as_uuid=True), sa.ForeignKey("hr_hiring_cases.id"), primary_key=True
        ),
        sa.Column("request_id", UUID(as_uuid=True), primary_key=True),
        sa.Column("actor_id", UUID(as_uuid=True), sa.ForeignKey("core_users.id"), nullable=False),
        sa.Column("fingerprint", sa.String(64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )


def downgrade() -> None:
    raise RuntimeError("Hiring contains signed personal documents. Use a reviewed retention plan.")
