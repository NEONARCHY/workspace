from __future__ import annotations

import asyncio
import json
import uuid
from datetime import UTC, datetime
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from pydantic import SecretStr

from hisobot_import import cli
from hisobot_import import writer as writer_module
from hisobot_import.planner import IdentityRecord, PlannedRow, RowQuarantineError
from hisobot_import.source import ArchiveFile
from hisobot_import.storage import MinioObjectStore
from hisobot_import.writer import (
    ImportConflictError,
    ImportPreflightError,
    ImportResult,
    _ensure_identity,
    _ensure_target_row,
    _get_or_create_run,
    _record_quarantine,
    _target_counts,
    _validate_preflight,
)

RUN_ID = uuid.UUID("5c371c6c-2c45-432c-92db-94ff30e77f22")
NOW = datetime(2026, 9, 2, tzinfo=UTC)


def _inspection() -> dict[str, object]:
    return {
        "database": {"integrity": "ok", "schema_issues": []},
        "snapshot_fingerprint": "f" * 64,
    }


def _mapping() -> dict[str, object]:
    from hisobot_import.mapping import load_mapping

    return load_mapping()


def _planned(row_hash: str = "a" * 64) -> PlannedRow:
    identity = IdentityRecord(
        id=uuid.uuid4(),
        identifier_type="employee_key",
        identifier_hash="b" * 64,
        identifier_value="employee-1",
    )
    return PlannedRow(
        source_table="reports",
        source_key_hash="c" * 64,
        source_payload_hash=row_hash,
        source_payload={"employee_key": "employee-1"},
        target_table="hisobot_reports",
        target_id=uuid.uuid4(),
        target_values={"id": uuid.uuid4()},
        identities=(identity,),
    )


def test_preflight_accepts_exact_snapshot_and_rejects_each_gate() -> None:
    inspection = _inspection()
    mapping = _mapping()
    _validate_preflight(inspection, "f" * 64, mapping)

    bad_integrity = _inspection()
    bad_integrity["database"] = {"integrity": "corrupt", "schema_issues": []}
    with pytest.raises(ImportPreflightError, match="integrity"):
        _validate_preflight(bad_integrity, "f" * 64, mapping)

    bad_schema = _inspection()
    bad_schema["database"] = {"integrity": "ok", "schema_issues": ["missing"]}
    with pytest.raises(ImportPreflightError, match="schema"):
        _validate_preflight(bad_schema, "f" * 64, mapping)

    with pytest.raises(ImportPreflightError, match="fingerprint"):
        _validate_preflight(inspection, "0" * 64, mapping)

    bad_mapping = dict(mapping)
    bad_mapping["version"] = "wrong"
    with pytest.raises(ImportPreflightError, match="Mapping"):
        _validate_preflight(inspection, "f" * 64, bad_mapping)


def test_identity_and_immutable_target_helpers() -> None:
    connection = SimpleNamespace(execute=AsyncMock(), scalar=AsyncMock(return_value=None))
    planned = _planned()

    asyncio.run(_ensure_identity(connection, planned, RUN_ID, NOW))  # type: ignore[arg-type]
    assert connection.execute.await_count == 1

    assert asyncio.run(_ensure_target_row(connection, planned)) is True  # type: ignore[arg-type]
    assert connection.execute.await_count == 2

    connection.scalar.return_value = planned.source_payload_hash
    assert asyncio.run(_ensure_target_row(connection, planned)) is False  # type: ignore[arg-type]

    connection.scalar.return_value = "different"
    with pytest.raises(ImportConflictError, match="Immutable source conflict"):
        asyncio.run(_ensure_target_row(connection, planned))  # type: ignore[arg-type]


def test_quarantine_and_target_count_helpers() -> None:
    connection = SimpleNamespace(execute=AsyncMock(), scalar=AsyncMock(return_value=2))
    error = RowQuarantineError("invalid_date", "report_date is not ISO")

    asyncio.run(
        _record_quarantine(  # type: ignore[arg-type]
            connection,
            run_id=RUN_ID,
            source_table="reports",
            key_hash="c" * 64,
            row_hash="a" * 64,
            source_payload={"report_date": "bad"},
            target_table="hisobot_reports",
            error=error,
            now=NOW,
        )
    )
    assert connection.execute.await_count == 2

    counts = asyncio.run(_target_counts(connection))  # type: ignore[arg-type]
    assert counts["hisobot_reports"] == 2
    assert counts["legacy_identity_links"] == 2


