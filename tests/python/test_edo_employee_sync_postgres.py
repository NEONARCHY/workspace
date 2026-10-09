"""Directory delivery leases and lifecycle on an isolated PostgreSQL database."""

import asyncio
import base64
import os
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
from fastapi import HTTPException
from pydantic import SecretStr
from sqlalchemy import delete, insert, select, text, update
from sqlalchemy.ext.asyncio import create_async_engine

from yuksalish_api.auth import AuthenticatedUser
from yuksalish_api.edo_employee_client import EmployeeSyncError
from yuksalish_api.edo_employee_schemas import EmployeeSyncAck
from yuksalish_api.edo_employee_sync import (
    claim_employee,
    employee_sync_status,
    finish_employee,
    reconcile_employees,
    retry_employee_sync,
    run_employee_sync_cycle,
)
from yuksalish_api.settings import Settings
from yuksalish_api.tables import audit_events, departments, users
from yuksalish_api.tables import edo_employee_sync as sync


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.mark.anyio
@pytest.mark.postgres
async def test_directory_lifecycle_durable_leases_retries_and_stale_ack(monkeypatch):
    url = os.environ.get("YUKSALISH_TEST_DATABASE_URL")
    if not url:
        pytest.skip("YUKSALISH_TEST_DATABASE_URL is not configured")
    schema = "edo_sync_test_" + uuid4().hex
    engine = create_async_engine(url, connect_args={"server_settings": {"search_path": schema}})
    ids = [uuid4() for _ in range(3)]
    now = datetime.now(UTC)
    # Private schema prevents other integration fixtures from entering this queue.
    async with engine.begin() as connection:
        await connection.execute(text(f"CREATE SCHEMA {schema}"))
        for table in (users, departments, audit_events, sync):
            table_name = table.name
            await connection.execute(
                text(f"CREATE TABLE {schema}.{table_name} (LIKE public.{table_name} INCLUDING ALL)")
            )

    def acknowledgement(claim, remote=101):
        return EmployeeSyncAck(
            protocol_version=1,
            employee_id=claim.user_id,
            revision=claim.revision,
            request_sha256="0" * 64,
            edo_user_id=remote,
            mapping_active=claim.payload.status == "active",
            action="linked",
        )

    async def claim_at(when=now):
        async with engine.begin() as connection:
            return await claim_employee(connection, now=when)

    async def row(employee_id):
        async with engine.begin() as connection:
            return (
                (await connection.execute(select(sync).where(sync.c.user_id == employee_id)))
                .mappings()
                .one()
            )

    try:
        async with engine.begin() as connection:
            await connection.execute(
                insert(users),
                [
                    {
                        "id": employee_id,
                        "username": f"sync-test-{employee_id.hex}",
                        "full_name": "Synthetic",
                        "role": "superadmin" if employee_id == ids[0] else "employee",
                        "status": status,
                        "created_at": now,
                        "updated_at": now,
                    }
                    for employee_id, status in zip(
                        ids, ["active", "pending", "blocked"], strict=True
                    )
                ],
            )
            assert await reconcile_employees(connection, now=now) == 3
            assert await reconcile_employees(connection, now=now) == 0

        # Two workers claim distinct rows, never one employee twice.
        first, second = await asyncio.gather(claim_at(), claim_at())
        assert first is not None and second is not None
        assert first.user_id != second.user_id
        third = await claim_at()
        assert third is not None
        assert await claim_at() is None
        claims = [first, second, third]
        assert {claim.payload.status for claim in claims} == {"active", "pending", "blocked"}

        # Acknowledgement of the old snapshot cannot deliver the new name/revision.
        changed = first
        async with engine.begin() as connection:
            await connection.execute(
                update(users).where(users.c.id == changed.user_id).values(full_name="Updated")
            )
            assert await reconcile_employees(connection, now=now) == 1
            await finish_employee(connection, changed, acknowledgement(changed), now=now)
        saved = await row(changed.user_id)
        assert saved["revision"] == 2 and saved["delivered_revision"] == 1
        assert saved["state"] == "pending" and saved["edo_user_id"] == 101
        replacement = await claim_at()
        assert replacement is not None and replacement.revision == 2
        assert replacement.payload.full_name == "Updated"
        async with engine.begin() as connection:
            await finish_employee(connection, replacement, acknowledgement(replacement), now=now)
            await finish_employee(connection, replacement, acknowledgement(replacement), now=now)
        assert (await row(changed.user_id))["state"] == "synced"

        # Connection failure remains durable, backoff is enforced.
        async with engine.begin() as connection:
            await finish_employee(
                connection, second, EmployeeSyncError("connection", retryable=True), now=now
            )
        assert (await row(second.user_id))["state"] == "retry"
        assert await claim_at() is None
        retry = await claim_at(now + timedelta(seconds=61))
        assert retry is not None and retry.user_id == second.user_id
        assert retry.revision == second.revision
        async with engine.begin() as connection:
            await finish_employee(connection, retry, acknowledgement(retry, remote=102), now=now)

        # Simulate worker crash: expired lease can be reclaimed; its late result is ignored.
        recovered = await claim_at(now + timedelta(seconds=121))
        assert recovered is not None and recovered.user_id == third.user_id
        async with engine.begin() as connection:
            await finish_employee(connection, third, acknowledgement(third, remote=999), now=now)
        assert (await row(third.user_id))["edo_user_id"] is None
        async with engine.begin() as connection:
            await finish_employee(
                connection, recovered, acknowledgement(recovered, remote=103), now=now
            )

        # Activate a pending invitation and then block/archive all identities.
        pending_id = next(item.user_id for item in claims if item.payload.status == "pending")
        async with engine.begin() as connection:
            await connection.execute(
                update(users).where(users.c.id == pending_id).values(status="active")
            )
            assert await reconcile_employees(connection, now=now) == 1
        activation = await claim_at()
        assert activation is not None and activation.user_id == pending_id
        assert activation.payload.status == "active"
        remote_id = (await row(pending_id))["edo_user_id"]
        async with engine.begin() as connection:
            await finish_employee(
                connection, activation, acknowledgement(activation, remote_id), now=now
            )
            await connection.execute(
                update(users).where(users.c.id.in_(ids)).values(status="archived")
            )
            assert await reconcile_employees(connection, now=now) == 3

        # Existing mapping IDs must never silently change on a later delivery.
        archive = await claim_at()
        assert archive is not None and archive.payload.status == "archived"
        original_id = (await row(archive.user_id))["edo_user_id"]
        async with engine.begin() as connection:
            await finish_employee(
                connection, archive, acknowledgement(archive, remote=999), now=now
            )
        saved = await row(archive.user_id)
        assert saved["state"] == "conflict" and saved["last_error_code"] == "mapping_changed"
        assert saved["edo_user_id"] == original_id

        # Invalid legacy data is isolated; corrected data requeues automatically.
        async with engine.begin() as connection:
            await connection.execute(
                update(users).where(users.c.id == archive.user_id).values(full_name="")
            )
            assert await reconcile_employees(connection, now=now) == 1
        assert (await row(archive.user_id))["last_error_code"] == "invalid_snapshot"
        async with engine.begin() as connection:
            await connection.execute(
                update(users).where(users.c.id == archive.user_id).values(full_name="Corrected")
            )
            assert await reconcile_employees(connection, now=now) == 1
            events = (
                (
                    await connection.execute(
                        select(audit_events.c.details).where(
                            audit_events.c.target_id == changed.user_id,
                            audit_events.c.action == "edo.employee_synced",
                        )
                    )
                )
                .scalars()
                .all()
            )
            assert len([event for event in events if event["revision"] == 2]) == 1

        # Full automatic cycle, inspection and explicit retry use the same durable records.
        config = Settings(
            edo_employee_sync_enabled=True,
            edo_api_url="https://edo.example.test",
            edo_directory_credential=SecretStr("synthetic-directory-credential-long-enough"),
            edo_directory_assertion_key_base64=SecretStr(base64.b64encode(b"d" * 32).decode()),
        )
        actor = AuthenticatedUser(
            id=ids[0],
            username="synthetic",
            full_name="Synthetic",
            role="superadmin",
            position_id=None,
            job_title=None,
        )

        async def deliver(config, person):
            remote_id = (await row(person.employee_id))["edo_user_id"]
            return EmployeeSyncAck(
                protocol_version=1,
                employee_id=person.employee_id,
                revision=person.revision,
                request_sha256="0" * 64,
                edo_user_id=remote_id,
                mapping_active=False,
                action="updated",
            )

        monkeypatch.setattr("yuksalish_api.edo_employee_sync.deliver_employee", deliver)
        assert await run_employee_sync_cycle(engine, config) == 3
        async with engine.begin() as connection:
            status = await employee_sync_status(connection, actor, config)
        assert len(status.entries) == 3 and all(item.status == "synced" for item in status.entries)
        assert status.enabled and status.configured

        async with engine.begin() as connection:
            await connection.execute(
                update(users).where(users.c.id == ids[0]).values(status="blocked")
            )
            await reconcile_employees(connection, now=now)
        failed = await claim_at()
        assert failed is not None
        async with engine.begin() as connection:
            await finish_employee(connection, failed, EmployeeSyncError("http_403"), now=now)
            await retry_employee_sync(connection, actor, failed.user_id)
        # A queued retry is not already synced, and cannot be repeated during its lease.
        assert (await row(failed.user_id))["state"] == "pending"
        retried = await claim_at(datetime.now(UTC))
        assert retried is not None
        with pytest.raises(HTTPException) as caught:
            async with engine.begin() as connection:
                await retry_employee_sync(connection, actor, failed.user_id)
        assert caught.value.status_code == 409
        async with engine.begin() as connection:
            await finish_employee(
                connection,
                retried,
                acknowledgement(retried, (await row(retried.user_id))["edo_user_id"]),
                now=now,
            )
    finally:
        async with engine.begin() as connection:
            await connection.execute(delete(audit_events).where(audit_events.c.target_id.in_(ids)))
            await connection.execute(delete(sync).where(sync.c.user_id.in_(ids)))
            await connection.execute(delete(users).where(users.c.id.in_(ids)))
            await connection.execute(text(f"DROP SCHEMA {schema} CASCADE"))
        await engine.dispose()
