# ruff: noqa: RUF001
"""One-time transfer of future ZoomBot bookings into the Workspace Zoom module.

The bot identifies people by Telegram id, Workspace by account, so the two are
joined through a mapping file the administrator fills in. A booking without a
mapped employee is still imported, read-only, under the name the bot stored, so
its slot is not silently given away.

Nothing is created in Zoom: these conferences already exist there. Reminders are
left off, because the bot keeps reminding in Telegram until it is retired.

Usage:

    python scripts/import_zoombot_meetings.py --template owners.csv
    python scripts/import_zoombot_meetings.py --mapping owners.csv --dry-run
    python scripts/import_zoombot_meetings.py --mapping owners.csv --apply
"""

from __future__ import annotations

import argparse
import asyncio
import csv
import os
import sqlite3
import sys
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from uuid import UUID, uuid4
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import create_async_engine

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "apps" / "api" / "src"))

from yuksalish_api.settings import get_settings
from yuksalish_api.tables import users, zoom_meetings

DEFAULT_SOURCE = Path(os.getenv("LOCALAPPDATA", Path.home())) / "ZoomBot" / "zoombot.db"


@dataclass(frozen=True, slots=True)
class BotMeeting:
    zoom_meeting_id: str
    topic: str
    description: str | None
    starts_at: datetime
    ends_at: datetime
    duration_minutes: int
    join_url: str | None
    passcode: str | None
    owner_telegram_id: int
    owner_full_name: str


def _as_utc(value: str) -> datetime:
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=UTC)


def read_bot_meetings(source: Path, now: datetime) -> list[BotMeeting]:
    """Future, still scheduled bookings only; history stays in the bot."""
    if not source.exists():
        raise SystemExit(f"Файл базы бота не найден: {source}")
    connection = sqlite3.connect(f"file:{source}?mode=ro", uri=True)
    connection.row_factory = sqlite3.Row
    try:
        rows = connection.execute(
            """
            SELECT m.zoom_meeting_id, m.topic, m.description, m.starts_at, m.ends_at,
                   m.duration_minutes, m.join_url, m.password, u.telegram_id, u.full_name
            FROM meetings AS m
            JOIN users AS u ON u.id = m.owner_id
            WHERE m.status = 'scheduled' AND m.zoom_meeting_id IS NOT NULL
            ORDER BY m.starts_at
            """
        ).fetchall()
    finally:
        connection.close()
    meetings: list[BotMeeting] = []
    for row in rows:
        starts_at = _as_utc(str(row["starts_at"]))
        if starts_at <= now:
            continue
        ends_at = _as_utc(str(row["ends_at"]))
        meetings.append(
            BotMeeting(
                zoom_meeting_id=str(row["zoom_meeting_id"]),
                topic=str(row["topic"])[:200],
                description=row["description"],
                starts_at=starts_at,
                ends_at=ends_at,
                duration_minutes=int(row["duration_minutes"]),
                join_url=row["join_url"],
                passcode=row["password"],
                owner_telegram_id=int(row["telegram_id"]),
                owner_full_name=str(row["full_name"]),
            )
        )
    return meetings


def write_template(meetings: list[BotMeeting], target: Path) -> None:
    seen: dict[int, str] = {}
    for meeting in meetings:
        seen.setdefault(meeting.owner_telegram_id, meeting.owner_full_name)
    with target.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.writer(handle, delimiter=";")
        writer.writerow(["telegram_id", "full_name_in_bot", "workspace_username"])
        for telegram_id, full_name in sorted(seen.items()):
            writer.writerow([telegram_id, full_name, ""])
    print(f"Заготовка соответствия записана: {target} ({len(seen)} организаторов)")


def read_mapping(path: Path) -> dict[int, str]:
    if not path.exists():
        raise SystemExit(f"Файл соответствия не найден: {path}")
    mapping: dict[int, str] = {}
    with path.open(encoding="utf-8-sig", newline="") as handle:
        for line, row in enumerate(csv.DictReader(handle, delimiter=";"), start=2):
            raw_id = (row.get("telegram_id") or "").strip()
            username = (row.get("workspace_username") or "").strip()
            if not raw_id or not username:
                continue
            try:
                mapping[int(raw_id)] = username
            except ValueError as error:
                raise SystemExit(f"Некорректный telegram_id в строке {line}: {raw_id}") from error
    return mapping


