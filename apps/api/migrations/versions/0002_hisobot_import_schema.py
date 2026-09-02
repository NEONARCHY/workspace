"""Create the immutable Hisobot import target schema.

Revision ID: 0002_hisobot_import_schema
Revises: 0001_import_ledger
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0002_hisobot_import_schema"
down_revision: str | None = "0001_import_ledger"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _source_columns() -> list[sa.Column[object]]:
    return [
        sa.Column("source_table", sa.String(length=64), nullable=False),
        sa.Column("source_key_hash", sa.String(length=64), nullable=False),
        sa.Column("source_payload_hash", sa.String(length=64), nullable=False),
        sa.Column(
            "first_import_run_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("system_import_runs.id", ondelete="RESTRICT"),
            nullable=False,
        ),
    ]


def _source_unique(table_name: str) -> sa.UniqueConstraint:
    return sa.UniqueConstraint(
        "source_table",
        "source_key_hash",
        name=f"uq_{table_name}_source",
    )


def upgrade() -> None:
    op.create_table(
        "legacy_identity_links",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("source_system", sa.String(length=64), nullable=False),
        sa.Column("identifier_type", sa.String(length=32), nullable=False),
        sa.Column("identifier_hash", sa.String(length=64), nullable=False),
        sa.Column("identifier_value", sa.Text(), nullable=False),
        sa.Column("platform_user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("resolution_state", sa.String(length=24), nullable=False),
        sa.Column("is_archived", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column(
            "first_import_run_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("system_import_runs.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "identifier_type IN ('employee_key', 'telegram_id')",
            name="ck_legacy_identity_links_identifier_type",
        ),
        sa.CheckConstraint(
            "resolution_state IN ('unresolved', 'resolved', 'quarantined')",
            name="ck_legacy_identity_links_resolution_state",
        ),
        sa.UniqueConstraint(
            "source_system",
            "identifier_type",
            "identifier_hash",
            name="uq_legacy_identity_links_source",
        ),
    )

    op.create_table(
        "hisobot_reports",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "employee_identity_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("legacy_identity_links.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("report_date", sa.Date(), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("submitted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("source_submitted_at", sa.Text(), nullable=True),
        sa.Column("is_late", sa.Boolean(), nullable=False),
        sa.Column("source_created_at", sa.Text(), nullable=True),
        sa.Column("source_updated_at", sa.Text(), nullable=True),
        *_source_columns(),
        _source_unique("hisobot_reports"),
    )
    op.create_index(
        "ix_hisobot_reports_employee_date",
        "hisobot_reports",
        ["employee_identity_id", "report_date"],
        unique=True,
    )

    op.create_table(
        "hisobot_vacations",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "employee_identity_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("legacy_identity_links.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("through_date", sa.Date(), nullable=False),
        sa.Column(
            "created_by_identity_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("legacy_identity_links.id", ondelete="RESTRICT"),
            nullable=True,
        ),
        sa.Column("source_created_at", sa.Text(), nullable=True),
        *_source_columns(),
        _source_unique("hisobot_vacations"),
    )

    op.create_table(
        "hisobot_legacy_user_preferences",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "telegram_identity_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("legacy_identity_links.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("language", sa.String(length=32), nullable=False),
        *_source_columns(),
        _source_unique("hisobot_legacy_user_preferences"),
    )

    op.create_table(
        "hisobot_summaries",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("variant", sa.String(length=32), nullable=False),
        sa.Column("period_start", sa.Date(), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("generated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("source_created_at", sa.Text(), nullable=True),
        *_source_columns(),
        sa.CheckConstraint(
            "variant IN ('central_daily', 'hudud_daily')",
            name="ck_hisobot_summaries_variant",
        ),
        _source_unique("hisobot_summaries"),
    )

    op.create_table(
        "hisobot_report_artifacts",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("scope", sa.String(length=16), nullable=False),
        sa.Column("period_type", sa.String(length=16), nullable=False),
        sa.Column("period_start", sa.Date(), nullable=False),
        sa.Column("period_end", sa.Date(), nullable=True),
        sa.Column("legacy_file_path", sa.Text(), nullable=False),
        sa.Column("source_file_name", sa.Text(), nullable=False),
        sa.Column("source_file_sha256", sa.String(length=64), nullable=False),
        sa.Column("source_file_size", sa.BigInteger(), nullable=False),
        sa.Column("object_key", sa.Text(), nullable=False),
        sa.Column("storage_status", sa.String(length=24), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("source_created_at", sa.Text(), nullable=True),
        sa.Column("report_count", sa.Integer(), nullable=False),
        sa.Column("missing_count", sa.Integer(), nullable=False),
        *_source_columns(),
        sa.CheckConstraint("scope IN ('central', 'hudud')", name="ck_artifacts_scope"),
        sa.CheckConstraint(
            "period_type IN ('daily', 'weekly')", name="ck_artifacts_period_type"
        ),
        sa.CheckConstraint(
            "storage_status IN ('verified_local', 'uploaded')",
            name="ck_artifacts_storage_status",
        ),
        _source_unique("hisobot_report_artifacts"),
    )
    op.create_index(
        "ix_hisobot_report_artifacts_object_key",
        "hisobot_report_artifacts",
        ["object_key"],
        unique=True,
    )

    op.create_table(
        "hisobot_legacy_archive_files",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("relative_path", sa.Text(), nullable=False),
        sa.Column("file_name", sa.Text(), nullable=False),
        sa.Column("file_extension", sa.String(length=16), nullable=False),
        sa.Column("file_sha256", sa.String(length=64), nullable=False),
        sa.Column("file_size", sa.BigInteger(), nullable=False),
        sa.Column("object_key", sa.Text(), nullable=False),
        sa.Column("referenced_by_package", sa.Boolean(), nullable=False),
        sa.Column("storage_status", sa.String(length=24), nullable=False),
        *_source_columns(),
        sa.CheckConstraint(
            "storage_status IN ('verified_local', 'uploaded')",
            name="ck_legacy_archive_files_storage_status",
        ),
        _source_unique("hisobot_legacy_archive_files"),
    )
    op.create_index(
        "ix_hisobot_legacy_archive_files_object_key",
        "hisobot_legacy_archive_files",
        ["object_key"],
    )

    op.create_table(
        "hisobot_legacy_delivery_states",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("delivery_type", sa.String(length=48), nullable=False),
        sa.Column("period_key", sa.String(length=32), nullable=False),
        sa.Column(
            "telegram_identity_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("legacy_identity_links.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("legacy_status", sa.String(length=64), nullable=False),
        sa.Column("attempt_count", sa.Integer(), nullable=False),
        sa.Column("sent_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("source_sent_at", sa.Text(), nullable=True),
        sa.Column("last_error", sa.Text(), nullable=True),
        *_source_columns(),
        _source_unique("hisobot_legacy_delivery_states"),
    )

    op.create_table(
        "hisobot_legacy_reminder_states",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("reminder_type", sa.String(length=32), nullable=False),
        sa.Column("report_date", sa.Date(), nullable=False),
        sa.Column("reminder_slot", sa.String(length=32), nullable=True),
        sa.Column(
            "telegram_identity_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("legacy_identity_links.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("legacy_status", sa.String(length=64), nullable=False),
        sa.Column("attempt_count", sa.Integer(), nullable=False),
        sa.Column("sent_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("source_sent_at", sa.Text(), nullable=True),
        sa.Column("last_error", sa.Text(), nullable=True),
        *_source_columns(),
        _source_unique("hisobot_legacy_reminder_states"),
    )

    op.create_table(
        "hisobot_legacy_ui_messages",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("chat_id", sa.BigInteger(), nullable=False),
        sa.Column("message_id", sa.BigInteger(), nullable=False),
        sa.Column("source_created_at", sa.Text(), nullable=True),
        *_source_columns(),
        _source_unique("hisobot_legacy_ui_messages"),
    )

    op.create_table(
        "system_import_quarantine",
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
        sa.Column("source_payload", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("error_code", sa.String(length=64), nullable=False),
        sa.Column("error_detail", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint(
            "run_id",
            "source_table",
            "source_key_hash",
            name="uq_system_import_quarantine_source",
        ),
    )


def downgrade() -> None:
    op.drop_table("system_import_quarantine")
    op.drop_table("hisobot_legacy_ui_messages")
    op.drop_table("hisobot_legacy_reminder_states")
    op.drop_table("hisobot_legacy_delivery_states")
    op.drop_index(
        "ix_hisobot_legacy_archive_files_object_key",
        table_name="hisobot_legacy_archive_files",
    )
    op.drop_table("hisobot_legacy_archive_files")
    op.drop_index(
        "ix_hisobot_report_artifacts_object_key", table_name="hisobot_report_artifacts"
    )
    op.drop_table("hisobot_report_artifacts")
    op.drop_table("hisobot_summaries")
    op.drop_table("hisobot_legacy_user_preferences")
    op.drop_table("hisobot_vacations")
    op.drop_index("ix_hisobot_reports_employee_date", table_name="hisobot_reports")
    op.drop_table("hisobot_reports")
    op.drop_table("legacy_identity_links")
