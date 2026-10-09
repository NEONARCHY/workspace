"""Durable directory reconciliation with leases, revisions and bounded retries."""

import asyncio
import hashlib
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import insert, or_, select, update
from sqlalchemy.ext.asyncio import AsyncConnection, AsyncEngine

from .auth import AuthenticatedUser
from .edo_access import require_access_admin
from .edo_employee_client import (
    EmployeeSyncError,
    canonical_bytes,
    deliver_employee,
    snapshot_hash,
    sync_configured,
)
from .edo_employee_schemas import (
    EmployeeSnapshot,
    EmployeeSyncAck,
    EmployeeSyncEntry,
    EmployeeSyncRequest,
    EmployeeSyncStatus,
)
from .settings import Settings
from .tables import audit_events, departments, users
from .tables import edo_employee_sync as sync


@dataclass(frozen=True)
class SyncClaim:
    user_id: UUID
    revision: int
    token: UUID
    payload: EmployeeSyncRequest


async def reconcile_employees(
    connection: AsyncConnection,
    *,
    now: datetime | None = None,
) -> int:
    current = now or datetime.now(UTC)
    # NO KEY UPDATE serializes reconcilers without blocking foreign-key audit
    # inserts while another transaction holds a delivery row lock.
    rows = (
        (
            await connection.execute(
                select(
                    users.c.id,
                    users.c.username,
                    users.c.full_name,
                    users.c.status,
                    users.c.department_id,
                    users.c.job_title,
                    departments.c.name.label("department_name"),
                )
                .outerjoin(departments, departments.c.id == users.c.department_id)
                .order_by(users.c.id)
                .with_for_update(of=users, skip_locked=True, key_share=True)
            )
        )
        .mappings()
        .all()
    )
    changed = 0
    for employee in rows:
        raw: dict[str, object] = {
            "employee_id": str(employee["id"]),
            "username": employee["username"],
            "full_name": employee["full_name"],
            "status": "pending" if employee["status"] == "invited" else employee["status"],
            "department_id": str(employee["department_id"]) if employee["department_id"] else None,
            "department_name": employee["department_name"],
            "job_title": employee["job_title"],
        }
        invalid = False
        try:
            snapshot = EmployeeSnapshot.model_validate(raw)
            payload = snapshot.model_dump(mode="json")
            digest = snapshot_hash(snapshot)
        except ValidationError:
            # One invalid historical record must not block all other employees.
            payload = raw
            digest = hashlib.sha256(canonical_bytes(raw)).hexdigest()
            invalid = True
        previous = (
            (
                await connection.execute(
                    select(sync).where(sync.c.user_id == employee["id"]).with_for_update()
                )
            )
            .mappings()
            .one_or_none()
        )
        if previous is not None and previous["payload_hash"] == digest:
            continue
        values = {
            "payload": payload,
            "payload_hash": digest,
            "revision": previous["revision"] + 1 if previous else 1,
            "state": "conflict" if invalid else "pending",
            "attempts": 0,
            "next_attempt_at": current,
            "last_error_code": "invalid_snapshot" if invalid else None,
            "updated_at": current,
        }
        if previous is None:
            await connection.execute(
                insert(sync).values(
                    user_id=employee["id"],
                    delivered_revision=0,
                    **values,
                )
            )
        else:
            # Preserve an active lease: its acknowledgement cannot deliver this
            # newer revision, and the old request must finish before another starts.
            await connection.execute(
                update(sync).where(sync.c.user_id == employee["id"]).values(**values)
            )
        changed += 1
    return changed


async def claim_employee(
    connection: AsyncConnection,
    *,
    now: datetime | None = None,
) -> SyncClaim | None:
    current = now or datetime.now(UTC)
    row = (
        (
            await connection.execute(
                select(sync)
                .where(
                    sync.c.state.in_(["pending", "retry"]),
                    sync.c.next_attempt_at <= current,
                    or_(sync.c.lease_until.is_(None), sync.c.lease_until < current),
                )
                .order_by(sync.c.next_attempt_at, sync.c.user_id)
                .with_for_update(skip_locked=True)
                .limit(1)
            )
        )
        .mappings()
        .one_or_none()
    )
    if row is None:
        return None
    token = uuid4()
    payload = EmployeeSyncRequest.model_validate(
        {
            **row["payload"],
            "protocol_version": 1,
            "revision": row["revision"],
        }
    )
    await connection.execute(
        update(sync)
        .where(sync.c.user_id == row["user_id"])
        .values(
            lease_token=token,
            lease_until=current + timedelta(seconds=120),
            attempts=row["attempts"] + 1,
        )
    )
    return SyncClaim(row["user_id"], row["revision"], token, payload)


