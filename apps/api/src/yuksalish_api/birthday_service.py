# ruff: noqa: RUF001 - Russian notification text is intentional.
"""Opt-in birthdays with idempotent annual feed and colleague notifications."""

import calendar
from datetime import UTC, date, datetime
from uuid import UUID, uuid4
from zoneinfo import ZoneInfo

from sqlalchemy import select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncConnection

from .tables import feed_posts, users, workspace_notifications

TASHKENT = ZoneInfo("Asia/Tashkent")


def birthday_today(month: int, day: int, today: date) -> bool:
    if month == 2 and day == 29 and not calendar.isleap(today.year):
        return today.month == 2 and today.day == 28
    return today.month == month and today.day == day


async def get_birthday(connection: AsyncConnection, user_id: UUID) -> dict[str, int | None]:
    row = (
        await connection.execute(
            select(users.c.birthday_month, users.c.birthday_day).where(users.c.id == user_id)
        )
    ).one()
    return {"month": row.birthday_month, "day": row.birthday_day}


async def set_birthday(
    connection: AsyncConnection, user_id: UUID, month: int | None, day: int | None,
) -> dict[str, int | None]:
    await connection.execute(
        update(users).where(users.c.id == user_id).values(
            birthday_month=month, birthday_day=day, updated_at=datetime.now(UTC),
        )
    )
    return {"month": month, "day": day}


async def materialize_birthdays(
    connection: AsyncConnection, today: date | None = None,
) -> int:
    local_today = today or datetime.now(TASHKENT).date()
    now = datetime.now(UTC)
    birthday_people = (
        await connection.execute(
            select(users.c.id, users.c.full_name, users.c.birthday_month, users.c.birthday_day)
            .where(users.c.status == "active", users.c.birthday_month.is_not(None))
        )
    ).all()
    colleagues = (
        await connection.execute(select(users.c.id).where(users.c.status == "active"))
    ).scalars().all()
    created = 0
    for person in birthday_people:
        if not birthday_today(person.birthday_month, person.birthday_day, local_today):
            continue
        new_post_id = uuid4()
        post_id = await connection.scalar(
            pg_insert(feed_posts).values(
                id=new_post_id, author_user_id=None,
                title=f"С днём рождения, {person.full_name}!",
                body=(
                    f"Команда Yuksalish поздравляет {person.full_name} с днём рождения! "
                    "Желаем вдохновения, крепкого здоровья и новых успехов."
                ),
                is_pinned=False, created_at=now, updated_at=now,
                system_kind="birthday", birthday_user_id=person.id,
                birthday_year=local_today.year,
            ).on_conflict_do_nothing(
                constraint="uq_feed_birthday_user_year"
            ).returning(feed_posts.c.id)
        )
        if post_id is None:
            post_id = await connection.scalar(
                select(feed_posts.c.id).where(
                    feed_posts.c.birthday_user_id == person.id,
                    feed_posts.c.birthday_year == local_today.year,
                )
            )
        else:
            created += 1
        if post_id is None:
            continue
        for colleague_id in colleagues:
            if colleague_id == person.id:
                continue
            notification_id = await connection.scalar(
                pg_insert(workspace_notifications).values(
                    id=uuid4(), user_id=colleague_id,
                    event_key=f"birthday:{person.id}:{local_today.year}",
                    kind="birthday", priority="normal", title="День рождения коллеги",
                    body=f"Сегодня день рождения у {person.full_name}. Поздравьте коллегу!",
                    section="feed", entity_id=post_id, requires_action=False,
                    is_reminder=False, occurred_at=now, read_at=None,
                    resolved_at=None, desktop_delivered_at=None,
                ).on_conflict_do_nothing(
                    index_elements=[
                        workspace_notifications.c.user_id,
                        workspace_notifications.c.event_key,
                    ]
                ).returning(workspace_notifications.c.id)
            )
            created += int(notification_id is not None)
    return created