def test_get_or_create_run_covers_new_and_existing_runs() -> None:
    inserted_id = uuid.uuid4()
    connection = SimpleNamespace(
        scalar=AsyncMock(return_value=inserted_id),
        execute=AsyncMock(),
    )
    created = asyncio.run(
        _get_or_create_run(  # type: ignore[arg-type]
            connection,
            source_fingerprint="f" * 64,
            source_counts={"reports": 1},
            source_snapshot_at=NOW,
            now=NOW,
        )
    )
    assert created == (inserted_id, "planned", {})

    existing_id = uuid.uuid4()
    existing_row = SimpleNamespace(
        id=existing_id,
        status="validated",
        target_counts={"entities": {"hisobot_reports": 1}},
    )
    query_result = SimpleNamespace(one=lambda: existing_row)
    connection.scalar.return_value = None
    connection.execute.return_value = query_result
    existing = asyncio.run(
        _get_or_create_run(  # type: ignore[arg-type]
            connection,
            source_fingerprint="f" * 64,
            source_counts={"reports": 1},
            source_snapshot_at=None,
            now=NOW,
        )
    )
    assert existing == (
        existing_id,
        "validated",
        {"entities": {"hisobot_reports": 1}},
    )


def test_import_result_and_cli_apply_output(
    monkeypatch: pytest.MonkeyPatch,
    capsys: object,
) -> None:
    import_result = ImportResult(
        run_id=RUN_ID,
        status="validated",
        reused=False,
        source_fingerprint="f" * 64,
        source_counts={"reports": 1},
        target_counts={"items": {"imported": 1}},
    )

    async def fake_apply(**_: object) -> ImportResult:
        return import_result

    monkeypatch.setattr(cli, "apply_snapshot", fake_apply)
    monkeypatch.setattr(
        cli,
        "get_settings",
        lambda: SimpleNamespace(
            database_url="postgresql+asyncpg://unused",
            s3_endpoint="unused",
            s3_access_key="unused",
            s3_secret_key=SecretStr("unused"),
            s3_bucket="unused",
            s3_secure=False,
        ),
    )

    assert (
        cli.main(
            [
                "apply",
                "--database",
                str(Path("source.sqlite3")),
                "--archive",
                str(Path("archive")),
                "--confirm-fingerprint",
                "f" * 64,
            ]
        )
        == 0
    )
    output = json.loads(capsys.readouterr().out)  # type: ignore[attr-defined]
    assert output["run_id"] == str(RUN_ID)
    assert output["status"] == "validated"

    class FakeStore:
        def __init__(self) -> None:
            self.bucket_ready = False

        def ensure_bucket(self) -> None:
            self.bucket_ready = True

    fake_store = FakeStore()
    monkeypatch.setattr(cli, "MinioObjectStore", lambda *args, **kwargs: fake_store)
    assert (
        cli.main(
            [
                "apply",
                "--database",
                "source.sqlite3",
                "--archive",
                "archive",
                "--confirm-fingerprint",
                "f" * 64,
                "--upload-files",
            ]
        )
        == 0
    )
    assert fake_store.bucket_ready is True


