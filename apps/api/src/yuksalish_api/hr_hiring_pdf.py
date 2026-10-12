"""Deterministic A4 documents; no AI, Word macros or shared-drive dependency."""

import json
import warnings
from io import BytesIO
from pathlib import Path
from threading import Lock
from xml.sax.saxutils import escape

from PIL import Image, ImageOps, UnidentifiedImageError
from pypdf import PdfReader, PdfWriter, apply_configuration
from pypdf.errors import PdfReadError
from pypdf.generic import DictionaryObject
from reportlab.lib.pagesizes import A4  # type: ignore[import-untyped]
from reportlab.lib.styles import ParagraphStyle  # type: ignore[import-untyped]
from reportlab.lib.utils import ImageReader  # type: ignore[import-untyped]
from reportlab.pdfbase import pdfmetrics  # type: ignore[import-untyped]
from reportlab.pdfbase.ttfonts import TTFont  # type: ignore[import-untyped]
from reportlab.pdfgen.canvas import Canvas  # type: ignore[import-untyped]
from reportlab.platypus import (  # type: ignore[import-untyped]
    Flowable,
    KeepTogether,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
)

from .hr_hiring_schemas import HiringFields, SignatureBox

MAX_BYTES = 10 * 1024 * 1024
_FONT_LOCK = Lock()


def fonts() -> None:
    with _FONT_LOCK:
        if "HRSerif" not in pdfmetrics.getRegisteredFontNames():
            root = Path(__file__).parent / "hr_assets"
            pdfmetrics.registerFont(TTFont("HRSerif", str(root / "SourceSerif4-Regular.ttf")))
            pdfmetrics.registerFont(TTFont("HRSerifBold", str(root / "SourceSerif4-Bold.ttf")))


def validate_signature(content: bytes) -> bytes:
    if not content.startswith(b"\x89PNG\r\n\x1a\n") or len(content) > 1024 * 1024:
        raise ValueError("Подпись должна быть PNG, не больше 1 МиБ")
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(BytesIO(content)) as image:
                if not 10 <= image.width <= 2048 or not 10 <= image.height <= 2048:
                    raise ValueError("Размер подписи должен быть от 10 до 2048 пикселей")
                image.load()
                if image.mode != "RGBA" or image.getchannel("A").getextrema()[0] == 255:
                    raise ValueError("У подписи должен быть прозрачный фон")  # noqa: RUF001 - intentional Cyrillic document text
                if image.getchannel("A").getbbox() is None:
                    raise ValueError("Изображение подписи пустое")
                output = BytesIO()
                image.save(output, format="PNG")
                return output.getvalue()
    except (
        UnidentifiedImageError,
        OSError,
        Image.DecompressionBombError,
        Image.DecompressionBombWarning,
    ) as error:
        raise ValueError("Не удалось прочитать подпись") from error  # noqa: RUF001 - intentional Cyrillic document text


def application_pdf(content: bytes) -> tuple[bytes, int]:
    # Context-local limits do not modify the reader settings of other modules or threads.
    with apply_configuration(
        page_tree_maximum_entries=100,
        page_tree_maximum_depth=20,
        maximum_declared_stream_length=MAX_BYTES,
        zlib_maximum_output_length=20_000_000,
        array_based_stream_maximum_output_length=20_000_000,
        image_maximum_buffer_size=60_000_000,
    ):
        return _application_pdf(content)


