"""Organization-only tenure thresholds for leave; no database needed."""

from datetime import date

import pytest
from pydantic import ValidationError

from yuksalish_api.leave_service import _eligible_days
from yuksalish_api.workspace_schemas import (
    LeaveHrDecisionRequest,
    LeaveTenureRule,
    LeaveTenureRulesWrite,
)


def test_extra_days_start_only_after_each_organization_anniversary() -> None:
    rules = [LeaveTenureRule(after_years=years, extra_days=days)
             for years, days in ((5, 2), (10, 4), (15, 6))]
    joined = date(2020, 10, 18)
    assert _eligible_days(None, date(2026, 10, 19), rules) == 0
    assert _eligible_days(joined, date(2025, 10, 18), rules) == 0
    assert _eligible_days(joined, date(2025, 10, 19), rules) == 2
    assert _eligible_days(joined, date(2030, 10, 19), rules) == 4
    assert _eligible_days(joined, date(2035, 10, 19), rules) == 6


def test_hr_cannot_save_unsorted_or_nonincreasing_thresholds() -> None:
    with pytest.raises(ValidationError):
        LeaveTenureRulesWrite(rules=[
            LeaveTenureRule(after_years=10, extra_days=4),
            LeaveTenureRule(after_years=5, extra_days=2),
        ])


def test_february_hire_uses_the_same_anniversary_in_leap_and_nonleap_years() -> None:
    rules = [LeaveTenureRule(after_years=4, extra_days=2)]
    assert _eligible_days(date(2020, 2, 29), date(2024, 2, 29), rules) == 0
    assert _eligible_days(date(2020, 2, 29), date(2024, 3, 1), rules) == 2
    rules = [LeaveTenureRule(after_years=5, extra_days=2)]
    assert _eligible_days(date(2020, 2, 29), date(2025, 2, 28), rules) == 0
    assert _eligible_days(date(2020, 2, 29), date(2025, 3, 1), rules) == 2


@pytest.mark.parametrize(("calendar_days", "paid_days"), [(21, 22), (24, 18)])
def test_hr_cannot_send_inconsistent_day_counts(calendar_days: int, paid_days: int) -> None:
    with pytest.raises(ValidationError):
        LeaveHrDecisionRequest(
            action="approve", starts_on=date(2030, 1, 1), ends_on=date(2030, 1, 21),
            calendar_days=calendar_days, paid_days=paid_days,
        )
