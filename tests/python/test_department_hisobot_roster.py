import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock
from uuid import uuid4

from yuksalish_api.hisobot_scope import effective_hisobot_scope
from yuksalish_api.hisobot_service import bridge_roster


def test_department_scope_overrides_stale_hisobot_grant() -> None:
    central_id, regional_id, child_id = uuid4(), uuid4(), uuid4()
    departments = {
        central_id: {
            "id": central_id,
            "name": "Финансы",
            "code": "finance",
            "scope": "central",
            "parent_id": None,
        },
        regional_id: {
            "id": regional_id,
            "name": "Jizzax viloyati hududiy bolinma",
            "code": "jizzax",
            "scope": "regional",
            "parent_id": None,
        },
        child_id: {
            "id": child_id,
            "name": "Группа мониторинга",
            "code": "monitoring",
            "scope": "regional",
            "parent_id": regional_id,
        },
    }
    assert effective_hisobot_scope(central_id, departments, "hudud", "Бухоро вилояти") == (
        "central",
        None,
    )
    assert effective_hisobot_scope(regional_id, departments, "central", None) == (
        "hudud",
        "Жиззах вилояти",
    )
    assert effective_hisobot_scope(child_id, departments, "central", None) == (
        "hudud",
        "Жиззах вилояти",
    )
    assert effective_hisobot_scope(None, departments, "hudud", "Бухоро вилояти") == (
        "hudud",
        "Бухоро вилояти",
    )


def test_hisobot_roster_keeps_department_lead_and_regional_scope() -> None:
    department_id, lead_id, colleague_id = uuid4(), uuid4(), uuid4()
    rows = [
        {
            "id": user_id,
            "full_name": name,
            "job_title": "Мутахассис",
            "telegram_id": telegram_id,
            "report_scope": "hudud",
            "region_name": "Жиззах вилояти",
            "report_required": True,
            "hisobot_manager": False,
            "hisobot_department_id": department_id,
            "department_id": department_id,
            "hisobot_department_name": "Жиззах вилояти",
            "hisobot_lead_user_id": lead_id,
        }
        for user_id, name, telegram_id in [
            (lead_id, "Главный сотрудник", "123456"),
            (colleague_id, "Сотрудник", "654321"),
        ]
    ]
    result = Mock()
    result.mappings.return_value.all.return_value = rows
    connection = SimpleNamespace(execute=AsyncMock(return_value=result))
    roster = asyncio.run(bridge_roster(connection))

    assert len(roster) == 2
    assert roster[0].department_lead is True
    assert roster[0].department_id == department_id
    assert roster[1].department_lead is False
    assert roster[1].department_id is not None
    assert all(member.report_scope == "hudud" for member in roster)


def test_hisobot_roster_uses_department_after_contour_change() -> None:
    department_id, user_id = uuid4(), uuid4()
    roster_result = Mock()
    roster_result.mappings.return_value.all.return_value = [{
        "id": user_id,
        "department_id": department_id,
        "full_name": "Сотрудник",
        "job_title": "Мутахассис",
        "telegram_id": "123456",
        "report_scope": "central",
        "region_name": None,
        "report_required": True,
        "hisobot_manager": False,
        "hisobot_department_id": department_id,
        "hisobot_department_name": "Jizzax viloyati",
        "hisobot_lead_user_id": user_id,
    }]
    department_result = Mock()
    department_result.mappings.return_value.all.return_value = [{
        "id": department_id,
        "name": "Jizzax viloyati",
        "code": "jizzax",
        "scope": "regional",
        "parent_id": None,
    }]
    connection = SimpleNamespace(execute=AsyncMock(side_effect=[
        roster_result, department_result,
    ]))
    roster = asyncio.run(bridge_roster(connection))
    assert roster[0].report_scope == "hudud"
    assert roster[0].region_name == "Жиззах вилояти"