async def transfer(source: Path, mapping_path: Path, apply: bool) -> int:
    now = datetime.now(UTC)
    meetings = read_bot_meetings(source, now)
    mapping = read_mapping(mapping_path)
    settings = get_settings()
    engine = create_async_engine(settings.database_url)
    imported = unmapped = skipped = conflicted = 0
    try:
        async with engine.begin() as connection:
            accounts = {
                str(row["username"]): row["id"]
                for row in (
                    await connection.execute(select(users.c.id, users.c.username))
                ).mappings()
            }
            existing = {
                str(value)
                for value in (
                    await connection.execute(
                        select(zoom_meetings.c.zoom_meeting_id).where(
                            zoom_meetings.c.zoom_meeting_id.is_not(None)
                        )
                    )
                ).scalars()
            }
        for meeting in meetings:
            if meeting.zoom_meeting_id in existing:
                skipped += 1
                continue
            username = mapping.get(meeting.owner_telegram_id)
            owner_id: UUID | None = accounts.get(username or "")
            if owner_id is None:
                unmapped += 1
            action = "перенести" if apply else "перенесли бы"
            owner_label = (
                username if owner_id else f"{meeting.owner_full_name} (без учётной записи)"
            )
            local = meeting.starts_at.astimezone(ZoneInfo(settings.zoom_timezone))
            print(f"{action}: {local:%d.%m %H:%M} · {meeting.topic} · {owner_label}")
            if not apply:
                imported += 1
                continue
            try:
                async with engine.begin() as connection:
                    await connection.execute(
                        zoom_meetings.insert().values(
                            id=uuid4(),
                            organizer_user_id=owner_id,
                            organizer_display_name=None if owner_id else meeting.owner_full_name,
                            topic=meeting.topic,
                            description=meeting.description,
                            starts_at=meeting.starts_at,
                            ends_at=meeting.ends_at,
                            duration_minutes=meeting.duration_minutes,
                            timezone=settings.zoom_timezone,
                            zoom_meeting_id=meeting.zoom_meeting_id,
                            join_url=meeting.join_url,
                            passcode=meeting.passcode,
                            status="scheduled",
                            source="zoombot",
                            # The bot still reminds in Telegram until it is retired.
                            reminders_enabled=False,
                            created_at=now,
                            updated_at=now,
                        )
                    )
                imported += 1
            except IntegrityError as error:
                conflicted += 1
                print(f"  пропущено, слот уже занят в Workspace: {type(error).__name__}")
    finally:
        await engine.dispose()
    verb = "Перенесено" if apply else "Готово к переносу"
    print(
        f"\n{verb}: {imported}. Уже были в Workspace: {skipped}. "
        f"Без сопоставленного сотрудника: {unmapped}. Конфликт по времени: {conflicted}."
    )
    if not apply:
        print("Это предварительный просмотр. Повторите с --apply, чтобы записать данные.")
    return conflicted


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE, help="SQLite-база ZoomBot")
    parser.add_argument("--mapping", type=Path, help="CSV соответствия telegram_id и логина")
    parser.add_argument("--template", type=Path, help="Записать заготовку соответствия и выйти")
    parser.add_argument("--apply", action="store_true", help="Записать данные, а не показать план")
    parser.add_argument("--dry-run", action="store_true", help="Явный предварительный просмотр")
    arguments = parser.parse_args()
    if arguments.template:
        write_template(read_bot_meetings(arguments.source, datetime.now(UTC)), arguments.template)
        return 0
    if not arguments.mapping:
        parser.error("Укажите --mapping или --template")
    if arguments.apply and arguments.dry_run:
        parser.error("--apply и --dry-run взаимно исключают друг друга")
    conflicts = asyncio.run(transfer(arguments.source, arguments.mapping, arguments.apply))
    return 0 if conflicts == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
