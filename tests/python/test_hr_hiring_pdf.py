"""Synthetic identity/signature only; no production personnel files."""

from datetime import date
from io import BytesIO

import pytest
from PIL import Image, ImageDraw
from pydantic import ValidationError
from pypdf import PdfReader, PdfWriter

from yuksalish_api.hr_hiring_pdf import (
    application_pdf,
    contract_duties,
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
    assert "Ходимнинг имзоси" in text
    assert len(reader.pages) >= 2
    for name, content in packet.items():
        signed = PdfReader(BytesIO(sign_generated(content, signature())))
        assert len(signed.pages) == len(PdfReader(BytesIO(content)).pages)
        assert any(page.images for page in signed.pages), name
    employee, employer = contract_duties()
    assert len(employee) == 11 and len(employer) == 10
    assert "ЎР МК" in text  # noqa: RUF001 - literal source wording


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
