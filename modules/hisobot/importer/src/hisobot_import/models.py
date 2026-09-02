from __future__ import annotations

from typing import Any

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

metadata = sa.MetaData()

system_import_runs = sa.Table(
    "system_import_runs",
    metadata,
    sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
    sa.Column("source_system", sa.String(64), nullable=False),
    sa.Column("source_fingerprint", sa.String(64), nullable=False),
    sa.Column("mapping_version", sa.String(32), nullable=False),
    sa.Column("source_snapshot_at", sa.DateTime(timezone=True)),
    sa.Column("status", sa.String(24), nullable=False),
    sa.Column("source_counts", postgresql.JSONB(), nullable=False),
    sa.Column("target_counts", postgresql.JSONB(), nullable=False),
    sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
    sa.Column("finished_at", sa.DateTime(timezone=True)),
    sa.Column("error_summary", sa.Text()),
)

system_import_items = sa.Table(
    "system_import_items",
    metadata,
    sa.Column("id", sa.BigInteger(), primary_key=True),
    sa.Column("run_id", postgresql.UUID(as_uuid=True), nullable=False),
    sa.Column("source_table", sa.String(64), nullable=False),
    sa.Column("source_key_hash", sa.String(64), nullable=False),
    sa.Column("source_payload_hash", sa.String(64), nullable=False),
    sa.Column("target_table", sa.String(96), nullable=False),
    sa.Column("target_key", sa.Text()),
    sa.Column("status", sa.String(24), nullable=False),
    sa.Column("error_code", sa.String(64)),
    sa.Column("error_detail", sa.Text()),
)

system_import_quarantine = sa.Table(
    "system_import_quarantine",
    metadata,
    sa.Column("id", sa.BigInteger(), primary_key=True),
    sa.Column("run_id", postgresql.UUID(as_uuid=True), nullable=False),
    sa.Column("source_table", sa.String(64), nullable=False),
    sa.Column("source_key_hash", sa.String(64), nullable=False),
    sa.Column("source_payload_hash", sa.String(64), nullable=False),
    sa.Column("source_payload", postgresql.JSONB(), nullable=False),
    sa.Column("error_code", sa.String(64), nullable=False),
    sa.Column("error_detail", sa.Text()),
    sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
)

legacy_identity_links = sa.Table(
    "legacy_identity_links",
    metadata,
    sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
    sa.Column("source_system", sa.String(64), nullable=False),
    sa.Column("identifier_type", sa.String(32), nullable=False),
    sa.Column("identifier_hash", sa.String(64), nullable=False),
    sa.Column("identifier_value", sa.Text(), nullable=False),
    sa.Column("platform_user_id", postgresql.UUID(as_uuid=True)),
    sa.Column("resolution_state", sa.String(24), nullable=False),
    sa.Column("is_archived", sa.Boolean(), nullable=False),
    sa.Column("first_import_run_id", postgresql.UUID(as_uuid=True), nullable=False),
    sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
)


def _source_columns() -> tuple[sa.Column[Any], ...]:
    return (
        sa.Column("source_table", sa.String(64), nullable=False),
        sa.Column("source_key_hash", sa.String(64), nullable=False),
        sa.Column("source_payload_hash", sa.String(64), nullable=False),
        sa.Column("first_import_run_id", postgresql.UUID(as_uuid=True), nullable=False),
    )


hisobot_reports = sa.Table(
    "hisobot_reports",
    metadata,
    sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
    sa.Column("employee_identity_id", postgresql.UUID(as_uuid=True), nullable=False),
    sa.Column("report_date", sa.Date(), nullable=False),
    sa.Column("content", sa.Text(), nullable=False),
    sa.Column("submitted_at", sa.DateTime(timezone=True)),
    sa.Column("source_submitted_at", sa.Text()),
    sa.Column("is_late", sa.Boolean(), nullable=False),
    sa.Column("source_created_at", sa.Text()),
    sa.Column("source_updated_at", sa.Text()),
    *_source_columns(),
)

hisobot_vacations = sa.Table(
    "hisobot_vacations",
    metadata,
    sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
    sa.Column("employee_identity_id", postgresql.UUID(as_uuid=True), nullable=False),
    sa.Column("through_date", sa.Date(), nullable=False),
    sa.Column("created_by_identity_id", postgresql.UUID(as_uuid=True)),
    sa.Column("source_created_at", sa.Text()),
    *_source_columns(),
)

