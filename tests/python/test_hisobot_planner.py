from __future__ import annotations

import sqlite3
import uuid
from pathlib import Path

import pytest

from hisobot_import.mapping import load_mapping
from hisobot_import.planner import (
    RowQuarantineError,
    identity_record,
    payload_hash,
    plan_archive_file,
    plan_source_row,
    source_key_hash,
)
from hisobot_import.source import (
    EXPECTED_TABLE_COLUMNS,
    build_archive_index,
    read_source_rows,
)

RUN_ID = uuid.UUID("e8825aa1-6801-4d1c-81ad-05bb23f68441")


def _sample_rows() -> dict[str, dict[str, object]]:
    delivery = {
        "report_date": "2026-08-03",
        "telegram_id": 101,
        "status": "sent",
        "attempt_count": 1,
        "sent_at": "2026-08-03 18:00:00",
        "last_error": None,
    }
    weekly_delivery = {
        "week_end": "2026-08-09",
        "telegram_id": 101,
        "status": "failed",
        "attempt_count": 2,
        "sent_at": None,
        "last_error": "timeout",
    }
    return {
        "reports": {
            "id": 1,
            "employee_key": "employee-1",
            "report_date": "2026-08-03",
            "content": "fixture",
            "submitted_at": "2026-08-03 18:00:00",
            "is_late": 1,
            "created_at": "2026-08-03 18:00:00",
            "updated_at": "2026-08-03 18:01:00",
        },
        "vacations": {
            "employee_key": "employee-1",
            "through_date": "2026-08-10",
            "created_by_telegram_id": 101,
            "created_at": "2026-08-03 18:00:00",
        },
        "user_preferences": {"telegram_id": 101, "language": "uz"},
        "daily_summaries": {
            "report_date": "2026-08-03",
            "content": "summary",
            "created_at": "2026-08-03 18:00:00",
        },
        "hudud_daily_summaries": {
            "report_date": "2026-08-03",
            "content": "hudud summary",
            "created_at": "2026-08-03 18:00:00",
        },
        "packages": {
            "report_date": "2026-08-03",
            "file_path": r"C:\legacy\Daily.pdf",
            "created_at": "2026-08-03 18:00:00",
            "report_count": 1,
            "missing_count": 0,
        },
        "hudud_packages": {
            "report_date": "2026-08-03",
            "file_path": r"C:\legacy\Hudud.pdf",
            "created_at": "2026-08-03 18:00:00",
            "report_count": 1,
            "missing_count": 0,
        },
        "weekly_packages": {
            "week_end": "2026-08-09",
            "week_start": "2026-08-03",
            "file_path": r"C:\legacy\Weekly.pdf",
            "created_at": "2026-08-09 18:00:00",
            "report_count": 5,
            "missing_count": 1,
        },
        "hudud_weekly_packages": {
            "week_end": "2026-08-09",
            "week_start": "2026-08-03",
            "file_path": r"C:\legacy\HududWeekly.pdf",
            "created_at": "2026-08-09 18:00:00",
            "report_count": 5,
            "missing_count": 1,
        },
        "deliveries": dict(delivery),
        "summary_deliveries": dict(delivery),
        "hudud_deliveries": dict(delivery),
        "hudud_summary_deliveries": dict(delivery),
        "weekly_deliveries": dict(weekly_delivery),
        "hudud_weekly_deliveries": dict(weekly_delivery),
        "reminders": dict(delivery),
        "reminder_events": {
            "report_date": "2026-08-03",
            "reminder_slot": "17:30",
            "telegram_id": 101,
            "status": "sent",
            "attempt_count": 1,
            "sent_at": "2026-08-03 17:30:00",
            "last_error": None,
        },
        "ui_messages": {
            "chat_id": -1001,
            "message_id": 42,
            "created_at": "2026-08-03 18:00:00",
        },
    }


def _create_full_source(path: Path) -> None:
    rows = _sample_rows()
    connection = sqlite3.connect(path)
    for table, columns in EXPECTED_TABLE_COLUMNS.items():
        definition = ", ".join(f'"{column}" TEXT' for column in columns)
        connection.execute(f'CREATE TABLE "{table}" ({definition})')
        row = rows[table]
        column_sql = ", ".join(f'"{column}"' for column in row)
        placeholders = ", ".join("?" for _ in row)
        connection.execute(
            f'INSERT INTO "{table}" ({column_sql}) VALUES ({placeholders})',
            tuple(row.values()),
        )
    connection.commit()
    connection.close()


