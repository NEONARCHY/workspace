"""A verified Telegram identity and explicit grant gate Workspace delivery."""

import re
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncConnection

from .tables import telegram_bot_grants, telegram_identities, users

GRANT = "workspace_notifications"


async def recipient(c: AsyncConnection, user_id: UUID) -> tuple[str, int] | None:
    active = await c.scalar(select(users.c.id).where(
        users.c.id == user_id, users.c.status == "active",
    ))
    if active is None:
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
