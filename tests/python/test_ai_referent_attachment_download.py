"""Draft DOCX downloads use the AI Referent module authorization path."""

from types import SimpleNamespace
from uuid import UUID, uuid4

import pytest
from fastapi import HTTPException

from yuksalish_api.routers import workspace


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"


@pytest.mark.anyio
async def test_draft_attachment_download_uses_referent_view_permission(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    attachment_id = uuid4()
    checks: list[tuple[str, str]] = []
    metadata = SimpleNamespace(
        owner_type="ai_referent_letter",
        content_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        file_name="Сохранённое письмо.docx",
    )

    async def get_attachment(
        _connection: object, _user: object, requested_id: UUID,
    ) -> tuple[SimpleNamespace, str]:
        assert requested_id == attachment_id
        return metadata, "referent/draft.docx"

    async def ensure_module_action(
        _connection: object, _user: object, module: str, action: str,
    ) -> None:
        checks.append((module, action))

    class Storage:
        async def get(self, key: str) -> bytes:
            assert key == "referent/draft.docx"
            return b"PK existing draft"

    monkeypatch.setattr(workspace, "get_attachment", get_attachment)
    monkeypatch.setattr(workspace, "ensure_module_action", ensure_module_action)
    monkeypatch.setattr(workspace, "_object_storage", lambda _request: Storage())

    response = await workspace.download_attachment(attachment_id, None, None, None)
    assert checks == [("ai_referent", "view")]
    assert response.body == b"PK existing draft"
    assert response.media_type == metadata.content_type

    async def deny_module_action(
        _connection: object, _user: object, module: str, action: str,
    ) -> None:
        assert (module, action) == ("ai_referent", "view")
        raise HTTPException(403, "Нет доступа к письмам")

    monkeypatch.setattr(workspace, "ensure_module_action", deny_module_action)
    with pytest.raises(HTTPException) as denied:
        await workspace.download_attachment(attachment_id, None, None, None)
    assert denied.value.status_code == 403
