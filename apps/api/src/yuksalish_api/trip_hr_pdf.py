"""Cyrillic trip documents composed from the immutable chairman decision snapshot."""

from datetime import date
from html import escape
from io import BytesIO
from typing import Literal

from pydantic import BaseModel
from pypdf import PdfReader, PdfWriter
from reportlab.platypus import (  # type: ignore[import-untyped]
    KeepTogether,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
)

from .trip_cyrillic import uzbek_cyrillic
from .trip_document_text import trip_destination_phrase
from .trip_order_pdf import _build, _fonts, _signature_image, _style


class TripDocumentSnapshot(BaseModel):
    requester: str
    requester_title: str
    chair: str
    brief_text: str
    purpose: str
    destination: str
    start: date
    end: date
    employees: list[tuple[str, str]]
    expense_source: str
    brief_font_size: int = 11
    brief_font_weight: Literal["regular", "bold"] = "regular"
    source_brief_key: str | None = None
    source_brief_sha256: str | None = None
    original_name: str | None = None
    signature_key: str | None = None
    signature_sha256: str | None = None


def _text(value: str) -> str:
    return escape(uzbek_cyrillic(value))


def hr_brief_pdf(
    facts: TripDocumentSnapshot, signature: bytes | None = None,
    original_pdf: bytes | None = None,
) -> bytes:
    _fonts()
    body = _style("hr-brief-body", size=facts.brief_font_size,
                  leading=facts.brief_font_size * 1.5, bold=facts.brief_font_weight == "bold")
    right = _style("hr-brief-recipient", size=11, leading=17)
    right.alignment = 2
    title = _style("hr-brief-title", size=16, leading=23, bold=True)
    title.alignment = 1
    resolution = _style("hr-brief-resolution", size=14, leading=20, bold=True)
    left: list[object] = [Spacer(1, 65)] if signature is None else [
        Paragraph("Буйруқ учун", resolution), Spacer(1, 8), _signature_image(signature),
    ]
    recipient: list[object] = [
        Paragraph(f'«Юксалиш» ҳаракати раиси<br/><b>{_text(facts.chair)}\u0433\u0430</b>', right),
        Spacer(1, 9),
        Paragraph(f'{_text(facts.requester_title)}<br/><b>{_text(facts.requester)}дан</b>', right),
    ]
    header = Table([[left, recipient]], colWidths=[200, 278], style=TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
    ]))
    story: list[object] = [header, Spacer(1, 24), Paragraph("Билдирги", title), Spacer(1, 16)]
    authored = facts.brief_text.strip()
    if authored:
        story.extend(Paragraph(_text(line), body) for line in authored.splitlines() if line.strip())
    else:
        story.append(Paragraph(
            f"{facts.start:%d.%m.%Y} - {facts.end:%d.%m.%Y} кунлари "
            f"{_text(trip_destination_phrase(facts.destination))} хизмат сафарига "
            "юборишингизни сўрайман.", body,
        ))
        if facts.purpose:
            story.append(Paragraph(f"Хизмат сафарининг мақсади: {_text(facts.purpose)}", body))
    if facts.employees:
        story.append(Paragraph(
            "Сафар иштирокчилари: "
            + "; ".join(_text(name) for name, _ in facts.employees), body,
        ))
    if facts.original_name:
        story.append(Paragraph(f"Илова: {escape(facts.original_name)}", body))
    # A signed source stays intact; its PDF/image pages follow the resolution cover.
    content = _build(story, title="Yuksalish - Билдирги")
    if original_pdf is None:
        return content
    writer = PdfWriter()
    for document in (content, original_pdf):
        for page in PdfReader(BytesIO(document)).pages:
            writer.add_page(page)
    output = BytesIO()
    writer.write(output)
    return output.getvalue()


def hr_order_pdf(
    facts: TripDocumentSnapshot, *, number: str, series: str, purpose: str,
    issued: date, signature: bytes,
) -> bytes:
    if not number.strip() or not series.strip():
        raise ValueError("Укажите номер и серию приказа")
    _fonts()
    body = _style("hr-order-body", leading=18)
    bold = _style("hr-order-bold", leading=18, bold=True)
    centered = _style("hr-order-title", size=14, leading=21, bold=True)
    centered.alignment = 1
    right = _style("hr-order-right")
    right.alignment = 2
    months = ("январь", "февраль", "март", "апрель", "май", "июнь", "июль",
              "август", "сентябрь", "октябрь", "ноябрь", "декабрь")
    story: list[object] = [
        Paragraph("БУЙРУҚ", centered),
        Paragraph(f"{escape(number)}-сон {escape(series)}", centered), Spacer(1, 12),
        Paragraph(f'{issued.year} йил «{issued.day}» {months[issued.month - 1]}', body),
        Paragraph("«Хизмат сафарига юбориш тўғрисида»", bold), Spacer(1, 8),
        Paragraph("БУЮРАМАН:", centered),
    ]
    for index, (name, position) in enumerate(facts.employees, 1):
        story.append(Paragraph(
            f"{index}. {_text(position)} {_text(name)} {facts.start:%d.%m.%Y} - "
            f"{facts.end:%d.%m.%Y} кунлари {_text(trip_destination_phrase(facts.destination))} "
            "хизмат сафарига юборилсин.", body,
        ))
    if purpose.strip():
        story.append(Paragraph(f"Хизмат сафарининг мақсади: {_text(purpose)}", body))
    if facts.expense_source:
        story.append(Paragraph(
            f"Хизмат сафари харажатлари {_text(facts.expense_source)} ҳисобидан қоплансин.", body,
        ))
    signature_row = Table([[
        Paragraph("Раис", bold), _signature_image(signature), Paragraph(_text(facts.chair), right),
    ]], colWidths=[120, 150, 208], style=TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
    ]))
    story.append(KeepTogether([
        Paragraph(
            f"\u0410\u0441\u043e\u0441: {_text(facts.requester)}нинг билдиргиси "
            "ва раис резолюцияси.",
            body,
        ),
        Spacer(1, 22), signature_row,
    ]))
    return _build(story, title="Yuksalish - Буйруқ")