def _application_pdf(content: bytes) -> tuple[bytes, int]:
    if not content or len(content) > MAX_BYTES:
        raise ValueError("Документ должен быть не больше 10 МиБ")
    if content.startswith(b"%PDF-"):
        try:
            reader = PdfReader(BytesIO(content), strict=True)
            if reader.is_encrypted or not 1 <= len(reader.pages) <= 20:
                raise ValueError("Нужен незашифрованный PDF от 1 до 20 страниц")
            # Only scanned/static applications. Preserve the original separately; never alter EDS.
            root = reader.trailer["/Root"]
            if not isinstance(root, DictionaryObject):
                raise ValueError("Некорректный корень PDF")
            if root.get("/AcroForm") or root.get("/OpenAction") or root.get("/AA"):
                raise ValueError("Загрузите статичный PDF без форм, ЭЦП и активных действий")
            writer = PdfWriter()
            for page in reader.pages:
                if page.get("/Annots") or page.get("/AA"):
                    raise ValueError("Загрузите PDF без интерактивных аннотаций")
                width, height = float(page.mediabox.width), float(page.mediabox.height)
                if not 72 <= width <= 2000 or not 72 <= height <= 2000:
                    raise ValueError("Размер страницы PDF вне допустимых границ")
                copied = writer.add_page(page)
                copied.transfer_rotation_to_content()
            output = BytesIO()
            writer.write(output)
            return output.getvalue(), len(reader.pages)
        except (PdfReadError, KeyError, TypeError, OverflowError) as error:
            raise ValueError("Некорректный PDF") from error
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(BytesIO(content)) as source:
                if (
                    source.format not in {"JPEG", "PNG"}
                    or source.width * source.height > 20_000_000
                ):
                    raise ValueError("Нужен PDF, JPEG или PNG до 20 мегапикселей")
                image = ImageOps.exif_transpose(source).convert("RGB")
                output = BytesIO()
                canvas = Canvas(output, pagesize=A4)
                scale = min((A4[0] - 40) / image.width, (A4[1] - 40) / image.height)
                w, h = image.width * scale, image.height * scale
                canvas.drawImage(
                    ImageReader(image), (A4[0] - w) / 2, (A4[1] - h) / 2, width=w, height=h
                )
                canvas.save()
                return output.getvalue(), 1
    except (
        UnidentifiedImageError,
        OSError,
        Image.DecompressionBombError,
        Image.DecompressionBombWarning,
    ) as error:
        raise ValueError("Не удалось прочитать документ") from error  # noqa: RUF001 - intentional Cyrillic document text


class SigningLine(Flowable):  # type: ignore[misc]
    def __init__(
        self,
        signer: str,
        signature: bytes | None,
        location: list[SignatureBox],
        *,
        employee: bool = False,
    ) -> None:
        super().__init__()
        self.signer, self.signature, self.employee = signer, signature, employee
        self.location = location
        self.width, self.height = 450, 82
        self.name_paragraph = Paragraph(
            escape(signer), ParagraphStyle("hr-signer", fontName="HRSerif", fontSize=11, leading=14)
        )
        _, self.name_height = self.name_paragraph.wrap(225, 400)
        self.height = max(82, self.name_height + 42)

    def draw(self) -> None:
        x, y = self.canv.absolutePosition(230, 24)
        self.location[:] = [
            SignatureBox(
                page=self.canv.getPageNumber(),
                x=x / A4[0],
                y=1 - (y + 55) / A4[1],
                width=140 / A4[0],
                height=55 / A4[1],
            )
        ]
        self.canv.setFont("HRSerif", 11)
        self.canv.drawString(0, self.height - 20, "Иш берувчи" if self.employee else "Раис")
        self.name_paragraph.drawOn(self.canv, 0, self.height - 28 - self.name_height)
        if self.signature:
            self.canv.drawImage(
                ImageReader(BytesIO(self.signature)),
                230,
                24,
                width=140,
                height=55,
                preserveAspectRatio=True,
                anchor="c",
                mask="auto",
            )
        else:
            self.canv.drawString(240, 24, "____________________")
        if self.employee:
            self.canv.drawString(0, 6, "Ходимнинг имзоси: ____________________  Сана: __________")


