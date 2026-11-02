"""Bounded, read-only XLSX preview. Uploaded bytes are never persisted."""

import re
from datetime import date, datetime
from io import BytesIO
from zoneinfo import ZoneInfo

import openpyxl  # type: ignore[import-untyped]

from .project_import_documents import checked_zip
from .task_proposal_schemas import TaskProposalImportPreview, TaskProposalImportRow

MAX_IMPORT_BYTES = 5 * 1024 * 1024
_HEADERS = {
    "nomi": "title",
    "название": "title",
    "названиезадачи": "title",
    "title": "title",
    "tavsif": "description",
    "описание": "description",
    "description": "description",
    "muddat": "deadline",
    "срок": "deadline",
    "deadline": "deadline",
    "ijrochi": "assignee",
    "исполнитель": "assignee",
    "ответственный": "assignee",
    "hamijrochilar": "helpers",
    "соисполнители": "helpers",
    "coexecutors": "helpers",
    "izoh": "note",
    "примечание": "note",
    "примечания": "note",
    "note": "note",
}


def _text(value: object) -> str:
    return str(value).strip() if value is not None else ""


def _header(value: object) -> str:
    return re.sub(r"[\s_'\-\u2018\u2019\u02bc\u02bb`]+", "", _text(value).casefold())


def _deadline(value: object) -> tuple[date | None, datetime | None, str]:
    if isinstance(value, datetime):
        with_time = value.hour or value.minute or value.second
        aware = value.replace(tzinfo=ZoneInfo("Asia/Tashkent")) if with_time else None
        return value.date(), aware, value.strftime("%d.%m.%Y %H:%M" if with_time else "%d.%m.%Y")
    if isinstance(value, date):
        return value, None, value.strftime("%d.%m.%Y")
    text = _text(value)
    for pattern in ("%d.%m.%Y", "%Y-%m-%d"):
        try:
            return datetime.strptime(text, pattern).date(), None, text
        except ValueError:
            continue
    return None, None, text


def preview_proposal_workbook(filename: str, content: bytes) -> TaskProposalImportPreview:
    filename = filename.replace("\\", "/").rsplit("/", 1)[-1]
    if not filename.casefold().endswith(".xlsx"):
        raise ValueError("Выберите XLSX. Обязательные колонки: Nomi, Tavsif, Muddat, Ijrochi")
    if not content or len(content) > MAX_IMPORT_BYTES:
        raise ValueError("Размер XLSX должен быть от 1 байта до 5 МБ")
    if len(filename) > 240:
        raise ValueError("Слишком длинное имя файла")
    checked_zip(content)
    book = openpyxl.load_workbook(
        BytesIO(content), read_only=True, data_only=False, keep_links=False
    )
    rows: list[TaskProposalImportRow] = []
    text_size = 0
    try:
        if len(book.worksheets) > 10:
            raise ValueError("Допустимо не более 10 листов")
        for sheet in book:
            if sheet.sheet_state != "visible":
                continue
            if sheet.max_row > 500 or sheet.max_column > 30:
                raise ValueError("Допустимо не более 500 строк и 30 колонок на листе")
            columns: dict[str, int] = {}
            for number, cells in enumerate(sheet.iter_rows(max_row=500, max_col=30), 1):
                if not columns:
                    if number > 10:
                        break
                    found = {
                        _HEADERS[_header(cell.value)]: index
                        for index, cell in enumerate(cells)
                        if _header(cell.value) in _HEADERS
                    }
                    if {"title", "assignee"} <= found.keys():
                        columns = found
                    continue
                values = {key: cells[index].value for key, index in columns.items()}
                if not any(value is not None and _text(value) for value in values.values()):
                    continue
                key = f"{sheet.title}!{number}"
                if any(cells[index].data_type == "f" for index in columns.values()):
                    raise ValueError(f"{key}: замените формулы обычными значениями перед импортом")
                title = _text(values.get("title"))
                description = _text(values.get("description"))
                note = _text(values.get("note"))
                assignee = _text(values.get("assignee"))
                helpers = [
                    part.strip()
                    for part in re.split(r"[,;\n]", _text(values.get("helpers")))
                    if part.strip()
                ]
                if len(title) > 2000 or len(description) + len(note) > 20_000:
                    raise ValueError(f"{key}: слишком длинный текст")
                if len(assignee) > 240 or len(helpers) > 100 or any(len(x) > 240 for x in helpers):
                    raise ValueError(f"{key}: проверьте список исполнителей")
                due_date, due_at, deadline_text = _deadline(values.get("deadline"))
                warnings: list[str] = []
                if not assignee or _header(assignee) in {"aniqlashkerak", "нужноопределить"}:
                    warnings.append("Файл: исполнитель не указан")
                if len(title) > 240:
                    warnings.append("Сократите название до 240 знаков")
                if due_date and due_at is None:
                    warnings.append("Файл содержит дату без времени")
                elif deadline_text and due_date is None:
                    warnings.append("Срок указан текстом и требует проверки")
                if "taxminan" in note.casefold():
                    warnings.append("Файл содержит предварительного исполнителя")
                if any("\ufffd" in _text(value) for value in values.values()):
                    warnings.append(
                        "Исходный текст содержит повреждённые символы — проверьте строку"
                    )
                text_size += sum(len(_text(value)) for value in values.values())
                if text_size > 200_000:
                    raise ValueError("Текст файла превышает 200 000 знаков")
                rows.append(
                    TaskProposalImportRow(
                        source_key=key,
                        number_hint=_text(cells[0].value),
                        title=title,
                        description=description,
                        assignee_hint=assignee,
                        coexecutor_hints=helpers,
                        due_date_hint=due_date,
                        due_at_hint=due_at,
                        deadline_text=deadline_text,
                        note=note,
                        warnings=warnings,
                    )
                )
                if len(rows) > 100:
                    raise ValueError("Максимум для одного импорта: 100 задач")
    finally:
        book.close()
    if not rows:
        raise ValueError(
            "Отсутствуют строки: нужны заголовки Nomi/Ijrochi или Название/Исполнитель",
        )
    return TaskProposalImportPreview(source_name=filename, rows=rows)
