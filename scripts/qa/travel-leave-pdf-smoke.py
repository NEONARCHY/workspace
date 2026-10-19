"""Generate and render synthetic launch documents; never loads production data."""

# Cyrillic text and Uzbek apostrophes in the document samples are intentional.
# ruff: noqa: RUF001

from datetime import UTC, date, datetime
from io import BytesIO
from pathlib import Path
from shutil import which
from subprocess import run

from PIL import Image, ImageDraw
from pypdf import PdfReader

from yuksalish_api.leave_pdf import application_pdf
from yuksalish_api.leave_pdf import order_pdf as leave_order
from yuksalish_api.trip_order_pdf import brief_pdf
from yuksalish_api.trip_order_pdf import order_pdf as trip_order

OUTPUT = Path("tmp/travel-leave-audit/pdfs")


def main() -> None:
    renderer = which("pdftoppm")
    if renderer is None:
        raise RuntimeError("Poppler pdftoppm is required for visual verification")
    OUTPUT.mkdir(parents=True, exist_ok=True)
    image = Image.new("RGBA", (100, 240), (0, 0, 0, 0))
    ImageDraw.Draw(image).line([(10, 220), (45, 10), (90, 190)], fill="blue", width=4)
    stream = BytesIO()
    image.save(stream, "PNG")
    signature = stream.getvalue()
    docs = {
        "leave-application": application_pdf(
            employee_name="Тестова Зебо",
            employee_job_title="Bosh mutaxassis",
            deputy_name="Тестов Али",
            application_text="Менга меҳнат таътили беришингизни сўрайман.",
            requested_start=date(2026, 11, 1),
            requested_end=date(2026, 11, 23),
            submitted_at=datetime(2026, 10, 19, tzinfo=UTC),
        ),
        "trip-brief": brief_pdf(
            requester="Тестова Зебо",
            chair="Тестов Раис",
            purpose="Hamkorlar bilan seminar",
            destination="Samarqand",
            start=date(2027, 3, 10),
            end=date(2027, 3, 12),
            employees=["Тестова Зебо"],
            expense_source="loyiha mablag‘lari",
            brief_text="2027-yil 10–12-mart kunlari Samarqand shahrida hamkorlar bilan "
            "loyiha doirasida amaliy seminar o‘tkazish rejalashtirilgan.\n"
            "Shu munosabat bilan xizmat safariga ruxsat berishingizni so‘rayman.\n"
            "Safar xarajatlari loyiha mablag‘lari hisobidan qoplanadi.",
            attachment_name=None,
            signature=None,
            signed_on=date(2026, 10, 19),
            include_fact_lines=False,
        ),
    }
    for signed in (False, True):
        docs[f"leave-order-{'signed' if signed else 'preview'}"] = leave_order(
            number="QA-10",
            issued_on=date(2026, 10, 19),
            employee_name="Тестова Зебо",
            job_title="бош мутахассис",
            work_year_start=date(2025, 6, 13),
            work_year_end=date(2026, 6, 12),
            starts_on=date(2026, 11, 1),
            ends_on=date(2026, 11, 23),
            calendar_days=23,
            paid_days=20,
            return_on=date(2026, 11, 24),
            accounting_officer="Тестов Бек",
            signer_name="Тестов Али",
            signature=signature if signed else None,
            tenure_additional_days=2,
        )
        for long in (False, True):
            docs[
                f"trip-order-{'long' if long else 'short'}-{'signed' if signed else 'preview'}"
            ] = trip_order(
                order_number="001-WS",
                issued=date(2026, 10, 19),
                purpose="Hamkorlar bilan loyiha doirasida amaliy seminar o‘tkazish",
                destination="Samarqand, O‘zbekiston",
                start=date(2027, 3, 10),
                end=date(2027, 3, 12),
                employees=[
                    (
                        f"Test xodim {i + 1}",
                        "Xalqaro hamkorlik va hududiy rivojlanish bo‘limi mutaxassisi",
                    )
                    for i in range(12 if long else 1)
                ],
                expense_source="loyiha mablag‘lari",
                requester="Тестова Зебо",
                chair="Тестов Раис",
                signature=signature if signed else None,
            )
    for name, content in docs.items():
        path = OUTPUT / f"{name}.pdf"
        path.write_bytes(content)
        pages = len(PdfReader(BytesIO(content)).pages)
        if "long" not in name:
            assert pages == 1, (name, pages)
        run([renderer, "-r", "110", "-png", str(path), str(OUTPUT / name)], check=True)
        print(f"{name}: {pages} pages, rendered")
    for prefix in ("leave-order", "trip-order-short", "trip-order-long"):
        assert len(PdfReader(BytesIO(docs[f"{prefix}-signed"])).pages) == len(
            PdfReader(BytesIO(docs[f"{prefix}-preview"])).pages
        )


if __name__ == "__main__":
    main()
