"""Read-only extraction of plan candidates and reviewable table-cell hints."""

import re
from collections.abc import Iterator
from dataclasses import dataclass
from datetime import date
from io import BytesIO
from pathlib import PurePath
from typing import Protocol
from zipfile import ZipFile

import openpyxl  # type: ignore[import-untyped]
from defusedxml import ElementTree
from pypdf import PdfReader

from .project_import_documents import checked_zip, document_type
from .task_plan_schemas import MAX_PLAN_IMPORT_ITEMS, TaskPlanImportPreview, TaskPlanImportRow

MAX_PLAN_BYTES = 10 * 1024 * 1024
MAX_ROWS = MAX_PLAN_IMPORT_ITEMS
MAX_TEXT_CHARS = 50_000
_NUMBER = re.compile(r"^\s*(?:\d+[.)]|\d+(?:\.\d+)+[.)]?|[•●▪◦‣-])\s*")
_TABLE_BULLET = re.compile(r"^\s*(?:[•●▪◦‣]\s*|-\s+)")
_PERSON_HEADING = re.compile(r"\b[^\W\d_]\s*\.\s*[^\W\d_][^\W\d_'-]+", re.UNICODE)
_DATE_CELL = re.compile(r"^\s*(?:до\s+)?(\d{1,2})[./](\d{1,2})[./](\d{4})\s*$")
_WEEK_END = re.compile(r"^\s*(\d{1,2})(?:\s+([\u0430-\u044f\u0451]+))?\s*"
                       r"[\u2013\u2014-]\s*(\d{1,2})\s+([\u0430-\u044f\u0451]+)\s*$",
                       re.IGNORECASE)
_PLAN_YEAR = re.compile(r"\b20\d{2}\b")
_MONTHS = {
    "январь": 1, "января": 1, "февраль": 2, "февраля": 2,
    "март": 3, "марта": 3, "апрель": 4, "апреля": 4,
    "май": 5, "мая": 5, "июнь": 6, "июня": 6,
    "июль": 7, "июля": 7, "август": 8, "августа": 8,
    "сентябрь": 9, "сентября": 9, "октябрь": 10, "октября": 10,
    "ноябрь": 11, "ноября": 11, "декабрь": 12, "декабря": 12,
}


@dataclass(frozen=True)
class _Candidate:
    title: str
    source: str
    assignee_hint: str | None = None
    coexecutors_hint: str | None = None
    group_key: str | None = None
    due_date_hint: date | None = None


class _XmlNode(Protocol):
    tag: str
    text: str | None

    def iter(self, tag: str | None = None) -> Iterator["_XmlNode"]: ...


def _docx_paragraph_text(paragraph: _XmlNode, ns: str) -> str:
    separators = {ns + "br", ns + "cr", ns + "tab"}
    return "".join(
        " " if node.tag in separators else node.text or ""
        for node in paragraph.iter() if node.tag == ns + "t" or node.tag in separators
    )


def _cell_text(cell: _XmlNode, ns: str) -> str:
    return " ".join(" ".join(_docx_paragraph_text(paragraph, ns).split())
                    for paragraph in cell.iter(ns + "p")).strip()


def _date_cell_hint(value: str, plan_year: int | None = None) -> date | None:
    match = _DATE_CELL.fullmatch(value)
    if match is not None:
        try:
            return date(int(match[3]), int(match[2]), int(match[1]))
        except ValueError:
            return None
    week = _WEEK_END.fullmatch(value)
    if week is None or plan_year is None:
        return None
    month = _MONTHS.get(week[4].casefold())
    if month is None:
        return None
    start_month = _MONTHS.get(week[2].casefold()) if week[2] else month
    if start_month is None or start_month > month:
        return None
    try:
        start = date(plan_year, start_month, int(week[1]))
        end = date(plan_year, month, int(week[3]))
    except ValueError:
        return None
    return end if start <= end else None


