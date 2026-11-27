"""Change only the registration lines of a Workspace-generated order copy."""

from datetime import date
from io import BytesIO

from pypdf import PdfReader, PdfWriter
from pypdf.generic import DictionaryObject
from reportlab.pdfbase import pdfmetrics  # type: ignore[import-untyped]
from reportlab.pdfgen.canvas import Canvas  # type: ignore[import-untyped]

from .trip_order_pdf import _fonts

_LATIN_MONTHS = (
    "yanvar", "fevral", "mart", "aprel", "may", "iyun", "iyul", "avgust", "sentabr",
    "oktabr", "noyabr", "dekabr",
)
_CYRILLIC_MONTHS = (
    "январь", "февраль", "март", "апрель", "май", "июнь", "июль", "август", "сентябрь",
    "октябрь", "ноябрь", "декабрь",
)
_SHOW = {b"Tj", b"TJ", b"'", b'"'}


def order_details_pdf(
    content: bytes, *, old_number: str, old_series: str, old_date: date,
    number: str, series: str, issued: date,
) -> bytes:
    """Retain the body and actual signature image; never use a stored user signature."""
    reader = PdfReader(BytesIO(content))
    if any(field.get("/FT") == "/Sig" for field in (reader.get_fields() or {}).values()):
        raise ValueError("Электронно подписанный PDF требует полного переоформления")
    writer = PdfWriter(clone_from=reader)
    page = writer.pages[0]
    stream = page.get_contents()
    if stream is None:
        raise ValueError("Приказ не содержит текста реквизитов")
    # These orders contain images, not nested form programs. Refuse an unknown
    # layout instead of applying operation indexes from another content stream.
    resources = page.get("/Resources", {}).get("/XObject", {})
    if any(item.get_object().get("/Subtype") == "/Form" for item in resources.values()):
        raise ValueError("Для этого формата приказа требуется полное переоформление")
    registration_lines = {
        f"{old_number}-son {old_series or 'a/f'}": False,
        f"{old_number}-сон {old_series}": True,
    }
    date_lines = {
        f"{old_date.year}-yil “{old_date.day}” {_LATIN_MONTHS[old_date.month - 1]}": False,
        f"{old_date.year} йил «{old_date.day}» {_CYRILLIC_MONTHS[old_date.month - 1]}": True,
    }
    index = -1
    showing: list[int] = []
    removed: set[int] = set()
    replacements: list[tuple[str, float, float, float, bool]] = []

    def before(
        operator: bytes, operands: list[object], cm: list[float], tm: list[float],
    ) -> None:
        nonlocal index
        del operands, cm, tm
        index += 1
        if operator == b"BT":
            showing.clear()
        if operator in _SHOW:
            showing.append(index)

    def text(
        value: str, cm: list[float], tm: list[float],
        font: DictionaryObject | None, size: float,
    ) -> None:
        del font
        line = value.strip()
        if not line:
            return
        x = tm[4] * cm[0] + tm[5] * cm[2] + cm[4]
        y = tm[4] * cm[1] + tm[5] * cm[3] + cm[5]
        # Both supported templates put these two lines below the letterhead.
        if 580 < y < 710 and line in registration_lines:
            cyrillic = registration_lines[line]
            replacement = f"{number}-сон {series}" if cyrillic else f"{number}-son {series}"
            replacements.append((replacement, float(page.mediabox.width) / 2, y, size, True))
            removed.update(showing)
        elif 580 < y < 660 and line in date_lines:
            cyrillic = date_lines[line]
            replacement = (
                f"{issued.year} йил «{issued.day}» {_CYRILLIC_MONTHS[issued.month - 1]}"
                if cyrillic else
                f"{issued.year}-yil “{issued.day}” {_LATIN_MONTHS[issued.month - 1]}"
            )
            replacements.append((replacement, x, y, size, False))
            removed.update(showing)
        showing.clear()

    page.extract_text(visitor_operand_before=before, visitor_text=text)
    if len(replacements) != 2 or sum(item[4] for item in replacements) != 1 \
            or index + 1 != len(stream.operations):
        raise ValueError("Реквизиты приказа не распознаны; используйте полное переоформление")
    # Remove the original text rather than hiding it beneath a white rectangle.
    stream.operations = [
        op for position, op in enumerate(stream.operations) if position not in removed
    ]
    page.replace_contents(stream)
    _fonts()
    overlay = BytesIO()
    canvas = Canvas(overlay, pagesize=(float(page.mediabox.width), float(page.mediabox.height)))
    canvas.setFillColorRGB(23 / 255, 34 / 255, 54 / 255)
    for value, x, y, size, centered in replacements:
        font_name = "TripSerifBold" if centered else "TripSerif"
        width = pdfmetrics.stringWidth(value, font_name, size)
        available = float(page.mediabox.width) - 116
        fitted_size = min(size, size * available / max(width, 1))
        if fitted_size < 10:
            raise ValueError("Номер или серия приказа слишком длинные")
        canvas.setFont(font_name, fitted_size)
        if centered:
            canvas.drawCentredString(x, y, value)
        else:
            canvas.drawString(x, y, value)
    canvas.save()
    page.merge_page(PdfReader(BytesIO(overlay.getvalue())).pages[0])
    output = BytesIO()
    writer.write(output)
    return output.getvalue()
