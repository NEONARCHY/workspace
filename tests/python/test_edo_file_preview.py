from collections.abc import AsyncGenerator
from io import BytesIO
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4
from zipfile import ZipFile

import pytest
from fastapi import HTTPException, Response

from yuksalish_api.edo_schemas import EdoAttachment, EdoIncomingDetail, EdoIncomingLetter
from yuksalish_api.edo_scope import EdoReadScope
from yuksalish_api.edo_service import EdoBridgeError
from yuksalish_api.routers import edo_incoming


def document() -> bytes:
    buffer = BytesIO()
    with ZipFile(buffer, "w") as archive:
        archive.writestr(
            "word/document.xml",
            '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
            '<w:body><w:p><w:r><w:t>External content</w:t></w:r></w:p></w:body></w:document>',
        )
    return buffer.getvalue()


async def chunks(content: bytes) -> AsyncGenerator[bytes, None]:
    yield content


def configure(monkeypatch: pytest.MonkeyPatch) -> tuple[AsyncMock, AsyncMock, EdoReadScope]:
    scope = EdoReadScope()
    monkeypatch.setattr(edo_incoming, "ensure_module_action", AsyncMock())
    monkeypatch.setattr(edo_incoming, "resolve_read_scope", AsyncMock(return_value=scope))
    read = AsyncMock(return_value=EdoIncomingDetail(data=EdoIncomingLetter(
        id=17, attachments=[EdoAttachment(id="doc", name="letter.docx", size=1000)],
    )))
    stream = AsyncMock(return_value=chunks(document()))
    monkeypatch.setattr(edo_incoming, "get_letter", read)
    monkeypatch.setattr(edo_incoming, "stream_attachment", stream)
    return read, stream, scope


@pytest.mark.anyio
async def test_office_preview_preserves_read_scope_and_never_mutates_edo(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    read, stream, scope = configure(monkeypatch)
    response = Response()
    user = MagicMock(id=uuid4())
    result = await edo_incoming.incoming_office_preview(
        17, "doc", MagicMock(), response, user, AsyncMock(), 0, 0,
    )
    assert result.blocks[0].text == "External content"
    assert response.headers["Cache-Control"] == "no-store, private"
    assert read.await_args.kwargs["read_scope"] is scope
    assert stream.await_args.kwargs["read_scope"] is scope
    assert stream.await_args.args[1:4] == (user.id, 17, "doc")


@pytest.mark.anyio
async def test_permission_denial_never_reads_edo(monkeypatch: pytest.MonkeyPatch) -> None:
    read, stream, _ = configure(monkeypatch)
    monkeypatch.setattr(edo_incoming, "ensure_module_action", AsyncMock(
        side_effect=HTTPException(403, "Forbidden"),
    ))
    with pytest.raises(HTTPException) as failure:
        await edo_incoming.incoming_office_preview(
            17, "doc", MagicMock(), Response(), MagicMock(), AsyncMock(), 0, 0,
        )
    assert failure.value.status_code == 403
    read.assert_not_awaited()
    stream.assert_not_awaited()


@pytest.mark.anyio
@pytest.mark.parametrize("mode, code", [("missing", 404), ("forbidden", 403), ("large", 422)])
async def test_invalid_or_inaccessible_metadata_does_not_download(
    monkeypatch: pytest.MonkeyPatch, mode: str, code: int,
) -> None:
    read, stream, _ = configure(monkeypatch)
    if mode == "forbidden":
        read.side_effect = EdoBridgeError(403, "Forbidden")
    elif mode == "large":
        monkeypatch.setattr(edo_incoming, "MAX_PREVIEW_BYTES", 10)
    with pytest.raises(HTTPException) as failure:
        await edo_incoming.incoming_office_preview(
            17, "missing" if mode == "missing" else "doc", MagicMock(), Response(),
            MagicMock(), AsyncMock(), 0, 0,
        )
    assert failure.value.status_code == code
    stream.assert_not_awaited()


@pytest.mark.anyio
async def test_stream_size_limit_closes_upstream(monkeypatch: pytest.MonkeyPatch) -> None:
    read, stream, _ = configure(monkeypatch)
    read.return_value.data.attachments[0].size = 1
    monkeypatch.setattr(edo_incoming, "MAX_PREVIEW_BYTES", 10)
    closed = False

    async def oversized() -> AsyncGenerator[bytes, None]:
        nonlocal closed
        try:
            yield b"12345678901"
        finally:
            closed = True

    stream.return_value = oversized()
    with pytest.raises(HTTPException) as failure:
        await edo_incoming.incoming_office_preview(
            17, "doc", MagicMock(), Response(), MagicMock(), AsyncMock(), 0, 0,
        )
    assert failure.value.status_code == 422
    assert closed


@pytest.mark.anyio
async def test_malformed_document_is_not_reported_as_success(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _, stream, _ = configure(monkeypatch)
    stream.return_value = chunks(b"not a document")
    with pytest.raises(HTTPException) as failure:
        await edo_incoming.incoming_office_preview(
            17, "doc", MagicMock(), Response(), MagicMock(), AsyncMock(), 0, 0,
        )
    assert failure.value.status_code == 422