def _text_rows(text: str, location: str) -> list[_Candidate]:
    if len(text) > MAX_TEXT_CHARS:
        raise ValueError("Document text exceeds extraction limits")
    rows: list[_Candidate] = []
    for number, line in enumerate(text.splitlines(), 1):
        title = _NUMBER.sub("", " ".join(line.split())).strip()
        if len(title) < 5 or title.lower() in {"план работ", "иш режа", "мероприятия"}:
            continue
        rows.append(_Candidate(title[:240], f"{location}, строка {number}"))
        if len(rows) > MAX_ROWS:
            break
    return rows


def _docx_rows(content: bytes) -> list[_Candidate]:
    with ZipFile(BytesIO(content)) as archive:
        root = ElementTree.fromstring(archive.read("word/document.xml"))
    ns = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
    paragraphs = [_docx_paragraph_text(paragraph, ns) for paragraph in root.iter(ns + "p")]
    if sum(len(paragraph) for paragraph in paragraphs) > MAX_TEXT_CHARS:
        raise ValueError("Document text exceeds extraction limits")

    # In weekly-plan tables, each cell can contain several real tasks. Do not turn
    # the week, names, co-executors and KPI cells into candidate tasks.
    table_rows: list[_Candidate] = []
    body = root.find(ns + "body")
    if body is not None:
        heading_text = " ".join(_docx_paragraph_text(paragraph, ns)
                                for paragraph in body.findall(ns + "p"))
        years = set(_PLAN_YEAR.findall(heading_text))
        plan_year = int(next(iter(years))) if len(years) == 1 else None
        for table_number, table in enumerate(body.findall(ns + "tbl"), 1):
            header = table.find(ns + "tr")
            header_cells = ([_cell_text(cell, ns)
                             for cell in header.findall(ns + "tc")] if header is not None else [])
            coexecutors_column = next((index for index, value in enumerate(header_cells)
                                       if any(label in value.casefold() for label in
                                              ("ҳамижрочи", "hamijrochi", "соисполнител"))), None)
            responsible_column = next((index for index, value in enumerate(header_cells)
                                       if any(label in value.casefold() for label in
                                              ("ответствен", "масъул", "mas'ul"))), None)
            deadline_column = next((index for index, value in enumerate(header_cells)
                                    if any(label in value.casefold() for label in
                                           ("срок", "муддат", "deadline"))), None)
            for row_number, row in enumerate(table.findall(ns + "tr"), 1):
                if row_number == 1:
                    continue
                cells = row.findall(ns + "tc")
                coexecutors_hint = (_cell_text(cells[coexecutors_column], ns)[:1000]
                                    if coexecutors_column is not None
                                    and coexecutors_column < len(cells) else "")
                row_assignee = (_cell_text(cells[responsible_column], ns)[:240]
                                if responsible_column is not None
                                and responsible_column < len(cells) else "")
                due_date_hint = (_date_cell_hint(_cell_text(cells[deadline_column], ns), plan_year)
                                 if deadline_column is not None
                                 and deadline_column < len(cells) else None)
                for column_number, cell in enumerate(cells, 1):
                    index = column_number - 1
                    if index in {coexecutors_column, responsible_column, deadline_column}:
                        continue
                    if coexecutors_column is not None and index >= coexecutors_column:
                        continue
                    heading_matches = (_PERSON_HEADING.findall(header_cells[index])
                                       if index < len(header_cells) else [])
                    assignee_hint = row_assignee or (
                        heading_matches[0] if len(heading_matches) == 1 else None
                    )
                    structured = (coexecutors_column is not None or responsible_column is not None
                                  or deadline_column is not None or bool(heading_matches))
                    group_key = (f"DOCX, таблица {table_number}, строка {row_number}"
                                 if structured else None)
                    for paragraph in cell.iter(ns + "p"):
                        line = _docx_paragraph_text(paragraph, ns)
                        if not _TABLE_BULLET.match(line):
                            continue
                        title = _NUMBER.sub("", " ".join(line.split())).strip()
                        if len(title) < 5:
                            continue
                        source = (f"DOCX, таблица {table_number}, строка {row_number}, "
                                  f"столбец {column_number}")
                        table_rows.append(_Candidate(
                            title[:240], source, assignee_hint,
                            coexecutors_hint or None, group_key, due_date_hint,
                        ))
                        if len(table_rows) > MAX_ROWS:
                            return table_rows
    if table_rows:
        return table_rows
    return _text_rows("\n".join(paragraphs), "DOCX")


