import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock
from uuid import uuid4

from yuksalish_api.hisobot_service import bridge_roster


def test_hisobot_roster_keeps_department_lead_and_regional_scope() -> None:
    department_id, lead_id, colleague_id = uuid4(), uuid4(), uuid4()
    rows = [{
        "id": user_id,
        "full_name": name,
        "job_title": "Мутахассис",
        "telegram_id": telegram_id,
        "report_scope": "hudud",
        "region_name": "Жиззах вилояти",
        "report_required": True,
        "hisobot_manager": False,
        "hisobot_department_id": department_id,
        "hisobot_department_name": "Жиззах вилояти",
        "hisobot_lead_user_id": lead_id,
    } for user_id, name, telegram_id in [
        (lead_id, "Главный сотрудник", "123456"),
        (colleague_id, "Сотрудник", "654321"),
    ]]
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
