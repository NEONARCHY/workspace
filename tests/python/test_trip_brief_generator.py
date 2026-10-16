"""Structured trip briefs use verified form facts, not invented details."""

import asyncio
from datetime import date
from io import BytesIO
from typing import Literal, TypedDict
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest
from pypdf import PdfReader

from yuksalish_api import repository
from yuksalish_api.auth import AuthenticatedUser
from yuksalish_api.trip_brief_generator import generate_trip_brief
from yuksalish_api.trip_order_pdf import brief_pdf
from yuksalish_api.workspace_schemas import CreateTripRequest, UpdateTripRequest


class TripBriefFacts(TypedDict):
    destination: str
    start: date
    end: date
    purpose: str
    expense_source: str


def _facts() -> TripBriefFacts:
    return {
        "destination": "Қашқадарё вилояти, Деҳқонобод тумани",
        "start": date(2026, 10, 22),
        "end": date(2026, 10, 22),
        "purpose": (
            "ЕИ ва KAS лойиҳаси доирасида юридик клиника иштирокчилари "
            "Қалтаминор маҳалласида сайёр қабул ўтказади"
        ),
        "expense_source": "лойиҳа маблағлари",
    }


def test_generates_one_day_uzbek_latin_brief_from_fields() -> None:
    facts = _facts()
    text = generate_trip_brief(**facts)
    assert "2026-yil 22-oktabr kuni" in text
    assert "Qashqadaryo viloyati, Dehqonobod tumani" in text
    assert "yuridik klinika ishtirokchilari" in text
    assert "Safar xarajatlarini qoplash manbai: loyiha mablagʻlari." in text  # noqa: RUF001
    assert "23-oktabr" not in text
    content = brief_pdf(
        requester="Testova Zebo", chair="Testov Rais", purpose=facts["purpose"],
        destination=facts["destination"], start=date(2026, 10, 22),
        end=date(2026, 10, 22), employees=["Testova Zebo"],
        expense_source=facts["expense_source"], brief_text=text,
        attachment_name=None, signature=None, signed_on=date(2026, 10, 16),
        include_fact_lines=False,
    )
    pdf_text = "\n".join(page.extract_text() for page in PdfReader(BytesIO(content)).pages)
    assert pdf_text.count("Safar xarajatlarini qoplash manbai") == 1
    assert "Safar maqsadi:" not in pdf_text


@pytest.mark.parametrize("field,value", [
    ("purpose", "test"),
    ("purpose", "aaaaaa loyiha doirasida qabul o'tkaziladi"),
    ("purpose", "https://example.com dagi tadbirni o'tkazish rejalashtirilgan"),
    ("expense_source", "нет"),
    ("destination", "asdf"),
])
def test_rejects_placeholder_or_nonsense_facts(
    field: Literal["purpose", "expense_source", "destination"], value: str,
) -> None:
    facts = _facts()
    facts[field] = value
    with pytest.raises(ValueError, match="содержательное значение"):
        generate_trip_brief(**facts)


def test_cross_month_range_has_both_dates() -> None:
    facts = _facts()
    facts["start"] = date(2026, 10, 31)
    facts["end"] = date(2026, 11, 2)
    text = generate_trip_brief(**facts)
    assert "31-oktabrdan 2026-yil 2-noyabrgacha" in text


def test_server_ignores_forged_brief_text_and_saves_generated_version(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user_id = uuid4()
    user = AuthenticatedUser(user_id, "requester", "Requester", None, None, "employee")
    connection = AsyncMock()
    monkeypatch.setattr(repository, "_validate_trip_employees", AsyncMock(return_value=[user_id]))
    monkeypatch.setattr(repository, "_sync_context_chat", AsyncMock())
    monkeypatch.setattr(repository, "_trip_response", AsyncMock(return_value="saved"))
    facts = _facts()
    payload = CreateTripRequest(
        purpose=facts["purpose"], destination=facts["destination"],
        start_date=facts["start"], end_date=facts["end"],
        expense_source=facts["expense_source"], employee_ids=[str(user_id)],
        brief_format="generated", brief_text="Forged client text",
    )
    assert asyncio.run(repository.create_trip_request(connection, user, payload)) == "saved"
    values = connection.execute.await_args_list[0].args[0].compile().params
    assert values["brief_format"] == "generated"
    assert values["brief_text"] == generate_trip_brief(**facts)
    assert "Forged client text" not in values["brief_text"]


def test_edit_regenerates_brief_and_invalidates_prepared_pdf(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user_id, request_id = uuid4(), uuid4()
    user = AuthenticatedUser(user_id, "requester", "Requester", None, None, "employee")
    row = {
        "id": request_id, "requester_user_id": user_id, "deleted_at": None,
        "workflow_version": 3, "stage": "launch", "status": "draft",
        "brief_format": "generated",
    }
    result = MagicMock()
    result.mappings.return_value.first.return_value = row
    connection = AsyncMock()
    connection.execute.return_value = result
    monkeypatch.setattr(repository, "_validate_trip_employees", AsyncMock(return_value=[user_id]))
    monkeypatch.setattr(repository, "_sync_context_chat", AsyncMock())
    monkeypatch.setattr(repository, "_trip_response", AsyncMock(return_value="updated"))
    facts = _facts()
    facts["destination"] = "Термиз шаҳри"
    payload = UpdateTripRequest(
        purpose=facts["purpose"], destination=facts["destination"],
        start_date=facts["start"], end_date=facts["end"],
        expense_source=facts["expense_source"], employee_ids=[str(user_id)],
        brief_format="generated", brief_text="Stale client text",
    )
    assert asyncio.run(repository.update_trip_request(
        connection, user, request_id, payload,
    )) == "updated"
    values = connection.execute.await_args_list[1].args[0].compile().params
    assert values["brief_text"] == generate_trip_brief(**facts)
    assert values["signed_brief_key"] is None
    assert values["signed_brief_sha256"] is None