def _xlsx_rows(content: bytes) -> list[_Candidate]:
    workbook = openpyxl.load_workbook(BytesIO(content), read_only=True, data_only=True,
                                      keep_links=False)
    rows: list[_Candidate] = []
    try:
        for sheet in workbook:
            if sheet.sheet_state != "visible":
                continue
            if sheet.max_row > 500 or sheet.max_column > 30:
                raise ValueError("Workbook exceeds 500 rows or 30 columns per sheet")
            for row_number, cells in enumerate(sheet.iter_rows(max_row=500, max_col=30), 1):
                texts = [" ".join(str(cell.value).split()) for cell in cells
                         if isinstance(cell.value, str) and len(cell.value.strip()) >= 5]
                if not texts:
                    continue
                # The longest text cell is generally the activity, not its number/budget.
                title = _NUMBER.sub("", max(texts, key=len)).strip()
                if len(title) < 5 or title.casefold() in {"activity", "мероприятие", "задача"}:
                    continue
                rows.append(_Candidate(title[:240], f"{sheet.title}!{row_number}"))
                if len(rows) > MAX_ROWS:
                    return rows
    finally:
        workbook.close()
    return rows


def preview_plan_document(filename: str, content: bytes) -> TaskPlanImportPreview:
    if len(content) > MAX_PLAN_BYTES:
        raise ValueError("План не должен превышать 10 МБ")
    document_type(filename, content)
    suffix = PurePath(filename).suffix.lower()
    if suffix in {".docx", ".xlsx"}:
        checked_zip(content)
    if suffix == ".xlsx":
        candidates = _xlsx_rows(content)
    elif suffix == ".docx":
        candidates = _docx_rows(content)
    elif suffix == ".txt":
        candidates = _text_rows(content.decode("utf-8-sig"), "TXT")
    else:
        reader = PdfReader(BytesIO(content), strict=False)
        if reader.is_encrypted or len(reader.pages) > 20:
            raise ValueError("PDF защищён или содержит более 20 страниц")
        candidates = []
        total_chars = 0
        for index, page in enumerate(reader.pages, 1):
            extracted = page.extract_text() or ""
            total_chars += len(extracted)
            if total_chars > MAX_TEXT_CHARS:
                raise ValueError("PDF text exceeds extraction limits")
            candidates.extend(_text_rows(extracted, f"PDF, стр. {index}"))
            if len(candidates) > MAX_ROWS:
                break
    if len(candidates) > MAX_ROWS:
        raise ValueError(f"План содержит более {MAX_ROWS} пунктов. Разделите файл на части.")
    seen: set[str] = set()
    rows: list[TaskPlanImportRow] = []
    for candidate in candidates:
        key = candidate.title.casefold()
        warning = "Похожий пункт уже есть в файле — проверьте дубль" if key in seen else None
        seen.add(key)
        rows.append(TaskPlanImportRow(
            title=candidate.title, source=candidate.source, warning=warning,
            assignee_hint=candidate.assignee_hint,
            coexecutors_hint=candidate.coexecutors_hint,
            group_key=candidate.group_key,
            due_date_hint=candidate.due_date_hint,
        ))
    if not rows:
        raise ValueError("No plan text found. Scanned PDFs require OCR; add a plan manually")
    return TaskPlanImportPreview(suggested_title=PurePath(filename).stem[:240], rows=rows)
