"""Plan document preview never persists data and surfaces uncertain rows for review."""

from io import BytesIO
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
        "№", "Ҳафта / муддат", "Раҳбар", "Мутахассис", "Ҳамижрочилар", "Натижа/KPI",
    )) + "</w:tr>"
    weeks = []
    for week in range(15):
        first = [f"• Task {week}-{item} for manager" for item in range(5)]
        second = [f"• Task {week}-{item} for specialist" for item in range(5)]
        if week == 0:
            first[0] = "•Task 0-0 for manager"  # Some Word files omit space after bullet.
            first[1] = "• Multi-line\nsecond part of task"
        weeks.append("<w:tr>" + "".join((
            cell(str(week + 1)), cell(f"Week {week + 1}"), cell(*first), cell(*second),
            cell("Co-executor name"), cell("KPI report text"),
        )) + "</w:tr>")
    document = ("<w:document xmlns:w=\"http://schemas.openxmlformats.org/"
                "wordprocessingml/2006/main\"><w:body><w:p><w:r>"
                "<w:t>Weekly plan heading</w:t></w:r></w:p><w:tbl>"
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
    assert not any("KPI" in row.title or "Co-executor" in row.title for row in preview.rows)


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