def documents(
    fields: HiringFields,
    signer: str,
    signature: bytes | None = None,
    *,
    employer: str = "“Юксалиш” ҳаракати – халқаро нодавлат нотижорат ташкилоти",  # noqa: RUF001 - intentional Cyrillic document text
    employer_address: str = "Тошкент ш. Шайхонтоҳур тумани Фурқат кўчаси, 1",
    employer_phone: str = "+998 95 230 33 23",
) -> dict[str, bytes]:
    fonts()
    normal = ParagraphStyle("hr-body", fontName="HRSerif", fontSize=11, leading=14, spaceAfter=6)
    title = ParagraphStyle(
        "hr-title", parent=normal, fontName="HRSerifBold", fontSize=13, alignment=1, spaceAfter=16
    )
    f = fields
    employee_duties, employer_duties = contract_duties()
    date_label = f.document_date.strftime("%d.%m.%Y")
    probation = (
        f"{f.probation_months} ойлик дастлабки синов муддати" if f.probation_months else "Синовсиз"
    )

    def paragraph(text: str, heading: bool = False) -> Flowable:
        return Paragraph(escape(text).replace("\n", "<br/>"), title if heading else normal)

    def build(content: list[Flowable], location: list[SignatureBox]) -> bytes:
        output = BytesIO()
        SimpleDocTemplate(
            output,
            pagesize=A4,
            leftMargin=55,
            rightMargin=45,
            topMargin=40,
            bottomMargin=40,
            title="",
            author="",
        ).build(content)
        writer = PdfWriter()
        writer.append(PdfReader(BytesIO(output.getvalue())))
        writer.add_metadata({"/HRSignatureBox": location[0].model_dump_json()})
        result = BytesIO()
        writer.write(result)
        return result.getvalue()

    contract_location: list[SignatureBox] = []
    order_location: list[SignatureBox] = []

    contract = [
        paragraph("Вазирлар Маҳкамасининг 2024 йил 14 ноябрдаги 758-сон қарорига 2-илова"),
        paragraph(f"{f.contract_number}-сон МЕҲНАТ ШАРТНОМАСИ", True),
        paragraph(f"Тошкент шаҳри                         {date_label}"),
        paragraph(
            f"1. {employer} раиси {signer} номидан, кейинги ўринларда «Иш берувчи» деб "
            f"аталади ва фуқаро {f.full_name}, кейинги ўринларда «Ходим» деб аталади, "
            "мазкур шартномани қуйидагилар ҳақида туздик:"
        ),
        paragraph(
            f"2. Ходим {f.full_name} {f.department} бўлинмасида {f.job_title} "
            "лавозимига ишга қабул қилинади."
        ),
        paragraph(
            "3. Шартнома "
            + ("асосий иш" if f.work_type == "primary" else "ўриндошлик")
            + " бўйича ҳисобланади."
        ),
        paragraph(
            "4. Шартнома муддати: "
            + (
                "номуайян муддатга"
                if f.term == "indefinite"
                else f"{f.end_date} гача. Асос: {f.fixed_term_reason}"  # noqa: RUF001 - intentional Cyrillic document text
            )
        ),
        paragraph(f"5. Шартнома бўйича ишлаш бошланиши: {f.start_date.strftime('%d.%m.%Y')}."),
        paragraph(f"6. Синов муддати: {probation}."),
        paragraph("7. Ходимнинг мажбуриятлари:"),
        *[paragraph(text) for text in employee_duties],
        paragraph("8. Иш берувчининг мажбуриятлари:"),
        *[paragraph(text) for text in employer_duties],
        paragraph(f"9. Иш куни режими: {f.work_regime}."),
        paragraph(
            f"10. Ходим учун {f.days_per_week} кунлик иш ҳафтаси белгиланади. Иш вақтининг "
            f"давомийлиги ҳафтасига {f.hours_per_week} соатгача этиб белгиланади."
        ),
        paragraph(
            f"11. Меҳнатга ҳақ тўлаш: {f.salary_terms}. Қўшимча ҳақ, устама ва "
            f"компенсациялар: {f.allowances or 'белгиланмаган'}."
        ),
        paragraph(
            f"12. Ходимга асосий йиллик меҳнат таътили {f.annual_leave} календарь кун, "
            f"қўшимча таътил {f.additional_leave} календарь кун белгиланади."
        ),
        paragraph(
            "13. Меҳнат шартномасининг меҳнат шароитлари ва унга ҳақ тўлаш хусусиятлари, "
            "ижтимоий ҳимоя, имтиёзлар, кафолатлар ва бошқалар билан боғлиқ бўлган шартлари "
            "тарафлар учун қонунчилик ҳужжатларида белгиланган тартибда амал қилади."
        ),
        paragraph(
            "14. Шартнома бир хил кучга эга бўлган камида икки нусхада ёзма шаклда "
            "тузилиб, уларнинг ҳар бири тарафлар томонидан имзоланади, меҳнат шартномасининг "
            "бир нусхаси ходимга берилади, бошқаси иш берувчида сақланади."
        ),
    ]
    if f.additional_terms:
        contract.append(paragraph(f"Қўшимча шартлар: {f.additional_terms}"))
    contract.append(
        KeepTogether(
            [
                paragraph(
                    f"Ходим: {f.full_name}\nПаспорт / ID-карта: {f.passport}\nЖШШИР: {f.pinfl}"  # noqa: RUF001 - intentional Cyrillic document text
                    f"\nЯшаш манзили: {f.address}\nТелефон: {f.phone}"  # noqa: RUF001 - intentional Cyrillic document text
                ),
                paragraph(f"Иш берувчи манзили: {employer_address}\nТелефон: {employer_phone}"),  # noqa: RUF001 - intentional Cyrillic document text
                SigningLine(signer, signature, contract_location, employee=True),
            ]
        )
    )
    order = [
        paragraph(employer, True),
        paragraph("БУЙРУҚ", True),
        paragraph(f"{f.order_number}-сон ш/т\n{date_label}                         Тошкент шаҳри"),
        paragraph("Ишга қабул қилиш тўғрисида", True),
        paragraph(
            f"{f.full_name} {f.start_date.strftime('%d.%m.%Y')} дан {f.department} "
            f"бўлинмасининг {f.job_title} лавозимига {probation.lower()} билан "
            "ишга қабул қилинсин."
        ),
        paragraph(
            "Бухгалтерия бўлимига ходимга штат жадвали ва меҳнат шартномасига "
            "мувофиқ меҳнат ҳақини ҳисоблаш ва тўлаш вазифаси юклатилсин."
        ),
        paragraph(
            f"Асос: ходимнинг аризаси; {date_label} да тузилган "  # noqa: RUF001 - intentional Cyrillic document text
            f"{f.contract_number}-сонли меҳнат шартномаси."
        ),
        Spacer(1, 20),
        SigningLine(signer, signature, order_location),
    ]
    return {"contract": build(contract, contract_location), "order": build(order, order_location)}


