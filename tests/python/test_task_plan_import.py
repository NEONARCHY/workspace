"""Plan document preview never persists data and surfaces uncertain rows for review."""

from io import BytesIO
from xml.sax.saxutils import escape
from zipfile import ZipFile

import openpyxl  # type: ignore[import-untyped]
import pytest
from reportlab.pdfgen.canvas import Canvas

from yuksalish_api.access_control import request_module_action
from yuksalish_api.task_plan_import import preview_plan_document
from yuksalish_api.task_plan_schemas import MAX_PLAN_IMPORT_ITEMS, TaskPlanImportConfirm


def test_import_routes_require_task_creation_permission() -> None:
    for path in ("preview", "confirm"):
        assert request_module_action(f"/api/v1/task-plans/import/{path}", "POST") == (
            "tasks", "create",
        )


def test_txt_preview_tracks_sources_and_warns_about_duplicates() -> None:
    preview = preview_plan_document(
        "иш режа.txt", ("1. Подготовить план работ\n2. Подготовить план работ\n"
        "3. Провести обучение сотрудников").encode(),
    )
    assert preview.suggested_title == "иш режа"
    assert len(preview.rows) == 3
    assert preview.rows[1].warning is not None
    assert preview.rows[2].source == "TXT, строка 3"


def test_xlsx_preview_picks_activity_not_budget_and_skips_hidden_sheet() -> None:
    book = openpyxl.Workbook()
    sheet = book.active
    assert sheet is not None
    sheet.append(["№", "Activity", "Budget"])
    sheet.append([1, "Conduct a mapping and needs assessment of local CSOs", 5920])
    hidden = book.create_sheet("hidden")
    hidden.sheet_state = "hidden"
    hidden.append(["Private task that must not appear"])
    buffer = BytesIO()
    book.save(buffer)
    preview = preview_plan_document("plan.xlsx", buffer.getvalue())
    assert len(preview.rows) == 1
    assert preview.rows[0].source == "Sheet!2"
    assert "mapping" in preview.rows[0].title


def test_docx_preview_and_invalid_or_oversized_files() -> None:
    buffer = BytesIO()
    with ZipFile(buffer, "w") as archive:
        archive.writestr("word/document.xml", """<w:document
          xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
          <w:body><w:p><w:r><w:t>Conduct regional dialogue forums</w:t></w:r></w:p>
          </w:body></w:document>""")
    assert preview_plan_document("plan.docx", buffer.getvalue()).rows[0].title == (
        "Conduct regional dialogue forums"
    )
    with pytest.raises(ValueError):
        preview_plan_document("plan.txt", b" ")
    with pytest.raises(ValueError):
        preview_plan_document("plan.txt", b"x" * (10 * 1024 * 1024 + 1))


def test_docx_weekly_table_extracts_all_bullets_without_metadata() -> None:
    def cell(*lines: str) -> str:
        return "<w:tc>" + "".join(
            f"<w:p><w:r><w:t>{line.replace(chr(10), '</w:t><w:br/><w:t>')}</w:t>"
            "</w:r></w:p>" for line in lines
        ) + "</w:tc>"

    header = "<w:tr>" + "".join(cell(value) for value in (
        "№", "Ҳафта / муддат", "Бўлим раҳбари \u041d. Каримбердиева", "Мутахассис Ф. Шокирова",
        "Ҳамижрочилар", "Натижа/KPI",
    )) + "</w:tr>"
    weeks = []
    for week in range(15):
        first = [f"• Task {week}-{item} for manager" for item in range(5)]
        second = [f"• Task {week}-{item} for specialist" for item in range(5)]
        if week == 0:
            first[0] = "•Task 0-0 for manager"  # Some Word files omit space after bullet.
            first[1] = "• Multi-line\nsecond part of task"
        weeks.append("<w:tr>" + "".join((
            cell(str(week + 1)),
            cell("28 сентябрь \u2013 2 октябрь" if week == 0 else f"Week {week + 1}"),
            cell(*first), cell(*second),
            cell("Б. Самугов; Матбуот хизмати"), cell("KPI report text"),
        )) + "</w:tr>")
    document = ("<w:document xmlns:w=\"http://schemas.openxmlformats.org/"
                "wordprocessingml/2006/main\"><w:body><w:p><w:r>"
                "<w:t>Weekly plan heading 2026</w:t></w:r></w:p><w:tbl>"
                + header + "".join(weeks) + "</w:tbl></w:body></w:document>")
    buffer = BytesIO()
    with ZipFile(buffer, "w") as archive:
        archive.writestr("word/document.xml", document)

    preview = preview_plan_document("weekly.docx", buffer.getvalue())
    assert len(preview.rows) == 150
    assert preview.rows[0].title == "Task 0-0 for manager"
    assert preview.rows[1].title == "Multi-line second part of task"
    assert preview.rows[0].source == "DOCX, таблица 1, строка 2, столбец 3"
    assert preview.rows[-1].source == "DOCX, таблица 1, строка 16, столбец 4"
    assert preview.rows[0].assignee_hint == "\u041d. Каримбердиева"
    assert preview.rows[5].assignee_hint == "Ф. Шокирова"
    assert preview.rows[0].due_date_hint is not None
    assert preview.rows[0].due_date_hint.isoformat() == "2026-10-02"
    assert preview.rows[10].due_date_hint is None
    assert preview.rows[5].coexecutors_hint == "Б. Самугов; Матбуот хизмати"
    assert preview.rows[0].group_key == preview.rows[5].group_key
    assert preview.rows[0].group_key != preview.rows[10].group_key
    assert preview.model_dump(by_alias=True)["rows"][0]["assigneeHint"] == (
        "\u041d. Каримбердиева"
    )
    assert not any("KPI" in row.title or "Самугов" in row.title for row in preview.rows)


