from io import BytesIO
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4
from zipfile import ZipFile

import openpyxl  # type: ignore[import-untyped]
import pytest
from fastapi import HTTPException, Response

from yuksalish_api.file_preview import preview_office
from yuksalish_api.repository import WorkspaceRepositoryError
from yuksalish_api.routers import workspace


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"


def word(xml: str) -> bytes:
    stream = BytesIO()
    with ZipFile(stream, "w") as archive:
        archive.writestr("word/document.xml", xml)
    return stream.getvalue()


def test_word_preserves_text_table_order_without_html() -> None:
    xml = '''<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
    <w:body><w:p><w:r><w:t>&lt;script&gt;text&lt;/script&gt;</w:t></w:r></w:p>
    <w:tbl><w:tr><w:tc><w:p><w:r><w:t>cell</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
    <w:p><w:r><w:t>last</w:t></w:r></w:p></w:body></w:document>'''
    result = preview_office("file.docx", word(xml), 0, 0)
    assert [block.kind for block in result.blocks] == ["paragraph", "table", "paragraph"]
    assert result.blocks[0].text == "<script>text</script>"
    assert result.blocks[1].rows == [["cell"]]


def test_excel_pages_sheets_and_keeps_uncached_formulas_as_text() -> None:
    book = openpyxl.Workbook()
    sheet = book.active
    sheet.title = "First"
    for index in range(420):
        sheet.append([index + 1, "=A1+1" if index == 0 else "value"])
    book.create_sheet("Second").append(["last"])
    stream = BytesIO()
    book.save(stream)
    content = stream.getvalue()
    first = preview_office("book.xlsx", content, 0, 0)
    assert first.rows[0] == ["1", "=A1+1"]
    assert len(first.rows) == 200
    assert first.total_rows == 420
    assert preview_office("book.xlsx", content, 0, 400).rows[0][0] == "401"
    assert preview_office("book.xlsx", content, 1, 0).rows == [["last"]]
    with pytest.raises(ValueError, match="Лист"):
        preview_office("book.xlsx", content, 3, 0)


def test_rejects_malformed_and_unsafe_office_packages() -> None:
    with pytest.raises(ValueError):
        preview_office("file.docx", b"not a document", 0, 0)
    stream = BytesIO()
    with ZipFile(stream, "w") as archive:
        archive.writestr("word/document.xml", "<root/>")
        archive.writestr("word/vbaProject.bin", b"macro")
    with pytest.raises(ValueError, match="Macros"):
        preview_office("file.docx", stream.getvalue(), 0, 0)


@pytest.mark.anyio
async def test_preview_uses_existing_attachment_and_module_authorization(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    get = AsyncMock(side_effect=WorkspaceRepositoryError(403, "Forbidden"))
    monkeypatch.setattr(workspace, "get_attachment", get)
    storage = MagicMock()
    storage.get = AsyncMock()
    monkeypatch.setattr(workspace, "_object_storage", lambda _: storage)
    with pytest.raises(HTTPException) as failure:
        await workspace.preview_attachment(
            uuid4(), MagicMock(), MagicMock(), AsyncMock(), Response(), 0, 0,
        )
    assert failure.value.status_code == 403
    storage.get.assert_not_awaited()


@pytest.mark.anyio
async def test_preview_returns_private_response_and_checks_module(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    metadata = MagicMock(owner_type="task", file_name="file.docx")
    monkeypatch.setattr(workspace, "get_attachment", AsyncMock(return_value=(metadata, "file")))
    access = AsyncMock()
    monkeypatch.setattr(workspace, "ensure_module_action", access)
    storage = MagicMock()
    storage.get = AsyncMock(return_value=word(
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
        '<w:body><w:p><w:r><w:t>hello</w:t></w:r></w:p></w:body></w:document>',
    ))
    monkeypatch.setattr(workspace, "_object_storage", lambda _: storage)
    response = Response()
    result = await workspace.preview_attachment(
        uuid4(), MagicMock(), MagicMock(), AsyncMock(), response, 0, 0,
    )
    assert result.blocks[0].text == "hello"
    assert response.headers["Cache-Control"] == "private, no-store"
    assert access.await_args.args[-2:] == ("tasks", "view")


@pytest.mark.anyio
async def test_module_denial_does_not_read_file(monkeypatch: pytest.MonkeyPatch) -> None:
    metadata = MagicMock(owner_type="task", file_name="file.docx")
    monkeypatch.setattr(workspace, "get_attachment", AsyncMock(return_value=(metadata, "file")))
    monkeypatch.setattr(workspace, "ensure_module_action", AsyncMock(
        side_effect=HTTPException(status_code=403, detail="Forbidden"),
    ))
    storage = MagicMock()
    storage.get = AsyncMock()
    monkeypatch.setattr(workspace, "_object_storage", lambda _: storage)
    with pytest.raises(HTTPException) as failure:
        await workspace.preview_attachment(
            uuid4(), MagicMock(), MagicMock(), AsyncMock(), Response(), 0, 0,
        )
    assert failure.value.status_code == 403
    storage.get.assert_not_awaited()
