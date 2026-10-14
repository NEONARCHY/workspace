"""Readable, immutable trip brief and order PDFs based on the owner's sample layout."""

from __future__ import annotations

from datetime import date
from html import escape
from io import BytesIO
from pathlib import Path
from threading import Lock

from PIL import Image as PillowImage
from reportlab.lib import colors  # type: ignore[import-untyped]
from reportlab.lib.pagesizes import A4  # type: ignore[import-untyped]
from reportlab.lib.styles import ParagraphStyle  # type: ignore[import-untyped]
from reportlab.pdfbase import pdfmetrics  # type: ignore[import-untyped]
from reportlab.pdfbase.ttfonts import TTFont  # type: ignore[import-untyped]
from reportlab.pdfgen.canvas import Canvas  # type: ignore[import-untyped]
from reportlab.platypus import (  # type: ignore[import-untyped]
    Image,
    KeepTogether,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
)

_ASSETS = Path(__file__).parent / "hr_assets"
_LOGO = Path(__file__).parent / "trip_assets" / "yuksalish-logo-color.png"
_FONT_LOCK = Lock()
_MONTHS = (
    "январь", "февраль", "март", "апрель", "май", "июнь",
    "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь",
)


def _fonts() -> None:
    with _FONT_LOCK:
        if "TripSerif" not in pdfmetrics.getRegisteredFontNames():
            pdfmetrics.registerFont(TTFont(
                "TripSerif", str(_ASSETS / "SourceSerif4-Regular.ttf")
            ))
            pdfmetrics.registerFont(TTFont(
                "TripSerifBold", str(_ASSETS / "SourceSerif4-Bold.ttf")
            ))
            pdfmetrics.registerFontFamily(
                "TripSerif", normal="TripSerif", bold="TripSerifBold"
            )


def _page(canvas: Canvas, document: object) -> None:
    del document
    canvas.saveState()
    canvas.setFont("TripSerifBold", 9)
    canvas.setFillColor(colors.HexColor("#293A55"))
    canvas.drawString(54, 759, "HARAKAT")
    canvas.drawRightString(A4[0] - 54, 759, "MOVEMENT")
    if _LOGO.exists():
        canvas.drawImage(
            str(_LOGO), A4[0] / 2 - 75, 742, width=150, height=50,
            preserveAspectRatio=True, anchor="c", mask="auto",
        )
    canvas.setStrokeColor(colors.HexColor("#293A55"))
    canvas.setLineWidth(0.8)
    canvas.line(54, 731, A4[0] - 54, 731)
    canvas.setFont("TripSerif", 8)
    canvas.setFillColor(colors.HexColor("#64748B"))
    canvas.drawRightString(A4[0] - 54, 35, str(canvas.getPageNumber()))
    canvas.restoreState()


def _style(
    name: str, *, size: float = 11, leading: float = 17, bold: bool = False,
) -> ParagraphStyle:
    return ParagraphStyle(
        name, fontName="TripSerifBold" if bold else "TripSerif",
        fontSize=size, leading=leading, textColor=colors.HexColor("#172236"),
        spaceAfter=10,
    )


def _text(value: str) -> str:
    return escape(" ".join(value.split()))


def _signature_image(content: bytes) -> Image:
    with PillowImage.open(BytesIO(content)) as source:
        rgba = source.convert("RGBA")
    visible = rgba.getchannel("A").point(lambda alpha: 255 if alpha >= 16 else 0).getbbox()
    if visible is None:
        raise ValueError("Изображение подписи пустое")
    rgba = rgba.crop(visible)
    output = BytesIO()
    rgba.save(output, format="PNG")
    output.seek(0)
    width = 122.0
    height = min(55.0, width * rgba.height / rgba.width)
    return Image(output, width=width, height=height, hAlign="LEFT")


def _build(story: list[object]) -> bytes:
    _fonts()
    output = BytesIO()
    document = SimpleDocTemplate(
        output, pagesize=A4, leftMargin=58, rightMargin=58,
        topMargin=130, bottomMargin=62, title="Yuksalish xizmat safari",
    )
    document.build(story, onFirstPage=_page, onLaterPages=_page)
    return output.getvalue()


