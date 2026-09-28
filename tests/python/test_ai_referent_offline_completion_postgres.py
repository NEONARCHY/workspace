"""Reconciliation releases the Workspace fence only for a complete, safe journal."""

import hashlib
import json
import os
from datetime import UTC, datetime, timedelta
from uuid import NAMESPACE_URL, uuid4, uuid5

import pytest
from fastapi import HTTPException
from sqlalchemy import delete, insert, select, update
from sqlalchemy.ext.asyncio import create_async_engine

from yuksalish_api.ai_referent_authority import (
    complete_authority_replay,
    read_authority_status,
    start_authority,
)
from yuksalish_api.ai_referent_schemas import OfflineReplayCompleteRequest
from yuksalish_api.tables import (
    ai_referent_authority,
    ai_referent_configuration,
    ai_referent_delivery_commands,
    ai_referent_letters,
    ai_referent_offline_operation_receipts,
    users,
)


@pytest.fixture
def anyio_backend():
    return "asyncio"


def _manifest(epoch, entries, *, external_count=0):
    return OfflineReplayCompleteRequest(
        epoch=epoch, operation_count=len(entries),
        last_sequence=entries[-1][0] if entries else None,
        operations_sha256=hashlib.sha256(
            json.dumps(entries, separators=(",", ":")).encode()
        ).hexdigest(),
        external_effect_count=external_count,
    )


@pytest.mark.anyio
@pytest.mark.postgres
async def test_empty_replay_is_fenced_until_manifest_matches_and_retry_is_idempotent():
    url = os.environ.get("YUKSALISH_TEST_DATABASE_URL")
    if not url:
        pytest.skip("YUKSALISH_TEST_DATABASE_URL is not configured")
    engine = create_async_engine(url)
    agent_id = f"offline-complete-{uuid4().hex}"
    try:
        async with engine.connect() as connection:
            transaction = await connection.begin()
            try:
                await connection.execute(delete(ai_referent_authority))
                await connection.execute(update(ai_referent_configuration).values(
                    execution_agent_id=agent_id
                ))
                epoch = (await start_authority(
                    connection, agent_id=agent_id, enabled=True
                )).epoch
                await connection.execute(update(ai_referent_authority).values(
                    mode="replay_required"
                ))
                payload = _manifest(epoch, [])
                bad = payload.model_copy(update={"operations_sha256": "0" * 64})
                with pytest.raises(HTTPException) as incomplete:
                    await complete_authority_replay(
                        connection, agent_id=agent_id, payload=bad, enabled=True
                    )
                assert incomplete.value.status_code == 409
                assert not (await read_authority_status(connection)).writable
                new_lease = await complete_authority_replay(
                    connection, agent_id=agent_id, payload=payload, enabled=True
                )
                assert new_lease.epoch != epoch
                assert new_lease.mode == "online"
                assert (await read_authority_status(connection)).writable
                assert (await complete_authority_replay(
                    connection, agent_id=agent_id, payload=payload, enabled=True
                )).epoch == new_lease.epoch
                with pytest.raises(HTTPException) as changed:
                    await complete_authority_replay(
                        connection, agent_id=agent_id, payload=bad, enabled=True
                    )
                assert changed.value.status_code == 409
                await connection.execute(update(ai_referent_authority).values(
                    lease_until=datetime.now(UTC) - timedelta(seconds=1)
                ))
                expired = await complete_authority_replay(
                    connection, agent_id=agent_id, payload=payload, enabled=True
                )
                assert expired.epoch == new_lease.epoch
                assert expired.mode == "replay_required"
                assert not (await read_authority_status(connection)).writable
                renewed = await complete_authority_replay(
                    connection, agent_id=agent_id,
                    payload=_manifest(new_lease.epoch, []), enabled=True,
                )
                assert renewed.epoch not in {epoch, new_lease.epoch}
                assert renewed.mode == "online"
            finally:
                await transaction.rollback()
    finally:
        await engine.dispose()


