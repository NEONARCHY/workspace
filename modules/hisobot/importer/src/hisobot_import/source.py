from __future__ import annotations

import hashlib
import json
import sqlite3
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path, PureWindowsPath
from typing import Any

EXPECTED_TABLE_COLUMNS: dict[str, tuple[str, ...]] = {
    "daily_summaries": ("report_date", "content", "created_at"),
    "deliveries": (
        "report_date",
        "telegram_id",
        "status",
        "attempt_count",
        "sent_at",
        "last_error",
    ),
    "hudud_daily_summaries": ("report_date", "content", "created_at"),
    "hudud_deliveries": (
        "report_date",
        "telegram_id",
        "status",
        "attempt_count",
        "sent_at",
        "last_error",
    ),
    "hudud_packages": (
        "report_date",
        "file_path",
        "created_at",
        "report_count",
        "missing_count",
    ),
    "hudud_summary_deliveries": (
        "report_date",
        "telegram_id",
        "status",
        "attempt_count",
        "sent_at",
        "last_error",
    ),
    "hudud_weekly_deliveries": (
        "week_end",
        "telegram_id",
        "status",
        "attempt_count",
        "sent_at",
        "last_error",
    ),
    "hudud_weekly_packages": (
        "week_end",
        "week_start",
        "file_path",
        "created_at",
        "report_count",
        "missing_count",
    ),
    "packages": (
        "report_date",
        "file_path",
        "created_at",
        "report_count",
        "missing_count",
    ),
    "reminder_events": (
        "report_date",
        "reminder_slot",
        "telegram_id",
        "status",
        "attempt_count",
        "sent_at",
        "last_error",
    ),
    "reminders": (
        "report_date",
        "telegram_id",
        "status",
        "attempt_count",
        "sent_at",
        "last_error",
    ),
    "reports": (
        "id",
        "employee_key",
        "report_date",
        "content",
        "submitted_at",
        "is_late",
        "created_at",
        "updated_at",
    ),
    "summary_deliveries": (
        "report_date",
        "telegram_id",
        "status",
        "attempt_count",
        "sent_at",
        "last_error",
    ),
    "ui_messages": ("chat_id", "message_id", "created_at"),
    "user_preferences": ("telegram_id", "language"),
    "vacations": ("employee_key", "through_date", "created_by_telegram_id", "created_at"),
    "weekly_deliveries": (
        "week_end",
        "telegram_id",
        "status",
        "attempt_count",
        "sent_at",
        "last_error",
    ),
    "weekly_packages": (
        "week_end",
        "week_start",
        "file_path",
        "created_at",
        "report_count",
        "missing_count",
    ),
}

PACKAGE_TABLES = ("packages", "hudud_packages", "weekly_packages", "hudud_weekly_packages")

TABLE_COUNT_QUERIES = {
    "daily_summaries": "SELECT COUNT(*) FROM daily_summaries",
    "deliveries": "SELECT COUNT(*) FROM deliveries",
    "hudud_daily_summaries": "SELECT COUNT(*) FROM hudud_daily_summaries",
    "hudud_deliveries": "SELECT COUNT(*) FROM hudud_deliveries",
    "hudud_packages": "SELECT COUNT(*) FROM hudud_packages",
    "hudud_summary_deliveries": "SELECT COUNT(*) FROM hudud_summary_deliveries",
    "hudud_weekly_deliveries": "SELECT COUNT(*) FROM hudud_weekly_deliveries",
    "hudud_weekly_packages": "SELECT COUNT(*) FROM hudud_weekly_packages",
    "packages": "SELECT COUNT(*) FROM packages",
    "reminder_events": "SELECT COUNT(*) FROM reminder_events",
    "reminders": "SELECT COUNT(*) FROM reminders",
    "reports": "SELECT COUNT(*) FROM reports",
    "summary_deliveries": "SELECT COUNT(*) FROM summary_deliveries",
    "ui_messages": "SELECT COUNT(*) FROM ui_messages",
    "user_preferences": "SELECT COUNT(*) FROM user_preferences",
    "vacations": "SELECT COUNT(*) FROM vacations",
    "weekly_deliveries": "SELECT COUNT(*) FROM weekly_deliveries",
    "weekly_packages": "SELECT COUNT(*) FROM weekly_packages",
}

