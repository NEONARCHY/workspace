"""Fenced AI Referent writes during a bot/server network partition.

The authority row is absent in legacy mode. The optional offline protocol must
be explicitly enabled before an agent can create it. A replay-required row is
never automatically reset by a later heartbeat.
"""

# ruff: noqa: RUF001

import hashlib
import json
from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta
from typing import Annotated
from uuid import NAMESPACE_URL, UUID, uuid4, uuid5

from fastapi import Depends, HTTPException
from sqlalchemy import delete, insert, select, update
from sqlalchemy.engine import RowMapping
from sqlalchemy.ext.asyncio import AsyncConnection

from .ai_referent_agent_service import expire_jobs
from .ai_referent_schemas import (
    OfflineAuthorityLease,
    OfflineAuthorityRetirement,
    OfflineAuthorityStatus,
    OfflineReplayCompleteRequest,
)
from .database import get_connection
from .tables import (
    ai_referent_authority,
    ai_referent_configuration,
    ai_referent_delivery_commands,
    ai_referent_letters,
    ai_referent_offline_operation_receipts,
    audit_events,
)

LEASE_SECONDS = 20
_READ_ONLY = "AI Referent временно доступен только для просмотра: связь с роботом потеряна."


def _lease(
    value: RowMapping, now: datetime, *, retire_requested: bool = False
) -> OfflineAuthorityLease:
    return OfflineAuthorityLease(
        epoch=value["epoch"],
        mode=value["mode"],
        lease_until=value["lease_until"],
        server_time=now,
        lease_seconds=LEASE_SECONDS,
        retire_requested=retire_requested,
    )


async def start_authority(
    connection: AsyncConnection, *, agent_id: str, enabled: bool
) -> OfflineAuthorityLease:
    """Idempotently establish the initial lease; never clear an expired fence."""
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
        if not enabled:
            raise HTTPException(409, "Автономный режим AI Referent пока не включён на сервере.")
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
            retire_requested=False,
        )
    if row["agent_id"] != agent_id:
        raise HTTPException(409, "Автономный режим уже закреплён за другим роботом.")
    if row["mode"] == "online" and row["lease_until"] <= now:
        await _require_replay(connection, row["epoch"], agent_id, now)
        return OfflineAuthorityLease(
            epoch=row["epoch"], mode="replay_required", lease_until=row["lease_until"],
            server_time=now, lease_seconds=LEASE_SECONDS,
            retire_requested=not enabled,
        )
    return _lease(row, now, retire_requested=not enabled)


async def heartbeat_authority(
    connection: AsyncConnection, *, agent_id: str, epoch: UUID, enabled: bool = True
) -> OfflineAuthorityLease:
    """Renew only a still-live epoch; expiry always requires journal replay."""
    now = datetime.now(UTC)
    row = (
        await connection.execute(select(ai_referent_authority).with_for_update())
    ).mappings().first()
    if row is None or row["agent_id"] != agent_id or row["epoch"] != epoch:
        raise HTTPException(409, "Аренда робота не найдена или устарела.")
    if row["mode"] == "replay_required":
        return _lease(row, now, retire_requested=not enabled)
    if row["lease_until"] <= now:
        await _require_replay(connection, epoch, agent_id, now)
        return OfflineAuthorityLease(
            epoch=epoch, mode="replay_required", lease_until=row["lease_until"],
            server_time=now, lease_seconds=LEASE_SECONDS,
            retire_requested=not enabled,
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
        retire_requested=not enabled,
    )


