"""Local, transient ID-card OCR. Never sends images or identity text to an AI provider."""

import asyncio
import csv
import re
import unicodedata
import warnings
from io import BytesIO, StringIO
from pathlib import Path

from PIL import Image, ImageOps, UnidentifiedImageError

from .errors import WorkspaceRepositoryError as Error
from .hr_hiring_schemas import IdentityRecognition

MAX_ID_BYTES = 5 * 1024 * 1024
MAX_OUTPUT = 128 * 1024
OCR_SLOTS = asyncio.Semaphore(2)
LABELS = {
    "surname": r"FAMILIYASI|SURNAME|ФАМИЛИЯ|ФАМИЛИЯСИ",
    "given": r"ISMI|GIVEN NAMES?|FIRST NAME|ИМЯ|ИСМИ",
    "patronymic": r"OTASINING ISMI|PATRONYMIC|ОТЧЕСТВО|ОТАСИНИНГ ИСМИ",
    "full_name": r"F\.?I\.?O\.?|FULL NAME|ФИО|Ф\.И\.О\.",  # noqa: RUF001 - Cyrillic label
    "pinfl": r"JSHSHIR|PINFL|PERSONAL (?:NUMBER|NO)|ЖШШИР|ПИНФЛ",
    "passport": (
        r"HUJJAT (?:RAQAMI|NOMERI)|DOCUMENT (?:NUMBER|NO\.?|NR)|"
        r"CARD (?:NUMBER|NO\.?)|ID (?:NUMBER|NO\.?)|"
        r"НОМЕР (?:ДОКУМЕНТА|КАРТЫ)"  # noqa: RUF001 - Cyrillic label
    ),
}
ALL_LABELS = "|".join(f"(?:{value})" for value in LABELS.values())
NAME = re.compile(r"^[A-ZА-ЯЁЎҚҒҲ][A-ZА-ЯЁЎҚҒҲ '\-’ʻʼ]{1,99}$")  # noqa: RUF001 - scripts


def normalise_photo(content: bytes) -> bytes:
    if not content or len(content) > MAX_ID_BYTES:
        raise Error(413, "Фото ID-карты должно быть не больше 5 МиБ")
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(BytesIO(content)) as source:
                if source.format not in {"JPEG", "PNG"} or getattr(source, "n_frames", 1) != 1:
                    raise Error(422, "Загрузите фото ID-карты в JPEG или PNG")
                if source.width * source.height > 12_000_000 or min(source.size) < 200:
                    raise Error(422, "Фото должно быть чётким, от 200 пикселей, до 12 мегапикселей")
                image = ImageOps.exif_transpose(source).convert("RGB")
                image.thumbnail((2200, 2200))
                # Re-encoding strips EXIF and other source metadata. No disk/object-storage write.
                result = BytesIO()
                image.save(result, format="PNG")
                return result.getvalue()
    except (
        UnidentifiedImageError,
        OSError,
        Image.DecompressionBombError,
        Image.DecompressionBombWarning,
    ) as exc:
        raise Error(422, "Не удалось прочитать фото ID-карты") from exc  # noqa: RUF001


def tsv_lines(text: str) -> list[str]:
    lines: dict[tuple[str, str, str, str], list[str]] = {}
    for row in csv.DictReader(StringIO(text), delimiter="\t"):
        if row.get("level") != "5":
            continue
        try:
            confidence = float(row.get("conf", "-1"))
        except ValueError:
            continue
        word = row.get("text", "").strip()
        if not word:
            continue
        key = (
            row.get("page_num", ""),
            row.get("block_num", ""),
            row.get("par_num", ""),
            row.get("line_num", ""),
        )
        # An uncertain token invalidates the line, rather than silently shortening a name/number.
        lines.setdefault(key, []).append(word if confidence >= 50 else "�")
    return [" ".join(words) for words in lines.values() if "�" not in words]