def test_docx_table_uses_each_rows_responsible_and_exact_deadline() -> None:
    def cell(text: str) -> str:
        return f"<w:tc><w:p><w:r><w:t>{text}</w:t></w:r></w:p></w:tc>"

    headings = ("№", "Задача / мероприятие", "Срок", "Ответственный",
                "Ҳамижрочилар / соисполнители", "Результат / KPI")
    values = (
        ("1", "• Подготовить отчёт", "02.10.2026", "\u041d. Каримбердиева",
         "Б. Самугов", "Отчёт готов"),
        ("2", "• Провести встречу", "03.10.2026", "Ф. Шокирова",
         "Б. Самугов", "Встреча проведена"),
        ("3", "• Согласовать бюджет", "32.10.2026", "Неизвестный сотрудник",
         "", "Бюджет согласован"),
    )
    table = "".join("<w:tr>" + "".join(cell(text) for text in row) + "</w:tr>"
                    for row in (headings, *values))
    document = ("<w:document xmlns:w=\"http://schemas.openxmlformats.org/"
                "wordprocessingml/2006/main\"><w:body><w:tbl>"
                + table + "</w:tbl></w:body></w:document>")
    buffer = BytesIO()
    with ZipFile(buffer, "w") as archive:
        archive.writestr("word/document.xml", document)

    preview = preview_plan_document("plan.docx", buffer.getvalue())
    assert [row.title for row in preview.rows] == [
        "Подготовить отчёт", "Провести встречу", "Согласовать бюджет",
    ]
    assert [row.assignee_hint for row in preview.rows] == [
        "\u041d. Каримбердиева", "Ф. Шокирова", "Неизвестный сотрудник",
    ]
    assert [row.due_date_hint.isoformat() if row.due_date_hint else None
            for row in preview.rows] == ["2026-10-02", "2026-10-03", None]
    assert preview.model_dump(mode="json", by_alias=True)["rows"][0]["dueDateHint"] == (
        "2026-10-02"
    )
    assert not any("Отчёт готов" in row.title for row in preview.rows)


