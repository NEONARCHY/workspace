from __future__ import annotations

import hashlib
import uuid
from collections import Counter
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncConnection, create_async_engine

from . import MAPPING_VERSION
from .mapping import load_mapping, validate_mapping
from .models import (
    TARGET_TABLES,
    legacy_identity_links,
    system_import_items,
    system_import_quarantine,
    system_import_runs,
)
from .planner import (
    SOURCE_SYSTEM,
    PlannedRow,
    RowQuarantineError,
    normalize_payload,
    payload_hash,
    plan_archive_file,
    plan_source_row,
    source_key_hash,
)
from .source import build_archive_index, inspect_snapshot, read_source_rows
from .storage import ObjectStore


class ImportPreflightError(ValueError):
    pass


class ImportConflictError(RuntimeError):
    pass


@dataclass(frozen=True)
class ImportResult:
    run_id: uuid.UUID
    status: str
    reused: bool
    source_fingerprint: str
    source_counts: dict[str, int]
    target_counts: dict[str, Any]

    def to_dict(self) -> dict[str, Any]:
        result = asdict(self)
        result["run_id"] = str(self.run_id)
        return result


def _validate_preflight(
    inspection: dict[str, Any],
    expected_fingerprint: str,
    mapping: dict[str, Any],
) -> None:
    if inspection["database"]["integrity"] != "ok":
        raise ImportPreflightError("SQLite integrity_check failed")
    schema_issues = inspection["database"]["schema_issues"]
    if schema_issues:
        raise ImportPreflightError(f"Source schema mismatch: {','.join(schema_issues)}")
    if inspection["snapshot_fingerprint"] != expected_fingerprint:
        raise ImportPreflightError("Snapshot fingerprint does not match --confirm-fingerprint")
    mapping_issues = validate_mapping(mapping)
    if mapping_issues:
        raise ImportPreflightError(f"Mapping is invalid: {','.join(mapping_issues)}")


async def _ensure_identity(
    connection: AsyncConnection,
    planned: PlannedRow,
    run_id: uuid.UUID,
    now: datetime,
) -> None:
    for identity in planned.identities:
        statement = pg_insert(legacy_identity_links).values(
            id=identity.id,
            source_system=SOURCE_SYSTEM,
            identifier_type=identity.identifier_type,
            identifier_hash=identity.identifier_hash,
            identifier_value=identity.identifier_value,
            platform_user_id=None,
            resolution_state="unresolved",
            is_archived=False,
            first_import_run_id=run_id,
            created_at=now,
        )
        await connection.execute(
            statement.on_conflict_do_nothing(
                index_elements=["source_system", "identifier_type", "identifier_hash"]
            )
        )


async def _ensure_target_row(connection: AsyncConnection, planned: PlannedRow) -> bool:
    table = TARGET_TABLES[planned.target_table]
    existing_hash = await connection.scalar(
        sa.select(table.c.source_payload_hash).where(
            table.c.source_table == planned.source_table,
            table.c.source_key_hash == planned.source_key_hash,
        )
    )
    if existing_hash is not None:
        if str(existing_hash) != planned.source_payload_hash:
            raise ImportConflictError(
                f"Immutable source conflict: {planned.source_table}:{planned.source_key_hash}"
            )
        return False
    await connection.execute(sa.insert(table).values(**planned.target_values))
    return True


async def _record_item(
    connection: AsyncConnection,
    *,
    run_id: uuid.UUID,
    source_table: str,
    key_hash: str,
    row_hash: str,
    target_table: str,
    target_key: str | None,
    status: str,
    error_code: str | None = None,
    error_detail: str | None = None,
) -> None:
    await connection.execute(
        sa.insert(system_import_items).values(
            run_id=run_id,
            source_table=source_table,
            source_key_hash=key_hash,
            source_payload_hash=row_hash,
            target_table=target_table,
            target_key=target_key,
            status=status,
            error_code=error_code,
            error_detail=error_detail,
        )
    )


async def _record_quarantine(
    connection: AsyncConnection,
    *,
    run_id: uuid.UUID,
    source_table: str,
    key_hash: str,
    row_hash: str,
    source_payload: dict[str, Any],
    target_table: str,
    error: RowQuarantineError,
    now: datetime,
) -> None:
    await connection.execute(
        sa.insert(system_import_quarantine).values(
            run_id=run_id,
            source_table=source_table,
            source_key_hash=key_hash,
            source_payload_hash=row_hash,
            source_payload=source_payload,
            error_code=error.error_code,
            error_detail=error.detail,
            created_at=now,
        )
    )
    await _record_item(
        connection,
        run_id=run_id,
        source_table=source_table,
        key_hash=key_hash,
        row_hash=row_hash,
        target_table=target_table,
        target_key=None,
        status="quarantined",
        error_code=error.error_code,
        error_detail=error.detail,
    )


