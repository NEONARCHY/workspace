# ruff: noqa: RUF001
"""Workspace-owned visibility rules; EDO enforces the resulting read scope."""

from datetime import UTC, datetime
from uuid import UUID, uuid4

from fastapi import HTTPException
from sqlalchemy import insert, select, update
from sqlalchemy.ext.asyncio import AsyncConnection

from .access_control import ensure_module_action
from .auth import AuthenticatedUser
from .edo_schemas import EdoAccessConfiguration, EdoAccessRule, EdoAccessUpdate, EdoDepartmentOption
from .edo_scope import MAX_SCOPE_EMPLOYEES, EdoReadScope
from .tables import audit_events, departments, edo_incoming_access, users


async def require_access_admin(connection: AsyncConnection, actor: AuthenticatedUser) -> None:
    if actor.role not in {"admin", "superadmin"}:
        raise HTTPException(403, "Настройка видимости доступна только администраторам.")
    await ensure_module_action(connection, actor, "incoming_letters", "admin")


async def resolve_read_scope(
    connection: AsyncConnection,
    actor: AuthenticatedUser,
) -> EdoReadScope:
    if actor.role in {"admin", "superadmin"}:
        return EdoReadScope(mode="all")
    rule = (
        (
            await connection.execute(
                select(edo_incoming_access).where(edo_incoming_access.c.user_id == actor.id)
            )
        )
        .mappings()
        .one_or_none()
    )
    if rule is None or rule["mode"] == "assigned":
        return EdoReadScope()
    if rule["mode"] == "all":
        return EdoReadScope(mode="all")
    if rule["mode"] != "departments":
        raise HTTPException(503, "Не удалось определить видимость писем.")
    department_ids = [UUID(value) for value in rule["department_ids"]]
    # Resolve membership on every request: moving/deactivating an employee
    # changes subsequent list, detail and file access without refreshing a rule.
    members = (
        (
            await connection.execute(
                select(users.c.id)
                .where(
                    users.c.status == "active",
                    users.c.department_id.in_(department_ids),
                )
                .limit(MAX_SCOPE_EMPLOYEES + 1)
            )
        )
        .scalars()
        .all()
    )
    ids = tuple(sorted({actor.id, *members}, key=str))
    if len(ids) > MAX_SCOPE_EMPLOYEES:
        raise HTTPException(
            422, "В выбранных подразделениях слишком много сотрудников (максимум 100)."
        )
    return EdoReadScope(mode="employees", employee_ids=ids)


async def read_access(
    connection: AsyncConnection,
    actor: AuthenticatedUser,
) -> EdoAccessConfiguration:
    await require_access_admin(connection, actor)
    accounts = (
        await connection.execute(
            select(users.c.id, users.c.role).where(users.c.status == "active").order_by(users.c.id)
        )
    ).all()
    stored = {
        row["user_id"]: row
        for row in (await connection.execute(select(edo_incoming_access))).mappings().all()
    }
    rules = []
    for account in accounts:
        row = stored.get(account.id)
        locked = account.role in {"admin", "superadmin"}
        rules.append(
            EdoAccessRule(
                user_id=account.id,
                mode="all" if locked else row["mode"] if row else "assigned",
                department_ids=[] if locked or row is None else row["department_ids"],
                revision=row["revision"] if row else 0,
                editable=not locked,
            )
        )
    options = (
        (
            await connection.execute(
                select(departments.c.id, departments.c.name).order_by(departments.c.name)
            )
        )
        .mappings()
        .all()
    )
    return EdoAccessConfiguration(
        rules=rules,
        departments=[EdoDepartmentOption(id=row["id"], name=row["name"]) for row in options],
    )


async def save_access(
    connection: AsyncConnection,
    actor: AuthenticatedUser,
    user_id: UUID,
    payload: EdoAccessUpdate,
) -> EdoAccessRule:
    await require_access_admin(connection, actor)
    account = (
        await connection.execute(
            select(users.c.id, users.c.role, users.c.status)
            .where(users.c.id == user_id)
            .with_for_update()
        )
    ).one_or_none()
    if account is None:
        raise HTTPException(404, "Сотрудник не найден.")
    if account.status != "active":
        raise HTTPException(422, "Выберите действующего сотрудника.")
    if account.role in {"admin", "superadmin"}:
        raise HTTPException(422, "Администраторы всегда видят все письма.")
    previous = (
        (
            await connection.execute(
                select(edo_incoming_access)
                .where(edo_incoming_access.c.user_id == user_id)
                .with_for_update()
            )
        )
        .mappings()
        .one_or_none()
    )
    revision = previous["revision"] if previous else 0
    if revision != payload.expected_revision:
        raise HTTPException(409, "Видимость уже изменена. Обновите настройки и повторите.")
    if payload.department_ids:
        found = (
            (
                await connection.execute(
                    select(departments.c.id).where(departments.c.id.in_(payload.department_ids))
                )
            )
            .scalars()
            .all()
        )
        if set(found) != set(payload.department_ids):
            raise HTTPException(422, "Одно из подразделений больше не существует.")
        members = (
            (
                await connection.execute(
                    select(users.c.id)
                    .where(
                        users.c.status == "active",
                        users.c.department_id.in_(payload.department_ids),
                    )
                    .limit(MAX_SCOPE_EMPLOYEES + 1)
                )
            )
            .scalars()
            .all()
        )
        if len({user_id, *members}) > MAX_SCOPE_EMPLOYEES:
            raise HTTPException(422, "Выберите подразделения с числом сотрудников не более 100.")
    now = datetime.now(UTC)
    values = {
        "mode": payload.mode,
        "department_ids": sorted(str(value) for value in payload.department_ids),
        "revision": revision + 1,
        "updated_by_user_id": actor.id,
        "updated_at": now,
    }
    if previous:
        await connection.execute(
            update(edo_incoming_access)
            .where(edo_incoming_access.c.user_id == user_id)
            .values(**values)
        )
    else:
        await connection.execute(insert(edo_incoming_access).values(user_id=user_id, **values))
    await connection.execute(
        insert(audit_events).values(
            id=uuid4(),
            actor_user_id=actor.id,
            action="edo.incoming_visibility_updated",
            target_type="user",
            target_id=user_id,
            details={
                "before": {
                    "mode": previous["mode"] if previous else "assigned",
                    "department_ids": previous["department_ids"] if previous else [],
                    "revision": revision,
                },
                "after": {
                    "mode": payload.mode,
                    "department_ids": values["department_ids"],
                    "revision": revision + 1,
                },
            },
            created_at=now,
        )
    )
    return EdoAccessRule(
        user_id=user_id,
        mode=payload.mode,
        department_ids=payload.department_ids,
        revision=revision + 1,
        editable=True,
    )
