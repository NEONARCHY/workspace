from io import BytesIO
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4
from zipfile import ZipFile

import httpx
import pytest
from fastapi import HTTPException, Response

from yuksalish_api import office_pdf_preview as preview
from yuksalish_api.repository import WorkspaceRepositoryError
from yuksalish_api.routers import workspace
from yuksalish_api.settings import Settings


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"


def docx(macro: bool = False) -> bytes:
    stream = BytesIO()
    with ZipFile(stream, "w") as archive:
        archive.writestr("word/document.xml", "<document/>")
        if macro:
            archive.writestr("word/vbaProject.bin", b"macro")
    return stream.getvalue()


def transport(monkeypatch: pytest.MonkeyPatch, status: int, content: bytes) -> list[str]:
    paths: list[str] = []

    def reply(request: httpx.Request) -> httpx.Response:
        paths.append(request.url.path)
        return httpx.Response(status, content=content)

    monkeypatch.setattr(
        preview.httpx,
        "AsyncHTTPTransport",
        lambda **_: httpx.MockTransport(reply),
    )
    return paths


@pytest.mark.anyio
@pytest.mark.parametrize(
    "name,data", [("document.docx", docx()), ("document.doc", b"{\\rtf1 text}")]
)
async def test_render_returns_private_pdf_without_changing_source(
    monkeypatch: pytest.MonkeyPatch,
    name: str,
    data: bytes,
) -> None:
    paths = transport(monkeypatch, 200, b"%PDF-1.7\nsynthetic")
    original = bytes(data)
    response = await preview.render_word_pdf(
        Settings(office_preview_socket="/private/socket"),
        name,
        data,
    )
    assert response.media_type == "application/pdf"
    assert response.headers["cache-control"] == "private, no-store"
    assert response.headers["x-content-type-options"] == "nosniff"
    assert response.body.startswith(b"%PDF-")
    assert data == original
    assert paths == ["/docx" if name.endswith("docx") else "/doc"]


@pytest.mark.anyio
@pytest.mark.parametrize("status", [422, 503, 504])
async def test_converter_failure_is_not_a_successful_preview(
    monkeypatch: pytest.MonkeyPatch,
    status: int,
) -> None:
    transport(monkeypatch, status, b"private engine failure")
    with pytest.raises(HTTPException) as error:
        await preview.render_word_pdf(Settings(office_preview_socket="/socket"), "f.docx", docx())
    assert error.value.status_code == status
    assert "private engine failure" not in error.value.detail


@pytest.mark.anyio
async def test_rejects_invalid_macro_and_oversized_inputs_before_conversion(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    paths = transport(monkeypatch, 200, b"%PDF-test")
    for name, data in [("f.doc", b"<html>not doc"), ("f.doc", b"")]:
        with pytest.raises(HTTPException) as error:
            await preview.render_word_pdf(Settings(office_preview_socket="/socket"), name, data)
        assert error.value.status_code == 422
    with pytest.raises(ValueError, match="Macros"):
        await preview.render_word_pdf(
            Settings(office_preview_socket="/socket"), "f.docx", docx(True)
        )
    monkeypatch.setattr(preview, "MAX_FILE_BYTES", 4)
    with pytest.raises(HTTPException) as error:
        await preview.render_word_pdf(Settings(office_preview_socket="/socket"), "f.docx", docx())
    assert error.value.status_code == 422
    assert not paths


@pytest.mark.anyio
async def test_bounds_output_and_rejects_non_pdf(monkeypatch: pytest.MonkeyPatch) -> None:
    transport(monkeypatch, 200, b"not a PDF")
    with pytest.raises(HTTPException) as error:
        await preview.render_word_pdf(Settings(office_preview_socket="/socket"), "f.docx", docx())
    assert error.value.status_code == 422
    transport(monkeypatch, 200, b"%PDF-" + b"x" * 20)
    monkeypatch.setattr(preview, "MAX_PDF_BYTES", 10)
    with pytest.raises(HTTPException) as error:
        await preview.render_word_pdf(Settings(office_preview_socket="/socket"), "f.docx", docx())
    assert error.value.status_code == 422


@pytest.mark.anyio
async def test_unconfigured_converter_is_explicit() -> None:
    with pytest.raises(HTTPException) as error:
        await preview.render_word_pdf(Settings(office_preview_socket=""), "f.docx", docx())
    assert error.value.status_code == 503


@pytest.mark.anyio
@pytest.mark.parametrize("deny_module", [False, True])
async def test_attachment_denial_never_calls_converter_or_reads_storage(
    monkeypatch: pytest.MonkeyPatch,
    deny_module: bool,
) -> None:
    metadata = MagicMock(owner_type="task", file_name="f.doc")
    get = (
        AsyncMock(return_value=(metadata, "file"))
        if deny_module
        else AsyncMock(
            side_effect=WorkspaceRepositoryError(403, "Forbidden"),
        )
    )
    monkeypatch.setattr(workspace, "get_attachment", get)
    monkeypatch.setattr(
        workspace,
        "ensure_module_action",
        AsyncMock(
            side_effect=HTTPException(403, "Forbidden"),
        ),
    )
    storage = MagicMock()
    storage.get = AsyncMock()
    monkeypatch.setattr(workspace, "_object_storage", lambda _: storage)
    convert = AsyncMock()
    monkeypatch.setattr(workspace, "render_word_pdf", convert)
    with pytest.raises(HTTPException) as error:
        await workspace.preview_attachment(
            uuid4(),
            MagicMock(),
            MagicMock(),
            AsyncMock(),
            Response(),
            0,
            0,
            render=True,
        )
    assert error.value.status_code == 403
    storage.get.assert_not_awaited()
    convert.assert_not_awaited()


@pytest.mark.anyio
async def test_authorized_doc_uses_converter_not_text_parser(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    metadata = MagicMock(owner_type="task", file_name="f.doc")
    monkeypatch.setattr(workspace, "get_attachment", AsyncMock(return_value=(metadata, "file")))
    access = AsyncMock()
    monkeypatch.setattr(workspace, "ensure_module_action", access)
    storage = MagicMock()
    storage.get = AsyncMock(return_value=b"legacy Word")
    monkeypatch.setattr(workspace, "_object_storage", lambda _: storage)
    convert = AsyncMock(return_value=Response(b"%PDF-", media_type="application/pdf"))
    monkeypatch.setattr(workspace, "render_word_pdf", convert)
    result = await workspace.preview_attachment(
        uuid4(),
        MagicMock(),
        MagicMock(),
        AsyncMock(),
        Response(),
        0,
        0,
        render=True,
    )
    assert isinstance(result, Response)
    assert result.media_type == "application/pdf"
    assert access.await_args.args[-2:] == ("tasks", "view")
    convert.assert_awaited_once()