hisobot_legacy_user_preferences = sa.Table(
    "hisobot_legacy_user_preferences",
    metadata,
    sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
    sa.Column("telegram_identity_id", postgresql.UUID(as_uuid=True), nullable=False),
    sa.Column("language", sa.String(32), nullable=False),
    *_source_columns(),
)

hisobot_summaries = sa.Table(
    "hisobot_summaries",
    metadata,
    sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
    sa.Column("variant", sa.String(32), nullable=False),
    sa.Column("period_start", sa.Date(), nullable=False),
    sa.Column("content", sa.Text(), nullable=False),
    sa.Column("generated_at", sa.DateTime(timezone=True)),
    sa.Column("source_created_at", sa.Text()),
    *_source_columns(),
)

hisobot_report_artifacts = sa.Table(
    "hisobot_report_artifacts",
    metadata,
    sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
    sa.Column("scope", sa.String(16), nullable=False),
    sa.Column("period_type", sa.String(16), nullable=False),
    sa.Column("period_start", sa.Date(), nullable=False),
    sa.Column("period_end", sa.Date()),
    sa.Column("legacy_file_path", sa.Text(), nullable=False),
    sa.Column("source_file_name", sa.Text(), nullable=False),
    sa.Column("source_file_sha256", sa.String(64), nullable=False),
    sa.Column("source_file_size", sa.BigInteger(), nullable=False),
    sa.Column("object_key", sa.Text(), nullable=False),
    sa.Column("storage_status", sa.String(24), nullable=False),
    sa.Column("created_at", sa.DateTime(timezone=True)),
    sa.Column("source_created_at", sa.Text()),
    sa.Column("report_count", sa.Integer(), nullable=False),
    sa.Column("missing_count", sa.Integer(), nullable=False),
    *_source_columns(),
)

hisobot_legacy_archive_files = sa.Table(
    "hisobot_legacy_archive_files",
    metadata,
    sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
    sa.Column("relative_path", sa.Text(), nullable=False),
    sa.Column("file_name", sa.Text(), nullable=False),
    sa.Column("file_extension", sa.String(16), nullable=False),
    sa.Column("file_sha256", sa.String(64), nullable=False),
    sa.Column("file_size", sa.BigInteger(), nullable=False),
    sa.Column("object_key", sa.Text(), nullable=False),
    sa.Column("referenced_by_package", sa.Boolean(), nullable=False),
    sa.Column("storage_status", sa.String(24), nullable=False),
    *_source_columns(),
)

hisobot_legacy_delivery_states = sa.Table(
    "hisobot_legacy_delivery_states",
    metadata,
    sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
    sa.Column("delivery_type", sa.String(48), nullable=False),
    sa.Column("period_key", sa.String(32), nullable=False),
    sa.Column("telegram_identity_id", postgresql.UUID(as_uuid=True), nullable=False),
    sa.Column("legacy_status", sa.String(64), nullable=False),
    sa.Column("attempt_count", sa.Integer(), nullable=False),
    sa.Column("sent_at", sa.DateTime(timezone=True)),
    sa.Column("source_sent_at", sa.Text()),
    sa.Column("last_error", sa.Text()),
    *_source_columns(),
)

hisobot_legacy_reminder_states = sa.Table(
    "hisobot_legacy_reminder_states",
    metadata,
    sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
    sa.Column("reminder_type", sa.String(32), nullable=False),
    sa.Column("report_date", sa.Date(), nullable=False),
    sa.Column("reminder_slot", sa.String(32)),
    sa.Column("telegram_identity_id", postgresql.UUID(as_uuid=True), nullable=False),
    sa.Column("legacy_status", sa.String(64), nullable=False),
    sa.Column("attempt_count", sa.Integer(), nullable=False),
    sa.Column("sent_at", sa.DateTime(timezone=True)),
    sa.Column("source_sent_at", sa.Text()),
    sa.Column("last_error", sa.Text()),
    *_source_columns(),
)

hisobot_legacy_ui_messages = sa.Table(
    "hisobot_legacy_ui_messages",
    metadata,
    sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
    sa.Column("chat_id", sa.BigInteger(), nullable=False),
    sa.Column("message_id", sa.BigInteger(), nullable=False),
    sa.Column("source_created_at", sa.Text()),
    *_source_columns(),
)

TARGET_TABLES: dict[str, sa.Table] = {
    table.name: table
    for table in (
        hisobot_reports,
        hisobot_vacations,
        hisobot_legacy_user_preferences,
        hisobot_summaries,
        hisobot_report_artifacts,
        hisobot_legacy_archive_files,
        hisobot_legacy_delivery_states,
        hisobot_legacy_reminder_states,
        hisobot_legacy_ui_messages,
    )
}
