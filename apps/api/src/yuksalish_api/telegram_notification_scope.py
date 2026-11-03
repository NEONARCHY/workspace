"""Additional bot grant never overrides current central-office membership."""

import re
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncConnection

from .tables import departments, telegram_bot_grants, telegram_identities, users

GRANT = "workspace_notifications"


async def central_office(c: AsyncConnection, user_id: UUID) -> bool:
    account = (
        (
            await c.execute(
                select(users.c.department_id, users.c.status).where(
                    users.c.id == user_id,
                )
            )
        )
        .mappings()
        .first()
    )
    if account is None or account["status"] != "active":
        return False
    identifier = account["department_id"]
    if identifier is None:
        # Only an explicitly recorded central contour can classify an unassigned leader.
        return bool(
            await c.scalar(
                select(telegram_bot_grants.c.user_id).where(
                    telegram_bot_grants.c.user_id == user_id,
                    telegram_bot_grants.c.bot_key == "hisobot",
                    telegram_bot_grants.c.report_scope == "central",
                )
            )
        )
    seen: set[UUID] = set()
    while identifier is not None:
        if identifier in seen:
            return False
        seen.add(identifier)
        dept = (
            (
                await c.execute(
                    select(departments).where(
                        departments.c.id == identifier,
                    )
                )
            )
            .mappings()
            .first()
        )
        if dept is None or dept["scope"] != "central":
            return False
        identifier = dept["parent_id"]
    return True


async def recipient(c: AsyncConnection, user_id: UUID) -> tuple[str, int] | None:
    if not await central_office(c, user_id):
        return None
    row = (
        (
            await c.execute(
                select(telegram_identities)
                .join(
                    telegram_bot_grants,
                    telegram_bot_grants.c.user_id == telegram_identities.c.user_id,
                )
                .where(
                    telegram_identities.c.user_id == user_id,
                    telegram_identities.c.verified_at.is_not(None),
                    telegram_bot_grants.c.bot_key == GRANT,
                )
            )
        )
        .mappings()
        .first()
    )
    if (
        row is None
        or not row["telegram_id"]
        or not re.fullmatch(r"[1-9][0-9]{0,15}", str(row["telegram_id"]))
    ):
        return None
    return str(row["telegram_id"]), int(row["revision"])