def test_planner_covers_every_mapping_and_normalizes_values(tmp_path: Path) -> None:
    database = tmp_path / "source.sqlite3"
    archive = tmp_path / "archive"
    archive.mkdir()
    for filename in ("Daily.pdf", "Hudud.pdf", "Weekly.pdf", "HududWeekly.pdf"):
        (archive / filename).write_bytes(f"fixture:{filename}".encode())
    _create_full_source(database)
    archive_index = build_archive_index(archive)
    mapping = load_mapping()

    planned = []
    for item in mapping["tables"]:
        source_table = str(item["source"])
        row = read_source_rows(database, source_table)[0]
        result = plan_source_row(
            source_table,
            [str(value) for value in item["source_key"]],
            row,
            RUN_ID,
            archive_index,
        )
        assert result.target_table == item["target"]
        assert len(result.source_key_hash) == 64
        assert len(result.source_payload_hash) == 64
        planned.append(result)

    assert len(planned) == len(EXPECTED_TABLE_COLUMNS)
    report = next(item for item in planned if item.source_table == "reports")
    assert report.target_values["submitted_at"].isoformat() == "2026-08-03T13:00:00+00:00"
    assert report.target_values["is_late"] is True
    artifact = next(item for item in planned if item.source_table == "packages")
    assert artifact.target_values["object_key"].startswith("hisobot/legacy/central/daily/2026/")


def test_hashes_and_identity_ids_are_stable_and_do_not_expose_source_values() -> None:
    row = {"employee_key": "sensitive-key", "report_date": "2026-08-03"}
    first = source_key_hash(row, ["employee_key", "report_date"])
    second = source_key_hash(dict(reversed(list(row.items()))), ["employee_key", "report_date"])

    assert first == second
    assert "sensitive-key" not in first
    assert payload_hash(row) == payload_hash(dict(reversed(list(row.items()))))
    assert identity_record("employee_key", "employee-1") == identity_record(
        "employee_key", "employee-1"
    )


def test_archive_inventory_plans_linked_and_unlinked_objects(tmp_path: Path) -> None:
    file_path = tmp_path / "legacy.DOCX"
    file_path.write_bytes(b"docx")
    archive_file = build_archive_index(tmp_path)["legacy.docx"][0]

    unlinked = plan_archive_file(archive_file, RUN_ID)
    linked = plan_archive_file(archive_file, RUN_ID, "hisobot/linked/document.docx")

    assert unlinked.target_table == "hisobot_legacy_archive_files"
    assert unlinked.target_values["file_extension"] == ".docx"
    assert unlinked.target_values["referenced_by_package"] is False
    assert unlinked.target_values["object_key"].startswith(
        "hisobot/legacy/archive/unlinked/"
    )
    assert linked.target_values["referenced_by_package"] is True
    assert linked.target_values["object_key"] == "hisobot/linked/document.docx"
    assert linked.target_id == unlinked.target_id


@pytest.mark.parametrize(
    ("table", "change", "error_code"),
    [
        ("reports", {"is_late": 3}, "invalid_boolean"),
        ("reports", {"report_date": "03.08.2026"}, "invalid_date"),
        ("reports", {"submitted_at": "not-a-time"}, "invalid_datetime"),
        ("reports", {"employee_key": ""}, "source_key_empty"),
        ("packages", {"file_path": r"C:\legacy\Missing.pdf"}, "archive_file_missing"),
    ],
)
def test_invalid_rows_are_quarantinable(
    tmp_path: Path,
    table: str,
    change: dict[str, object],
    error_code: str,
) -> None:
    rows = _sample_rows()
    rows[table].update(change)
    archive = tmp_path / "archive"
    archive.mkdir()
    (archive / "Daily.pdf").write_bytes(b"one")
    archive_index = build_archive_index(archive)
    mapping = {str(item["source"]): item for item in load_mapping()["tables"]}

    with pytest.raises(RowQuarantineError) as caught:
        plan_source_row(
            table,
            [str(value) for value in mapping[table]["source_key"]],
            rows[table],
            RUN_ID,
            archive_index,
        )

    assert caught.value.error_code == error_code


def test_ambiguous_or_absent_archive_is_quarantinable(tmp_path: Path) -> None:
    row = _sample_rows()["packages"]
    mapping = {str(item["source"]): item for item in load_mapping()["tables"]}["packages"]
    archive = tmp_path / "archive"
    (archive / "a").mkdir(parents=True)
    (archive / "b").mkdir()
    (archive / "a" / "Daily.pdf").write_bytes(b"one")
    (archive / "b" / "daily.PDF").write_bytes(b"two")

    with pytest.raises(RowQuarantineError, match="Multiple") as ambiguous:
        plan_source_row(
            "packages",
            [str(value) for value in mapping["source_key"]],
            row,
            RUN_ID,
            build_archive_index(archive),
        )
    assert ambiguous.value.error_code == "archive_file_ambiguous"

    with pytest.raises(RowQuarantineError) as absent:
        plan_source_row(
            "packages",
            [str(value) for value in mapping["source_key"]],
            row,
            RUN_ID,
            None,
        )
    assert absent.value.error_code == "archive_not_provided"


def test_unknown_source_table_and_source_reader_are_rejected(tmp_path: Path) -> None:
    with pytest.raises(RowQuarantineError) as caught:
        plan_source_row("unknown", ["id"], {"id": 1}, RUN_ID)
    assert caught.value.error_code == "unsupported_source_table"

    with pytest.raises(ValueError, match="Unknown source table"):
        read_source_rows(tmp_path / "missing.sqlite3", "unknown")
