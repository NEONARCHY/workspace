"""Separate metadata keeps hiring isolated from the existing tenure tables."""

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, UUID

metadata = sa.MetaData()
hiring_cases = sa.Table(
    "hr_hiring_cases",
    metadata,
    sa.Column("id", UUID(as_uuid=True), primary_key=True),
    sa.Column("created_by", UUID(as_uuid=True), nullable=False),
    sa.Column("signer_id", UUID(as_uuid=True), nullable=False),
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
)
hiring_signatures = sa.Table(
    "hr_hiring_signatures",
    metadata,
    sa.Column("user_id", UUID(as_uuid=True), primary_key=True),
    sa.Column("storage_key", sa.String(200), nullable=False),
    sa.Column("sha256", sa.String(64), nullable=False),
    sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
)
hiring_receipts = sa.Table(
    "hr_hiring_receipts",
    metadata,
    sa.Column("case_id", UUID(as_uuid=True), primary_key=True),
    sa.Column("request_id", UUID(as_uuid=True), primary_key=True),
    sa.Column("actor_id", UUID(as_uuid=True), nullable=False),
    sa.Column("fingerprint", sa.String(64), nullable=False),
    sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
)
