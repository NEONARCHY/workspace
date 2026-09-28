"""Fenced AI Referent writes during a bot/server network partition.

The authority row is absent in legacy mode. The optional offline protocol must
be explicitly enabled before an agent can create it. A replay-required row is
never automatically reset by a later heartbeat.
"""

# ruff: noqa: RUF001

from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta
from typing import Annotated
from uuid import UUID, uuid4

from fastapi import Depends, HTTPException
from sqlalchemy import insert, select, update
from sqlalchemy.engine import RowMapping
from sqlalchemy.ext.asyncio import AsyncConnection

from .ai_referent_schemas import OfflineAuthorityLease, OfflineAuthorityStatus
from .database import get_connection
from .tables import ai_referent_authority, ai_referent_configuration, audit_events

LEASE_SECONDS = 45
_READ_ONLY = "AI Referent временно доступен только для просмотра: связь с роботом потеряна."


def _lease(value: RowMapping, now: datetime) -> OfflineAuthorityLease:
    return OfflineAuthorityLease(
        epoch=value["epoch"],
        mode=value["mode"],
        lease_until=value["lease_until"],
        server_time=now,
        lease_seconds=LEASE_SECONDS,
    )


async def start_authority(
    connection: AsyncConnection, *, agent_id: str, enabled: bool
) -> OfflineAuthorityLease:
    """Idempotently establish the initial lease; never clear an expired fence."""
    if not enabled:
        raise HTTPException(409, "Автономный режим AI Referent пока не включён на сервере.")
    assigned = await connection.scalar(
        select(ai_referent_configuration.c.execution_agent_id).with_for_update()
    )
    if assigned != agent_id:
        raise HTTPException(409, "Этот компьютер не назначен агентом отправки.")
    now = datetime.now(UTC)
    row = (
        await connection.execute(select(ai_referent_authority).with_for_update())
    ).mappings().first()
    if row is None:
        epoch = uuid4()
        lease_until = now + timedelta(seconds=LEASE_SECONDS)
        await connection.execute(insert(ai_referent_authority).values(
            id=1, agent_id=agent_id, epoch=epoch, mode="online",
            lease_until=lease_until, updated_at=now,
        ))
        await _audit(connection, "ai_referent.authority_started", epoch, agent_id, now)
        return OfflineAuthorityLease(
            epoch=epoch, mode="online", lease_until=lease_until,
            server_time=now, lease_seconds=LEASE_SECONDS,
        )
    if row["agent_id"] != agent_id:
        raise HTTPException(409, "Автономный режим уже закреплён за другим роботом.")
    if row["mode"] == "online" and row["lease_until"] <= now:
        await _require_replay(connection, row["epoch"], agent_id, now)
        return OfflineAuthorityLease(
            epoch=row["epoch"], mode="replay_required", lease_until=row["lease_until"],
            server_time=now, lease_seconds=LEASE_SECONDS,
        )
    return _lease(row, now)


async def heartbeat_authority(
    connection: AsyncConnection, *, agent_id: str, epoch: UUID
) -> OfflineAuthorityLease:
    """Renew only a still-live epoch; expiry always requires journal replay."""
    now = datetime.now(UTC)
    row = (
        await connection.execute(select(ai_referent_authority).with_for_update())
    ).mappings().first()
    if row is None or row["agent_id"] != agent_id or row["epoch"] != epoch:
        raise HTTPException(409, "Аренда робота не найдена или устарела.")
    if row["mode"] == "replay_required":
        return _lease(row, now)
    if row["lease_until"] <= now:
        await _require_replay(connection, epoch, agent_id, now)
        return OfflineAuthorityLease(
            epoch=epoch, mode="replay_required", lease_until=row["lease_until"],
            server_time=now, lease_seconds=LEASE_SECONDS,
        )
    lease_until = now + timedelta(seconds=LEASE_SECONDS)
    await connection.execute(
        update(ai_referent_authority)
        .where(ai_referent_authority.c.id == 1)
        .values(lease_until=lease_until, updated_at=now)
    )
    return OfflineAuthorityLease(
        epoch=epoch, mode="online", lease_until=lease_until,
        server_time=now, lease_seconds=LEASE_SECONDS,
    )


async def _require_replay(
    connection: AsyncConnection, epoch: UUID, agent_id: str, now: datetime
) -> None:
    await connection.execute(
        update(ai_referent_authority)
        .where(ai_referent_authority.c.id == 1)
        .values(mode="replay_required", updated_at=now)
    )
    await _audit(connection, "ai_referent.authority_replay_required", epoch, agent_id, now)


async def _audit(
    connection: AsyncConnection, action: str, epoch: UUID, agent_id: str, now: datetime
) -> None:
    await connection.execute(insert(audit_events).values(
        id=uuid4(), actor_user_id=None, action=action,
        target_type="ai_referent_authority", target_id=epoch,
        details={"agentId": agent_id}, created_at=now,
    ))


async def workspace_write_guard(connection: AsyncConnection) -> AsyncIterator[None]:
    """Serialize Referent writes through the configuration row and fence commits.

    FastAPI closes this dependency before get_connection commits. Checking both
    sides of the route means an operation begun just before expiry cannot commit
    after the bot may be allowed to take autonomous authority.
    """
    # Most letter services later take FOR UPDATE on this row. Taking FOR SHARE
    # here would let concurrent requests both acquire it and deadlock while
    # upgrading to FOR UPDATE. This lock also serializes authority start.
    await connection.execute(
        select(ai_referent_configuration.c.id).with_for_update()
    )
    row = (
        await connection.execute(select(ai_referent_authority).with_for_update(read=True))
    ).mappings().first()
    if row is not None and (row["mode"] != "online" or row["lease_until"] <= datetime.now(UTC)):
        raise HTTPException(503, _READ_ONLY)
    yield
    if row is not None and row["lease_until"] <= datetime.now(UTC):
        raise HTTPException(503, _READ_ONLY)


async def require_workspace_write(
    connection: Annotated[AsyncConnection, Depends(get_connection)],
) -> AsyncIterator[None]:
    async for _ in workspace_write_guard(connection):
        yield


async def read_authority_status(connection: AsyncConnection) -> OfflineAuthorityStatus:
    row = (await connection.execute(select(ai_referent_authority))).mappings().first()
    if row is None:
        return OfflineAuthorityStatus(writable=True, mode="legacy")
    writable = row["mode"] == "online" and row["lease_until"] > datetime.now(UTC)
    return OfflineAuthorityStatus(
        writable=writable,
        mode=row["mode"] if writable else "replay_required",
        lease_until=row["lease_until"],
        detail="" if writable else _READ_ONLY,
    )
