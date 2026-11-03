"""Transactional events; never contact Telegram while saving a business operation."""

from dataclasses import replace
from datetime import UTC, datetime
from uuid import UUID, uuid4

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.engine import RowMapping
from sqlalchemy.ext.asyncio import AsyncConnection

from .access_control import ensure_module_action
from .auth import AuthenticatedUser, load_authenticated_user
from .errors import WorkspaceRepositoryError
from .tables import approval_nodes, approval_requests, task_participants, tasks, telegram_bot_grants
from .telegram_notification_scope import GRANT, recipient
from .telegram_notification_tables import deliveries


def payment_actor(
    user: AuthenticatedUser, row: RowMapping, key: str, config: dict[str, object]
) -> bool:
    from .repository import SUBSIDY_APPROVAL_NODE, SUBSIDY_ROUTE_VARIANT, _can_act_from_config

    # Global administrative read/repair authority must not subscribe every admin to payments.
    # Retain explicit account/position assignments; role stages target that actual role.
    if (
        (row.get("actor_overrides") or {}).get(key) is not None
        or any(
            config.get(name)
            for name in ("approverUserId", "approverPositionId", "approverPositionIds")
        )
        or (
            key == SUBSIDY_APPROVAL_NODE
            and (row.get("payload") or {}).get("payment_route_variant") == SUBSIDY_ROUTE_VARIANT
        )
    ):
        return _can_act_from_config(replace(user, role="employee"), row, key, config)
    role = config.get("approverRole", "manager")
    return user.role == role


async def task_access(c: AsyncConnection, user: AuthenticatedUser, identifier: UUID) -> bool:
    from .repository import _task_access_row

    await ensure_module_action(c, user, "tasks", "view")
    row = await _task_access_row(c, user, identifier)
    involved = row["primary_assignee_user_id"] == user.id or bool(
        await c.scalar(
            select(task_participants.c.user_id).where(
                task_participants.c.task_id == identifier,
                task_participants.c.user_id == user.id,
                task_participants.c.participant_role == "co_assignee",
            ),
        )
    )
    return involved and row["status"] not in {"completed", "cancelled"}


async def current_payment_stage(
    c: AsyncConnection, identifier: UUID, key: str, version: int, user: AuthenticatedUser
) -> bool:
    await ensure_module_action(c, user, "payment_requests", "view")
    await ensure_module_action(c, user, "payment_requests", "approve")
    row = (
        (
            await c.execute(
                select(approval_requests).where(
                    approval_requests.c.id == identifier,
                )
            )
        )
        .mappings()
        .first()
    )
    if (
        row is None
        or row["status"] != "running"
        or key not in row["active_node_keys"]
        or row["current_version"] != version
    ):
        return False
    node = (
        (
            await c.execute(
                select(approval_nodes).where(
                    approval_nodes.c.template_id == row["template_id"],
                    approval_nodes.c.node_key == key,
                )
            )
        )
        .mappings()
        .first()
    )
    return bool(node and payment_actor(user, row, key, node["config"] or {}))


async def enqueue(
    c: AsyncConnection,
    user_id: UUID,
    key: str,
    kind: str,
    entity_id: UUID,
    title: str,
    body: str,
    stage: str | None = None,
    version: int | None = None,
) -> None:
    if await recipient(c, user_id) is None:
        return
    await c.execute(
        pg_insert(deliveries)
        .values(
            id=uuid4(),
            user_id=user_id,
            event_key=key,
            kind=kind,
            entity_id=entity_id,
            stage_key=stage,
            entity_version=version,
            title=title[:240],
            body=body[:3000],
            state="pending",
            created_at=datetime.now(UTC),
            attempts=0,
        )
        .on_conflict_do_nothing(index_elements=[deliveries.c.user_id, deliveries.c.event_key])
    )


async def queue_task(c: AsyncConnection, identifier: UUID) -> None:
    row = (await c.execute(select(tasks).where(tasks.c.id == identifier))).mappings().one()
    targets = {
        row["primary_assignee_user_id"],
        *(
            await c.execute(
                select(task_participants.c.user_id).where(
                    task_participants.c.task_id == identifier,
                    task_participants.c.participant_role == "co_assignee",
                )
            )
        )
        .scalars()
        .all(),
    }
    author = await load_authenticated_user(c, row["author_user_id"])
    body = f"{row['title']}\nПостановщик: {author.full_name if author else 'Сотрудник'}"  # noqa: RUF001
    if row["due_at"]:
        from zoneinfo import ZoneInfo

        body += "\nСрок: " + row["due_at"].astimezone(ZoneInfo("Asia/Tashkent")).strftime(  # noqa: RUF001
            "%d.%m.%Y %H:%M"
        )
    if row["description"]:
        body += "\n\n" + row["description"][:600]
    for user_id in targets - {row["author_user_id"]}:
        user = await load_authenticated_user(c, user_id)
        try:
            eligible = bool(user and await task_access(c, user, identifier))
        except (WorkspaceRepositoryError, HTTPException) as error:
            if error.status_code not in {403, 404}:
                raise
            eligible = False
        if eligible:
            await enqueue(
                c,
                user_id,
                f"task:{identifier}:assigned",
                "task_assigned",
                identifier,
                "Новая задача в Workspace",
                body,
            )


async def queue_payment(c: AsyncConnection, identifier: UUID) -> None:
    row = (
        (
            await c.execute(
                select(approval_requests).where(
                    approval_requests.c.id == identifier,
                )
            )
        )
        .mappings()
        .one()
    )
    if row["status"] != "running":
        return
    targets = (
        (
            await c.execute(
                select(telegram_bot_grants.c.user_id).where(
                    telegram_bot_grants.c.bot_key == GRANT,
                )
            )
        )
        .scalars()
        .all()
    )
    for user_id in targets:
        user = await load_authenticated_user(c, user_id)
        if user is None:
            continue
        for key in row["active_node_keys"]:
            try:
                eligible = await current_payment_stage(
                    c, identifier, key, row["current_version"], user
                )
            except (WorkspaceRepositoryError, HTTPException) as error:
                if error.status_code not in {403, 404}:
                    raise
                eligible = False
            if not eligible:
                continue
            payload = row["payload"] or {}
            body = f"{row['title']}\nЗаявка №{payload.get('number', '')}"  # noqa: RUF001
            body += f"\nСумма: {payload.get('amount', '')} {payload.get('currency', '')}"  # noqa: RUF001
            node_title = await c.scalar(
                select(approval_nodes.c.title).where(
                    approval_nodes.c.template_id == row["template_id"],
                    approval_nodes.c.node_key == key,
                )
            )
            body += f"\nЭтап: {node_title}\nТребуется ваше решение."  # noqa: RUF001
            await enqueue(
                c,
                user_id,
                f"payment:{identifier}:{key}:v{row['current_version']}",
                "payment_action",
                identifier,
                "Заявка на оплату в Workspace",
                body,
                key,
                row["current_version"],
            )
