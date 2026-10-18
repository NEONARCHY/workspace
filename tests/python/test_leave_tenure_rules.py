"""Organization-only tenure thresholds for leave; no database needed."""

from datetime import date

import pytest
from pydantic import ValidationError

from yuksalish_api.leave_service import _eligible_days
from yuksalish_api.workspace_schemas import LeaveTenureRule, LeaveTenureRulesWrite


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
