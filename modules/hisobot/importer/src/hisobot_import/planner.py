from __future__ import annotations

import hashlib
import json
import uuid
from dataclasses import dataclass
from datetime import UTC, date, datetime
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

from .source import ArchiveFile, legacy_basename

SOURCE_SYSTEM = "yuksalish_hisobot_sqlite"
IDENTITY_NAMESPACE = uuid.UUID("4bb5ee51-ab01-4f31-9c79-70ef5936ae77")
TARGET_NAMESPACE = uuid.UUID("7003662d-5f82-443f-a69a-7dcf7ba8bf03")
TASHKENT = ZoneInfo("Asia/Tashkent")

SUMMARY_VARIANTS = {
    "daily_summaries": "central_daily",
    "hudud_daily_summaries": "hudud_daily",
}
ARTIFACT_TYPES = {
    "packages": ("central", "daily"),
    "hudud_packages": ("hudud", "daily"),
    "weekly_packages": ("central", "weekly"),
    "hudud_weekly_packages": ("hudud", "weekly"),
}
DELIVERY_TABLES = {
    "deliveries",
    "summary_deliveries",
    "hudud_deliveries",
    "hudud_summary_deliveries",
    "weekly_deliveries",
    "hudud_weekly_deliveries",
}
REMINDER_TABLES = {"reminders", "reminder_events"}


class RowQuarantineError(ValueError):
    def __init__(self, error_code: str, detail: str) -> None:
        super().__init__(detail)
        self.error_code = error_code
        self.detail = detail


@dataclass(frozen=True)
class IdentityRecord:
    id: uuid.UUID
    identifier_type: str
    identifier_hash: str
    identifier_value: str


@dataclass(frozen=True)
class PlannedRow:
    source_table: str
    source_key_hash: str
    source_payload_hash: str
    source_payload: dict[str, Any]
    target_table: str
    target_id: uuid.UUID
    target_values: dict[str, Any]
    identities: tuple[IdentityRecord, ...] = ()
    archive_file: ArchiveFile | None = None


def _jsonable(value: Any) -> Any:
    if isinstance(value, bytes):
        return {"bytes_sha256": hashlib.sha256(value).hexdigest(), "length": len(value)}
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    return value


def canonical_json(payload: Any) -> str:
    return json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def payload_hash(row: dict[str, Any]) -> str:
    return hashlib.sha256(canonical_json(normalize_payload(row)).encode("utf-8")).hexdigest()


def normalize_payload(row: dict[str, Any]) -> dict[str, Any]:
    return {key: _jsonable(value) for key, value in row.items()}


def source_key_hash(row: dict[str, Any], columns: list[str]) -> str:
    try:
        key = {column: _jsonable(row[column]) for column in columns}
    except KeyError as error:
        raise RowQuarantineError("source_key_missing", str(error)) from error
    if any(value is None or value == "" for value in key.values()):
        raise RowQuarantineError("source_key_empty", "One or more source key values are empty")
    return hashlib.sha256(canonical_json(key).encode("utf-8")).hexdigest()


def identity_record(identifier_type: str, value: Any) -> IdentityRecord:
    if value is None or str(value) == "":
        raise RowQuarantineError("identity_missing", f"Missing {identifier_type}")
    normalized = str(value)
    identifier_hash = hashlib.sha256(
        f"{SOURCE_SYSTEM}:{identifier_type}:{normalized}".encode()
    ).hexdigest()
    return IdentityRecord(
        id=uuid.uuid5(IDENTITY_NAMESPACE, identifier_hash),
        identifier_type=identifier_type,
        identifier_hash=identifier_hash,
        identifier_value=normalized,
    )


def _required_text(value: Any, field: str) -> str:
    if value is None:
        raise RowQuarantineError("invalid_text", f"{field} is null")
    return str(value)


def _date(value: Any, field: str) -> date:
    try:
        return date.fromisoformat(_required_text(value, field))
    except ValueError as error:
        raise RowQuarantineError("invalid_date", f"{field} is not an ISO date") from error


def _datetime(value: Any, field: str) -> datetime | None:
    if value is None or value == "":
        return None
    try:
        parsed = datetime.fromisoformat(str(value))
    except ValueError as error:
        raise RowQuarantineError("invalid_datetime", f"{field} is not ISO-like") from error
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=TASHKENT)
    return parsed.astimezone(UTC)


