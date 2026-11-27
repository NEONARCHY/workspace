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
@pytest.mark.parametrize("action", ["complete", "update_order_details"])
def test_complete_requires_real_number_and_series(number, series, action):
    with pytest.raises(ValidationError):
        TripActionRequest(action=action, order_number=number, order_series=series)


def test_registration_cannot_change_the_approved_purpose():
    with pytest.raises(ValidationError, match="не изменяют цель"):
        TripActionRequest(action="update_order_details", order_number="29", order_series="a/f",
                          order_purpose="A different purpose")


def test_other_actions_cannot_change_hr_order_fields():
    with pytest.raises(ValidationError):
        TripActionRequest(action="approve", order_number="29", order_series="a/f")


@pytest.mark.parametrize("brief_text", [
    "Safarga ruxsat so'rayman.", "Сафарга рухсат сўрайман.", "",
])
def test_new_brief_lists_all_selected_participants(brief_text: str) -> None:
    facts = TripDocumentSnapshot(
        requester="Тестовый Инициатор", requester_title="Bosh mutaxassis", chair="Тестовый Раис",
        brief_text=brief_text, purpose="Мониторинг", destination="Farg'ona shahri",
        start=date(2030, 5, 1), end=date(2030, 5, 2),
        employees=[("Testova Zebo", "Mutaxassis"), ("Тестов Али", "Мутахассис")],
        expense_source="",
    )
    content = hr_brief_pdf(facts)
    document = PdfReader(BytesIO(content))
    text = " ".join(page.extract_text() for page in document.pages)

    assert "Сафар иштирокчилари: " in text
    participants = text.split("Сафар иштирокчилари: ")[1].strip()
    assert participants == "Тестова \u0417\u0435\u0431\u043e; Тестов Али"
    assert len(document.pages) == 1


def test_new_brief_does_not_invent_participants_when_none_selected() -> None:
    facts = TripDocumentSnapshot(
        requester="Тестовый Инициатор", requester_title="Мутахассис", chair="Тестовый Раис",
        brief_text="Сафарга рухсат сўрайман.", purpose="", destination="Нукус",
        start=date(2030, 5, 1), end=date(2030, 5, 2), employees=[], expense_source="",
    )
    text = PdfReader(BytesIO(hr_brief_pdf(facts))).pages[0].extract_text()

    assert "Сафар иштирокчилари:" not in text


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
    assert "Сафар иштирокчилари: Тестовый Инициатор" in brief_text
    assert "Уточнение кадровика" not in brief_text and "Резолюция санаси" not in brief_text
    assert len(brief_page.images) == 2
    order_text = " ".join(page.extract_text() for page in PdfReader(BytesIO(order)).pages)
    assert "29-сон \u0430/ф" in order_text and "Уточнение кадровика" in order_text
    assert "БУЙРУҚ" in order_text and "2030 йил" in order_text
    assert order_text.index("тўғрисида") < order_text.index("Уточнение кадровика")
    assert order_text.index("Уточнение кадровика") < order_text.index("БУЮРАМАН:")
    assert "1. Ҳаракатнинг Бош мутахассис Тестовый Инициатор" in order_text
    assert "2. Сафар харажатлари" in order_text
    assert "\u0410\u0441\u043e\u0441: Тестовый Инициаторнинг билдиргиси." in order_text
    assert "раис резолюцияси" not in order_text


@pytest.mark.parametrize("count", [2, 6, 35])
def test_order_groups_participants_under_one_clause(count):
    image = Image.new("RGBA", (20, 20), "blue")
    data = BytesIO()
    image.save(data, "PNG")
    facts = TripDocumentSnapshot(
        requester="Инициатор", requester_title="Мутахассис", chair="Раис",
        brief_text="Билдирги", purpose="Сафар мақсади", destination="Самарқанд",
        start=date(2030, 5, 1), end=date(2030, 5, 2),
        employees=[(f"Ходим {index}", "Мутахассис" if index else "") for index in range(count)],
        expense_source="Лойиҳа маблағлари",
    )
    content = hr_order_pdf(facts, number="29", series="\u0430/ф", purpose=facts.purpose,
                           issued=date(2029, 12, 31), signature=data.getvalue())
    pages = PdfReader(BytesIO(content)).pages
    text = " ".join(page.extract_text() for page in pages)
    assert text.count("хизмат сафарига юборилсин") == 1
    assert "1. Ҳаракатнинг қуйидаги ходимлари" in text
    assert "Ходим 0;" in text
    assert f"Ходим {count - 1} - Мутахассис." in text
    assert "2. Сафар харажатлари" in text
    assert "3." not in text
    assert "2029 йил «31» декабрь" in text
    assert "раис резолюцияси" not in text
    if count == 6:
        assert len(pages) == 1


@pytest.mark.parametrize("value", ["2030-04-28", None])
def test_order_date_is_optional_and_accepted_in_the_camel_case_contract(value):
    payload = TripActionRequest.model_validate({
        "action": "complete", "orderNumber": "29", "orderSeries": "\u0430/ф", "orderDate": value,
    })
    assert payload.order_date == (date(2030, 4, 28) if value else None)


@pytest.mark.parametrize("value", ["2030-02-30", "invalid", ""])
def test_invalid_order_dates_are_rejected(value):
    with pytest.raises(ValidationError):
        TripActionRequest(
            action="complete", order_number="29", order_series="\u0430/ф", order_date=value,
        )


def test_other_actions_cannot_set_an_order_date():
    with pytest.raises(ValidationError):
        TripActionRequest(action="approve", order_date=date(2030, 4, 28))
