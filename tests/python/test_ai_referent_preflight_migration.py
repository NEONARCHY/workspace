"""Exercise the legacy-data upgrade in an isolated, rolled-back PostgreSQL schema."""

import importlib.util
import os
from datetime import UTC, datetime
from pathlib import Path
from uuid import uuid4

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import insert, select, text
from sqlalchemy.ext.asyncio import create_async_engine

from yuksalish_api.tables import (
    ai_referent_delivery_commands as commands,
)
from yuksalish_api.tables import (
    ai_referent_files as files,
)
from yuksalish_api.tables import (
    ai_referent_letters as letters,
)


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.mark.anyio
@pytest.mark.postgres
async def test_upgrade_pins_completed_pdf_and_only_prepares_legacy_waiting_letters(monkeypatch):
    url = os.environ.get("YUKSALISH_TEST_DATABASE_URL")
    if not url:
        pytest.skip("YUKSALISH_TEST_DATABASE_URL is not configured")
    engine = create_async_engine(url)
    path = Path(__file__).parents[2] / "apps/api/migrations/versions/0055_ai_referent_preflight.py"
    spec = importlib.util.spec_from_file_location("preflight_migration", path)
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    async with engine.connect() as connection:
        transaction = await connection.begin()
        try:
            schema = "migration55_" + uuid4().hex
            await connection.execute(text(f'CREATE SCHEMA "{schema}"'))
            await connection.execute(text(f'SET LOCAL search_path TO "{schema}", public'))
            await connection.execute(text("CREATE TABLE core_users (id uuid PRIMARY KEY)"))
            for table in (letters, commands, files):
                await connection.execute(text(
                    f'CREATE TABLE "{table.name}" (LIKE public."{table.name}" INCLUDING ALL)'
                ))
            await connection.execute(text(
                "ALTER TABLE ai_referent_letters DROP COLUMN final_pdf_file_id"
            ))
            now, owner = datetime.now(UTC), uuid4()
            waiting, prepared, drafting = uuid4(), uuid4(), uuid4()
            job_id, pdf_id, decoy_id = uuid4(), uuid4(), uuid4()
            await connection.execute(text("INSERT INTO core_users VALUES (:id)"), {"id": owner})
            for letter_id, status in (
                (waiting, "awaiting_final_send"),
                (prepared, "awaiting_final_send"),
                (drafting, "draft"),
            ):
                await connection.execute(insert(letters).values(
                    id=letter_id, subject="Migration fixture", recipient_organization="Test",
                    recipient_address="safe@example.test", route="webmail", note="",
                    status=status, source="workspace", workflow_kind="delivery",
                    created_by_user_id=owner, reviewer_key="bobur", revision=1,
                    created_at=now, updated_at=now,
                ))
            await connection.execute(insert(commands).values(
                id=job_id, letter_id=prepared, route="webmail", status="completed",
                kind="prepare", idempotency_key=str(job_id), attempt_count=1,
                result={"outcome": "prepared"}, last_error="", completed_at=now,
                created_at=now, updated_at=now,
            ))
            for file_id, letter_id, relative in (
                (pdf_id, prepared, f"signed/{job_id}.pdf"),
                (decoy_id, waiting, "signed/unrelated.pdf"),
            ):
                await connection.execute(insert(files).values(
                    id=file_id, kind="outgoing", owner_id=letter_id,
                    relative_path=relative, storage_key=str(file_id),
                    sha256="a" * 64, byte_size=8, content_type="application/pdf", created_at=now,
                ))

            def upgrade(sync_connection):
                monkeypatch.setattr(
                    migration, "op", Operations(MigrationContext.configure(sync_connection))
                )
                migration.upgrade()

            await connection.run_sync(upgrade)
            rows = {row["id"]: row for row in (
                await connection.execute(select(letters))
            ).mappings()}
            assert rows[prepared]["final_pdf_file_id"] == pdf_id
            assert rows[prepared]["status"] == "awaiting_final_send"
            assert rows[waiting]["final_pdf_file_id"] is None
            assert rows[waiting]["status"] == "queued" and rows[waiting]["revision"] == 2
            assert rows[drafting]["status"] == "draft"
            pending = (await connection.execute(
                select(commands).where(commands.c.status == "pending")
            )).mappings().all()
            assert len(pending) == 1
            assert pending[0]["kind"] == "prepare" and pending[0]["letter_id"] == waiting
        finally:
            await transaction.rollback()
    await engine.dispose()
