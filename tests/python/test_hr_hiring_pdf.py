"""Synthetic identity/signature only; no production personnel files."""

import re
from datetime import date
from io import BytesIO
from pathlib import Path

import pytest
from PIL import Image, ImageDraw
from pydantic import ValidationError
from pypdf import PdfReader, PdfWriter

from yuksalish_api.hr_hiring_pdf import (
    _visible_signature,
    application_pdf,
    documents,
    place_signature,
    sign_generated,
    validate_signature,
)
from yuksalish_api.hr_hiring_schemas import HiringFields, SignatureBox


def fields() -> HiringFields:
    return HiringFields(
        full_name="Тестовый сотрудник",
        job_title="Мутахассис",
        department="Тест бўлими",
        start_date=date(2026, 10, 12),
        document_date=date(2026, 10, 12),
        contract_number="TEST-1",
        order_number="TEST-2",
        salary_terms="Штат жадвалига мувофиқ",
        accountant_dative="Тест Бухгалтерга",
        passport="TEST00000",
        pinfl="00000000000000",
        address="Тестовый адрес",
        phone="+998000000000",
    )


def signature() -> bytes:
    image = Image.new("RGBA", (200, 80), (0, 0, 0, 0))
    ImageDraw.Draw(image).line([(10, 50), (50, 10), (90, 60), (190, 30)], fill="blue", width=3)
    output = BytesIO()
    image.save(output, format="PNG")
    return output.getvalue()


def test_unicode_contract_order_slots_and_safe_signature() -> None:
    packet = documents(fields(), "Тестовый руководитель")
    reader = PdfReader(BytesIO(packet["contract"]))
    text = "\n".join(page.extract_text() for page in reader.pages)
    assert "МЕҲНАТ ШАРТНОМАСИ" in text
    assert "00000000000000" in text
    assert "21" in text and "40" in text
    assert "(сана ва имзо)" in text
    assert len(reader.pages) == 2
    assert len(PdfReader(BytesIO(packet["order"])).pages) == 1
    for name, content in packet.items():
        signed = PdfReader(BytesIO(sign_generated(content, signature())))
        assert len(signed.pages) == len(PdfReader(BytesIO(content)).pages)
        assert any(page.images for page in signed.pages), name
    assert "Меҳнатга ҳақ тўлаш" in text
    assert "ЖЭЖЗ қаршилик билдириш" in text
    order_text = "\n".join(
        page.extract_text() for page in PdfReader(BytesIO(packet["order"])).pages
    )
    assert "BUYRUQ" in order_text and "Toshkent shahri" in order_text
    assert "Buxgalteriya boʻlimi boshligʻi Test Buxgalterga" in order_text  # noqa: RUF001
    assert "Mehnat kodeksining 127, 129 va 130-moddalari" in " ".join(order_text.split())
    assert not re.search(r"[А-Яа-яЁёЎўҚқҒғҲҳ]", order_text)  # noqa: RUF001


def test_document_fields_are_text_not_paragraph_markup() -> None:
    values = fields().model_copy(
        update={"full_name": 'Тест <b>не тег</b> & "кавычки"', "address": "O'Connor & <адрес>"}
    )
    packet = documents(values, 'Руководитель <i>текст</i> & "имя"')
    for name, content in packet.items():
        text = "\n".join(page.extract_text() for page in PdfReader(BytesIO(content)).pages)
        expected_name = (
            values.full_name if name == "contract" else 'Test <b>ne teg</b> & "kavichki"'
        )
        expected_signer = (
            'Руководитель <i>текст</i> & "имя"'
            if name == "contract" else 'Rukovoditel <i>tekst</i> & "imya"'
        )
        assert expected_name in text, name
        assert expected_signer in " ".join(text.split()), name
    contract = "\n".join(
        page.extract_text() for page in PdfReader(BytesIO(packet["contract"])).pages
    )
    assert values.address in contract


def test_latin_order_normalizes_patronymics_without_changing_source_identity() -> None:
    values = fields().model_copy(update={
        "full_name": "Testov Xodim Anvar угли", "accountant_dative": "Testov Hisobchi Ali углига",
    })
    packet = documents(values, "Testov Rais Vali ўғли")
    order_text = " ".join(
        page.extract_text() for page in PdfReader(BytesIO(packet["order"])).pages
    )
    assert "Testov Xodim Anvar o'g'li" in order_text
    assert "Testov Hisobchi Ali o'g'liga" in order_text
    assert "Testov Rais Vali o'g'li" in order_text
    contract_text = " ".join(
        page.extract_text() for page in PdfReader(BytesIO(packet["contract"])).pages
    )
    assert values.full_name in contract_text


