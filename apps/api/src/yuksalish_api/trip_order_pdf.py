"""Readable, immutable trip brief and order PDFs based on the owner's sample layout."""

from __future__ import annotations

import re
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

from .hr_hiring_templates import _latin
from .trip_document_text import trip_destination_text

_ASSETS = Path(__file__).parent / "hr_assets"
_LOGO = Path(__file__).parent / "trip_assets" / "yuksalish-logo-color.png"
_FONT_LOCK = Lock()
_MONTHS = (
    "yanvar", "fevral", "mart", "aprel", "may", "iyun",
    "iyul", "avgust", "sentabr", "oktabr", "noyabr", "dekabr",
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
    return escape(_latin(" ".join(value.split())))


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
    scale = min(122.0 / rgba.width, 55.0 / rgba.height)
    width, height = rgba.width * scale, rgba.height * scale
    return Image(output, width=width, height=height, hAlign="LEFT")


def _build(story: list[object], *, draft: bool = False) -> bytes:
    _fonts()
    output = BytesIO()
    document = SimpleDocTemplate(
        output, pagesize=A4, leftMargin=58, rightMargin=58,
        topMargin=130, bottomMargin=62, title="Yuksalish xizmat safari",
    )
    def page(canvas: Canvas, document: object) -> None:
        _page(canvas, document)
        if draft:
            canvas.saveState()
            canvas.setFont("TripSerifBold", 9)
            canvas.drawString(58, 35, "LOYIHA — IMZOLANMAGAN")
            canvas.restoreState()

    document.build(story, onFirstPage=page, onLaterPages=page)
    return output.getvalue()


def brief_pdf(
    *, requester: str, chair: str, purpose: str, destination: str,
    start: date, end: date, employees: list[str], expense_source: str,
    brief_text: str, attachment_name: str | None, signature: bytes | None,
    signed_on: date, include_fact_lines: bool = True,
    brief_font_size: int = 11, brief_font_weight: str = "regular",
) -> bytes:
    """Create a Latin-script brief for the chair's resolution and optional legacy signature."""
    _fonts()
    if not 9 <= brief_font_size <= 14 or brief_font_weight not in {"regular", "bold"}:
        raise ValueError("Недопустимое оформление билдирги")
    regular = _style("brief-body")
    brief_body = _style(
        "brief-authored-body", size=brief_font_size,
        leading=brief_font_size * 1.5, bold=brief_font_weight == "bold",
    )
    small = _style("brief-small", size=9.5, leading=14)
    centered = _style("brief-title", size=16, leading=22, bold=True)
    centered.alignment = 1
    recipient = _style("brief-recipient", size=11, leading=17, bold=True)
    recipient.alignment = 2
    story: list[object] = [
        Table([[
            Spacer(1, 66),
            Paragraph(f'“Yuksalish” harakati raisi<br/>{_text(chair)}ga', recipient),
        ]], colWidths=[235, 243], style=TableStyle([
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("LEFTPADDING", (0, 0), (-1, -1), 0),
            ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ])),
        Spacer(1, 18),
        Paragraph("BILDIRGI", centered),
        Spacer(1, 14),
    ]
    # The authored brief is the official wording. A legacy purpose field may be
    # Russian; transliteration is not a translation and must not precede it.
    if include_fact_lines and purpose.strip() and not brief_text.strip():
        story.append(Paragraph(f"Safar maqsadi: {_text(purpose)}", regular))
    if brief_text.strip():
        for paragraph in brief_text.strip().splitlines():
            if paragraph.strip():
                story.append(Paragraph(_text(paragraph), brief_body))
    else:
        story.append(Paragraph(
            f"{start:%d.%m.%Y} - {end:%d.%m.%Y} kunlari "
            f"{escape(trip_destination_text(destination))}ga "
            "xizmat safariga yuborishga ruxsat berishingizni soʻrayman.", brief_body,  # noqa: RUF001
        ))
    if employees:
        story.append(Paragraph(
            "Safar ishtirokchilari: " + "; ".join(_text(name) for name in employees), regular,
        ))
    if include_fact_lines and expense_source.strip():
        story.append(Paragraph(f"Xarajatlar manbai: {_text(expense_source)}", regular))
    if attachment_name:
        story.append(Paragraph(
            f"Ilova: {_text(attachment_name)}. Asl fayl alohida saqlanadi.", small
        ))
    story.append(Spacer(1, 28))
    story.append(Paragraph(f"{signed_on:%d.%m.%Y} y. &nbsp;&nbsp; {_text(requester)}", regular))
    if signature is not None:
        story.append(_signature_image(signature))
    return _build(story)


def order_pdf(
    *, order_number: str | None, issued: date, purpose: str, destination: str,
    start: date, end: date, employees: list[tuple[str, str]],
    expense_source: str, requester: str, chair: str, signature: bytes | None,
) -> bytes:
    """Issue an Uzbek-Latin order with a separate Workspace registration number."""
    # Purpose remains in the request and authoritative brief, not a duplicate
    # paragraph transliterated from a legacy Russian field into pseudo-Uzbek.
    del purpose
    number = (order_number or "").strip()
    unregistered = not number or re.fullmatch(r"0+-WS", number, re.IGNORECASE) is not None
    if unregistered and signature is not None:
        raise ValueError("Нельзя подписать приказ без зарегистрированного номера")
    registration = (
        "Raqam tasdiqlangandan so'ng beriladi" if unregistered else f"{_text(number)}-son a/f"
    )
    place = escape(trip_destination_text(destination))
    _fonts()
    body = _style("order-body", size=11, leading=18)
    bold = _style("order-bold", size=11, leading=18, bold=True)
    centered = _style("order-centered", size=13, leading=19, bold=True)
    centered.alignment = 1
    right = _style("order-right", size=11, leading=18)
    right.alignment = 2
    month = _MONTHS[issued.month - 1]
    period = (
        f"{start.year}-yil {start.day} {_MONTHS[start.month - 1]} kuni" if start == end
        else f"{start.year}-yil {start.day}-{end.day} {_MONTHS[start.month - 1]} kunlari"
        if start.month == end.month and start.year == end.year
        else f"{start:%d.%m.%Y} - {end:%d.%m.%Y} kunlari"
    )
    date_line = Table([[
        Paragraph(f"{issued.year}-yil “{issued.day}” {month}", body),
        Paragraph("Toshkent shahri", right),
    ]], colWidths=[239, 239])
    date_line.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
    ]))
    story: list[object] = [
        Paragraph("BUYRUQ", centered),
        Paragraph(registration, centered),
        Spacer(1, 12), date_line, Spacer(1, 8),
        Paragraph("“Xizmat safariga yuborish toʻgʻrisida”", bold),  # noqa: RUF001
        Spacer(1, 8),
    ]
    story.extend([Spacer(1, 8), Paragraph("B U Y U R A M A N :", centered), Spacer(1, 6)])
    if len(employees) == 1:
        name, job_title = employees[0]
        person = f"{_text(job_title)} {_text(name)}" if job_title else _text(name)
        story.append(Paragraph(
            f"1. Harakatning {person} {period} "
            f"{place}ga xizmat safariga yuborilsin.", body,
        ))
    else:
        story.append(Paragraph(
            f"1. Harakatning quyidagi xodimlari {period} "
            f"{place}ga xizmat safariga yuborilsin:", body,
        ))
        for index, (name, job_title) in enumerate(employees, start=1):
            suffix = f" — {_text(job_title)}" if job_title else ""
            story.append(Paragraph(f"{index}) {_text(name)}{suffix};", body))
    if expense_source.strip():
        story.append(Paragraph(
            "2. Xizmat safari bilan bogʻliq xarajatlar "  # noqa: RUF001
            f"{_text(expense_source)} hisobidan qoplanishi maʼlumot uchun qabul qilinsin.",  # noqa: RUF001
            body,
        ))
    signature_cell: object = _signature_image(signature) if signature is not None else Spacer(1, 55)
    signature_row = Table([[
        Paragraph("Rais", bold), signature_cell, Paragraph(_text(chair), right),
    ]], colWidths=[150, 150, 178], minRowHeights=[55])
    signature_row.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
    ]))
    # A continuation page must contain a substantive clause, not only a signature.
    story.append(KeepTogether([
        story.pop(), Spacer(1, 12), Paragraph(f"Asos: {_text(requester)}ning bildirgisi.", body),
        Spacer(1, 24), signature_row,
    ]))
    return _build(story, draft=signature is None)