async def finish_employee(
    connection: AsyncConnection,
    claim: SyncClaim,
    result: EmployeeSyncAck | EmployeeSyncError,
    *,
    now: datetime | None = None,
) -> None:
    current = now or datetime.now(UTC)
    row = (
        (
            await connection.execute(
                select(sync).where(sync.c.user_id == claim.user_id).with_for_update()
            )
        )
        .mappings()
        .one_or_none()
    )
    if row is None or row["lease_token"] != claim.token:
        return  # An expired lease was reclaimed. Its old worker cannot overwrite it.
    is_latest = row["revision"] == claim.revision
    if (
        isinstance(result, EmployeeSyncAck)
        and row["edo_user_id"] is not None
        and row["edo_user_id"] != result.edo_user_id
    ):
        result = EmployeeSyncError("mapping_changed")
    values: dict[str, object] = dict(lease_token=None, lease_until=None)
    if isinstance(result, EmployeeSyncError):
        values.update(
            state=("retry" if result.retryable else "conflict") if is_latest else "pending",
            last_error_code=result.code if is_latest else None,
            next_attempt_at=current
            + timedelta(seconds=min(3600, 30 * 2 ** min(row["attempts"], 7)))
            if is_latest and result.retryable
            else current,
        )
    else:
        values.update(
            state="synced" if is_latest else "pending",
            edo_user_id=result.edo_user_id,
            delivered_revision=claim.revision,
            last_synced_at=current,
            last_error_code=None,
            next_attempt_at=current,
        )
        # Once recorded, identical retries do not emit duplicate delivery audits.
        if row["delivered_revision"] < claim.revision:
            await connection.execute(
                insert(audit_events).values(
                    id=uuid4(),
                    actor_user_id=None,
                    action="edo.employee_synced",
                    target_type="user",
                    target_id=claim.user_id,
                    details={
                        "revision": claim.revision,
                        "edoUserId": result.edo_user_id,
                        "action": result.action,
                        "mappingActive": result.mapping_active,
                    },
                    created_at=current,
                )
            )
    await connection.execute(update(sync).where(sync.c.user_id == claim.user_id).values(**values))


async def run_employee_sync_cycle(
    engine: AsyncEngine,
    settings: Settings,
    *,
    batch_size: int = 20,
) -> int:
    if not settings.edo_employee_sync_enabled or not sync_configured(settings):
        return 0
    async with engine.begin() as connection:
        await reconcile_employees(connection)
    processed = 0
    for _ in range(batch_size):
        async with engine.begin() as connection:
            claim = await claim_employee(connection)
        if claim is None:
            break
        try:
            result: EmployeeSyncAck | EmployeeSyncError = await asyncio.wait_for(
                deliver_employee(settings, claim.payload),
                timeout=55,
            )
        except EmployeeSyncError as error:
            result = error
        except TimeoutError:
            result = EmployeeSyncError("timeout", retryable=True)
        # The remote request is outside the DB transaction and row lock.
        async with engine.begin() as connection:
            await finish_employee(connection, claim, result)
        processed += 1
        if isinstance(result, EmployeeSyncError) and result.retryable:
            # Reconcile fresh directory changes next tick instead of spending
            # an entire batch waiting on an unavailable remote server.
            break
    return processed


async def employee_sync_status(
    connection: AsyncConnection,
    actor: AuthenticatedUser,
    settings: Settings,
) -> EmployeeSyncStatus:
    await require_access_admin(connection, actor)
    rows = (
        (
            await connection.execute(
                select(sync, users.c.full_name.label("name"))
                .join(users, users.c.id == sync.c.user_id)
                .order_by(users.c.full_name)
            )
        )
        .mappings()
        .all()
    )
    return EmployeeSyncStatus(
        enabled=settings.edo_employee_sync_enabled,
        configured=sync_configured(settings),
        entries=[
            EmployeeSyncEntry(
                user_id=row["user_id"],
                name=row["name"],
                status=row["state"],
                revision=row["revision"],
                delivered_revision=row["delivered_revision"],
                edo_user_id=row["edo_user_id"],
                attempts=row["attempts"],
                last_error_code=row["last_error_code"],
                last_synced_at=row["last_synced_at"],
            )
            for row in rows
        ],
    )


async def retry_employee_sync(
    connection: AsyncConnection,
    actor: AuthenticatedUser,
    employee_id: UUID,
) -> None:
    await require_access_admin(connection, actor)
    row = (
        (
            await connection.execute(
                select(sync).where(sync.c.user_id == employee_id).with_for_update()
            )
        )
        .mappings()
        .one_or_none()
    )
    if row is None:
        raise HTTPException(404, "Employee has not been queued for EDO")
    if row["state"] not in {"retry", "conflict"}:
        raise HTTPException(409, "Only a failed synchronization can be retried")
    if row["last_error_code"] == "invalid_snapshot":
        raise HTTPException(409, "Correct employee data before retrying")
    now = datetime.now(UTC)
    if row["lease_until"] is not None and row["lease_until"] >= now:
        raise HTTPException(409, "Synchronization is already in progress")
    await connection.execute(
        update(sync)
        .where(sync.c.user_id == employee_id)
        .values(
            state="pending",
            next_attempt_at=now,
            attempts=0,
            last_error_code=None,
            lease_token=None,
            lease_until=None,
        )
    )
    await connection.execute(
        insert(audit_events).values(
            id=uuid4(),
            actor_user_id=actor.id,
            action="edo.employee_sync_retried",
            target_type="user",
            target_id=employee_id,
            details={"revision": row["revision"]},
            created_at=now,
        )
    )
