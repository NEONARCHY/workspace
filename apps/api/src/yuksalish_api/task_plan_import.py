"""Read-only, bounded extraction of candidate task titles from a plan document.

This is deliberately conservative: dates and people are never assigned from prose.
Structured table names are hints for a reviewed confirm request, not user IDs.
"""

import re
from collections.abc import Iterator
from dataclasses import dataclass
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


@dataclass(frozen=True)
class _Candidate:
    title: str
    source: str
    assignee_hint: str | None = None
    coexecutors_hint: str | None = None
    group_key: str | None = None


class _XmlNode(Protocol):
    tag: str
    text: str | None

    def iter(self) -> Iterator["_XmlNode"]: ...


def _docx_paragraph_text(paragraph: _XmlNode, ns: str) -> str:
    separators = {ns + "br", ns + "cr", ns + "tab"}
    return "".join(
        " " if node.tag in separators else node.text or ""
        for node in paragraph.iter() if node.tag == ns + "t" or node.tag in separators
    )


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
        for table_number, table in enumerate(body.findall(ns + "tbl"), 1):
            header = table.find(ns + "tr")
            header_cells = ([" ".join(_docx_paragraph_text(paragraph, ns)
                                     for paragraph in cell.iter(ns + "p"))
                             for cell in header.findall(ns + "tc")] if header is not None else [])
            coexecutors_column = next((index for index, value in enumerate(header_cells)
                                       if "ҳамижрочи" in value.casefold()), None)
            leader_column = next((index for index, value in enumerate(header_cells)
                                  if "раҳбар" in value.casefold()), None)
            leader_match = (_PERSON_HEADING.search(header_cells[leader_column])
                            if leader_column is not None else None)
            leader_hint = leader_match.group(0) if leader_match is not None else None
            for row_number, row in enumerate(table.findall(ns + "tr"), 1):
                cells = row.findall(ns + "tc")
                coexecutors_hint = None
                group_key = None
                if (row_number > 1 and coexecutors_column is not None
                        and coexecutors_column < len(cells)):
                    coexecutors_hint = " ".join(" ".join(
                        _docx_paragraph_text(paragraph, ns).split()
                    ) for paragraph in cells[coexecutors_column].iter(ns + "p")).strip()[:1000]
                    group_key = f"DOCX, таблица {table_number}, строка {row_number}"
                for column_number, cell in enumerate(cells, 1):
                    if coexecutors_column is not None and column_number - 1 >= coexecutors_column:
                        continue
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
                            title[:240], source, leader_hint if group_key else None,
                            coexecutors_hint or None, group_key,
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
        ))
    if not rows:
        raise ValueError("No plan text found. Scanned PDFs require OCR; add a plan manually")
    return TaskPlanImportPreview(suggested_title=PurePath(filename).stem[:240], rows=rows)
