"""Trip stationery with an explicit, consistent Uzbek alphabet and justified text."""

from datetime import date
from html import escape

from reportlab.platypus import (  # type: ignore[import-untyped]
    KeepTogether,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
)

from .memo_document_text import DocumentScript, document_parts
from .trip_order_pdf import _build, _fonts, _style


def memo_pdf(
    *,
    chair: str,
    requester: str,
    job_title: str,
    body: str,
    dated: date,
    script: DocumentScript = "cyrillic",
) -> bytes:
    _fonts()
    parts = document_parts(chair, requester, job_title, body, script)
    recipient = _style("memo-recipient", bold=True)
    recipient.alignment = 2
    heading = _style("memo-heading", size=16, leading=22, bold=True)
    heading.alignment = 1
    text = _style("memo-body")
    text.alignment = 4  # reportlab TA_JUSTIFY; the last line remains left aligned.
    text.firstLineIndent = 28
    text.spaceAfter = 7
    applicant = _style("memo-applicant")
    story: list[object] = [
        Table(
            [
                [
                    Spacer(1, 66),
                    Paragraph(
                        escape(parts["recipient_label"]) + "<br/>" + escape(parts["recipient"]),
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
        Paragraph(parts["heading"], heading),
        Spacer(1, 14),
    ]
    for paragraph in parts["body"].replace("\r\n", "\n").split("\n"):
        story.append(Paragraph(escape(paragraph), text) if paragraph.strip() else Spacer(1, 10))
    story.append(
        KeepTogether([
            Spacer(1, 24),
            Paragraph(escape(parts["job_title"]), applicant),
            Paragraph(f"{dated:%d.%m.%Y} &nbsp;&nbsp; {escape(parts['requester'])}", applicant),
        ])
    )
    return _build(story, title="Yuksalish bildirgi")