PACKAGE_PATH_QUERIES = {
    "packages": "SELECT file_path FROM packages",
    "hudud_packages": "SELECT file_path FROM hudud_packages",
    "weekly_packages": "SELECT file_path FROM weekly_packages",
    "hudud_weekly_packages": "SELECT file_path FROM hudud_weekly_packages",
}

SOURCE_ROW_QUERIES = {
    table: "SELECT " + ", ".join(f'"{column}"' for column in columns) + f' FROM "{table}"'
    for table, columns in EXPECTED_TABLE_COLUMNS.items()
}


@dataclass(frozen=True)
class ArchiveFile:
    path: Path
    relative_path: str
    sha256: str
    size: int


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _open_immutable(path: Path) -> sqlite3.Connection:
    connection = sqlite3.connect(f"{path.resolve().as_uri()}?mode=ro&immutable=1", uri=True)
    connection.row_factory = sqlite3.Row
    return connection


def _schema_fingerprint(connection: sqlite3.Connection) -> str:
    rows = connection.execute(
        """
        SELECT type, name, tbl_name, sql
        FROM sqlite_master
        WHERE sql IS NOT NULL
        ORDER BY type, name
        """
    ).fetchall()
    normalized = "\n".join("|".join(str(value or "") for value in row) for row in rows)
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()


def validate_source_schema(connection: sqlite3.Connection) -> list[str]:
    actual_tables = {
        str(row[0])
        for row in connection.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
        )
    }
    issues: list[str] = []
    missing_tables = sorted(set(EXPECTED_TABLE_COLUMNS) - actual_tables)
    extra_tables = sorted(actual_tables - set(EXPECTED_TABLE_COLUMNS))
    if missing_tables:
        issues.append(f"missing_tables:{','.join(missing_tables)}")
    if extra_tables:
        issues.append(f"extra_tables:{','.join(extra_tables)}")
    for table, expected_columns in EXPECTED_TABLE_COLUMNS.items():
        if table not in actual_tables:
            continue
        actual_columns = tuple(
            str(row[1]) for row in connection.execute(f'PRAGMA table_info("{table}")')
        )
        if actual_columns != expected_columns:
            issues.append(f"column_mismatch:{table}")
    return issues


def _archive_summary(archive_root: Path | None) -> tuple[dict[str, Any], dict[str, list[Path]]]:
    if archive_root is None:
        return {"provided": False}, {}
    files = sorted(path for path in archive_root.rglob("*") if path.is_file())
    basename_index: dict[str, list[Path]] = defaultdict(list)
    manifest_digest = hashlib.sha256()
    for path in files:
        relative = path.relative_to(archive_root).as_posix()
        file_hash = sha256_file(path)
        manifest_digest.update(f"{file_hash}  {relative}\n".encode())
        basename_index[path.name.casefold()].append(path)
    return (
        {
            "provided": True,
            "file_count": len(files),
            "manifest_sha256": manifest_digest.hexdigest(),
        },
        dict(basename_index),
    )


def _legacy_basename(value: str) -> str:
    return PureWindowsPath(value).name if "\\" in value else Path(value).name


