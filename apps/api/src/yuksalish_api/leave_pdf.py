"""One-page Cyrillic leave application and order based on the owner's examples."""

# Cyrillic legal-document text intentionally contains glyphs resembling Latin letters.
# ruff: noqa: RUF001

from __future__ import annotations

from datetime import date, datetime
from html import escape
from io import BytesIO
from pathlib import Path

from reportlab.lib import colors  # type: ignore[import-untyped]
from reportlab.lib.pagesizes import A4  # type: ignore[import-untyped]
from reportlab.lib.styles import ParagraphStyle  # type: ignore[import-untyped]
from reportlab.pdfgen.canvas import Canvas  # type: ignore[import-untyped]
from reportlab.platypus import (  # type: ignore[import-untyped]
    KeepTogether,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

from .trip_order_pdf import _fonts, _signature_image

_LOGO = Path(__file__).parent / "trip_assets" / "yuksalish-logo-color.png"
_MONTHS = (
    "январь",
    "февраль",
    "март",
    "апрель",
    "май",
    "июнь",
    "июль",
    "август",
    "сентябрь",
    "октябрь",
    "ноябрь",
    "декабрь",
)


def _text(value: str) -> str:
    return escape(" ".join(value.split()))


def _date(value: date, suffix: str = "") -> str:
    month = _MONTHS[value.month - 1]
    if suffix:
        month = month.removesuffix("ь")
    return f"{value.year} йил {value.day} {month}{suffix}"


def _style(
    name: str,
    *,
    size: float = 11,
    leading: float = 18,
    bold: bool = False,
    align: int = 0,
) -> ParagraphStyle:
    return ParagraphStyle(
        name,
        fontName="TripSerifBold" if bold else "TripSerif",
        fontSize=size,
        leading=leading,
        alignment=align,
        textColor=colors.HexColor("#172236"),
        spaceAfter=12,
    )


def _order_page(canvas: Canvas, document: object) -> None:
    del document
    canvas.saveState()
    canvas.setFillColor(colors.HexColor("#293A55"))
    canvas.setFont("TripSerifBold", 10)
    canvas.drawString(54, 760, "HARAKAT")
    canvas.drawRightString(A4[0] - 54, 760, "MOVEMENT")
    canvas.drawImage(
        str(_LOGO),
        A4[0] / 2 - 96,
        739,
        width=192,
        height=52,
        preserveAspectRatio=True,
        anchor="c",
        mask="auto",
    )
    canvas.setStrokeColor(colors.HexColor("#293A55"))
    canvas.setLineWidth(0.7)
    canvas.line(54, 731, A4[0] - 54, 731)
    canvas.line(54, 728, A4[0] - 54, 728)
    canvas.setFillColor(colors.HexColor("#0091A8"))
    path = canvas.beginPath()
    path.moveTo(155, 13)
    path.curveTo(285, 35, 445, 21, 525, 27)
    path.curveTo(559, 27, 566, 44, 557, 64)
    path.curveTo(578, 45, 582, 26, 566, 18)
    path.curveTo(520, -3, 290, 7, 155, 13)
    path.close()
    canvas.drawPath(path, fill=1, stroke=0)
    canvas.restoreState()


def _application_page(canvas: Canvas, document: object) -> None:
    del document
    canvas.saveState()
    canvas.setFillColor(colors.HexColor("#64748B"))
    canvas.setFont("TripSerif", 8)
    canvas.drawString(58, 35, "Workspace орқали юборилган ариза")
    canvas.restoreState()


def _build(story: list[object], title: str, *, order: bool, draft: bool = False) -> bytes:
    _fonts()
    output = BytesIO()
    document = SimpleDocTemplate(
        output,
        pagesize=A4,
        leftMargin=65,
        rightMargin=65,
        topMargin=145 if order else 82,
        bottomMargin=74,
        title=title,
    )
    def page(canvas: Canvas, document: object) -> None:
        (_order_page if order else _application_page)(canvas, document)
        if draft:
            canvas.saveState()
            canvas.setFont("TripSerifBold", 9)
            canvas.drawString(65, 50, "ЛОЙИҲА — ИМЗОЛАНМАГАН")
            canvas.restoreState()
    document.build(story, onFirstPage=page, onLaterPages=page)
    return output.getvalue()


def application_pdf(
    *,
    employee_name: str,
    employee_job_title: str,
    deputy_name: str,
    application_text: str,
    requested_start: date,
    requested_end: date | None,
    submitted_at: datetime,
    edited_by_hr: str | None = None,
    edited_at: datetime | None = None,
) -> bytes:
    """Typeset the employee's words, with account submission instead of a drawn signature."""
    _fonts()
    body = _style("leave-application-body", size=12, leading=23, align=4)
    right = _style("leave-application-address", size=11, leading=18, align=2)
    title = _style("leave-application-title", size=15, leading=24, bold=True, align=1)
    lines = [part.strip() for part in application_text.splitlines() if part.strip()]
    story: list[object] = [
        Table(
            [
                [
                    Spacer(1, 90),
                    Paragraph(
                        "«Юксалиш» ҳаракати раисининг биринчи ўринбосари — "
                        f"ижрочи директор {_text(deputy_name)}га<br/>"
                        f"«Юксалиш» ҳаракати {_text(employee_job_title)} "
                        f"{_text(employee_name)}дан",
                        right,
                    ),
                ]
            ],
            colWidths=[170, 295],
            style=TableStyle(
                [
                    ("VALIGN", (0, 0), (-1, -1), "TOP"),
                    ("LEFTPADDING", (0, 0), (-1, -1), 0),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                ]
            ),
        ),
        Spacer(1, 40),
        Paragraph("АРИЗА", title),
        Spacer(1, 17),
    ]
    for line in lines:
        story.append(Paragraph(_text(line), body))
    if not lines:
        story.append(
            Paragraph(
                f"Менга {_date(requested_start, 'дан')} меҳнат таътилига чиқишга "
                "рухсат беришингизни сўрайман.",
                body,
            )
        )
    story.extend(
        [
            Paragraph(
                f"Сўралган муддат: {_date(requested_start, 'дан')} "
                + (f"{_date(requested_end, 'гача')}." if requested_end else "бошлаб."),
                body,
            ),
            Spacer(1, 34),
            Paragraph(
                f"{submitted_at:%d.%m.%Y} й. &nbsp;&nbsp;&nbsp;&nbsp; {_text(employee_name)}",
                body,
            ),
        ]
    )
    if edited_by_hr and edited_at:
        story.extend([
            Spacer(1, 12),
            Paragraph(
                f"Кадрлар хизмати томонидан {_text(edited_by_hr)} "
                f"{edited_at:%d.%m.%Y} куни таҳрир қилинган электрон нусха.", body,
            ),
        ])
    return _build(story, "Меҳнат таътили аризаси", order=False)


def order_pdf(
    *,
    number: str,
    issued_on: date,
    employee_name: str,
    job_title: str,
    work_year_start: date,
    work_year_end: date,
    starts_on: date,
    ends_on: date,
    calendar_days: int,
    paid_days: int,
    return_on: date,
    accounting_officer: str | None,
    signer_name: str,
    signature: bytes | None,
    tenure_additional_days: int = 0,
    order_clause_1: str | None = None,
    order_clause_2: str | None = None,
    order_clause_3: str | None = None,
) -> bytes:
    """Generate an A4 order with the supplied sample's hierarchy and three clauses."""
    _fonts()
    body = _style("leave-order-body", size=11.4, leading=19, align=4)
    centered = _style("leave-order-centered", size=13, leading=20, bold=True, align=1)
    bold = _style("leave-order-bold", size=11.4, leading=19, bold=True)
    right = _style("leave-order-right", size=11.4, leading=19, align=2)
    date_row = Table(
        [
            [
                Paragraph(
                    f"{issued_on.year} йил “{issued_on.day}” {_MONTHS[issued_on.month - 1]}", body
                ),
                Paragraph("Тошкент шаҳри", right),
            ]
        ],
        colWidths=[232, 233],
        style=TableStyle(
            [
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 0),
                ("RIGHTPADDING", (0, 0), (-1, -1), 0),
            ]
        ),
    )
    accounting = (
        f"Бухгалтерия бўлими бошлиғи {_text(accounting_officer)} "
        if accounting_officer
        else "Бухгалтерия бўлими "
    )
    story: list[object] = [
        Paragraph("БУЙРУҚ", centered),
        Paragraph(f"{_text(number)}-сон а/ф", centered),
        Spacer(1, 8),
        date_row,
        Spacer(1, 12),
        Paragraph("“Меҳнат таътили бериш тўғрисида”", bold),
        Spacer(1, 14),
        Paragraph(
            "1. " + _text(order_clause_1)
            + (f" Ташкилотдаги иш стажи учун қўшимча {tenure_additional_days} кун."
               if tenure_additional_days else "") if order_clause_1 else
            f"1. {_text(job_title)} {_text(employee_name)}га "
            f"{work_year_start:%d.%m.%Y}–{work_year_end:%d.%m.%Y} йиллар иш даври "
            f"учун {calendar_days} календарь кундан иборат меҳнат таътили "
            + (f"(шу жумладан ташкилотдаги иш стажи учун {tenure_additional_days} кун) "
               if tenure_additional_days else "")
            + f"{_date(starts_on, 'дан')} {_date(ends_on, 'гача')} берилсин.", body,
        ),
        Paragraph("2. " + _text(order_clause_2) if order_clause_2 else
                  f"2. Ишга чиқиш санаси – {_date(return_on)} куни этиб белгилансин.", body),
        Paragraph("3. " + _text(order_clause_3) if order_clause_3 else
                  f"3. {accounting}{_text(employee_name)}га меҳнат таътили берилиши "
                  f"муносабати билан тегишли тартибда {paid_days} кунга "
                  "ҳисоб-китобларни амалга оширсин.", body),
        Spacer(1, 9),
        Paragraph(
            "Асос: ходимнинг аризаси, Ўзбекистон Республикаси Меҳнат "
            "кодексининг 216, 217-моддалари.",
            body,
        ),
        Spacer(1, 25),
    ]
    signature_row = Table(
        [
            [
                Paragraph("Ижрочи директор", bold),
                _signature_image(signature)
                if signature is not None
                else Spacer(1, 55),
                Paragraph(_text(signer_name), right),
            ]
        ],
        colWidths=[145, 145, 175],
        minRowHeights=[55],
        style=TableStyle(
            [
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("LEFTPADDING", (0, 0), (-1, -1), 0),
                ("RIGHTPADDING", (0, 0), (-1, -1), 0),
            ]
        ),
    )
    # Keep the legal basis with its signature block even for long edited clauses.
    story[-4:] = [KeepTogether([*story[-4:], signature_row])]
    return _build(story, "Меҳнат таътили ҳақида буйруқ", order=True, draft=signature is None)
