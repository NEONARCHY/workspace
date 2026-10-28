"""Shared examples guarantee preview/API parity without guessing administrative types."""

import json
from datetime import date
from io import BytesIO
from pathlib import Path

import pytest
from pypdf import PdfReader

from yuksalish_api.trip_brief_generator import generate_trip_brief
from yuksalish_api.trip_document_text import (
    trip_body_text,
    trip_destination_phrase,
    trip_destination_text,
)
from yuksalish_api.trip_order_pdf import brief_pdf, order_pdf

_CASES = json.loads(
    (Path(__file__).parents[1] / "fixtures/trip-destination-phrases.json").read_text("utf-8"),
)


@pytest.mark.parametrize(("source", "name", "phrase"), _CASES)
def test_destination_forms_and_generated_text(source: str, name: str, phrase: str) -> None:
    assert trip_destination_text(source) == name
    assert trip_destination_phrase(source) == phrase
    assert trip_destination_phrase(phrase) == phrase
    text = generate_trip_brief(
        destination=source, start=date(2026, 10, 28), end=date(2026, 10, 29),
        purpose="Loyiha doirasida joylarda monitoring o'tkazish",
        expense_source="Loyiha mablag'lari",
    )
    assert f"{phrase} xizmat safari rejalashtirilgan" in text


@pytest.mark.parametrize(("source", "expected"), [
    ("Fergana, Uzbekistan hududiga", "Farg'ona shahriga"),
    ("Ferghana, Uzbekistanga", "Farg'ona shahriga"),
    ("Ферганская область hududiga", "Farg'ona viloyatiga"),
    ("Xiva shahri hududiga", "Xiva shahriga"),
    ("Xiva hududiga", "Xiva shahriga"),
    ("Қашқадарё вилояти, Деҳқонобод тумани hududiga",
     "Qashqadaryo viloyati, Dehqonobod tumaniga"),
    ("Xiva shahriga", "Xiva shahriga"),
    ("Farg'ona viloyatiga", "Farg'ona viloyatiga"),
])
def test_legacy_brief_direction_is_corrected_without_rewriting_prose(
    source: str, expected: str,
) -> None:
    text = f"Tekshiruv: {source} xizmat safari.\n\nAsos va maqsad o'zgarmaydi."
    result = f"Tekshiruv: {expected} xizmat safari.\n\nAsos va maqsad o'zgarmaydi."
    assert trip_body_text(text) == result
    assert trip_body_text(result) == result


@pytest.mark.parametrize(("destination", "phrase"), [
    ("Ферганская область", "Farg'ona viloyatiga"),
    ("Xiva", "Xiva shahriga"),
    ("Ferghana, Uzbekistan", "Farg'ona shahriga"),
])
def test_brief_and_order_pdf_use_the_same_direction(destination: str, phrase: str) -> None:
    common = dict(
        destination=destination, start=date(2026, 10, 28), end=date(2026, 10, 29),
        requester="Testov Xodim Anvar угли", chair="Testov Rais Vali ўғли",
        purpose="Loyiha doirasida joylarda monitoring o'tkazish",
        expense_source="Loyiha mablag'lari",
        signature=None,
    )
    for content in (
        brief_pdf(**common, employees=["Testova Hamroh"], brief_text="",
                  signed_on=date(2026, 10, 28), attachment_name=None),
        order_pdf(**common, employees=[("Testova Hamroh", "mutaxassis")],
                  order_number=None, issued=date(2026, 10, 28)),
    ):
        text = " ".join(page.extract_text() for page in PdfReader(BytesIO(content)).pages)
        assert phrase in text
        assert "gaga" not in text and f"{phrase} hududiga" not in text
        assert "Anvar o'g'li" in text
