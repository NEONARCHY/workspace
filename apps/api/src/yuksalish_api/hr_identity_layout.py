"""Card separation and strict TD1 MRZ validation; no identity-specific coordinates."""

import re
from datetime import datetime
from itertools import groupby

from PIL import Image, ImageOps, ImageStat

from .hr_hiring_schemas import IdentityRecognition


def bands(values: list[bool], minimum: int) -> list[tuple[int, int]]:
    groups: list[tuple[int, int]] = []
    for active, items in groupby(enumerate(values), lambda item: item[1]):
        positions = [item[0] for item in items]
        if active:
            start, end = positions[0], positions[-1] + 1
            if groups and start - groups[-1][1] < 10:
                groups[-1] = groups[-1][0], end
            else:
                groups.append((start, end))
    return [(start, end) for start, end in groups if end - start >= minimum]


def card_regions(image: Image.Image) -> list[Image.Image]:
    """White-separated stacked or side-by-side scans; fallback to the whole photo."""
    probe = image.convert("L")
    probe.thumbnail((600, 900))
    mask = probe.point(lambda value: 255 if value < 242 else 0)
    width, height = mask.size
    row_active = [
        ImageStat.Stat(mask.crop((0, y, width, y + 1))).mean[0] > 40 for y in range(height)
    ]
    boxes: list[tuple[int, int, int, int]] = []
    for top, bottom in bands(row_active, max(60, height // 8)):
        column_active = [
            ImageStat.Stat(mask.crop((x, top, x + 1, bottom))).mean[0] > 40 for x in range(width)
        ]
        for left, right in bands(column_active, max(100, width // 4)):
            ratio = (right - left) / (bottom - top)
            if 1.2 <= ratio <= 2.0:
                boxes.append(
                    (
                        max(0, left - 4),
                        max(0, top - 4),
                        min(width, right + 4),
                        min(height, bottom + 4),
                    )
                )
    if not 1 <= len(boxes) <= 2:
        return [image]
    sx, sy = image.width / width, image.height / height
    return [
        image.crop((round(left * sx), round(top * sy), round(right * sx), round(bottom * sy)))
        for left, top, right, bottom in boxes
    ]


def prepare_region(image: Image.Image, *, mrz: bool = False) -> bytes:
    from io import BytesIO

    grey = image.convert("L") if mrz else ImageOps.autocontrast(image.convert("L"))
    scale = min(3, 2200 / max(grey.size))
    if scale > 1:
        grey = grey.resize(
            (round(grey.width * scale), round(grey.height * scale)), Image.Resampling.LANCZOS
        )
    grey = ImageOps.expand(grey, border=15 if mrz else 12, fill=255)
    result = BytesIO()
    grey.save(result, "PNG")
    return result.getvalue()


def check_digit(value: str) -> str:
    if not re.fullmatch(r"[A-Z0-9<]+", value):
        return "!"
    return str(
        sum(
            (0 if char == "<" else int(char) if char.isdigit() else ord(char) - 55)
            * (7, 3, 1)[index % 3]
            for index, char in enumerate(value)
        )
        % 10
    )


def td1_identity(lines: list[str]) -> IdentityRecognition | None:
    # Only whitespace is removed: no O->0/I->1 repair, padding, dropped chars or brute force.
    rows = [re.sub(r"\s", "", row.upper()) for row in lines]
    results: dict[tuple[str, str, str], IdentityRecognition] = {}
    for index in range(len(rows) - 2):
        first, second, third = rows[index : index + 3]
        if any(
            len(row) != 30 or not re.fullmatch(r"[A-Z0-9<]{30}", row)
            for row in (first, second, third)
        ):
            continue
        if not re.fullmatch(r"[ACI][A-Z<]UZB[A-Z]{2}\d{7}\d\d{14}<", first):
            continue
        if not re.fullmatch(r"\d{7}[MF<]\d{7}UZB[A-Z0-9<]{11}\d", second):
            continue
        if (
            check_digit(first[5:14]) != first[14]
            or check_digit(second[:6]) != second[6]
            or check_digit(second[8:14]) != second[14]
            or check_digit(first[5:] + second[:7] + second[8:15] + second[18:29]) != second[29]
        ):
            continue
        try:
            datetime.strptime(second[:6], "%y%m%d")
            datetime.strptime(second[8:14], "%y%m%d")
        except ValueError:
            continue
        if "<<" not in third or not re.fullmatch(r"[A-Z<]{30}", third):
            continue
        surname, given = third.rstrip("<").split("<<", 1)
        if not surname or not given or "<<" in given:
            continue
        name = (surname + " " + given).replace("<", " ")
        if not 2 <= len(name.split()) <= 5:
            continue
        result = IdentityRecognition(
            full_name=name,
            pinfl=first[15:29],
            passport=first[5:14],
            name_complete=False,
            warnings=[
                "Имя прочитано из MRZ. Отчество и написание ФИО сверяются по лицевой стороне."
            ],
        )
        results[(name, result.pinfl or "", result.passport or "")] = result
    return next(iter(results.values())) if len(results) == 1 else None


def name_key(value: str) -> str:
    return re.sub(r"[^A-ZА-ЯЁЎҚҒҲ ]", "", value.upper())  # noqa: RUF001 - scripts


def merge_results(results: list[IdentityRecognition]) -> IdentityRecognition:
    names: dict[str, bool] = {}
    for item in results:
        if item.full_name:
            names[item.full_name] = names.get(item.full_name, False) or item.name_complete
    # MRZ transliteration may omit apostrophes/patronymic. A matching longer VIZ name wins.
    selected_name: str | None = None
    if names:
        longest = max(names, key=lambda value: len(name_key(value)))
        if all(
            name_key(longest) == name_key(value)
            or (not complete and name_key(longest).startswith(name_key(value) + " "))
            for value, complete in names.items()
        ):
            selected_name = longest
    warnings: list[str] = []
    fields: dict[str, str | None] = {"full_name": selected_name}
    for key in ("pinfl", "passport"):
        values = {getattr(item, key) for item in results if getattr(item, key)}
        fields[key] = next(iter(values)) if len(values) == 1 else None
    for key, label in (("full_name", "ФИО"), ("pinfl", "JSHSHIR"), ("passport", "Номер ID-карты")):
        if not fields[key]:
            warnings.append(
                f"{label} не распознан однозначно. "
                "Добавьте чёткое фото нужной стороны или заполните вручную."
            )
    complete = bool(selected_name and names[selected_name])
    if selected_name and not complete:
        warnings.append("Отчество и написание имени проверьте по лицевой стороне карты.")
    return IdentityRecognition(**fields, name_complete=complete, warnings=warnings)