def sign_generated(content: bytes, signature: bytes) -> bytes:
    reader = PdfReader(BytesIO(content))
    if not reader.metadata or not reader.metadata.get("/HRSignatureBox"):
        raise ValueError("В документе отсутствует безопасное место подписи")  # noqa: RUF001 - intentional Cyrillic document text
    box = SignatureBox.model_validate_json(str(reader.metadata["/HRSignatureBox"]))
    return place_signature(content, box, signature)


def place_signature(content: bytes, box: SignatureBox, signature: bytes | None) -> bytes:
    reader = PdfReader(BytesIO(content))
    if box.page > len(reader.pages):
        raise ValueError("Выбранной страницы для подписи нет")
    writer = PdfWriter()
    for item in reader.pages:
        writer.add_page(item)
    page = writer.pages[box.page - 1]
    w, h = float(page.mediabox.width), float(page.mediabox.height)
    output = BytesIO()
    canvas = Canvas(output, pagesize=(w, h))
    x, y = box.x * w, (1 - box.y - box.height) * h
    if signature:
        canvas.drawImage(
            ImageReader(BytesIO(signature)),
            x,
            y,
            width=box.width * w,
            height=box.height * h,
            preserveAspectRatio=True,
            anchor="c",
            mask="auto",
        )
    else:
        canvas.setStrokeColorRGB(0, 0.45, 0.5)
        canvas.rect(x, y, box.width * w, box.height * h)
    canvas.save()
    page.merge_page(PdfReader(BytesIO(output.getvalue())).pages[0])
    result = BytesIO()
    writer.write(result)
    return result.getvalue()


def contract_duties() -> tuple[list[str], list[str]]:
    data = json.loads(
        (Path(__file__).parent / "hr_assets" / "contract-clauses.json").read_text(encoding="utf-8")
    )
    return list(data["employee"]), list(data["employer"])
