"""Fill the owner's original contract and order forms without replacing their boilerplate."""

from __future__ import annotations

from html import escape
from io import BytesIO
from pathlib import Path
from threading import Lock

from pypdf import PdfReader, PdfWriter
from reportlab.lib.pagesizes import A4  # type: ignore[import-untyped]
from reportlab.lib.styles import ParagraphStyle  # type: ignore[import-untyped]
from reportlab.pdfbase import pdfmetrics  # type: ignore[import-untyped]
from reportlab.pdfbase.ttfonts import TTFont  # type: ignore[import-untyped]
from reportlab.pdfgen.canvas import Canvas  # type: ignore[import-untyped]
from reportlab.platypus import Paragraph  # type: ignore[import-untyped]

from .hr_hiring_schemas import HiringFields, SignatureBox

_ASSETS = Path(__file__).parent / "hr_assets"
_FONT_LOCK = Lock()
_MONTHS = (
    ("январь", "январдан", "январда"),
    ("февраль", "февралдан", "февралда"),
    ("март", "мартдан", "мартда"),
    ("апрель", "апрелдан", "апрелда"),
    ("май", "майдан", "майда"),
    ("июнь", "июндан", "июнда"),
    ("июль", "июлдан", "июлда"),
    ("август", "августдан", "августда"),
    ("сентябрь", "сентябрдан", "сентябрда"),
    ("октябрь", "октябрдан", "октябрда"),
    ("ноябрь", "ноябрдан", "ноябрда"),
    ("декабрь", "декабрдан", "декабрда"),
)
_NUMBERS = ("", "бир", "икки", "уч", "тўрт", "беш", "олти")
_MONTHS_LATIN = (
    ("yanvar", "yanvardan", "yanvarda"),
    ("fevral", "fevraldan", "fevralda"),
    ("mart", "martdan", "martda"),
    ("aprel", "apreldan", "aprelda"),
    ("may", "maydan", "mayda"),
    ("iyun", "iyundan", "iyunda"),
    ("iyul", "iyuldan", "iyulda"),
    ("avgust", "avgustdan", "avgustda"),
    ("sentabr", "sentabrdan", "sentabrda"),
    ("oktabr", "oktabrdan", "oktabrda"),
    ("noyabr", "noyabrdan", "noyabrda"),
    ("dekabr", "dekabrdan", "dekabrda"),
)
_NUMBERS_LATIN = ("", "bir", "ikki", "uch", "toʻrt", "besh", "olti")  # noqa: RUF001
_CYRILLIC_TO_LATIN = {
    "а": "a", "б": "b", "в": "v", "г": "g", "д": "d", "е": "e", "ё": "yo", "ж": "j",  # noqa: RUF001
    "з": "z", "и": "i", "й": "y", "к": "k", "л": "l", "м": "m", "н": "n", "о": "o",  # noqa: RUF001
    "п": "p", "р": "r", "с": "s", "т": "t", "у": "u", "ф": "f", "х": "x", "ц": "ts",  # noqa: RUF001
    "ч": "ch", "ш": "sh", "щ": "shch", "ъ": "ʼ", "ы": "i", "ь": "", "э": "e",  # noqa: RUF001
    "ю": "yu", "я": "ya", "ў": "oʻ", "қ": "q", "ғ": "gʻ", "ҳ": "h",  # noqa: RUF001
}
_CYRILLIC_TO_LATIN.update({letter.upper(): latin.capitalize() for letter, latin in
                           tuple(_CYRILLIC_TO_LATIN.items())})
_LATIN_TRANSLATION = str.maketrans(_CYRILLIC_TO_LATIN)


def _latin(value: str) -> str:
    """Keep already-Latin ID names while converting legacy Cyrillic HR fields."""
    translated = value.translate(_LATIN_TRANSLATION)
    return translated.upper() if value.isupper() else translated


def _fonts() -> None:
    with _FONT_LOCK:
        if "HRForm" not in pdfmetrics.getRegisteredFontNames():
            pdfmetrics.registerFont(TTFont("HRForm", str(_ASSETS / "SourceSerif4-Regular.ttf")))
            pdfmetrics.registerFont(TTFont("HRFormBold", str(_ASSETS / "SourceSerif4-Bold.ttf")))
            pdfmetrics.registerFontFamily("HRForm", normal="HRForm", bold="HRFormBold")


def _line(canvas: Canvas, x: float, top: float, width: float, value: str, label: str) -> None:
    """Put one value above an original blank; never silently clip a signed field."""
    value = " ".join(value.split())
    size = 10.5
    while size >= 8 and pdfmetrics.stringWidth(value, "HRForm", size) > width:
        size -= 0.25
    if size < 8:
        raise ValueError(f"Поле «{label}» не помещается в бланк; сократите значение")
    canvas.setFont("HRForm", size)
    canvas.drawString(x, A4[1] - top - size, value)


