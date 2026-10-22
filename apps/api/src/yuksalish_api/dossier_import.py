"""Deterministic DOCX-only import preview. Never execute Word, fetch URLs or save the file."""

import re
from datetime import date
from io import BytesIO

# Type only; parsing uses defusedxml below.
from xml.etree.ElementTree import Element  # nosec B405
from zipfile import ZIP_DEFLATED, ZIP_STORED, BadZipFile, ZipFile

from defusedxml import ElementTree as XML
from defusedxml.common import DefusedXmlException
from pydantic import ValidationError

from .ai_referent_docx_safety import has_disallowed_external_relationships
from .dossier_documents import MONTHS, NS, W
from .dossier_schemas import DossierEducation, DossierFields, DossierImportPreview, DossierRelative

MAX_IMPORT_BYTES = 5 * 1024 * 1024
MAX_XML_BYTES = 2 * 1024 * 1024
MAX_TEXT = 120_000
LABELS = {
    "birth_date": ("Туғилган йили", "Дата рождения"),
    "birth_place": ("Туғилган жойи", "Место рождения"),
    "nationality": ("Миллати", "Национальность"),
    "party_membership": ("Партиявийлиги", "Партийность"),
    "education_level": ("Маълумоти", "Образование"),
    "institutions": ("Тамомлаган", "Окончил", "Окончила"),
    "specialties": ("Маълумоти бўйича мутахассислиги", "Специальность по образованию"),
    "academic_degree": ("Илмий даражаси", "Учёная степень"),
    "academic_title": ("Илмий унвони", "Учёное звание"),
    "languages": ("Қайси чет тилларини билади", "Владение языками"),
    "military_rank": ("Ҳарбий (махсус) унвони", "Воинское звание"),
    "awards": ("Давлат мукофотлари билан тақдирланганми", "Награды"),
    "elected_membership": (
        "Халқ депутатлари, республика, вилоят, шаҳар ва туман Кенгаши депутатими "
        "ёки бошқа сайланадиган органларнинг аъзосими", "Членство в выборных органах",
    ),
}


def _norm(value: str) -> str:
    return re.sub(r"[\W_]+", "", value.casefold())


def _paragraphs(element: Element) -> list[str]:
    # Runs are fragments of the same word; never insert spaces between them.
    result: list[str] = []
    for paragraph in element.findall("w:p", NS):
        parts = []
        for node in paragraph.iter():
            if node.tag == f"{{{W}}}t":
                parts.append(node.text or "")
            elif node.tag in {f"{{{W}}}br", f"{{{W}}}tab"}:
                parts.append("\n" if node.tag.endswith("}br") else " ")
        result.extend(line.strip() for line in "".join(parts).splitlines() if line.strip())
    return result


def _cells(row: Element) -> list[str]:
    return ["\n".join(_paragraphs(cell)) for cell in row.findall("w:tc", NS)]


def _label(value: str) -> tuple[str, str] | None:
    # Labels can span paragraphs but end at the colon in the agreed template.
    prefix, separator, tail = value.partition(":")
    candidate = _norm(prefix if separator else value.split("\n", 1)[0])
    for key, aliases in LABELS.items():
        if candidate in {_norm(alias) for alias in aliases}:
            return key, tail.strip() if separator else value.partition("\n")[2].strip()
    return None


def _empty(value: str) -> bool:
    return not value.strip(" \n\t—-_") or bool(re.fullmatch(r"\{\{\w+\}\}", value))


def _date(value: str) -> date | None:
    match = re.search(r"\b(\d{1,2})[./](\d{1,2})[./](\d{4})\b", value)
    if match:
        return date(int(match[3]), int(match[2]), int(match[1]))
    match = re.search(r"\b(\d{4})\s*йил\s*(\d{1,2})\s*([\u0430-\u044f\u0451]+)",
                      value.casefold())
    if match and match[3].removesuffix("дан") in MONTHS:
        return date(int(match[1]), MONTHS.index(match[3].removesuffix("дан")) + 1, int(match[2]))
    return None