def inspect_snapshot(database_path: Path, archive_root: Path | None = None) -> dict[str, Any]:
    database_path = database_path.resolve()
    if not database_path.is_file():
        raise FileNotFoundError(database_path)
    if archive_root is not None and not archive_root.is_dir():
        raise FileNotFoundError(archive_root)

    database_sha256 = sha256_file(database_path)
    archive, basename_index = _archive_summary(archive_root)
    with _open_immutable(database_path) as connection:
        integrity = str(connection.execute("PRAGMA integrity_check").fetchone()[0])
        schema_sha256 = _schema_fingerprint(connection)
        schema_issues = validate_source_schema(connection)
        table_counts = {
            table: int(connection.execute(TABLE_COUNT_QUERIES[table]).fetchone()[0])
            for table in EXPECTED_TABLE_COLUMNS
            if not any(issue == f"missing_tables:{table}" for issue in schema_issues)
            and table
            in {
                str(row[0])
                for row in connection.execute(
                    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
                )
            }
        }

        reports: dict[str, Any] = {"available": "reports" in table_counts}
        if reports["available"]:
            row = connection.execute(
                """
                SELECT COUNT(*) AS total,
                       COUNT(DISTINCT employee_key) AS employee_count,
                       MIN(report_date) AS first_date,
                       MAX(report_date) AS last_date,
                       SUM(is_late) AS late_count
                FROM reports
                """
            ).fetchone()
            report_keys = ("total", "employee_count", "first_date", "last_date", "late_count")
            reports.update({key: row[key] for key in report_keys})

        path_stats = {"total": 0, "direct": 0, "rebase_unique": 0, "missing": 0, "ambiguous": 0}
        for table in PACKAGE_TABLES:
            if table not in table_counts:
                continue
            for row in connection.execute(PACKAGE_PATH_QUERIES[table]):
                raw_path = str(row[0])
                path_stats["total"] += 1
                if Path(raw_path).is_file():
                    path_stats["direct"] += 1
                    continue
                matches = basename_index.get(_legacy_basename(raw_path).casefold(), [])
                if len(matches) == 1:
                    path_stats["rebase_unique"] += 1
                elif len(matches) > 1:
                    path_stats["ambiguous"] += 1
                else:
                    path_stats["missing"] += 1

    fingerprint_payload = json.dumps(
        {
            "database_sha256": database_sha256,
            "archive_manifest_sha256": archive.get("manifest_sha256"),
            "schema_sha256": schema_sha256,
        },
        sort_keys=True,
        separators=(",", ":"),
    ).encode()
    return {
        "source_system": "yuksalish_hisobot_sqlite",
        "database": {
            "bytes": database_path.stat().st_size,
            "sha256": database_sha256,
            "integrity": integrity,
            "schema_sha256": schema_sha256,
            "schema_issues": schema_issues,
        },
        "archive": archive,
        "snapshot_fingerprint": hashlib.sha256(fingerprint_payload).hexdigest(),
        "table_counts": table_counts,
        "reports": reports,
        "package_paths": path_stats,
    }


def read_source_rows(database_path: Path, table: str) -> list[dict[str, Any]]:
    """Read one known source table through an immutable SQLite connection."""

    query = SOURCE_ROW_QUERIES.get(table)
    if query is None:
        raise ValueError(f"Unknown source table: {table}")
    with _open_immutable(database_path.resolve()) as connection:
        return [dict(row) for row in connection.execute(query)]


def build_archive_index(archive_root: Path) -> dict[str, tuple[ArchiveFile, ...]]:
    """Index archive files by case-insensitive basename with content hashes."""

    archive_root = archive_root.resolve()
    if not archive_root.is_dir():
        raise FileNotFoundError(archive_root)
    index: dict[str, list[ArchiveFile]] = defaultdict(list)
    for path in sorted(item for item in archive_root.rglob("*") if item.is_file()):
        index[path.name.casefold()].append(
            ArchiveFile(
                path=path,
                relative_path=path.relative_to(archive_root).as_posix(),
                sha256=sha256_file(path),
                size=path.stat().st_size,
            )
        )
    return {key: tuple(values) for key, values in index.items()}


def legacy_basename(value: str) -> str:
    return _legacy_basename(value)
