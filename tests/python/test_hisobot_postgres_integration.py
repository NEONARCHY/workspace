from __future__ import annotations

import asyncio
import os
import sqlite3
from pathlib import Path

import pytest

from hisobot_import.source import EXPECTED_TABLE_COLUMNS, ArchiveFile, inspect_snapshot
from hisobot_import.writer import apply_snapshot


class RecordingObjectStore:
    def __init__(self) -> None:
        self.keys: set[str] = set()

    def ensure_object(self, object_key: str, source: ArchiveFile) -> None:
        assert source.path.is_file()
        self.keys.add(object_key)


def _create_source(path: Path) -> None:
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
        (1, "employee-qa", "2026-09-02", "qa", "2026-09-02 18:00:00", 0, "a", "b"),
    )
    connection.execute(
        """
        INSERT INTO packages(report_date, file_path, created_at, report_count, missing_count)
        VALUES (?, ?, ?, ?, ?)
        """,
        ("2026-09-02", r"C:\legacy\Daily.pdf", "2026-09-02 18:00:00", 1, 0),
    )
    connection.commit()
    connection.close()


@pytest.mark.postgres
def test_postgres_import_is_idempotent(tmp_path: Path) -> None:
    database_url = os.environ.get("YUKSALISH_TEST_DATABASE_URL")
    if not database_url:
        pytest.skip("YUKSALISH_TEST_DATABASE_URL is not configured")

    database = tmp_path / "hisobot.sqlite3"
    archive = tmp_path / "archive"
    archive.mkdir()
    (archive / "Daily.pdf").write_bytes(b"pdf integration fixture")
    _create_source(database)
    before = database.read_bytes()
    fingerprint = str(inspect_snapshot(database, archive)["snapshot_fingerprint"])
    object_store = RecordingObjectStore()

    first = asyncio.run(
        apply_snapshot(
            database_path=database,
            archive_root=archive,
            database_url=database_url,
            expected_fingerprint=fingerprint,
            object_store=object_store,
        )
    )
    second = asyncio.run(
        apply_snapshot(
            database_path=database,
            archive_root=archive,
            database_url=database_url,
            expected_fingerprint=fingerprint,
            object_store=object_store,
        )
    )

    assert first.status == "validated"
    assert first.reused is False
    assert first.source_counts["archive_files"] == 1
    assert first.target_counts["items"] == {"imported": 3}
    assert first.target_counts["entities"]["hisobot_reports"] == 1
    assert first.target_counts["entities"]["hisobot_report_artifacts"] == 1
    assert first.target_counts["entities"]["hisobot_legacy_archive_files"] == 1
    assert second.reused is True
    assert second.run_id == first.run_id
    assert len(object_store.keys) == 1
    assert database.read_bytes() == before
