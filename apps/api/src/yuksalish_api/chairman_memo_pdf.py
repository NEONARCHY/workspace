"""Same stationery as trip briefs; free text is never rewritten or transliterated."""

from datetime import date
from html import escape

from reportlab.platypus import Paragraph, Spacer, Table, TableStyle  # type: ignore[import-untyped]

from .hr_hiring_templates import latin_person_name
from .trip_order_pdf import _build, _fonts, _style


def memo_pdf(*, chair: str, requester: str, job_title: str, body: str, dated: date) -> bytes:
    _fonts()
    recipient = _style("memo-recipient", bold=True)
    recipient.alignment = 2
    heading = _style("memo-heading", size=16, leading=22, bold=True)
    heading.alignment = 1
    text = _style("memo-body")
    story: list[object] = [
        Table(
            [
                [
                    Spacer(1, 66),
                    Paragraph(
                        f"“Yuksalish” harakati raisi<br/>{escape(latin_person_name(chair))}ga",
                        recipient,
                    ),
                ]
            ],
            colWidths=[235, 243],
            style=TableStyle(
                [
                    ("VALIGN", (0, 0), (-1, -1), "TOP"),
                    ("LEFTPADDING", (0, 0), (-1, -1), 0),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                ]
            ),
        ),
        Spacer(1, 18),
        Paragraph("BILDIRGI", heading),
        Spacer(1, 14),
    ]
    for paragraph in body.replace("\r\n", "\n").split("\n"):
        story.append(Paragraph(escape(paragraph), text) if paragraph.strip() else Spacer(1, 10))
    story.extend(
        [
            Spacer(1, 24),
            Paragraph(escape(job_title), text),
            Paragraph(
                f"{dated:%d.%m.%Y} y. &nbsp;&nbsp; {escape(latin_person_name(requester))}", text
            ),
        ]
    )
    return _build(story, title="Yuksalish bildirgi")