@pytest.mark.anyio
@pytest.mark.postgres
async def test_replay_refuses_claimed_send_but_releases_pending_server_job():
    url = os.environ.get("YUKSALISH_TEST_DATABASE_URL")
    if not url:
        pytest.skip("YUKSALISH_TEST_DATABASE_URL is not configured")
    engine = create_async_engine(url)
    agent_id = f"offline-complete-{uuid4().hex}"
    operation_id, letter_id, user_id = uuid4(), uuid4(), uuid4()
    now = datetime.now(UTC)
    try:
        async with engine.connect() as connection:
            transaction = await connection.begin()
            try:
                await connection.execute(delete(ai_referent_authority))
                await connection.execute(update(ai_referent_configuration).values(
                    execution_agent_id=agent_id
                ))
                epoch = (await start_authority(
                    connection, agent_id=agent_id, enabled=True
                )).epoch
                await connection.execute(update(ai_referent_authority).values(
                    mode="replay_required"
                ))
                await connection.execute(insert(users).values(
                    id=user_id, username=f"offline-{user_id.hex[:12]}",
                    full_name="Offline Employee", role="employee", status="active",
                    created_at=now, updated_at=now,
                ))
                await connection.execute(insert(ai_referent_letters).values(
                    id=letter_id, subject="Offline letter", recipient_organization="Test",
                    recipient_address="test@example.org", route="exat", note="",
                    status="sending", workflow_kind="delivery", source="telegram",
                    created_by_user_id=user_id, revision=2, delivery_error="",
                    created_at=now, updated_at=now,
                ))
                await connection.execute(insert(ai_referent_offline_operation_receipts).values(
                    operation_id=operation_id, agent_id=agent_id, epoch=epoch,
                    sequence=1, letter_id=letter_id, kind="letter.action",
                    fingerprint="0" * 64, result_revision=1,
                    occurred_at=now, accepted_at=now,
                ))
                command_id = uuid5(NAMESPACE_URL, "ai-offline-command:" + str(operation_id))
                await connection.execute(insert(ai_referent_delivery_commands).values(
                    id=command_id, letter_id=letter_id, route="exat",
                    status="claimed", kind="prepare", idempotency_key=f"letter:{letter_id}:2",
                    claimed_by=agent_id, attempt_count=1, last_error="",
                    created_at=now, updated_at=now,
                ))
                payload = _manifest(epoch, [[1, str(operation_id)]])
                with pytest.raises(HTTPException) as uncertain:
                    await complete_authority_replay(
                        connection, agent_id=agent_id, payload=payload, enabled=True
                    )
                assert uncertain.value.status_code == 409
                await connection.execute(update(ai_referent_delivery_commands).where(
                    ai_referent_delivery_commands.c.id == command_id
                ).values(status="pending"))
                await connection.execute(update(ai_referent_letters).where(
                    ai_referent_letters.c.id == letter_id
                ).values(status="queued"))
                lease = await complete_authority_replay(
                    connection, agent_id=agent_id, payload=payload, enabled=True
                )
                assert lease.mode == "online"
                assert await connection.scalar(select(ai_referent_delivery_commands.c.status)
                    .where(ai_referent_delivery_commands.c.id == command_id)) == "pending"
            finally:
                await transaction.rollback()
    finally:
        await engine.dispose()