async def _target_counts(connection: AsyncConnection) -> dict[str, int]:
    counts: dict[str, int] = {}
    for name, table in TARGET_TABLES.items():
        value = await connection.scalar(sa.select(sa.func.count()).select_from(table))
        counts[name] = int(value or 0)
    counts["legacy_identity_links"] = int(
        await connection.scalar(sa.select(sa.func.count()).select_from(legacy_identity_links)) or 0
    )
    return counts


async def _get_or_create_run(
    connection: AsyncConnection,
    *,
    source_fingerprint: str,
    source_counts: dict[str, int],
    source_snapshot_at: datetime | None,
    now: datetime,
) -> tuple[uuid.UUID, str, dict[str, Any]]:
    candidate_id = uuid.uuid4()
    statement = (
        pg_insert(system_import_runs)
        .values(
            id=candidate_id,
            source_system=SOURCE_SYSTEM,
            source_fingerprint=source_fingerprint,
            mapping_version=MAPPING_VERSION,
            source_snapshot_at=source_snapshot_at,
            status="planned",
            source_counts=source_counts,
            target_counts={},
            started_at=now,
            finished_at=None,
            error_summary=None,
        )
        .on_conflict_do_nothing(
            index_elements=["source_system", "source_fingerprint", "mapping_version"]
        )
        .returning(system_import_runs.c.id)
    )
    inserted_id = await connection.scalar(statement)
    if inserted_id is not None:
        return uuid.UUID(str(inserted_id)), "planned", {}

    existing = (
        await connection.execute(
            sa.select(
                system_import_runs.c.id,
                system_import_runs.c.status,
                system_import_runs.c.target_counts,
            ).where(
                system_import_runs.c.source_system == SOURCE_SYSTEM,
                system_import_runs.c.source_fingerprint == source_fingerprint,
                system_import_runs.c.mapping_version == MAPPING_VERSION,
            )
        )
    ).one()
    return uuid.UUID(str(existing.id)), str(existing.status), dict(existing.target_counts)


