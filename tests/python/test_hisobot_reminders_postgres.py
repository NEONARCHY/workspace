"""Hisobot backlog tests use only the isolated PostgreSQL integration database."""

import asyncio
import os
from datetime import UTC, date, datetime
from uuid import UUID, uuid4

import pytest
from sqlalchemy import delete, insert, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncConnection, create_async_engine

from yuksalish_api.auth import load_authenticated_user
from yuksalish_api.hisobot_service import (
    TASHKENT,
    collapse_hisobot_notification_backlog,
    materialize_hisobot_reminders,
)
from yuksalish_api.repository import (
    _upsert_notification,
    find_active_user_by_username,
    load_workspace,
)
from yuksalish_api.seed import seed_demo_data
from yuksalish_api.tables import (
    departments,
    hisobot_live_reports,
    hisobot_live_vacations,
    hisobot_unit_reports,
    telegram_bot_grants,
    telegram_identities,
    users,
    workspace_notifications,
)
from yuksalish_api.telegram_access_schemas import HISOBOT_REGIONS


def at(day: int, hour: int, minute: int = 0, second: int = 0) -> datetime:
    return datetime(2026, 10, day, hour, minute, second, tzinfo=TASHKENT)


async def legacy_reminder(connection: AsyncConnection, user_id: UUID, day: int) -> None:
    await _upsert_notification(
        connection, user_id=user_id, event_key=f"hisobot:2026-10-{day:02d}:1825",
        kind="hisobot", priority="attention", title="AI Hisobot · отчёт не сдан",
        body="Старое напоминание до обновления", section="ai_hisobot", entity_id=None,
        requires_action=True, occurred_at=at(day, 18, 25), is_reminder=True,
    )


async def unit_report(
    connection: AsyncConnection, department_id: UUID, user_id: UUID,
    telegram_id: str, day: int, *, region: str | None = None,
) -> None:
    await connection.execute(insert(hisobot_unit_reports).values(
        id=uuid4(), department_id=department_id, department_name="Проверочный отдел",
        reporter_user_id=user_id, reporter_telegram_id=telegram_id,
        reporter_employee_key=str(user_id), reporter_name="Проверочный руководитель",
        reporter_position="Руководитель", report_scope="hudud" if region else "central",
        region_name=region, covered_telegram_ids=[] if region else [telegram_id],
        report_date=date(2026, 10, day), content="Рабочий отчёт для интеграционной проверки",
        submitted_at=at(day, 18), is_late=False, source="workspace",
        created_at=at(day, 18), updated_at=at(day, 18),
    ))