@pytest.mark.anyio
@pytest.mark.postgres
async def test_replay_expires_old_server_send_to_manual_delivery_check():
    url = os.environ.get("YUKSALISH_TEST_DATABASE_URL")
    if not url:
        pytest.skip("YUKSALISH_TEST_DATABASE_URL is not configured")
    engine = create_async_engine(url)
    agent_id = f"offline-complete-{uuid4().hex}"
    letter_id, user_id, command_id = uuid4(), uuid4(), uuid4()
    now = datetime.now(UTC)
    try:
        async with engine.connect() as connection:
            transaction = await connection.begin()
            try:
                await connection.execute(delete(ai_referent_authority))
                await connection.execute(update(ai_referent_configuration).values(
                    execution_agent_id=agent_id
                ))
                epoch = (await start_authority(
                    connection, agent_id=agent_id, enabled=True
                )).epoch
                await connection.execute(update(ai_referent_authority).values(
                    mode="replay_required"
                ))
                await connection.execute(insert(users).values(
                    id=user_id, username=f"offline-{user_id.hex[:12]}",
                    full_name="Offline Employee", role="employee", status="active",
                    created_at=now, updated_at=now,
                ))
                await connection.execute(insert(ai_referent_letters).values(
                    id=letter_id, subject="Old claimed send", recipient_organization="Test",
                    recipient_address="test@example.org", route="exat", note="",
                    status="sending", workflow_kind="delivery", source="telegram",
                    created_by_user_id=user_id, revision=2, delivery_error="",
                    created_at=now, updated_at=now,
                ))
                await connection.execute(insert(ai_referent_delivery_commands).values(
                    id=command_id, letter_id=letter_id, route="exat", kind="send",
                    status="claimed", idempotency_key=f"letter:{letter_id}:2",
                    claimed_by=agent_id, lease_token=uuid4(),
                    lease_until=now - timedelta(seconds=1), attempt_count=1,
                    last_error="", created_at=now, updated_at=now,
                ))
                lease = await complete_authority_replay(
                    connection, agent_id=agent_id,
                    payload=_manifest(epoch, []), enabled=True,
                )
                assert lease.mode == "online"
                assert await connection.scalar(select(ai_referent_delivery_commands.c.status)
                    .where(ai_referent_delivery_commands.c.id == command_id)) == "failed"
                assert await connection.scalar(select(ai_referent_letters.c.status)
                    .where(ai_referent_letters.c.id == letter_id)) == "delivery_unknown"
            finally:
                await transaction.rollback()
    finally:
        await engine.dispose()


@pytest.mark.anyio
@pytest.mark.postgres
async def test_replay_counts_confirmed_external_results_before_unfencing():
    url = os.environ.get("YUKSALISH_TEST_DATABASE_URL")
    if not url:
        pytest.skip("YUKSALISH_TEST_DATABASE_URL is not configured")
    engine = create_async_engine(url)
    agent_id = f"offline-complete-{uuid4().hex}"
    letter_id, user_id, result_id = uuid4(), uuid4(), uuid4()
    now = datetime.now(UTC)
    try:
        async with engine.connect() as connection:
            transaction = await connection.begin()
            try:
                await connection.execute(delete(ai_referent_authority))
                await connection.execute(update(ai_referent_configuration).values(
                    execution_agent_id=agent_id
                ))
                epoch = (await start_authority(
                    connection, agent_id=agent_id, enabled=True
                )).epoch
                await connection.execute(update(ai_referent_authority).values(
                    mode="replay_required"
                ))
                await connection.execute(insert(users).values(
                    id=user_id, username=f"offline-{user_id.hex[:12]}",
                    full_name="Offline Employee", role="employee", status="active",
                    created_at=now, updated_at=now,
                ))
                await connection.execute(insert(ai_referent_letters).values(
                    id=letter_id, subject="Sent offline", recipient_organization="Test",
                    recipient_address="test@example.org", route="exat", note="",
                    status="sent", workflow_kind="delivery", source="telegram",
                    created_by_user_id=user_id, revision=3, delivery_error="",
                    created_at=now, updated_at=now,
                ))
                await connection.execute(insert(ai_referent_offline_operation_receipts).values(
                    operation_id=result_id, agent_id=agent_id, epoch=epoch,
                    sequence=1, letter_id=letter_id, kind="letter.external_result",
                    fingerprint="0" * 64, result_revision=3,
                    occurred_at=now, accepted_at=now,
                ))
                entries = [[1, str(result_id)]]
                with pytest.raises(HTTPException) as missing:
                    await complete_authority_replay(
                        connection, agent_id=agent_id,
                        payload=_manifest(epoch, entries), enabled=True,
                    )
                assert missing.value.status_code == 409
                assert not (await read_authority_status(connection)).writable
                lease = await complete_authority_replay(
                    connection, agent_id=agent_id,
                    payload=_manifest(epoch, entries, external_count=1), enabled=True,
                )
                assert lease.mode == "online"
            finally:
                await transaction.rollback()
    finally:
        await engine.dispose()