def _integer(value: Any, field: str) -> int:
    try:
        return int(value)
    except (TypeError, ValueError) as error:
        raise RowQuarantineError("invalid_integer", f"{field} is not an integer") from error


def _boolean01(value: Any, field: str) -> bool:
    integer = _integer(value, field)
    if integer not in {0, 1}:
        raise RowQuarantineError("invalid_boolean", f"{field} must be 0 or 1")
    return bool(integer)


def _base_values(
    source_table: str,
    key_hash: str,
    row_hash: str,
    run_id: uuid.UUID,
) -> dict[str, Any]:
    return {
        "id": uuid.uuid5(TARGET_NAMESPACE, f"{SOURCE_SYSTEM}:{source_table}:{key_hash}"),
        "source_table": source_table,
        "source_key_hash": key_hash,
        "source_payload_hash": row_hash,
        "first_import_run_id": run_id,
    }


def _artifact_file(
    raw_path: str,
    archive_index: dict[str, tuple[ArchiveFile, ...]] | None,
) -> ArchiveFile:
    if archive_index is None:
        raise RowQuarantineError("archive_not_provided", "Archive is required for package rows")
    matches = archive_index.get(legacy_basename(raw_path).casefold(), ())
    if not matches:
        raise RowQuarantineError("archive_file_missing", "No archive file matches the basename")
    if len(matches) > 1:
        raise RowQuarantineError("archive_file_ambiguous", "Multiple archive files match basename")
    return matches[0]


def plan_archive_file(
    archive_file: ArchiveFile,
    run_id: uuid.UUID,
    referenced_object_key: str | None = None,
) -> PlannedRow:
    key_hash = hashlib.sha256(archive_file.relative_path.encode()).hexdigest()
    source_payload = {
        "relative_path": archive_file.relative_path,
        "sha256": archive_file.sha256,
        "size": archive_file.size,
    }
    row_hash = hashlib.sha256(canonical_json(source_payload).encode()).hexdigest()
    extension = archive_file.path.suffix.lower()
    object_key = referenced_object_key or (
        f"hisobot/legacy/archive/unlinked/{archive_file.sha256}{extension}"
    )
    target_id = uuid.uuid5(TARGET_NAMESPACE, f"{SOURCE_SYSTEM}:archive_files:{key_hash}")
    target_values = {
        "id": target_id,
        "relative_path": archive_file.relative_path,
        "file_name": archive_file.path.name,
        "file_extension": extension,
        "file_sha256": archive_file.sha256,
        "file_size": archive_file.size,
        "object_key": object_key,
        "referenced_by_package": referenced_object_key is not None,
        "storage_status": "verified_local",
        "source_table": "archive_files",
        "source_key_hash": key_hash,
        "source_payload_hash": row_hash,
        "first_import_run_id": run_id,
    }
    return PlannedRow(
        source_table="archive_files",
        source_key_hash=key_hash,
        source_payload_hash=row_hash,
        source_payload=source_payload,
        target_table="hisobot_legacy_archive_files",
        target_id=target_id,
        target_values=target_values,
        archive_file=archive_file,
    )


