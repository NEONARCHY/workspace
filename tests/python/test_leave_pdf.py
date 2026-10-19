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
    text = " ".join(reader.pages[0].extract_text().split())
    assert "Тестова Зебо" in text
    assert "раисининг биринчи ўринбосари — ижрочи директор Тестов Алига" in text
    assert "«Юксалиш» ҳаракати бош мутахассис Тестова Зебодан" in text
    assert not reader.pages[0].images


def test_hr_correction_is_attributed_without_impersonating_employee() -> None:
    content = application_pdf(
        employee_name="Тестова Зебо", employee_job_title="мутахассис",
        deputy_name="Тестов Али", application_text="Тузатилган ариза.",
        requested_start=date(2026, 11, 19), requested_end=None,
        submitted_at=datetime(2026, 10, 16, tzinfo=UTC),
        edited_by_hr="Кадровик Тест", edited_at=datetime(2026, 10, 18, tzinfo=UTC),
    )
    text = PdfReader(BytesIO(content)).pages[0].extract_text()
    assert "Тестова Зебо" in text
    assert "Кадровик Тест" in text
    assert "Кадрлар хизмати томонидан" in text


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


def test_order_includes_organization_tenure_days_and_hr_edits_without_signature() -> None:
    content = order_pdf(
        number="11", issued_on=date(2026, 10, 18), employee_name="Тестова Зебо",
        job_title="мутахассис", work_year_start=date(2025, 1, 1),
        work_year_end=date(2025, 12, 31), starts_on=date(2026, 11, 1),
        ends_on=date(2026, 11, 23), calendar_days=23, paid_days=20,
        return_on=date(2026, 11, 24), accounting_officer=None,
        signer_name="Тестов Али", signature=None, tenure_additional_days=2,
        order_clause_1="Таҳрирланган меҳнат таътили берилсин.",
        order_clause_2="Ишга чиқиш 24 ноябрь куни белгилансин.",
    )
    page = PdfReader(BytesIO(content)).pages[0]
    text = " ".join(page.extract_text().split())
    assert "Ташкилотдаги иш стажи учун қўшимча 2 кун" in text
    assert "Таҳрирланган меҳнат таътили" in text
    assert "Ишга чиқиш 24 ноябрь" in text
    assert len(page.images) == 1