def test_original_backgrounds_have_no_sample_employee_or_extra_page() -> None:
    root = Path(__file__).parents[2] / "apps/api/src/yuksalish_api/hr_assets"
    contract = PdfReader(root / "contract-original-blank.pdf")
    order = PdfReader(root / "order-original-blank.pdf")
    latin_order = PdfReader(root / "order-latin-blank.pdf")
    assert len(contract.pages) == 2 and len(order.pages) == 1 and len(latin_order.pages) == 1
    content = "\n".join(page.extract_text() for page in [*contract.pages, *order.pages])
    assert "Муталиева" not in content
    assert "Турдалиева" not in content
    assert "Бекмуродов" not in content
    assert "Тошкент шаҳри" in content and "HARAKAT" in content
    assert latin_order.pages[0].extract_text().split() == ["HARAKAT", "MOVEMENT"]


def test_original_form_rejects_fields_with_no_room_or_no_slot() -> None:
    with pytest.raises(ValueError, match="начальника бухгалтерии"):
        documents(fields().model_copy(update={"accountant_dative": ""}), "Тестовый руководитель")
    with pytest.raises(ValueError, match="нет места для дополнительных условий"):
        documents(
            fields().model_copy(update={"additional_terms": "Новый пункт"}), "Тестовый руководитель"
        )
    with pytest.raises(ValueError, match="не помещается"):
        documents(
            fields().model_copy(update={"salary_terms": "длинное поле " * 100}),
            "Тестовый руководитель",
        )


def test_fixed_term_reason_is_printed_inside_existing_contract_slot() -> None:
    current = fields().model_copy(
        update={
            "term": "fixed",
            "end_date": date(2027, 1, 1),
            "fixed_term_reason": "Тест лойиҳа муддати",
        }
    )
    packet = documents(current, "Тестовый руководитель")
    text = "\n".join(page.extract_text() for page in PdfReader(BytesIO(packet["contract"])).pages)
    assert "Тест лойиҳа муддати" in text
    assert "01.01.2027" in text


def test_source_length_order_fits_its_original_three_line_first_clause() -> None:
    current = fields().model_copy(
        update={
            "department": "Ташкилий ва инсон капитали билан ишлаш тармоғи",
            "job_title": "Канцелярия мутахассиси",
            "probation_months": 2,
            "probation_eligible": True,
            "full_name": "Тестова Сабина Юнусовна",
        }
    )
    result = documents(current, "Тестовый руководитель")
    assert len(PdfReader(BytesIO(result["order"])).pages) == 1
    text = " ".join(PdfReader(BytesIO(result["order"])).pages[0].extract_text().split())
    assert "ikki oylik dastlabki sinov muddati bilan ishga qabul qilinsin" in text


def test_visible_signature_crops_transparent_source_margins() -> None:
    image = Image.new("RGBA", (500, 500), (0, 0, 0, 0))
    ImageDraw.Draw(image).line([(30, 220), (240, 180), (460, 260)], fill="blue", width=5)
    output = BytesIO()
    image.save(output, format="PNG")
    cropped = _visible_signature(output.getvalue())
    assert cropped.width > 400 and cropped.height < 120


@pytest.mark.parametrize(
    "patch",
    [
        {"pinfl": "short"},
        {"hours_per_week": 41},
        {"annual_leave": 20},
        {"probation_months": 2},
        {"term": "fixed"},
        {"end_date": date(2027, 1, 1)},
        {"term": "fixed", "end_date": date(2026, 1, 1), "fixed_term_reason": "test"},
        {"full_name": "   "},
    ],
)
def test_invalid_terms_are_rejected(patch: dict[str, object]) -> None:
    with pytest.raises(ValidationError):
        HiringFields.model_validate(fields().model_dump() | patch)


def test_application_limits_rotation_and_placement() -> None:
    pdf = documents(fields(), "Тестовый руководитель")["order"]
    reader = PdfReader(BytesIO(pdf))
    writer = PdfWriter()
    writer.add_page(reader.pages[0].rotate(90))
    output = BytesIO()
    writer.write(output)
    normalized, pages = application_pdf(output.getvalue())
    assert pages == 1 and PdfReader(BytesIO(normalized)).pages[0].rotation == 0
    assert place_signature(normalized, SignatureBox(), signature()).startswith(b"%PDF-")
    with pytest.raises(ValueError):
        place_signature(normalized, SignatureBox(page=2), signature())
    with pytest.raises(ValidationError):
        SignatureBox(x=0.9, width=0.3)
    with pytest.raises(ValidationError):
        SignatureBox(x=float("nan"))
    with pytest.raises(ValueError):
        application_pdf(b"broken")
    with pytest.raises(ValueError):
        application_pdf(b"x" * (10 * 1024 * 1024 + 1))


def test_signature_validation_and_photo_conversion() -> None:
    assert validate_signature(signature()).startswith(b"\x89PNG")
    with pytest.raises(ValueError):
        validate_signature(b"bad")
    opaque = BytesIO()
    Image.new("RGB", (100, 100), "white").save(opaque, format="PNG")
    with pytest.raises(ValueError):
        validate_signature(opaque.getvalue())
    pdf, pages = application_pdf(opaque.getvalue())
    assert pages == 1 and len(PdfReader(BytesIO(pdf)).pages) == 1