async def apply_snapshot(
    *,
    database_path: Path,
    archive_root: Path | None,
    database_url: str,
    expected_fingerprint: str,
    mapping_path: Path | None = None,
    source_snapshot_at: datetime | None = None,
    object_store: ObjectStore | None = None,
) -> ImportResult:
    inspection = inspect_snapshot(database_path, archive_root)
    mapping = load_mapping(mapping_path)
    _validate_preflight(inspection, expected_fingerprint, mapping)
    source_counts = {key: int(value) for key, value in inspection["table_counts"].items()}
    archive_index = build_archive_index(archive_root) if archive_root is not None else None
    if archive_index is not None:
        source_counts["archive_files"] = sum(len(files) for files in archive_index.values())
    mapping_items = {str(item["source"]): item for item in mapping["tables"]}
    now = datetime.now(UTC)

    engine = create_async_engine(database_url, pool_pre_ping=True)
    connection = await engine.connect()
    lock_name = f"{SOURCE_SYSTEM}:{expected_fingerprint}:{MAPPING_VERSION}"
    try:
        await connection.execute(
            sa.text("SELECT pg_advisory_lock(hashtext(:lock_name))"),
            {"lock_name": lock_name},
        )
        await connection.commit()

        async with connection.begin():
            run_id, current_status, existing_counts = await _get_or_create_run(
                connection,
                source_fingerprint=expected_fingerprint,
                source_counts=source_counts,
                source_snapshot_at=source_snapshot_at,
                now=now,
            )
        if current_status == "validated":
            return ImportResult(
                run_id=run_id,
                status="validated",
                reused=True,
                source_fingerprint=expected_fingerprint,
                source_counts=source_counts,
                target_counts=existing_counts,
            )

        status_counts: Counter[str] = Counter()
        per_table_counts: dict[str, Counter[str]] = {}
        referenced_archive_objects: dict[str, str] = {}
        try:
            async with connection.begin():
                await connection.execute(
                    sa.delete(system_import_items).where(system_import_items.c.run_id == run_id)
                )
                await connection.execute(
                    sa.delete(system_import_quarantine).where(
                        system_import_quarantine.c.run_id == run_id
                    )
                )
                await connection.execute(
                    sa.update(system_import_runs)
                    .where(system_import_runs.c.id == run_id)
                    .values(status="running", finished_at=None, error_summary=None)
                )

                for source_table, mapping_item in mapping_items.items():
                    table_statuses: Counter[str] = Counter()
                    per_table_counts[source_table] = table_statuses
                    key_columns = [str(value) for value in mapping_item["source_key"]]
                    target_table = str(mapping_item["target"])
                    for row in read_source_rows(database_path, source_table):
                        row_hash = payload_hash(row)
                        try:
                            key_hash = source_key_hash(row, key_columns)
                        except RowQuarantineError:
                            key_hash = hashlib.sha256(f"invalid:{row_hash}".encode()).hexdigest()
                        try:
                            planned = plan_source_row(
                                source_table,
                                key_columns,
                                row,
                                run_id,
                                archive_index,
                            )
                            if planned.target_table != target_table:
                                raise ImportPreflightError(
                                    f"Planner target mismatch for {source_table}"
                                )
                            await _ensure_identity(connection, planned, run_id, now)
                            if object_store is not None and planned.archive_file is not None:
                                object_store.ensure_object(
                                    str(planned.target_values["object_key"]), planned.archive_file
                                )
                                planned.target_values["storage_status"] = "uploaded"
                            if planned.archive_file is not None:
                                archive_relative_path = planned.archive_file.relative_path
                                referenced_archive_objects[archive_relative_path] = str(
                                    planned.target_values["object_key"]
                                )
                            inserted = await _ensure_target_row(connection, planned)
                            item_status = "imported" if inserted else "skipped"
                            await _record_item(
                                connection,
                                run_id=run_id,
                                source_table=source_table,
                                key_hash=planned.source_key_hash,
                                row_hash=planned.source_payload_hash,
                                target_table=planned.target_table,
                                target_key=str(planned.target_id),
                                status=item_status,
                            )
                        except RowQuarantineError as error:
                            await _record_quarantine(
                                connection,
                                run_id=run_id,
                                source_table=source_table,
                                key_hash=key_hash,
                                row_hash=row_hash,
                                source_payload=normalize_payload(row),
                                target_table=target_table,
                                error=error,
                                now=now,
                            )
                            item_status = "quarantined"
                        table_statuses[item_status] += 1
                        status_counts[item_status] += 1

                if archive_index is not None:
                    archive_statuses: Counter[str] = Counter()
                    per_table_counts["archive_files"] = archive_statuses
                    archive_files = sorted(
                        (item for files in archive_index.values() for item in files),
                        key=lambda item: item.relative_path,
                    )
                    for archive_file in archive_files:
                        planned_archive = plan_archive_file(
                            archive_file,
                            run_id,
                            referenced_archive_objects.get(archive_file.relative_path),
                        )
                        if object_store is not None:
                            object_store.ensure_object(
                                str(planned_archive.target_values["object_key"]),
                                archive_file,
                            )
                            planned_archive.target_values["storage_status"] = "uploaded"
                        inserted = await _ensure_target_row(connection, planned_archive)
                        item_status = "imported" if inserted else "skipped"
                        await _record_item(
                            connection,
                            run_id=run_id,
                            source_table="archive_files",
                            key_hash=planned_archive.source_key_hash,
                            row_hash=planned_archive.source_payload_hash,
                            target_table=planned_archive.target_table,
                            target_key=str(planned_archive.target_id),
                            status=item_status,
                        )
                        archive_statuses[item_status] += 1
                        status_counts[item_status] += 1

                for source_table, expected_count in source_counts.items():
                    if sum(per_table_counts[source_table].values()) != expected_count:
                        raise ImportConflictError(f"Reconciliation failed for {source_table}")

                entity_counts = await _target_counts(connection)
                target_counts: dict[str, Any] = {
                    "entities": entity_counts,
                    "items": dict(sorted(status_counts.items())),
                    "by_source_table": {
                        table: dict(sorted(counts.items()))
                        for table, counts in sorted(per_table_counts.items())
                    },
                }
                await connection.execute(
                    sa.update(system_import_runs)
                    .where(system_import_runs.c.id == run_id)
                    .values(
                        status="validated",
                        target_counts=target_counts,
                        finished_at=datetime.now(UTC),
                    )
                )
        except Exception as error:
            async with connection.begin():
                await connection.execute(
                    sa.update(system_import_runs)
                    .where(system_import_runs.c.id == run_id)
                    .values(
                        status="failed",
                        error_summary=type(error).__name__,
                        finished_at=datetime.now(UTC),
                    )
                )
            raise

        return ImportResult(
            run_id=run_id,
            status="validated",
            reused=False,
            source_fingerprint=expected_fingerprint,
            source_counts=source_counts,
            target_counts=target_counts,
        )
    finally:
        if connection.in_transaction():
            await connection.rollback()
        await connection.execute(
            sa.text("SELECT pg_advisory_unlock(hashtext(:lock_name))"), {"lock_name": lock_name}
        )
        await connection.commit()
        await connection.close()
        await engine.dispose()