def _package(content: bytes) -> Element:
    if not content or len(content) > MAX_IMPORT_BYTES:
        raise ValueError("Выберите DOCX размером до 5 МБ")
    try:
        with ZipFile(BytesIO(content)) as package:
            parts = package.infolist()
            names = [part.filename for part in parts]
            if (len(parts) > 300 or len(set(names)) != len(names)
                    or sum(part.file_size for part in parts) > 30 * 1024 * 1024
                    or any(part.flag_bits & 1 for part in parts)
                    or any(part.compress_type not in {ZIP_STORED, ZIP_DEFLATED} for part in parts)
                    or "word/document.xml" not in names
                    or any(".." in name.split("/") or "\\" in name or name.startswith("/")
                           for name in names)
                    or any("vbaproject" in name.lower() or "embeddings/" in name.lower()
                           for name in names)
                    or any(part.file_size > MAX_XML_BYTES for part in parts
                           if part.filename.lower().endswith((".xml", ".rels")))):
                raise ValueError("Структура DOCX не поддерживается или превышает ограничения")
            if has_disallowed_external_relationships(package):
                raise ValueError("Удалите внешние ресурсы и связанные шаблоны из Word")
            root = XML.fromstring(package.read("word/document.xml"))
            if any(root.find(f".//w:{tag}", NS) is not None for tag in (
                "ins", "del", "instrText", "fldSimple", "altChunk", "object",
            )):
                raise ValueError("Примите исправления и удалите поля/вложенные объекты в Word")
            if sum(len(node.text or "") for node in root.iter()) > MAX_TEXT:
                raise ValueError("Слишком много текста. Разделите документ")
            return root
    except (BadZipFile, KeyError, RuntimeError, XML.ParseError, DefusedXmlException) as error:
        raise ValueError("Файл повреждён или небезопасен. Заново сохраните документ как DOCX") \
            from error


