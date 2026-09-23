from datetime import UTC, date, datetime, time
from uuid import uuid4

import pytest

from yuksalish_api.workday_schemas import WorkdayScheduleWrite, WorkdaySessionResponse
from yuksalish_api.workday_service import ZONE, _status, automatic_close_due, schedule_bounds


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
