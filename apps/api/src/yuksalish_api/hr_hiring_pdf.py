"""Deterministic A4 documents; no AI, Word macros or shared-drive dependency."""

import warnings
from io import BytesIO

from PIL import Image, ImageOps, UnidentifiedImageError
from pypdf import PdfReader, PdfWriter, apply_configuration
from pypdf.errors import PdfReadError
from pypdf.generic import DictionaryObject
from reportlab.lib.pagesizes import A4  # type: ignore[import-untyped]
from reportlab.lib.utils import ImageReader  # type: ignore[import-untyped]
from reportlab.pdfgen.canvas import Canvas  # type: ignore[import-untyped]

from .hr_hiring_schemas import SignatureBox
from .hr_hiring_templates import documents as documents

MAX_BYTES = 10 * 1024 * 1024


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
