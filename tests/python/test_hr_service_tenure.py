from datetime import date
from decimal import Decimal

from yuksalish_api.hr_service import allowance, service_parts


def test_service_starts_from_confirmed_calendar_snapshot() -> None:
    assert service_parts(date(2026, 8, 31), 5, 2, 3, date(2026, 8, 31)) == (5, 2, 3)
    assert service_parts(date(2026, 8, 31), 5, 2, 3, date(2027, 8, 31)) == (6, 2, 3)


def test_service_handles_leap_day_and_never_rewinds_before_anchor() -> None:
    assert service_parts(date(2024, 2, 29), 1, 0, 0, date(2025, 2, 28)) == (2, 0, 0)
    assert service_parts(date(2026, 8, 31), 3, 0, 0, date(2020, 1, 1)) == (3, 0, 0)


def test_service_normalizes_days_into_calendar_months() -> None:
    assert service_parts(date(2026, 8, 31), 10, 6, 28, date(2026, 9, 21)) == (10, 7, 18)
    assert service_parts(date(2026, 8, 31), 0, 11, 28, date(2026, 9, 21)) == (1, 0, 18)


def test_allowance_thresholds_are_exact() -> None:
    assert allowance(0, 11) == Decimal("0")
    assert allowance(1, 0) == Decimal("10")
    assert allowance(3, 0) == Decimal("20")
    assert allowance(5, 0) == Decimal("30")
    assert allowance(10, 0) == Decimal("40")
    assert allowance(15, 0) == Decimal("50")
    assert allowance(20, 0) == Decimal("60")