async def complete_authority_replay(
    connection: AsyncConnection,
    *,
    agent_id: str,
    payload: OfflineReplayCompleteRequest,
    enabled: bool,
) -> OfflineAuthorityLease:
    """Unfence after full replay; queued server jobs then resume under the new lease."""
    await connection.execute(select(ai_referent_configuration.c.id).with_for_update())
    assigned = await connection.scalar(select(ai_referent_configuration.c.execution_agent_id))
    if assigned != agent_id:
        raise HTTPException(403, "Этот компьютер не назначен агентом отправки.")
    now = datetime.now(UTC)
    authority = (
        await connection.execute(select(ai_referent_authority).with_for_update())
    ).mappings().one_or_none()
    if authority is None or authority["agent_id"] != agent_id:
        raise HTTPException(409, "Аренда робота не найдена.")
    receipt_id = uuid5(NAMESPACE_URL, "ai-offline-replay-complete:" + str(payload.epoch))
    previous = (
        await connection.execute(select(audit_events).where(audit_events.c.id == receipt_id))
    ).mappings().one_or_none()
    if previous is not None:
        details = previous["details"]
        if not isinstance(details, dict) or details.get("newEpoch") is None:
            raise HTTPException(409, "Квитанция завершения сверки повреждена.")
        try:
            new_epoch = UUID(str(details["newEpoch"]))
        except ValueError as error:
            raise HTTPException(409, "Квитанция завершения сверки повреждена.") from error
        if previous["action"] != "ai_referent.authority_replay_completed" or details != {
            "agentId": agent_id,
            "operationCount": payload.operation_count,
            "lastSequence": payload.last_sequence,
            "operationsSha256": payload.operations_sha256,
            "externalEffectCount": payload.external_effect_count,
            "newEpoch": str(new_epoch),
        }:
            raise HTTPException(409, "Повторное завершение сверки содержит другие данные.")
        if authority["epoch"] != new_epoch:
            raise HTTPException(409, "После сверки уже началась другая эпоха робота.")
        if authority["mode"] == "online" and authority["lease_until"] <= now:
            await _require_replay(connection, authority["epoch"], agent_id, now)
            return OfflineAuthorityLease(
                epoch=authority["epoch"], mode="replay_required",
                lease_until=authority["lease_until"], server_time=now,
                lease_seconds=LEASE_SECONDS,
                retire_requested=not enabled,
            )
        return _lease(authority, now, retire_requested=not enabled)
    if (
        authority["epoch"] != payload.epoch
        or authority["mode"] != "replay_required"
    ):
        raise HTTPException(409, "Сервер ещё не ожидает сверку этой эпохи.")
    receipts = (
        await connection.execute(select(ai_referent_offline_operation_receipts).where(
            ai_referent_offline_operation_receipts.c.agent_id == agent_id,
            ai_referent_offline_operation_receipts.c.epoch == payload.epoch,
        ).order_by(ai_referent_offline_operation_receipts.c.sequence))
    ).mappings().all()
    entries = [[int(row["sequence"]), str(row["operation_id"])] for row in receipts]
    external_results = sum(row["kind"] == "letter.external_result" for row in receipts)
    if payload.external_effect_count != external_results:
        raise HTTPException(409, "Сверены не все внешние отправки автономного журнала.")
    digest = hashlib.sha256(json.dumps(entries, separators=(",", ":")).encode()).hexdigest()
    if (
        len(receipts) != payload.operation_count
        or (entries[-1][0] if entries else None) != payload.last_sequence
        or digest != payload.operations_sha256
    ):
        raise HTTPException(409, "Сервер получил не весь автономный журнал.")
    # An old claimed job may have clicked E-XAT/Webmail while the API was lost.
    # Expire its lease into delivery_unknown before lifting the write fence;
    # an unexpired claim means the physical executor might still be running.
    await expire_jobs(connection)
    active_job = await connection.scalar(select(ai_referent_delivery_commands.c.id).where(
        ai_referent_delivery_commands.c.status == "claimed"
    ).limit(1))
    if active_job is not None:
        raise HTTPException(409, "Ранее взятое роботом задание ещё выполняется.")
    command_ids = [
        uuid5(NAMESPACE_URL, "ai-offline-command:" + str(row["operation_id"]))
        for row in receipts if row["kind"] == "letter.action"
    ]
    if command_ids:
        commands = (
            await connection.execute(select(ai_referent_delivery_commands).where(
                ai_referent_delivery_commands.c.id.in_(command_ids)
            ))
        ).mappings().all()
        for command in commands:
            letter_status = await connection.scalar(select(ai_referent_letters.c.status).where(
                ai_referent_letters.c.id == command["letter_id"]
            ))
            if not (
                (command["status"] == "pending" and letter_status == "queued")
                or (command["status"] == "completed" and letter_status not in {"queued", "sending"})
            ):
                raise HTTPException(409, "Статус подготовки письма требует ручной сверки.")
    new_epoch = uuid4()
    lease_until = now + timedelta(seconds=LEASE_SECONDS)
    await connection.execute(update(ai_referent_authority).where(
        ai_referent_authority.c.id == 1
    ).values(epoch=new_epoch, mode="online", lease_until=lease_until, updated_at=now))
    await connection.execute(insert(audit_events).values(
        id=receipt_id, actor_user_id=None, action="ai_referent.authority_replay_completed",
        target_type="ai_referent_authority", target_id=payload.epoch,
        details={
            "agentId": agent_id,
            "operationCount": payload.operation_count,
            "lastSequence": payload.last_sequence,
            "operationsSha256": payload.operations_sha256,
            "externalEffectCount": payload.external_effect_count,
            "newEpoch": str(new_epoch),
        },
        created_at=now,
    ))
    return OfflineAuthorityLease(
        epoch=new_epoch, mode="online", lease_until=lease_until,
        server_time=now, lease_seconds=LEASE_SECONDS,
        retire_requested=not enabled,
    )


