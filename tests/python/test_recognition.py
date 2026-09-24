from datetime import date

import pytest
from pydantic import ValidationError

from yuksalish_api.main import create_app
from yuksalish_api.recognition_schemas import EmployeeRewardCreate
from yuksalish_api.recognition_service import _achievements, _longest_month_streak


def test_recognition_routes_are_present_in_openapi() -> None:
    paths = create_app().openapi()["paths"]

    assert "/api/v1/recognition/profiles/{user_id}" in paths
    assert "/api/v1/recognition/profiles/{user_id}/rewards" in paths
    assert "/api/v1/recognition/settings" in paths


def test_achievement_catalog_backfills_levels_and_tenure() -> None:
    achievements = _achievements(
        {
            "tasks": 52,
            "projects": 1,
            "trips": 0,
            "meetings": 15,
            "letters": 52,
            "feed_posts": 5,
            "payments_created": 31,
            "payments_completed": 10,
            "messages": 640,
            "reactions": 55,
            "efficiency_months": 3,
            "efficiency_streak": 2,
        },
        date(2025, 3, 15),
        date(2026, 9, 24),
    )
    by_code = {item.code: item for item in achievements}

    assert by_code["tasks_50"].unlocked is True
    assert by_code["tasks_100"].unlocked is False
    assert by_code["messages_500"].unlocked is True
    assert by_code["meetings_15"].tier == "platinum"
    assert by_code["letters_50"].unlocked is True
    assert by_code["feed_posts_5"].unlocked is True
    assert by_code["payments_created_30"].tier == "amethyst"
    assert by_code["payments_completed_10"].unlocked is True
    assert by_code["payments_completed_15"].unlocked is False
    assert by_code["projects_100"].tier == "cosmic"
    assert by_code["trips_50"].tier == "prism"
    assert by_code["reactions_50"].unlocked is True
    assert by_code["efficiency_streak_2"].unlocked is True
    assert by_code["tenure_12"].unlocked is True
    assert by_code["tenure_24"].unlocked is False
    assert by_code["tenure_12"].earned_at == date(2026, 3, 15)


def test_efficiency_streak_uses_consecutive_calendar_months() -> None:
    assert _longest_month_streak(["2026-01", "2026-02", "2026-04", "2026-05", "2026-06"]) == 3
    assert _longest_month_streak(["2025-12", "2026-01", "2026-01"]) == 2
    assert _longest_month_streak([]) == 0


def test_reward_copy_is_free_form_but_meaningful() -> None:
    reward = EmployeeRewardCreate(
        icon_key="mentorship",
        title="Сильный наставник",
        description="Помог команде освоить новый процесс без потери темпа.",
    )
    assert reward.title == "Сильный наставник"

    with pytest.raises(ValidationError):
        EmployeeRewardCreate(
            icon_key="mentorship",
            title="Ок",
            description="Коротко",
        )