def _paragraph(canvas: Canvas, text: str, top: float, *, bold_name: str = "") -> float:
    if bold_name:
        prefix, suffix = text.split(bold_name, 1)
        markup = f"{escape(prefix)}<b>{escape(bold_name)}</b>{escape(suffix)}"
    else:
        markup = escape(text)
    style = ParagraphStyle("original-order", fontName="HRForm", fontSize=11.3, leading=18.4)
    paragraph = Paragraph(markup, style)
    _, height = paragraph.wrap(483, 250)
    paragraph.drawOn(canvas, 79.5, A4[1] - top - height)
    return float(height)


def _signer_name(canvas: Canvas, signer: str) -> None:
    style = ParagraphStyle(
        "order-signer", fontName="HRFormBold", fontSize=9.5, leading=11, alignment=2
    )
    paragraph = Paragraph(escape(signer), style)
    _, height = paragraph.wrap(140, 30)
    if height > 23:
        raise ValueError("ФИО руководителя не помещается в приказ")
    paragraph.drawOn(canvas, 397, A4[1] - 512 - height)


def _contract(fields: HiringFields, signer: str, employer: str, address: str, phone: str) -> bytes:
    overlays: list[BytesIO] = []
    for _ in range(2):
        overlays.append(BytesIO())
    first = Canvas(overlays[0], pagesize=A4)
    second = Canvas(overlays[1], pagesize=A4)
    f = fields
    month = _MONTHS[f.document_date.month - 1][0]
    _line(first, 184, 100, 82, f.contract_number, "номер договора")
    _line(
        first,
        385,
        129,
        162,
        f"{f.document_date.year} йил «{f.document_date.day}» {month}",
        "дата договора",
    )
    clause = (
        f"1. {employer} раиси {signer} номидан, кейинги ўринларда "
        "«Иш берувчи» деб аталади ва фуқаро"
    )
    style = ParagraphStyle("original-contract", fontName="HRForm", fontSize=9.8, leading=12.5)
    paragraph = Paragraph(escape(clause), style)
    _, height = paragraph.wrap(470, 28)
    if height > 26:
        raise ValueError("Название работодателя или ФИО руководителя не помещается в бланк")
    paragraph.drawOn(first, 85, A4[1] - 155 - height)
    _line(first, 95, 180, 455, f.full_name, "ФИО сотрудника")
    _line(first, 166, 232, 386, f.full_name, "ФИО сотрудника")
    _line(first, 96, 258, 454, f.department, "подразделение")
    _line(first, 184, 283, 364, f.job_title, "должность")
    _line(
        first,
        177,
        332,
        330,
        "асосий иш бўйича" if f.work_type == "primary" else "ўриндошлик бўйича",
        "вид работы",
    )
    term = (
        "номуайян муддатга" if f.term == "indefinite" else f"муайян муддатга, {f.fixed_term_reason}"
    )
    _line(first, 216, 357, 328, term, "срок договора")
    _line(first, 295, 385, 249, f.start_date.strftime("%d.%m.%Y"), "дата начала")
    if f.end_date:
        _line(first, 175, 400, 366, f.end_date.strftime("%d.%m.%Y"), "дата окончания")
    probation = (
        "синовсиз"
        if not f.probation_months
        else f"{_NUMBERS[f.probation_months]} ойлик синов муддати"
    )
    _line(first, 205, 426, 335, probation, "испытательный срок")
    first.save()

    _line(second, 196, 188, 346, f.work_regime, "режим рабочего времени")
    _line(second, 180, 211, 20, str(f.days_per_week), "дней в неделю")
    _line(second, 90, 223, 29, str(f.hours_per_week), "часов в неделю")
    _line(second, 120, 263, 418, f.salary_terms, "оплата труда")
    if f.allowances:
        _line(second, 103, 311, 209, f.allowances, "доплаты")
    _line(second, 324, 450, 48, str(f.annual_leave), "основной отпуск")
    if f.additional_leave:
        _line(second, 271, 466, 65, str(f.additional_leave), "дополнительный отпуск")
    _line(second, 96, 599, 208, f.full_name, "ФИО сотрудника")
    _line(second, 96, 630, 207, f.passport, "паспорт или ID-карта")
    _line(second, 96, 673, 208, f.phone, "телефон сотрудника")
    _line(second, 96, 704, 208, f.address, "адрес сотрудника")
    _line(second, 96, 745, 208, f.pinfl, "ЖШШИР")
    _line(second, 333, 596, 207, signer, "ФИО работодателя")
    _line(second, 332, 664, 205, phone, "телефон работодателя")
    _line(second, 332, 709, 205, address, "адрес работодателя")
    second.save()
    return _merge(
        "contract-original-blank.pdf",
        overlays,
        SignatureBox(page=2, x=0.60, y=0.88, width=0.28, height=0.055),
    )