async def exercise_backlog(url: str) -> None:
    engine = create_async_engine(url)
    try:
        await seed_demo_data(engine)
        async with engine.connect() as connection:
            transaction = await connection.begin()
            try:
                # Fixture isolation is rolled back; no working database or real grants are changed.
                await connection.execute(delete(telegram_bot_grants).where(
                    telegram_bot_grants.c.bot_key == "hisobot"
                ))
                await connection.execute(delete(workspace_notifications).where(
                    workspace_notifications.c.kind == "hisobot"
                ))
                actor_ids: list[UUID] = []
                telegram_ids: list[str] = []
                for index, username in enumerate(("dilshod", "baxtiyor", "aziza", "malika")):
                    actor = await find_active_user_by_username(connection, username)
                    assert actor is not None
                    actor_ids.append(actor["id"])
                    telegram_id = str(9_000_000_000_000 + uuid4().int % 1_000_000_000 + index)
                    telegram_ids.append(telegram_id)
                    await connection.execute(update(users).where(
                        users.c.id == actor["id"]
                    ).values(department_id=None))
                    identity = pg_insert(telegram_identities).values(
                        user_id=actor["id"], telegram_id=telegram_id,
                        updated_at=at(5, 12), revision=1,
                    )
                    await connection.execute(identity.on_conflict_do_update(
                        index_elements=[telegram_identities.c.user_id],
                        set_={"telegram_id": telegram_id},
                    ))
                    await connection.execute(insert(telegram_bot_grants).values(
                        user_id=actor["id"], bot_key="hisobot", report_scope="central",
                        region_name=None, report_required=index < 3, hisobot_manager=False,
                        updated_at=at(5, 12),
                    ))
                owner, submitted, exempt, not_required = actor_ids
                assert await materialize_hisobot_reminders(connection, at(5, 17, 39)) == 0
                assert await materialize_hisobot_reminders(connection, at(5, 17, 40)) == 3
                await connection.execute(insert(hisobot_live_reports).values(
                    id=uuid4(), user_id=submitted, telegram_id=telegram_ids[1],
                    employee_key=str(submitted), full_name="Проверочный сотрудник",
                    position="Сотрудник", report_scope="central", region_name=None,
                    report_date=date(2026, 10, 5), content="Отчёт уже отправлен в срок",
                    submitted_at=at(5, 17, 50), is_late=False, source="workspace",
                    created_at=at(5, 17, 50), updated_at=at(5, 17, 50),
                ))
                await connection.execute(insert(hisobot_live_vacations).values(
                    telegram_id=telegram_ids[2], starts_date=date(2026, 10, 5),
                    through_date=date(2026, 10, 5), updated_at=at(5, 17, 50),
                ))
                for minute in (0, 10, 20, 25):
                    await materialize_hisobot_reminders(connection, at(5, 18, minute))
                    active = (await connection.execute(select(workspace_notifications).where(
                        workspace_notifications.c.kind == "hisobot",
                        workspace_notifications.c.dismissed_at.is_(None),
                    ))).mappings().all()
                    assert len(active) == 1 and active[0]["user_id"] == owner
                assert await materialize_hisobot_reminders(connection, at(5, 18, 29, 59)) == 0
                # Upgrade an old backlog even when reports/exemptions arrived while offline.
                for recipient in (submitted, exempt, not_required):
                    await legacy_reminder(connection, recipient, 5)
                assert await materialize_hisobot_reminders(connection, at(5, 18, 30)) > 0
                assert await materialize_hisobot_reminders(connection, at(5, 18, 30)) == 0
                active = (await connection.execute(select(workspace_notifications).where(
                    workspace_notifications.c.kind == "hisobot",
                    workspace_notifications.c.dismissed_at.is_(None),
                ))).mappings().all()
                assert len(active) == 1 and active[0]["user_id"] == owner
                first_notice_id = active[0]["id"]
                assert active[0]["event_key"] == "hisobot:2026-10-05:missed"
                assert "05.10.2026" in active[0]["body"] and "18:30" in active[0]["body"]
                assert not active[0]["is_reminder"] and not active[0]["requires_action"]
                assert active[0]["read_at"] is None and active[0]["resolved_at"] is None
                slots = (await connection.execute(select(workspace_notifications).where(
                    workspace_notifications.c.user_id == owner,
                    workspace_notifications.c.is_reminder.is_(True),
                ))).mappings().all()
                # Archived in storage, not deleted or falsely read/delivered.
                assert len(slots) == 5
                assert all(row["dismissed_at"] and row["resolved_at"] for row in slots)
                assert all(row["read_at"] is None and row["desktop_delivered_at"] is None
                           for row in slots)
                department_id = await connection.scalar(select(departments.c.id).limit(1))
                assert department_id is not None
                await unit_report(connection, department_id, submitted, telegram_ids[1], 6)
                await connection.execute(update(telegram_bot_grants).where(
                    telegram_bot_grants.c.user_id == exempt,
                    telegram_bot_grants.c.bot_key == "hisobot",
                ).values(report_required=False))
                await materialize_hisobot_reminders(connection, at(6, 18, 25))
                await materialize_hisobot_reminders(connection, at(6, 18, 30))
                old = (await connection.execute(select(workspace_notifications).where(
                    workspace_notifications.c.id == first_notice_id
                ))).mappings().one()
                assert old["dismissed_at"] and old["read_at"] is None
                region = sorted(HISOBOT_REGIONS)[0]
                await connection.execute(update(telegram_bot_grants).where(
                    telegram_bot_grants.c.user_id == exempt,
                    telegram_bot_grants.c.bot_key == "hisobot",
                ).values(report_required=True, report_scope="hudud", region_name=region))
                await unit_report(connection, department_id, exempt, telegram_ids[2], 7,
                                  region=region)
                await materialize_hisobot_reminders(connection, at(7, 18, 25))
                await materialize_hisobot_reminders(connection, at(7, 18, 30))
                active_owner = (await connection.execute(select(workspace_notifications).where(
                    workspace_notifications.c.user_id == owner,
                    workspace_notifications.c.kind == "hisobot",
                    workspace_notifications.c.dismissed_at.is_(None),
                ))).mappings().all()
                assert len(active_owner) == 1
                latest_id = active_owner[0]["id"]
                assert active_owner[0]["event_key"] == "hisobot:2026-10-07:missed"
                assert "07.10.2026" in active_owner[0]["body"]
                assert await connection.scalar(select(workspace_notifications.c.id).where(
                    workspace_notifications.c.user_id == exempt,
                    workspace_notifications.c.event_key == "hisobot:2026-10-07:missed",
                )) is None
                assert await materialize_hisobot_reminders(connection, at(10, 17, 40)) == 0
                await connection.execute(update(workspace_notifications).where(
                    workspace_notifications.c.id == latest_id
                ).values(read_at=at(8, 9).astimezone(UTC)))
                # Simulate pre-upgrade slots returning late; the newer acknowledged notice wins.
                for recipient in (owner, submitted):
                    await _upsert_notification(
                        connection, user_id=recipient, event_key="hisobot:2026-10-06:1800",
                        kind="hisobot", priority="attention", title="Старое напоминание",
                        body="До обновления", section="ai_hisobot", entity_id=None,
                        requires_action=True, occurred_at=at(6, 18), is_reminder=True,
                    )
                actor = await load_authenticated_user(connection, owner)
                assert actor is not None
                workspace = await load_workspace(connection, actor)
                visible = [item for item in workspace.notifications if item.kind == "hisobot"]
                assert len(visible) == 1 and visible[0].id == str(latest_id)
                assert visible[0].read_at is not None
                # Bootstrap cleanup is personal, not a write to another employee's queue.
                peer_slot = (await connection.execute(select(workspace_notifications).where(
                    workspace_notifications.c.user_id == submitted,
                    workspace_notifications.c.event_key == "hisobot:2026-10-06:1800",
                ))).mappings().one()
                assert peer_slot["dismissed_at"] is None
                assert await collapse_hisobot_notification_backlog(
                    connection, at(8, 9), user_id=submitted,
                ) == 1
                assert await collapse_hisobot_notification_backlog(
                    connection, at(8, 9), user_id=owner,
                ) == 0
            finally:
                await transaction.rollback()
    finally:
        await engine.dispose()


@pytest.mark.postgres
def test_hisobot_reminders_expire_and_do_not_flood_the_next_launch() -> None:
    url = os.environ.get("YUKSALISH_TEST_DATABASE_URL")
    if not url:
        pytest.skip("YUKSALISH_TEST_DATABASE_URL is not configured")
    asyncio.run(exercise_backlog(url))
