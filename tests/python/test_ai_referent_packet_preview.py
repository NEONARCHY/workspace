"""Packet previews keep the same object scope, publication and integrity as downloads."""

import hashlib
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import httpx
import pytest
from fastapi import FastAPI, HTTPException, Response

from yuksalish_api.file_preview import OfficePreview
from yuksalish_api.routers import ai_referent_shared as api


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"


def configure(monkeypatch: pytest.MonkeyPatch) -> tuple[MagicMock, AsyncMock, AsyncMock]:
    content = b"synthetic document"
    request = MagicMock()
    metadata = AsyncMock(return_value={
        "storage_key": "private/key", "sha256": hashlib.sha256(content).hexdigest(),
        "byte_size": len(content),
        "relative_path": "published/letter.docx", "content_type": "application/octet-stream",
    })
    storage = MagicMock(get=AsyncMock(return_value=content))
    monkeypatch.setattr(api, "require_packet_access", AsyncMock())
    monkeypatch.setattr(api, "file_metadata", metadata)
    monkeypatch.setattr(api, "_storage", lambda _: storage)
    return request, metadata, storage.get


@pytest.mark.anyio
@pytest.mark.parametrize("kind", ["incoming", "outgoing", "archive", "journal"])
async def test_word_preview_uses_download_guards_and_converter(
    monkeypatch: pytest.MonkeyPatch, kind: api.Kind,
) -> None:
    request, metadata, get = configure(monkeypatch)
    convert = AsyncMock(return_value=Response(b"%PDF-test", media_type="application/pdf"))
    monkeypatch.setattr(api, "render_word_pdf", convert)
    owner, file = uuid4(), uuid4()
    result = await api.preview_packet_file(kind, owner, file, request, None, None, "packet", 0, 0)
    assert result.body == b"%PDF-test"
    api.require_packet_access.assert_awaited_once_with(None, None, kind, owner)
    assert metadata.await_args.args == (None, kind, owner, file, "packet")
    get.assert_awaited_once_with("private/key")
    convert.assert_awaited_once_with(
        request.app.state.settings, "published/letter.docx", b"synthetic document"
    )


@pytest.mark.anyio
async def test_oversized_packet_is_rejected_before_storage_read(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    request, metadata, get = configure(monkeypatch)
    metadata.return_value["byte_size"] = 26 * 1024 * 1024
    with pytest.raises(HTTPException) as failure:
        await api.preview_packet_file(
            "incoming", uuid4(), uuid4(), request, None, None, "packet", 0, 0
        )
    assert failure.value.status_code == 413
    get.assert_not_awaited()


@pytest.mark.anyio
@pytest.mark.parametrize("stage,status", [("scope", 403), ("file", 404), ("checksum", 503)])
async def test_denied_hidden_or_changed_file_never_reaches_converter(
    monkeypatch: pytest.MonkeyPatch, stage: str, status: int,
) -> None:
    request, metadata, get = configure(monkeypatch)
    if stage == "scope":
        api.require_packet_access.side_effect = HTTPException(403, "Forbidden")
    elif stage == "file":
        metadata.side_effect = HTTPException(404, "Not published")
    else:
        get.return_value = b"tampered"
    convert = AsyncMock()
    monkeypatch.setattr(api, "render_word_pdf", convert)
    with pytest.raises(HTTPException) as failure:
        await api.preview_packet_file(
            "outgoing", uuid4(), uuid4(), request, None, None, "attachment", 0, 0
        )
    assert failure.value.status_code == status
    convert.assert_not_awaited()
    if stage != "checksum":
        get.assert_not_awaited()


@pytest.mark.anyio
async def test_excel_preview_is_private_bounded_json(monkeypatch: pytest.MonkeyPatch) -> None:
    request, metadata, _get = configure(monkeypatch)
    metadata.return_value["relative_path"] = "register.xlsx"
    parse = MagicMock(return_value=OfficePreview(kind="excel", rows=[["value"]]))
    monkeypatch.setattr(api, "preview_office", parse)
    result = await api.preview_packet_file(
        "journal", uuid4(), uuid4(), request, None, None, "packet", 2, 200
    )
    assert isinstance(result, Response)
    assert result.headers["cache-control"] == "private, no-store"
    assert result.headers["x-content-type-options"] == "nosniff"
    assert result.media_type == "application/json"
    parse.assert_called_once_with("register.xlsx", b"synthetic document", 2, 200)


@pytest.mark.anyio
async def test_invalid_office_is_explicit_and_does_not_expose_parser_details(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    request, metadata, _get = configure(monkeypatch)
    metadata.return_value["relative_path"] = "register.xlsx"
    monkeypatch.setattr(api, "preview_office", MagicMock(side_effect=ValueError("private detail")))
    with pytest.raises(HTTPException) as failure:
        await api.preview_packet_file(
            "journal", uuid4(), uuid4(), request, None, None, "packet", 0, 0
        )
    assert failure.value.status_code == 422
    assert "private detail" not in failure.value.detail


@pytest.mark.anyio
async def test_http_preview_requires_session_and_validates_source_and_pagination(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _request, _metadata, get = configure(monkeypatch)
    app = FastAPI()
    app.include_router(api.router)

    async def connection() -> None:
        return None

    async def unauthorized() -> None:
        raise HTTPException(401, "Session required")

    async def user() -> object:
        return MagicMock()

    app.dependency_overrides[api.get_connection] = connection
    app.dependency_overrides[api.require_user] = unauthorized
    path = f"/ai-referent/packets/outgoing/{uuid4()}/files/{uuid4()}/preview"
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        assert (await client.get(path)).status_code == 401
        app.dependency_overrides[api.require_user] = user
        for query in ["source=other", "sheet=-1", "offset=150001"]:
            assert (await client.get(path + "?" + query)).status_code == 422
    get.assert_not_awaited()
