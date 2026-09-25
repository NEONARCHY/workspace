"""Absence exemptions follow the approved Workspace absence interval."""

import asyncio
from datetime import UTC, date, datetime
from types import SimpleNamespace

from yuksalish_api.hisobot_service import report_exemptions


class _Rows:
    def __init__(self, values: list[object]) -> None:
        self.values = values

    def all(self) -> list[object]:
        return self.values

    def mappings(self) -> "_Rows":
        return self


class _Connection:
    def __init__(self, rows: list[object]) -> None:
        self.rows = rows
        self.calls = 0

    async def execute(self, _query: object) -> _Rows:
        self.calls += 1
        return _Rows(self.rows if self.calls == 1 else [])


def test_evening_personal_time_excuses_only_covered_days() -> None:
    rows = [
        SimpleNamespace(telegram_id="1", kind="personal_time",
                        starts_at=datetime(2026, 9, 25, 12, 0, tzinfo=UTC),
                        ends_at=datetime(2026, 9, 25, 14, 0, tzinfo=UTC)),
        SimpleNamespace(telegram_id="2", kind="personal_time",
                        starts_at=datetime(2026, 9, 25, 3, 0, tzinfo=UTC),
                        ends_at=datetime(2026, 9, 25, 7, 0, tzinfo=UTC)),
        SimpleNamespace(telegram_id="3", kind="personal_time",
                        starts_at=datetime(2026, 9, 25, 13, 31, tzinfo=UTC),
                        ends_at=datetime(2026, 9, 25, 15, 0, tzinfo=UTC)),
    ]
    exemptions = asyncio.run(report_exemptions(
        _Connection(rows), date(2026, 9, 25), date(2026, 9, 25)
    ))
    assert [(item.telegram_id, item.kind) for item in exemptions] == [("1", "personal_time")]


def test_vacation_and_sick_leave_keep_their_cause() -> None:
    rows = [
        SimpleNamespace(telegram_id="1", kind="vacation",
                        starts_at=datetime(2026, 9, 25, 4, 0, tzinfo=UTC),
                        ends_at=datetime(2026, 9, 27, 12, 0, tzinfo=UTC)),
        SimpleNamespace(telegram_id="2", kind="sick_leave",
                        starts_at=datetime(2026, 9, 25, 4, 0, tzinfo=UTC),
                        ends_at=datetime(2026, 9, 25, 12, 0, tzinfo=UTC)),
    ]
    exemptions = asyncio.run(report_exemptions(
        _Connection(rows), date(2026, 9, 25), date(2026, 9, 27)
    ))
    assert [(item.telegram_id, item.kind, item.starts_date, item.through_date)
            for item in exemptions] == [
                ("1", "vacation", date(2026, 9, 25), date(2026, 9, 27)),
                ("2", "sick_leave", date(2026, 9, 25), date(2026, 9, 25)),
            ]
