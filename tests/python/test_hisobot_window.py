"""The two Hisobot publication times must not close the submission window early."""

from datetime import datetime
from zoneinfo import ZoneInfo

from yuksalish_api.hisobot_service import report_window_status

TASHKENT = ZoneInfo("Asia/Tashkent")


def test_hisobot_report_window_boundaries() -> None:
    def status(day: int, hour: int, minute: int, second: int = 0) -> str:
        return report_window_status(datetime(2026, 10, day, hour, minute, second,
                                             tzinfo=TASHKENT))

    assert status(15, 11, 59, 59) == "closed"
    assert status(15, 12, 0) == "on_time"
    assert status(15, 18, 29, 59) == "on_time"
    assert status(15, 18, 30) == "late"
    assert status(15, 20, 59, 59) == "late"
    assert status(15, 21, 0) == "closed"
    assert status(17, 18, 0) == "closed"  # Saturday
