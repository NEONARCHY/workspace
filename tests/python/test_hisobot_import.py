from __future__ import annotations

import json
import sqlite3
from pathlib import Path

from hisobot_import.cli import main
from hisobot_import.mapping import load_mapping, validate_mapping
from hisobot_import.source import EXPECTED_TABLE_COLUMNS, inspect_snapshot


def create_source_database(path: Path) -> None:
    connection = sqlite3.connect(path)
    for table, columns in EXPECTED_TABLE_COLUMNS.items():
        definition = ", ".join(f'"{column}" TEXT' for column in columns)
        connection.execute(f'CREATE TABLE "{table}" ({definition})')
    connection.execute(
        """
        INSERT INTO reports(
            id, employee_key, report_date, content, submitted_at, is_late, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        ("1", "employee-1", "2026-08-03", "fixture", "2026-08-03T18:00:00", "1", "a", "b"),
    )
    connection.execute(
        """
        INSERT INTO packages(report_date, file_path, created_at, report_count, missing_count)
        VALUES (?, ?, ?, ?, ?)
        """,
        ("2026-08-03", r"C:\\legacy\\Daily.pdf", "now", "1", "0"),
    )
    connection.commit()
    connection.close()


def test_mapping_covers_every_legacy_table_once() -> None:
    mapping = load_mapping()

    assert validate_mapping(mapping) == []
    assert len(mapping["tables"]) == len(EXPECTED_TABLE_COLUMNS)


def test_snapshot_inspection_is_read_only_and_rebases_archive(tmp_path: Path) -> None:
    database = tmp_path / "hisobot.sqlite3"
    archive = tmp_path / "archive"
    archive.mkdir()
    (archive / "Daily.pdf").write_bytes(b"pdf fixture")
    create_source_database(database)
    before = database.read_bytes()

    result = inspect_snapshot(database, archive)

    assert result["database"]["integrity"] == "ok"
    assert result["database"]["schema_issues"] == []
    assert result["table_counts"]["reports"] == 1
    assert result["reports"]["employee_count"] == 1
    assert result["reports"]["late_count"] == 1
    assert result["package_paths"] == {
        "total": 1,
        "direct": 0,
        "rebase_unique": 1,
        "missing": 0,
        "ambiguous": 0,
    }
    assert len(result["snapshot_fingerprint"]) == 64
    assert database.read_bytes() == before
    assert not (tmp_path / "hisobot.sqlite3-wal").exists()


def test_cli_outputs_machine_readable_results(tmp_path: Path, capsys: object) -> None:
    database = tmp_path / "hisobot.sqlite3"
    create_source_database(database)

    assert main(["validate-mapping"]) == 0
    mapping_output = json.loads(capsys.readouterr().out)  # type: ignore[attr-defined]
    assert mapping_output == {"valid": True, "issues": []}

    assert main(["inspect", "--database", str(database)]) == 0
    inspection_output = json.loads(capsys.readouterr().out)  # type: ignore[attr-defined]
    assert inspection_output["table_counts"]["reports"] == 1