def parse_dossier(content: bytes) -> DossierImportPreview:
    root = _package(content)
    body = root.find("w:body", NS)
    if body is None:
        raise ValueError("Текст Word не найден")
    tables = body.findall("w:tbl", NS)
    if not tables:
        raise ValueError("Выберите DOCX по согласованному табличному образцу объективки")
    main = next((table for table in tables if any(
        _label(cell) for row in table.findall("w:tr", NS) for cell in _cells(row)
    )), None)
    if main is None:
        raise ValueError("Поля объективки не найдены. Используйте согласованный образец Word")
    values: dict[str, object] = {}
    captured: dict[str, str] = {}
    warnings: list[str] = [
        "Проверьте все распознанные сведения перед переносом. ФИО, должность и фото профиля "
        "не меняются. Исходный файл не сохраняется на сервере.",
    ]
    unknown: list[str] = []
    ambiguous: set[str] = set()
    jobs: list[dict[str, object]] = []
    rows = main.findall("w:tr", NS)
    source_name = source_job = ""
    if rows and any(_norm(cell) == _norm("МАЪЛУМОТНОМА") for cell in _cells(rows[0])):
        if len(rows) > 1:
            source_name = next((cell for cell in _cells(rows[1]) if not _empty(cell)), "")
        if len(rows) > 2:
            header = next((cell for cell in _cells(rows[2]) if not _empty(cell)), "")
            lines = header.splitlines()
            try:
                appointment = _date(lines[0]) if lines else None
            except ValueError:
                appointment = None
            if appointment:
                values["appointment_date"] = appointment.isoformat()
                source_job = "\n".join(lines[1:])
            else:
                source_job = header
                if header and not _empty(header):
                    warnings.append("Дата назначения не определена; шапку проверьте отдельно.")
    in_work = False
    for row_number, row in enumerate(rows):
        cells = _cells(row)
        if any(_norm(cell) in {_norm("МЕҲНАТ ФАОЛИЯТИ"), _norm("Трудовая деятельность")}
               for cell in cells):
            in_work = True
            continue
        if in_work:
            if not any(not _empty(cell) for cell in cells):
                continue
            if len(cells) >= 3 and cells[1].strip() in {"-", "—", "\u2013"}:
                description = "\n".join(filter(None, cells[2:]))
                organization, separator, position = description.partition(" · ")
                jobs.append({"period": cells[0], "organization": organization if separator else "",
                             "position": position if separator else description})
            else:
                unknown.append(" | ".join(cells))
            continue
        for index, cell in enumerate(cells):
            match = _label(cell)
            if not match:
                previous = _label(cells[index - 1]) if index else None
                if row_number > 2 and not _empty(cell) and not (previous and not previous[1]):
                    unknown.append(cell)
                continue
            key, value = match
            if not value and index + 1 < len(cells) and not _label(cells[index + 1]):
                value = cells[index + 1]
            if _empty(value):
                continue
            if key in captured and captured[key] != value:
                ambiguous.add(key)
                unknown.extend((captured[key], value))
            captured[key] = value
    for key in ambiguous:
        del captured[key]
        warnings.append(f"Неоднозначное поле {key}: выберите нужный текст вручную.")
    for key, value in captured.items():
        if key not in {"birth_date", "institutions", "specialties"}:
            values[key] = value
    if "birth_date" in captured:
        try:
            birth_date = _date(captured["birth_date"])
        except ValueError:
            birth_date = None
        if birth_date:
            values["birth_date"] = birth_date.isoformat()
        else:
            unknown.append(captured["birth_date"])
            warnings.append("Дата рождения не определена; заполните её вручную.")
    if "institutions" in captured:
        education = []
        for line in captured["institutions"].splitlines():
            prefix = re.match(r"^(?:(?:19|20)\d{2}\s*(?:йил|й\.?|\u0433\.?)?[\s\u2013\u2014,-]*)+",
                              line)
            lead = prefix[0] if prefix else ""
            years = re.findall(r"(?<!\d)(?:19|20)\d{2}(?!\d)", lead)
            institution = line[len(lead):].strip(" ,.-")
            education.append({"institution": institution,
                              "startYear": int(years[0]) if len(years) == 2 else None,
                              "graduationYear": int(years[-1]) if years else None})
        if education and "specialties" in captured:
            specialties = captured["specialties"].splitlines()
            if len(specialties) == len(education):
                for education_row, specialty_line in zip(education, specialties, strict=True):
                    specialty, separator, qualification = specialty_line.partition(" · ")
                    education_row.update(specialty=specialty,
                                         qualification=qualification if separator else "")
            else:
                unknown.append(captured["specialties"])
                warnings.append("Сопоставьте специальности и учебные заведения вручную.")
        try:
            values["education"] = [DossierEducation.model_validate(row).model_dump(mode="json")
                                   for row in education]
        except ValidationError:
            warnings.append("Проверьте образование: текст не перенесён автоматически.")
            unknown.append(captured["institutions"])
    elif "specialties" in captured:
        unknown.append(captured["specialties"])
    if jobs:
        values["employment"] = jobs
        warnings.append("Периоды работы сохранены как в Word, без выдуманных дней и месяцев. "
                        "Неразделённое описание работы оставлено в поле должности.")
    relatives = []
    for table in tables:
        if table is main:
            continue
        family_rows = table.findall("w:tr", NS)
        header = " ".join(_cells(family_rows[0])) if family_rows else ""
        if not ("қариндош" in header.casefold() or "родств" in header.casefold()):
            unknown.extend(" | ".join(_cells(row)) for row in family_rows)
            continue
        for row in family_rows[1:]:
            cells = _cells(row)
            if all(_empty(cell) for cell in cells):
                continue
            if len(cells) != 5:
                unknown.append(" | ".join(cells))
                continue
            year = re.match(r"\s*((?:19|20)\d{2})(?!\d)", cells[2])
            place = re.sub(r"^\s*\d{4}\s*(?:йил|й\.?|год(?:\u0430)?|\u0433\.?)?[\s,.-]*",
                           "", cells[2])
            try:
                relatives.append(DossierRelative(
                    relationship=cells[0], full_name=cells[1],
                    birth_year=int(year[1]) if year else None, birth_place=place,
                    workplace_position=cells[3], address=cells[4],
                ).model_dump(mode="json"))
            except ValidationError:
                unknown.append(" | ".join(cells))
                warnings.append("Одна из строк родственников требует ручного заполнения.")
    if relatives:
        values["relatives"] = relatives
    for paragraph in body.findall("w:p", NS):
        text = "".join(node.text or "" for node in paragraph.findall(".//w:t", NS)).strip()
        if text and not ("қариндош" in text.casefold()
                         or _norm(text) in {_norm("МАЪЛУМОТ"), _norm(source_name)}):
            unknown.append(text)
    # Validate every section separately. Invalid sections remain visible, never silently truncated.
    valid: dict[str, object] = {}
    for key, candidate_value in values.items():
        try:
            DossierFields.model_validate({key: candidate_value})
            valid[key] = candidate_value
        except ValidationError:
            unknown.append(str(candidate_value))
            warnings.append(f"Раздел {key} не прошёл проверку; требуется ручное заполнение.")
    if root.find(".//w:txbxContent", NS) is not None:
        warnings.append("Текст в надписях Word не импортируется; "
                        "проверьте надписи в исходном файле.")
    if not valid:
        raise ValueError("Заполненные поля не распознаны. Проверьте образец и содержимое Word")
    fields = DossierFields.model_validate(valid)
    return DossierImportPreview(
        source_full_name=source_name, source_job_title=source_job, fields=fields,
        detected_fields=[DossierFields.model_fields[key].alias or key for key in valid],
        warnings=list(dict.fromkeys(warnings)), unrecognized_text="\n\n".join(unknown),
    )
