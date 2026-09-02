"""Create the immutable import ledger.

Revision ID: 0001_import_ledger
Revises: None
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0001_import_ledger"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "system_import_runs",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("source_system", sa.String(length=64), nullable=False),
        sa.Column("source_fingerprint", sa.String(length=64), nullable=False),
        sa.Column("mapping_version", sa.String(length=32), nullable=False),
        sa.Column("source_snapshot_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("status", sa.String(length=24), nullable=False),
        sa.Column("source_counts", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("target_counts", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("error_summary", sa.Text(), nullable=True),
        sa.CheckConstraint(
            "status IN ('planned', 'running', 'validated', 'failed', 'rolled_back')",
            name="ck_system_import_runs_status",
        ),
        sa.UniqueConstraint(
            "source_system",
            "source_fingerprint",
            "mapping_version",
            name="uq_system_import_runs_source",
        ),
    )
    op.create_table(
        "system_import_items",
        sa.Column("id", sa.BigInteger(), sa.Identity(), primary_key=True),
        sa.Column(
            "run_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("system_import_runs.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("source_table", sa.String(length=64), nullable=False),
        sa.Column("source_key_hash", sa.String(length=64), nullable=False),
        sa.Column("source_payload_hash", sa.String(length=64), nullable=False),
        sa.Column("target_table", sa.String(length=96), nullable=False),
        sa.Column("target_key", sa.Text(), nullable=True),
        sa.Column("status", sa.String(length=24), nullable=False),
        sa.Column("error_code", sa.String(length=64), nullable=True),
        sa.Column("error_detail", sa.Text(), nullable=True),
        sa.CheckConstraint(
            "status IN ('pending', 'imported', 'quarantined', 'skipped', 'failed')",
            name="ck_system_import_items_status",
        ),
        sa.UniqueConstraint(
            "run_id",
            "source_table",
            "source_key_hash",
            name="uq_system_import_items_source",
        ),
    )
    op.create_index(
        "ix_system_import_items_run_status",
        "system_import_items",
        ["run_id", "status"],
    )


def downgrade() -> None:
    op.drop_index("ix_system_import_items_run_status", table_name="system_import_items")
    op.drop_table("system_import_items")
    op.drop_table("system_import_runs")
