from datetime import UTC, date, datetime, time
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest

from yuksalish_api.workday_schemas import WorkdayScheduleWrite, WorkdaySessionResponse
from yuksalish_api.workday_service import (
    ZONE,
    _status,
    automatic_close_due,
    close_overdue_sessions,
    schedule_bounds,
)


def test_default_schedule_and_next_day_cutoff() -> None:
    work_date = date(2026, 9, 23)
    start, end = schedule_bounds(work_date, time(9), time(18))
    assert start == datetime(2026, 9, 23, 9, tzinfo=ZONE)
    assert end == datetime(2026, 9, 23, 18, tzinfo=ZONE)
    assert automatic_close_due(work_date) == datetime(2026, 9, 24, 6, tzinfo=ZONE)


def test_weekend_and_approved_absence_are_not_mislabeled() -> None:
    assert _status(date(2026, 9, 26), None, None) == "weekend_off"
    assert _status(date(2026, 9, 23), None, "sick_leave") == "approved_absence"
    assert _status(date(2026, 9, 23), None, None) == "not_started"


def test_weekend_checkin_counts_as_working_even_with_absence() -> None:
    user_id = uuid4()
    session = WorkdaySessionResponse(
        id=uuid4(), user_id=user_id, work_date=date(2026, 9, 26),
        started_at=datetime(2026, 9, 26, 10, tzinfo=UTC), ended_at=None,
        scheduled_start_at=datetime(2026, 9, 26, 4, tzinfo=UTC),
        scheduled_end_at=datetime(2026, 9, 26, 13, tzinfo=UTC),
        closed_at=None, close_source=None, is_weekend=True,
    )
    assert _status(session.work_date, session, None) == "working"
    assert _status(session.work_date, session, "business_event") == "working"


def test_schedule_rejects_inverted_and_overnight_times() -> None:
    WorkdayScheduleWrite(starts_at=time(9), ends_at=time(18))
    with pytest.raises(ValueError):
        WorkdayScheduleWrite(starts_at=time(19), ends_at=time(10))
    with pytest.raises(ValueError):
        WorkdayScheduleWrite(starts_at=time(9), ends_at=time(9))


@pytest.mark.anyio
async def test_personal_cleanup_query_is_scoped_but_scheduler_stays_global() -> None:
    connection = AsyncMock()
    result = MagicMock()
    result.mappings.return_value.all.return_value = []
    connection.execute.return_value = result
    user_id = uuid4()
    now = datetime(2026, 9, 24, 5, tzinfo=UTC)
    assert await close_overdue_sessions(connection, now=now, user_id=user_id) == 0
    personal = connection.execute.call_args.args[0].compile()
    assert user_id in personal.params.values()
    assert "workday_sessions.user_id =" in str(personal)
    assert await close_overdue_sessions(connection, now=now) == 0
    scheduled = connection.execute.call_args.args[0].compile()
    assert "workday_sessions.user_id =" not in str(scheduled)