async def retire_authority(
    connection: AsyncConnection, *, agent_id: str, payload: OfflineReplayCompleteRequest,
    enabled: bool,
) -> OfflineAuthorityRetirement:
    """Release the fence only after the bot has durably surrendered offline writes.

    The bot sends the same complete journal manifest as replay. A lost HTTP
    response can be retried against the deterministic audit receipt; neither
    a missing journal nor an active physical send can silently unlock writes.
    """
    await connection.execute(select(ai_referent_configuration.c.id).with_for_update())
    assigned = await connection.scalar(select(ai_referent_configuration.c.execution_agent_id))
    if assigned != agent_id:
        raise HTTPException(403, "Этот компьютер не назначен агентом отправки.")
    receipt_id = uuid5(NAMESPACE_URL, "ai-offline-authority-retired:" + str(payload.epoch))
    previous = (
        await connection.execute(select(audit_events).where(audit_events.c.id == receipt_id))
    ).mappings().one_or_none()
    details = {
        "agentId": agent_id,
        "operationCount": payload.operation_count,
        "lastSequence": payload.last_sequence,
        "operationsSha256": payload.operations_sha256,
        "externalEffectCount": payload.external_effect_count,
    }
    authority = (
        await connection.execute(select(ai_referent_authority).with_for_update())
    ).mappings().one_or_none()
    if previous is not None:
        if (
            previous["action"] != "ai_referent.authority_retired"
            or not isinstance(previous["details"], dict)
            or any(previous["details"].get(key) != value for key, value in details.items())
            or (authority is not None and authority["epoch"] == payload.epoch)
        ):
            raise HTTPException(409, "Повторное завершение аренды содержит другие данные.")
        return OfflineAuthorityRetirement(epoch=payload.epoch)
    if enabled:
        raise HTTPException(409, "Отключите автономный режим перед завершением аренды робота.")
    if (
        authority is None or authority["agent_id"] != agent_id
        or authority["epoch"] != payload.epoch
        or authority["mode"] not in {"online", "replay_required"}
    ):
        raise HTTPException(409, "Аренда робота не найдена или уже изменилась.")
    if authority["mode"] == "online":
        await _require_replay(connection, payload.epoch, agent_id, datetime.now(UTC))
    # Reuse the exact replay verification: operation receipts, external
    # effects and in-flight delivery commands must all reconcile first.
    lease = await complete_authority_replay(
        connection, agent_id=agent_id, payload=payload, enabled=False
    )
    if lease.mode != "online":
        raise HTTPException(409, "Сверка ещё не завершена; блокировка записи сохранена.")
    await connection.execute(
        delete(ai_referent_authority).where(
            ai_referent_authority.c.id == 1,
            ai_referent_authority.c.epoch == lease.epoch,
        )
    )
    await connection.execute(insert(audit_events).values(
        id=receipt_id, actor_user_id=None, action="ai_referent.authority_retired",
        target_type="ai_referent_authority", target_id=payload.epoch,
        details={**details, "completedEpoch": str(lease.epoch)},
        created_at=datetime.now(UTC),
    ))
    return OfflineAuthorityRetirement(epoch=payload.epoch)


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