def test_object_store_reuses_content_addressed_object(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    source_path = tmp_path / "report.pdf"
    source_path.write_bytes(b"pdf")
    source = ArchiveFile(
        path=source_path,
        relative_path="report.pdf",
        sha256="d" * 64,
        size=3,
    )

    class FakeMinio:
        def __init__(self) -> None:
            self.made_bucket = False
            self.object_size = 3

        def bucket_exists(self, bucket: str) -> bool:
            return False

        def make_bucket(self, bucket: str) -> None:
            self.made_bucket = True

        def stat_object(self, bucket: str, key: str) -> SimpleNamespace:
            return SimpleNamespace(size=self.object_size)

    fake = FakeMinio()
    monkeypatch.setattr("hisobot_import.storage.Minio", lambda *args, **kwargs: fake)
    store = MinioObjectStore("minio:9000", "access", "secret", "files", secure=False)

    store.ensure_bucket()
    store.ensure_object("hisobot/report.pdf", source)
    assert fake.made_bucket is True

    fake.object_size = 4
    with pytest.raises(ValueError, match="size mismatch"):
        store.ensure_object("hisobot/report.pdf", source)


def test_apply_snapshot_orchestrates_import_and_reuses_validated_run(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    fingerprint = "f" * 64
    inspection = {
        "database": {"integrity": "ok", "schema_issues": []},
        "snapshot_fingerprint": fingerprint,
        "table_counts": {"reports": 1},
        "archive": {"provided": False},
    }
    mapping = {
        "version": "1.0.0",
        "tables": [
            {
                "source": "reports",
                "source_key": ["employee_key", "report_date"],
                "target": "hisobot_reports",
                "strategy": "immutable",
            }
        ],
    }
    report = {
        "id": 1,
        "employee_key": "employee-1",
        "report_date": "2026-08-03",
        "content": "fixture",
        "submitted_at": "2026-08-03 18:00:00",
        "is_late": 0,
        "created_at": "2026-08-03 18:00:00",
        "updated_at": "2026-08-03 18:00:00",
    }

    class Transaction:
        async def __aenter__(self) -> None:
            return None

        async def __aexit__(self, *_: object) -> bool:
            return False

    class Connection:
        def __init__(self) -> None:
            self.execute = AsyncMock()
            self.commit = AsyncMock()
            self.rollback = AsyncMock()
            self.close = AsyncMock()

        def begin(self) -> Transaction:
            return Transaction()

        def in_transaction(self) -> bool:
            return False

    class Engine:
        def __init__(self, connection: Connection) -> None:
            self._connection = connection
            self.dispose = AsyncMock()

        async def connect(self) -> Connection:
            return self._connection

    connection = Connection()
    engine = Engine(connection)
    get_run = AsyncMock(return_value=(RUN_ID, "planned", {}))
    ensure_identity = AsyncMock()
    ensure_target = AsyncMock(return_value=True)
    record_item = AsyncMock()
    target_counts = AsyncMock(return_value={"hisobot_reports": 1})

    monkeypatch.setattr(writer_module, "inspect_snapshot", lambda *args: inspection)
    monkeypatch.setattr(writer_module, "load_mapping", lambda *args: mapping)
    monkeypatch.setattr(writer_module, "_validate_preflight", lambda *args: None)
    monkeypatch.setattr(writer_module, "read_source_rows", lambda *args: [report])
    monkeypatch.setattr(writer_module, "create_async_engine", lambda *args, **kwargs: engine)
    monkeypatch.setattr(writer_module, "_get_or_create_run", get_run)
    monkeypatch.setattr(writer_module, "_ensure_identity", ensure_identity)
    monkeypatch.setattr(writer_module, "_ensure_target_row", ensure_target)
    monkeypatch.setattr(writer_module, "_record_item", record_item)
    monkeypatch.setattr(writer_module, "_target_counts", target_counts)

    result = asyncio.run(
        writer_module.apply_snapshot(
            database_path=Path("source.sqlite3"),
            archive_root=None,
            database_url="postgresql+asyncpg://unused",
            expected_fingerprint=fingerprint,
        )
    )
    assert result.status == "validated"
    assert result.reused is False
    assert result.target_counts["items"] == {"imported": 1}
    assert ensure_identity.await_count == 1
    assert ensure_target.await_count == 1
    assert record_item.await_count == 1
    assert connection.close.await_count == 1
    assert engine.dispose.await_count == 1

    get_run.return_value = (RUN_ID, "validated", {"entities": {"hisobot_reports": 1}})
    reused = asyncio.run(
        writer_module.apply_snapshot(
            database_path=Path("source.sqlite3"),
            archive_root=None,
            database_url="postgresql+asyncpg://unused",
            expected_fingerprint=fingerprint,
        )
    )
    assert reused.reused is True
    assert reused.run_id == RUN_ID