def _order(fields: HiringFields, signer: str) -> bytes:
    f = fields
    if not f.accountant_dative.strip():
        raise ValueError("Для приказа укажите начальника бухгалтерии в дательном падеже")
    if f.additional_terms.strip():
        raise ValueError("В оригинальном бланке нет места для дополнительных условий")  # noqa: RUF001
    output = BytesIO()
    canvas = Canvas(output, pagesize=A4)
    canvas.setFont("HRFormBold", 14)
    canvas.drawCentredString(A4[0] / 2, 691.5, "BUYRUQ")
    canvas.setFont("HRForm", 13)
    canvas.drawString(433.5, 641, "Toshkent shahri")
    canvas.setFont("HRFormBold", 13)
    canvas.drawString(79.5, 604.2, "“Ishga qabul qilish toʻgʻrisida”")  # noqa: RUF001
    canvas.drawString(100.8, 313.2, "Rais")
    month = _MONTHS_LATIN[f.document_date.month - 1]
    start_month = _MONTHS_LATIN[f.start_date.month - 1]
    full_name = _latin(f.full_name)
    _line(canvas, 286, 160, 73, f"{_latin(f.order_number)}-son sh/t", "номер приказа")
    _line(
        canvas,
        79.5,
        185,
        232,
        f"{f.document_date.year} yil “{f.document_date.day}” {month[0]}",
        "дата приказа",
    )
    probation = (
        f"{_NUMBERS_LATIN[f.probation_months]} oylik dastlabki sinov muddati bilan "
        if f.probation_months
        else ""
    )
    start_date = f"{f.start_date.year} yil {f.start_date.day} {start_month[1]}"
    first = (
        f"1. {full_name} {start_date} {_latin(f.department)}ning {_latin(f.job_title)} "
        f"lavozimiga {probation}ishga qabul qilinsin."
    )
    second = (
        f"2. Buxgalteriya boʻlimi boshligʻi {_latin(f.accountant_dative)} xodimga shtat "  # noqa: RUF001
        "jadvaliga muvofiq lavozim maoshini belgilash hamda mehnatga haq toʻlashni "  # noqa: RUF001
        "belgilangan tartibda amalga oshirish vazifasi yuklatilsin."
    )
    short_name = (
        f"{full_name.split()[1][0]}. {full_name.split()[0]}"
        if len(full_name.split()) > 1
        else full_name
    )
    basis_date = f"{f.document_date.year} yil {f.document_date.day} {month[2]}"
    basis = (
        f"Asos: {short_name} bilan {basis_date} tuzilgan {_latin(f.contract_number)}-sonli "
        "mehnat shartnomasi, Oʻzbekiston Respublikasi Mehnat kodeksining 127, 129 va "  # noqa: RUF001
        "130-moddalari."
    )
    top = 262.5
    top = max(323.7, top + _paragraph(canvas, first, top, bold_name=full_name) + 4)
    top = max(391.3, top + _paragraph(canvas, second, top) + 12)
    top += _paragraph(canvas, basis, top)
    if top > 487:
        raise ValueError("Текст приказа не помещается на оригинальном бланке; сократите поля")
    _signer_name(canvas, _latin(signer))
    canvas.save()
    return _merge(
        "order-latin-blank.pdf",
        [output],
        SignatureBox(page=1, x=0.36, y=0.58, width=0.29, height=0.075),
    )


def _merge(background_name: str, overlays: list[BytesIO], box: SignatureBox) -> bytes:
    background = PdfReader(_ASSETS / background_name)
    if len(background.pages) != len(overlays):
        raise ValueError("Шаблон документа повреждён")
    writer = PdfWriter()
    for source, overlay in zip(background.pages, overlays, strict=True):
        page = writer.add_page(source)
        page.merge_page(PdfReader(BytesIO(overlay.getvalue())).pages[0])
    writer.add_metadata({"/HRSignatureBox": box.model_dump_json()})
    result = BytesIO()
    writer.write(result)
    return result.getvalue()


def documents(
    fields: HiringFields,
    signer: str,
    signature: bytes | None = None,
    *,
    employer: str = "“Юксалиш” ҳаракати – халқаро нодавлат нотижорат ташкилоти",  # noqa: RUF001
    employer_address: str = "Тошкент ш. Шайхонтохур тумани Фурқат кўчаси, 1",
    employer_phone: str = "+998 95 230 33 23",
) -> dict[str, bytes]:
    _fonts()
    packet = {
        "contract": _contract(fields, signer, employer, employer_address, employer_phone),
        "order": _order(fields, signer),
    }
    if signature:
        from .hr_hiring_pdf import sign_generated

        return {name: sign_generated(content, signature) for name, content in packet.items()}
    return packet