def test_annual_work_plan_preserves_columns_and_conservative_completion() -> None:
    def cell(*lines: str, green: bool = False) -> str:
        color = '<w:rPr><w:color w:val="00B050"/></w:rPr>' if green else ""
        return "<w:tc>" + "".join(
            f"<w:p><w:r>{color}<w:t>{escape(line)}</w:t></w:r></w:p>"
            for line in lines
        ) + "</w:tc>"

    header = ("№", "Тадбирнинг номи", "Муддати", "Амалга ошириш механизми",
              "Бажарувчи", "Масъул", "Бажарилган ишлар")
    completed = ("1", "Тадбирни ташкил этиш", "Март", "Б. Мардаев; ҳудудий бўлинмалар",
                 "Д. Лютфиддинов", "Тадбир ўтказилди")
    recurring = ("2", "Мунтазам мониторинг ўтказиш", "Ҳар ойда", "1. Ҳисобот бериш",
                 "Б. Мардаев", "Д. Лютфиддинов", "Мониторинг давом этмоқда")
    table = "<w:tbl>" + "<w:tr>" + "".join(cell(value) for value in header) + "</w:tr>"
    table += "<w:tr>" + cell("I. БЎЛИМ") + "</w:tr>"
    table += ("<w:tr>" + "".join(cell(value) for value in completed[:3])
              + cell("1. Режа тузиш", "2. Учрашув")
              + cell(completed[3]) + cell(completed[4])
              + cell(completed[5], green=True) + "</w:tr>")
    table += "<w:tr>" + "".join(
        cell(value, green=index == 6) for index, value in enumerate((
            recurring[0], recurring[1], recurring[2], recurring[3],
            recurring[4], recurring[5], recurring[6],
        ))
    ) + "</w:tr></w:tbl>"
    document = ('<w:document xmlns:w="http://schemas.openxmlformats.org/'
                'wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>'
                'ИШ РЕЖА 2026</w:t></w:r></w:p>' + table + '</w:body></w:document>')
    buffer = BytesIO()
    with ZipFile(buffer, "w") as archive:
        archive.writestr("word/document.xml", document)
    preview = preview_plan_document("annual.docx", buffer.getvalue())
    assert preview.annual_work_plan
    assert preview.suggested_title == "Иш режа 2026"
    assert len(preview.rows) == 2
    first, second = preview.rows
    assert first.title == "Тадбирни ташкил этиш"
    assert first.assignee_hint == "Д. Лютфиддинов"
    assert first.coexecutors_hint == "Б. Мардаев; ҳудудий бўлинмалар"
    assert first.due_date_hint is not None and first.due_date_hint.isoformat() == "2026-03-31"
    assert first.mechanism_items == ["Режа тузиш", "Учрашув"]
    assert first.completed_work_text == "Тадбир ўтказилди"
    assert first.green_completion and not first.deadline_needs_review
    assert first.section == "I. БЎЛИМ"
    assert second.due_date_hint is None and second.deadline_needs_review


def test_pdf_text_preview_and_candidate_limit() -> None:
    stream = BytesIO()
    canvas = Canvas(stream)
    canvas.drawString(70, 700, "Conduct regional dialogue forums")
    canvas.save()
    preview = preview_plan_document("plan.pdf", stream.getvalue())
    assert preview.rows[0].source == "PDF, стр. 1, строка 1"
    with pytest.raises(ValueError, match=str(MAX_PLAN_IMPORT_ITEMS)):
        preview_plan_document("plan.txt", "\n".join(
            f"Task number {index}: conduct forum" for index in range(MAX_PLAN_IMPORT_ITEMS + 1)
        ).encode())


def test_confirm_payload_requires_link_target_and_nonblank_title() -> None:
    valid = {"operationId": "94b1a84b-2ab9-483f-a28b-6413c7b6de8a",
             "plan": {"title": "Иш режа"}}
    with pytest.raises(ValueError):
        TaskPlanImportConfirm.model_validate({**valid, "items": [{
            "title": "Task", "source": "TXT, строка 1", "mode": "link",
        }]})
    with pytest.raises(ValueError):
        TaskPlanImportConfirm.model_validate({**valid, "items": [{
            "title": "  ", "source": "TXT, строка 1", "mode": "create",
        }]})
    items = [{"title": f"Task {index}", "source": "DOCX, таблица 1",
              "mode": "create"} for index in range(150)]
    assert len(TaskPlanImportConfirm.model_validate({**valid, "items": items}).items) == 150
    with pytest.raises(ValueError):
        TaskPlanImportConfirm.model_validate({**valid, "items": items * 2})
    co_assignee = "e0e04184-a101-4fba-8674-33c5f72d4ee6"
    with pytest.raises(ValueError, match="unique"):
        TaskPlanImportConfirm.model_validate({**valid, "items": [{
            "title": "Task", "source": "DOCX", "mode": "create",
            "coAssigneeIds": [co_assignee, co_assignee],
        }]})
    with pytest.raises(ValueError, match="cannot also"):
        TaskPlanImportConfirm.model_validate({**valid, "items": [{
            "title": "Task", "source": "DOCX", "mode": "create",
            "assigneeId": co_assignee, "coAssigneeIds": [co_assignee],
        }]})
