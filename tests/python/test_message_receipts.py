import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch
from uuid import uuid4

import pytest
from fastapi import HTTPException, Request

from yuksalish_api.auth import AuthenticatedUser
from yuksalish_api.errors import WorkspaceRepositoryError
from yuksalish_api.routers.workspace import post_chat_read


@pytest.mark.parametrize("changed", [False, True])
def test_read_receipt_event_is_published_only_after_commit(changed: bool) -> None:
    async def exercise() -> None:
        order = []
        chat_id = uuid4()
        actor = AuthenticatedUser(uuid4(), "test", "Test employee", None, None, "employee")
        bus = SimpleNamespace(publish=AsyncMock(side_effect=lambda _: order.append("event")))
        request = Request(
            {"type": "http", "app": SimpleNamespace(state=SimpleNamespace(event_bus=bus))}
        )
        connection = SimpleNamespace(commit=AsyncMock(side_effect=lambda: order.append("commit")))
        with patch(
            "yuksalish_api.routers.workspace.mark_chat_read", AsyncMock(return_value=changed)
        ):
            response = await post_chat_read(chat_id, request, actor, connection)
        assert response.status_code == 204
        assert order == (["commit", "event"] if changed else ["commit"])
        if changed:
            bus.publish.assert_awaited_once_with({"type": "message.read", "entityId": str(chat_id)})

    asyncio.run(exercise())


def test_inaccessible_chat_cannot_publish_a_read_receipt() -> None:
    async def exercise() -> None:
        actor = AuthenticatedUser(uuid4(), "test", "Test employee", None, None, "employee")
        bus = SimpleNamespace(publish=AsyncMock())
        request = Request(
            {"type": "http", "app": SimpleNamespace(state=SimpleNamespace(event_bus=bus))}
        )
        connection = SimpleNamespace(commit=AsyncMock())
        with (
            patch(
                "yuksalish_api.routers.workspace.mark_chat_read",
                AsyncMock(side_effect=WorkspaceRepositoryError(404, "Not found")),
            ),
            pytest.raises(HTTPException) as error,
        ):
            await post_chat_read(uuid4(), request, actor, connection)
        assert error.value.status_code == 404
        connection.commit.assert_not_awaited()
        bus.publish.assert_not_awaited()

    asyncio.run(exercise())