def extract_identity(lines: list[str]) -> IdentityRecognition:
    rows = [unicodedata.normalize("NFKC", line).upper().strip() for line in lines]
    found: dict[str, set[str]] = {key: set() for key in LABELS}
    for index, line in enumerate(rows):
        for key, pattern in LABELS.items():
            match = re.search(rf"(?<![\w])(?:{pattern})(?![\w])", line)
            if not match:
                continue
            # ISMI is part of OTASINING ISMI; do not reuse a patronymic as the given name.
            if key == "given" and re.search(LABELS["patronymic"], line):
                continue
            tail = line[match.end() :].lstrip(" :/.-")
            # Bilingual labels on one line, value on the next.
            tail = re.sub(rf"^(?:{pattern})\b[ :/.-]*", "", tail).strip()
            if not tail and index + 1 < len(rows):
                tail = rows[index + 1]
            if not tail or re.search(rf"\b(?:{ALL_LABELS})\b", tail):
                continue
            if key == "pinfl":
                candidates = re.findall(r"(?<!\d)\d{14}(?!\d)", tail)
            elif key == "passport":
                candidates = re.findall(
                    r"(?<![A-Z0-9])(?:[A-Z]{2}\s*\d{7,9}|\d{9})(?![A-Z0-9])", tail
                )
            else:
                candidates = [tail] if NAME.fullmatch(tail) and len(tail.split()) <= 5 else []
            found[key].update(re.sub(r"\s+", " ", item).strip() for item in candidates)
    messages: list[str] = []

    def unique(key: str) -> str | None:
        values = found[key]
        if len(values) > 1:
            messages.append("Есть противоречивые значения. Сверьте данные по оригиналу карты.")
        return next(iter(values)) if len(values) == 1 else None

    surname, given, patronymic = (unique(key) for key in ("surname", "given", "patronymic"))
    full_name = unique("full_name")
    if surname and given:
        assembled = " ".join(value for value in (surname, given, patronymic) if value)
        if full_name and full_name != assembled:
            full_name = None
            messages.append("ФИО противоречиво — заполните его вручную.")  # noqa: RUF001
        else:
            full_name = assembled
        if not patronymic:
            messages.append("Отчество не найдено: проверьте и дополните ФИО вручную.")
    pinfl, passport = unique("pinfl"), unique("passport")
    if passport:
        passport = passport.replace(" ", "")
    for title, value in (("ФИО", full_name), ("JSHSHIR", pinfl), ("Номер ID-карты", passport)):
        if not value:
            messages.append(f"{title} не распознан однозначно. Можно заполнить вручную.")
    return IdentityRecognition(
        full_name=full_name, pinfl=pinfl, passport=passport, warnings=list(dict.fromkeys(messages))
    )


async def recognise_identity(content: bytes, executable: Path) -> IdentityRecognition:
    if not executable.is_absolute() or not executable.is_file():
        raise Error(503, "Локальное распознавание не настроено. Данные можно заполнить вручную")
    if OCR_SLOTS.locked():
        raise Error(429, "Распознавание занято. Повторите через несколько секунд")
    async with OCR_SLOTS:
        image = await asyncio.to_thread(normalise_photo, content)
        try:
            process = await asyncio.create_subprocess_exec(
                str(executable),
                "stdin",
                "stdout",
                "-l",
                "eng+rus+uzb+uzb_cyrl",
                "--psm",
                "6",
                "tsv",
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.DEVNULL,
                env={"OMP_THREAD_LIMIT": "1"},
            )
        except OSError as exc:
            raise Error(503, "Локальное распознавание временно недоступно") from exc
        try:
            async with asyncio.timeout(25):
                if process.stdin is None or process.stdout is None:
                    raise Error(503, "Локальное распознавание временно недоступно")
                process.stdin.write(image)
                await process.stdin.drain()
                process.stdin.close()
                output = bytearray()
                while chunk := await process.stdout.read(16 * 1024):
                    output.extend(chunk)
                    if len(output) > MAX_OUTPUT:
                        raise Error(422, "На фото слишком много текста. Загрузите только ID-карту")  # noqa: RUF001
                await process.wait()
                if process.returncode:
                    raise Error(
                        503, "Локальное распознавание не завершено. Проверьте языковые модели"
                    )
                return extract_identity(tsv_lines(output.decode("utf-8", errors="replace")))
        except OSError as exc:
            raise Error(503, "Локальное распознавание временно недоступно") from exc
        except TimeoutError as exc:
            raise Error(
                503, "Распознавание заняло слишком много времени. Повторите с чётким фото"  # noqa: RUF001
            ) from exc
        finally:
            if process.returncode is None:
                process.kill()
                await process.wait()
