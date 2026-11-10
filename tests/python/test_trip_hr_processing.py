from datetime import date
from io import BytesIO
from uuid import uuid4

import pytest
from PIL import Image, ImageDraw
from pydantic import ValidationError
from pypdf import PdfReader

from yuksalish_api.auth import AuthenticatedUser
from yuksalish_api.repository import _trip_allowed_actions
from yuksalish_api.trip_cyrillic import uzbek_cyrillic
from yuksalish_api.trip_hr_pdf import TripDocumentSnapshot, hr_brief_pdf, hr_order_pdf
from yuksalish_api.workspace_schemas import TripActionRequest


@pytest.mark.parametrize("source,expected", [
    ("O\u02bbzbekiston", "Ўзбекистон"), ("G'ulom", "Ғулом"),
    ("Bosh mutaxassis", "Бош мутахассис"), ("Yuksalish", "Юксалиш"),
    ("ma'lumot va e'lon", "маълумот ва эълон"),
    ("Евгений ўз мақсадини ёзади", "Евгений ўз мақсадини ёзади"),
])
def test_cyrillic_documents_preserve_cyrillic_employee_prose(source, expected):
    assert uzbek_cyrillic(source) == expected


def test_new_trip_actions_require_the_actual_chair_and_pinned_hr():
    chair, hr, outsider = uuid4(), uuid4(), uuid4()
    row = {"workflow_version": 1, "hr_processing_required": True,
           "stage": "manager_approval", "status": "running", "requester_user_id": outsider,
           "hr_processor_user_id": hr, "resolved_brief_key": None}

    def actor(user_id, role="employee"):
        return AuthenticatedUser(user_id, "qa", "QA", None, None, role)

    assert "approve" in _trip_allowed_actions(row, actor(chair), chair)
    assert "approve" not in _trip_allowed_actions(row, actor(outsider, "superadmin"), chair)
    row["stage"] = "hr"
    assert _trip_allowed_actions(row, actor(hr), chair) == []
    assert _trip_allowed_actions(row, actor(chair), chair) == ["approve"]
    assert _trip_allowed_actions(row, actor(outsider), chair) == ["withdraw"]
    row["resolved_brief_key"] = "resolution.pdf"
    assert _trip_allowed_actions(row, actor(hr), chair) == ["complete", "return", "reject"]
    assert _trip_allowed_actions(row, actor(chair), chair) == []
    assert _trip_allowed_actions(row, actor(outsider), chair) == ["withdraw"]
    row["status"] = "approved"
    assert "complete" not in _trip_allowed_actions(row, actor(hr), chair)


@pytest.mark.parametrize("number,series", [("", "a/f"), ("29", ""), ("  ", "a/f")])
def test_complete_requires_real_number_and_series(number, series):
    with pytest.raises(ValidationError):
        TripActionRequest(action="complete", order_number=number, order_series=series)


def test_other_actions_cannot_change_hr_order_fields():
    with pytest.raises(ValidationError):
        TripActionRequest(action="approve", order_number="29", order_series="a/f")


def test_cyrillic_brief_and_order_keep_the_employee_and_hr_purposes_separate():
    image = Image.new("RGBA", (240, 70), (0, 0, 0, 0))
    ImageDraw.Draw(image).line([(5, 60), (70, 5), (160, 60), (230, 15)], fill="blue", width=3)
    data = BytesIO()
    image.save(data, "PNG")
    facts = TripDocumentSnapshot(
        requester="Тестовый Инициатор", requester_title="Bosh mutaxassis", chair="Тестовый Раис",
        brief_text="Сотрудник сам описал свою цель поездки. Содержание сохраняется.",
        purpose="Цель сотрудника", destination="Samarqand, O'zbekiston",
        start=date(2030, 5, 1), end=date(2030, 5, 2),
        employees=[("Тестовый Инициатор", "Bosh mutaxassis")], expense_source="loyiha mablag'lari",
    )
    resolution = hr_brief_pdf(facts, data.getvalue())
    order = hr_order_pdf(facts, number="29", series="\u0430/ф", purpose="Уточнение кадровика",
                         issued=date(2030, 4, 28), signature=data.getvalue())
    brief_page = PdfReader(BytesIO(resolution)).pages[0]
    brief_text = brief_page.extract_text()
    assert facts.brief_text in brief_text
    assert "Буйруқ учун" in brief_text and "Бош мутахассис" in brief_text
    assert "Уточнение кадровика" not in brief_text and "Резолюция санаси" not in brief_text
    assert len(brief_page.images) == 2
    order_text = " ".join(page.extract_text() for page in PdfReader(BytesIO(order)).pages)
    assert "29-сон \u0430/ф" in order_text and "Уточнение кадровика" in order_text
    assert "БУЙРУҚ" in order_text and "2030 йил" in order_text
