"""Synthetic leave documents; no real names or signatures."""

# Cyrillic sample text is intentional in this PDF regression test.
# ruff: noqa: RUF001

from datetime import UTC, date, datetime
from io import BytesIO

from PIL import Image, ImageDraw
from pypdf import PdfReader

from yuksalish_api.leave_pdf import application_pdf, order_pdf


def _signature() -> bytes:
    image = Image.new("RGBA", (320, 100), (0, 0, 0, 0))
    ImageDraw.Draw(image).line([(15, 70), (100, 15), (180, 72), (300, 20)], fill="blue", width=4)
    output = BytesIO()
    image.save(output, format="PNG")
    return output.getvalue()


def test_leave_application_has_no_handwritten_signature() -> None:
    content = application_pdf(
        employee_name="Тестова Зебо",
        employee_job_title="бош мутахассис",
        deputy_name="Тестов Али",
        application_text="Менга меҳнат таътили беришингизни сўрайман.",
        requested_start=date(2026, 10, 19),
        requested_end=None,
        submitted_at=datetime(2026, 10, 16, tzinfo=UTC),
    )
    reader = PdfReader(BytesIO(content))
    assert len(reader.pages) == 1
    assert "АРИЗА" in reader.pages[0].extract_text()
    assert "Тестова Зебо" in reader.pages[0].extract_text()
    assert not reader.pages[0].images


def test_leave_order_follows_three_clause_sample_and_is_signed() -> None:
    content = order_pdf(
        number="10",
        issued_on=date(2026, 10, 18),
        employee_name="Тестова Зебо",
        job_title="бош мутахассис",
        work_year_start=date(2025, 6, 13),
        work_year_end=date(2026, 6, 12),
        starts_on=date(2026, 10, 19),
        ends_on=date(2026, 11, 8),
        calendar_days=21,
        paid_days=18,
        return_on=date(2026, 11, 9),
        accounting_officer="Тестов Бек",
        signer_name="Тестов Али",
        signature=_signature(),
    )
    reader = PdfReader(BytesIO(content))
    assert len(reader.pages) == 1
    text = " ".join(reader.pages[0].extract_text().split())
    assert "БУЙРУҚ" in text and "10-сон а/ф" in text
    assert "216, 217" in text and "21 календарь" in text
    assert "18" in text and "9 ноябрь" in text
    assert len(reader.pages[0].images) == 2  # brand logo and deputy signature


def test_order_preview_never_embeds_deputy_signature() -> None:
    content = order_pdf(
        number="10",
        issued_on=date(2026, 10, 18),
        employee_name="Тестова Зебо",
        job_title="бош мутахассис",
        work_year_start=date(2025, 6, 13),
        work_year_end=date(2026, 6, 12),
        starts_on=date(2026, 10, 19),
        ends_on=date(2026, 11, 8),
        calendar_days=21,
        paid_days=18,
        return_on=date(2026, 11, 9),
        accounting_officer=None,
        signer_name="Тестов Али",
        signature=None,
    )
    page = PdfReader(BytesIO(content)).pages[0]
    assert "ИМЗОЛАНМАГАН" in page.extract_text()
    assert len(page.images) == 1  # only brand logo