def plan_source_row(
    source_table: str,
    source_key_columns: list[str],
    row: dict[str, Any],
    run_id: uuid.UUID,
    archive_index: dict[str, tuple[ArchiveFile, ...]] | None = None,
) -> PlannedRow:
    key_hash = source_key_hash(row, source_key_columns)
    row_hash = payload_hash(row)
    source_payload = normalize_payload(row)
    values = _base_values(source_table, key_hash, row_hash, run_id)
    identities: list[IdentityRecord] = []
    archive_file: ArchiveFile | None = None

    if source_table == "reports":
        employee = identity_record("employee_key", row["employee_key"])
        identities.append(employee)
        values.update(
            employee_identity_id=employee.id,
            report_date=_date(row["report_date"], "report_date"),
            content=_required_text(row["content"], "content"),
            submitted_at=_datetime(row["submitted_at"], "submitted_at"),
            source_submitted_at=row["submitted_at"],
            is_late=_boolean01(row["is_late"], "is_late"),
            source_created_at=row["created_at"],
            source_updated_at=row["updated_at"],
        )
        target_table = "hisobot_reports"
    elif source_table == "vacations":
        employee = identity_record("employee_key", row["employee_key"])
        identities.append(employee)
        creator = None
        if row["created_by_telegram_id"] not in {None, ""}:
            creator = identity_record("telegram_id", row["created_by_telegram_id"])
            identities.append(creator)
        values.update(
            employee_identity_id=employee.id,
            through_date=_date(row["through_date"], "through_date"),
            created_by_identity_id=creator.id if creator else None,
            source_created_at=row["created_at"],
        )
        target_table = "hisobot_vacations"
    elif source_table == "user_preferences":
        telegram = identity_record("telegram_id", row["telegram_id"])
        identities.append(telegram)
        values.update(
            telegram_identity_id=telegram.id,
            language=_required_text(row["language"], "language"),
        )
        target_table = "hisobot_legacy_user_preferences"
    elif source_table in SUMMARY_VARIANTS:
        values.update(
            variant=SUMMARY_VARIANTS[source_table],
            period_start=_date(row["report_date"], "report_date"),
            content=_required_text(row["content"], "content"),
            generated_at=_datetime(row["created_at"], "created_at"),
            source_created_at=row["created_at"],
        )
        target_table = "hisobot_summaries"
    elif source_table in ARTIFACT_TYPES:
        scope, period_type = ARTIFACT_TYPES[source_table]
        period_column = "report_date" if period_type == "daily" else "week_start"
        raw_path = _required_text(row["file_path"], "file_path")
        archive_file = _artifact_file(raw_path, archive_index)
        extension = Path(archive_file.path.name).suffix.lower()
        object_key = (
            f"hisobot/legacy/{scope}/{period_type}/"
            f"{_date(row[period_column], period_column).year}/"
            f"{archive_file.sha256}{extension}"
        )
        values.update(
            scope=scope,
            period_type=period_type,
            period_start=_date(row[period_column], period_column),
            period_end=(
                _date(row["week_end"], "week_end") if period_type == "weekly" else None
            ),
            legacy_file_path=raw_path,
            source_file_name=archive_file.path.name,
            source_file_sha256=archive_file.sha256,
            source_file_size=archive_file.size,
            object_key=object_key,
            storage_status="verified_local",
            created_at=_datetime(row["created_at"], "created_at"),
            source_created_at=row["created_at"],
            report_count=_integer(row["report_count"], "report_count"),
            missing_count=_integer(row["missing_count"], "missing_count"),
        )
        target_table = "hisobot_report_artifacts"
    elif source_table in DELIVERY_TABLES:
        telegram = identity_record("telegram_id", row["telegram_id"])
        identities.append(telegram)
        period_column = "week_end" if "weekly" in source_table else "report_date"
        values.update(
            delivery_type=source_table,
            period_key=_required_text(row[period_column], period_column),
            telegram_identity_id=telegram.id,
            legacy_status=_required_text(row["status"], "status"),
            attempt_count=_integer(row["attempt_count"], "attempt_count"),
            sent_at=_datetime(row["sent_at"], "sent_at"),
            source_sent_at=row["sent_at"],
            last_error=row["last_error"],
        )
        target_table = "hisobot_legacy_delivery_states"
    elif source_table in REMINDER_TABLES:
        telegram = identity_record("telegram_id", row["telegram_id"])
        identities.append(telegram)
        values.update(
            reminder_type="event" if source_table == "reminder_events" else "daily",
            report_date=_date(row["report_date"], "report_date"),
            reminder_slot=row.get("reminder_slot"),
            telegram_identity_id=telegram.id,
            legacy_status=_required_text(row["status"], "status"),
            attempt_count=_integer(row["attempt_count"], "attempt_count"),
            sent_at=_datetime(row["sent_at"], "sent_at"),
            source_sent_at=row["sent_at"],
            last_error=row["last_error"],
        )
        target_table = "hisobot_legacy_reminder_states"
    elif source_table == "ui_messages":
        values.update(
            chat_id=_integer(row["chat_id"], "chat_id"),
            message_id=_integer(row["message_id"], "message_id"),
            source_created_at=row["created_at"],
        )
        target_table = "hisobot_legacy_ui_messages"
    else:
        raise RowQuarantineError("unsupported_source_table", source_table)

    return PlannedRow(
        source_table=source_table,
        source_key_hash=key_hash,
        source_payload_hash=row_hash,
        source_payload=source_payload,
        target_table=target_table,
        target_id=uuid.UUID(str(values["id"])),
        target_values=values,
        identities=tuple(identities),
        archive_file=archive_file,
    )
