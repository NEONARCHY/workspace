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
    Table,
    TableStyle,
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
        Paragraph(f"Манзил: {_text(destination)}", regular),
        Paragraph(f"Муддат: {start:%d.%m.%Y} — {end:%d.%m.%Y}", regular),
        Paragraph("Иштирокчилар: " + "; ".join(_text(name) for name in employees), regular),
    ]
    if purpose.strip():
        story.insert(4, Paragraph(f"Мақсад: {_text(purpose)}", regular))
    if expense_source.strip():
        story.append(Paragraph(f"Харажатлар манбаи: {_text(expense_source)}", regular))
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
    centered = _style("order-centered", size=13, leading=19, bold=True)
    centered.alignment = 1
    right = _style("order-right", size=11, leading=18)
    right.alignment = 2
    month = _MONTHS[issued.month - 1]
    period = (
        f"{start.day} {_MONTHS[start.month - 1]} куни" if start == end
        else f"{start.day}-{end.day} {_MONTHS[start.month - 1]} кунлари"
        if start.month == end.month and start.year == end.year
        else f"{start:%d.%m.%Y} — {end:%d.%m.%Y} кунлари"
    )
    date_line = Table([[
        Paragraph(f"{issued.year} йил “{issued.day}” {month}", body),
        Paragraph("Тошкент шаҳри", right),
    ]], colWidths=[239, 239])
    date_line.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
    ]))
    story: list[object] = [
        Paragraph("БУЙРУҚ", centered),
        Paragraph(f"{_text(order_number)}-сон а/ф", centered),  # noqa: RUF001
        Spacer(1, 12), date_line, Spacer(1, 8),
        Paragraph("“Хизмат сафарига юбориш тўғрисида”", bold),
        Spacer(1, 8),
    ]
    if purpose.strip():
        story.append(Paragraph(_text(purpose), body))
    story.extend([Spacer(1, 8), Paragraph("Б У Ю Р А М А Н :", centered), Spacer(1, 6)])  # noqa: RUF001
    if len(employees) == 1:
        name, job_title = employees[0]
        person = f"{_text(job_title)} {_text(name)}" if job_title else _text(name)
        story.append(Paragraph(
            f"1. Ҳаракатнинг {person} жорий йилнинг {period} "
            f"{_text(destination)}га хизмат сафарига юборилсин.", body,  # noqa: RUF001
        ))
    else:
        story.append(Paragraph(
            f"1. Ҳаракатнинг қуйидаги ходимлари жорий йилнинг {period} "
            f"{_text(destination)}га хизмат сафарига юборилсин:", body,  # noqa: RUF001
        ))
        for index, (name, job_title) in enumerate(employees, start=1):
            suffix = f" — {_text(job_title)}" if job_title else ""
            story.append(Paragraph(f"{index}) {_text(name)}{suffix};", body))
    if expense_source.strip():
        story.append(Paragraph(
            "2. Хизмат сафари билан боғлиқ харажатлар "
            f"{_text(expense_source)} ҳисобидан қопланиши маълумот учун қабул қилинсин.",
            body,
        ))
    story.extend([
        Spacer(1, 12),
        Paragraph(f"Асос: {_text(requester)}нинг билдиргиси.", body),  # noqa: RUF001
        Spacer(1, 24),
    ])
    signature_cell: object = _signature_image(signature) if signature is not None else Spacer(1, 50)
    signature_row = Table([[
        Paragraph("Раис", bold), signature_cell, Paragraph(_text(chair), right),
    ]], colWidths=[150, 150, 178])
    signature_row.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
    ]))
    story.append(KeepTogether([signature_row]))
    return _build(story)
