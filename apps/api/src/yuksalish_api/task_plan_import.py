"""Read-only, bounded extraction of candidate task titles from a plan document.

This is deliberately conservative: dates and people are never guessed from prose.
Every candidate is reviewed before a separate confirm request writes anything.
"""

import re
from io import BytesIO
from pathlib import PurePath
from zipfile import ZipFile

import openpyxl  # type: ignore[import-untyped]
from defusedxml import ElementTree
from pypdf import PdfReader

from .project_import_documents import checked_zip, document_type
from .task_plan_schemas import TaskPlanImportPreview, TaskPlanImportRow

MAX_PLAN_BYTES = 10 * 1024 * 1024
MAX_ROWS = 100
MAX_TEXT_CHARS = 50_000
_NUMBER = re.compile(r"^\s*(?:\d+[.)]|\d+(?:\.\d+)+[.)]?|[•●▪-])\s*")


def _text_rows(text: str, location: str) -> list[tuple[str, str]]:
    if len(text) > MAX_TEXT_CHARS:
        raise ValueError("Document text exceeds extraction limits")
    rows: list[tuple[str, str]] = []
    for number, line in enumerate(text.splitlines(), 1):
        title = _NUMBER.sub("", " ".join(line.split())).strip()
        if len(title) < 5 or title.lower() in {"план работ", "иш режа", "мероприятия"}:
            continue
        rows.append((title[:240], f"{location}, строка {number}"))
        if len(rows) > MAX_ROWS:
            break
    return rows


def _docx_rows(content: bytes) -> list[tuple[str, str]]:
    with ZipFile(BytesIO(content)) as archive:
        root = ElementTree.fromstring(archive.read("word/document.xml"))
    ns = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
    paragraphs = ["".join(node.text or "" for node in paragraph.iter(ns + "t"))
                  for paragraph in root.iter(ns + "p")]
    return _text_rows("\n".join(paragraphs), "DOCX")


def _xlsx_rows(content: bytes) -> list[tuple[str, str]]:
    workbook = openpyxl.load_workbook(BytesIO(content), read_only=True, data_only=True,
                                      keep_links=False)
    rows: list[tuple[str, str]] = []
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
                rows.append((title[:240], f"{sheet.title}!{row_number}"))
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
        raise ValueError("Plan has more than 100 candidate items; split the document")
    seen: set[str] = set()
    rows: list[TaskPlanImportRow] = []
    for title, source in candidates:
        key = title.casefold()
        warning = "Похожий пункт уже есть в файле — проверьте дубль" if key in seen else None
        seen.add(key)
        rows.append(TaskPlanImportRow(title=title, source=source, warning=warning))
    if not rows:
        raise ValueError("No plan text found. Scanned PDFs require OCR; add a plan manually")
    return TaskPlanImportPreview(suggested_title=PurePath(filename).stem[:240], rows=rows)