def brief_pdf(
    *, requester: str, chair: str, purpose: str, destination: str,
    start: date, end: date, employees: list[str], expense_source: str,
    brief_text: str, attachment_name: str | None, signature: bytes,
    signed_on: date,
) -> bytes:
    """Create the signed Workspace cover brief; the uploaded original stays separate."""
    _fonts()
    regular = _style("brief-body")
    small = _style("brief-small", size=9.5, leading=14)
    story: list[object] = [
        Paragraph("БИЛДИРГИ", _style("brief-title", size=16, leading=22, bold=True)),
        Paragraph(f"“Юксалиш” ҳаракати раиси {_text(chair)}га", regular),  # noqa: RUF001
        Paragraph(f"Кимдан: {_text(requester)}", regular),
        Spacer(1, 10),
        Paragraph(f"Мақсад: {_text(purpose)}", regular),
        Paragraph(f"Манзил: {_text(destination)}", regular),
        Paragraph(f"Муддат: {start:%d.%m.%Y} — {end:%d.%m.%Y}", regular),
        Paragraph("Иштирокчилар: " + "; ".join(_text(name) for name in employees), regular),
        Paragraph(f"Харажатлар манбаи: {_text(expense_source)}", regular),
    ]
    if brief_text.strip():
        for paragraph in brief_text.strip().splitlines():
            if paragraph.strip():
                story.append(Paragraph(_text(paragraph), regular))
    if attachment_name:
        story.append(Paragraph(
            f"Илова: {_text(attachment_name)}. Асл файл алоҳида сақланади.", small
        ))
    story.extend([
        Spacer(1, 18),
        KeepTogether([
            Paragraph(f"{_text(requester)} · {signed_on:%d.%m.%Y}", small),
            _signature_image(signature),
            Paragraph("Ходимнинг график имзоси", small),
        ]),
    ])
    return _build(story)


def order_pdf(
    *, order_number: str, issued: date, purpose: str, destination: str,
    start: date, end: date, employees: list[tuple[str, str]],
    expense_source: str, requester: str, chair: str, signature: bytes | None,
) -> bytes:
    """Issue an Uzbek-Cyrillic order with a separate Workspace registration number."""
    _fonts()
    body = _style("order-body", size=11, leading=18)
    bold = _style("order-bold", size=11, leading=18, bold=True)
    month = _MONTHS[issued.month - 1]
    period = (
        f"{start:%d.%m.%Y} куни" if start == end
        else f"{start:%d.%m.%Y} — {end:%d.%m.%Y} кунлари"
    )
    story: list[object] = [
        Paragraph("БУЙРУҚ", _style("order-title", size=17, leading=22, bold=True)),
        Paragraph(f"{_text(order_number)}-сон а/ф", bold),  # noqa: RUF001
        Paragraph(f"{issued.year} йил “{issued.day}” {month} · Тошкент шаҳри", body),
        Spacer(1, 5),
        Paragraph("“Хизмат сафарига юбориш тўғрисида”", bold),
        Paragraph(_text(purpose), body),
        Spacer(1, 7),
        Paragraph("Б У Ю Р А М А Н :", bold),  # noqa: RUF001
        Paragraph(
            f"1. Қуйидаги ходимлар {period} {_text(destination)}га "  # noqa: RUF001
            "хизмат сафарига юборилсин:", body,
        ),
    ]
    for index, (name, job_title) in enumerate(employees, start=1):
        suffix = f" — {_text(job_title)}" if job_title else ""
        story.append(Paragraph(f"{index}) {_text(name)}{suffix};", body))
    story.extend([
        Paragraph(
            "2. Хизмат сафари билан боғлиқ харажатлар "
            f"{_text(expense_source)} ҳисобидан қопланиши маълумот учун қабул қилинсин.",
            body,
        ),
        Spacer(1, 12),
        Paragraph(f"Асос: {_text(requester)}нинг билдиргиси.", body),  # noqa: RUF001
        Spacer(1, 24),
    ])
    signature_block: list[object] = [Paragraph("Раис", bold)]
    if signature is not None:
        signature_block.append(_signature_image(signature))
    else:
        signature_block.append(Spacer(1, 50))
    signature_block.append(Paragraph(_text(chair), bold))
    story.append(KeepTogether(signature_block))
    return _build(story)
