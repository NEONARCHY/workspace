import inspect
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest
from fastapi import HTTPException
from fastapi.routing import APIRoute
from starlette.requests import Request

from yuksalish_api.auth import AuthenticatedUser
from yuksalish_api.routers import administration, directory, messenger, personal, updates, workspace


def _argument(
    name: str,
    request: Request,
    user: AuthenticatedUser,
    connection: AsyncMock,
) -> object:
    if name == "request":
        return request
    if name == "current_user":
        return user
    if name == "connection":
        return connection
    if name.endswith("_id"):
        return uuid4()
    if name == "emoji":
        return "👍"
    if name == "q":
        return "сообщение"
    if name == "period":
        return None
    if name in {"file_name", "filename"}:
        return "document.pdf"
    return MagicMock()


async def _exercise_router(
    monkeypatch: pytest.MonkeyPatch,
    module: object,
    request: Request,
    user: AuthenticatedUser,
    connection: AsyncMock,
    excluded: set[str],
) -> int:
    router = vars(module)["router"]
    endpoints = {route.endpoint for route in router.routes if isinstance(route, APIRoute)}
    for name, value in vars(module).items():
        if inspect.iscoroutinefunction(value) and value not in endpoints:
            monkeypatch.setattr(module, name, AsyncMock(return_value=MagicMock(id=str(uuid4()))))
        elif inspect.ismodule(value) and value.__name__.startswith("yuksalish_api"):
            for service_name, service_value in vars(value).items():
                if inspect.iscoroutinefunction(service_value):
                    monkeypatch.setattr(
                        value,
                        service_name,
                        AsyncMock(return_value=MagicMock(id=str(uuid4()))),
                    )
    exercised = 0
    for endpoint in endpoints:
        if endpoint.__name__ in excluded:
            continue
        kwargs = {
            name: _argument(name, request, user, connection)
            for name in inspect.signature(endpoint).parameters
        }
        try:
            await endpoint(**kwargs)
        except HTTPException as error:
            assert 400 <= error.status_code < 500
        exercised += 1
    return exercised


@pytest.mark.anyio
async def test_workspace_routes_delegate_to_services(monkeypatch: pytest.MonkeyPatch) -> None:
    """Exercise the thin HTTP adapters independently from repository integration tests."""
    result = MagicMock()
    result.id = str(uuid4())
    result.file_name = "document.pdf"
    result.content_type = "application/pdf"
    result.storage_key = "test/document.pdf"

    endpoints = {
        route.endpoint
        for route in workspace.router.routes
        if isinstance(route, APIRoute)
    }
    for name, value in vars(workspace).items():
        if inspect.iscoroutinefunction(value) and value not in endpoints:
            monkeypatch.setattr(workspace, name, AsyncMock(return_value=result))

    event_bus = SimpleNamespace(publish=AsyncMock())
    request = Request(
        {"type": "http", "app": SimpleNamespace(state=SimpleNamespace(event_bus=event_bus))}
    )
    user = MagicMock(spec=AuthenticatedUser)
    user.id = uuid4()
    connection = AsyncMock()

    excluded = {
        "put_profile_avatar",
        "get_profile_avatar",
        "post_attachment",
        "get_attachment",
        "download_attachment",
        "put_attachment",
    }
    exercised = 0
    for endpoint in endpoints:
        if endpoint.__name__ in excluded:
            continue
        kwargs = {
            name: _argument(name, request, user, connection)
            for name in inspect.signature(endpoint).parameters
        }
        try:
            await endpoint(**kwargs)
        except HTTPException as error:
            assert error.status_code in {400, 403, 404, 409, 422}
        exercised += 1

    assert exercised >= 50
    assert event_bus.publish.await_count >= 20


@pytest.mark.anyio
async def test_other_routes_delegate_to_services(monkeypatch: pytest.MonkeyPatch) -> None:
    event_bus = SimpleNamespace(publish=AsyncMock())
    state = SimpleNamespace(event_bus=event_bus, settings=MagicMock(), object_store=MagicMock())
    request = Request({"type": "http", "app": SimpleNamespace(state=state)})
    user = MagicMock(spec=AuthenticatedUser)
    user.id = uuid4()
    connection = AsyncMock()

    exercised = 0
    for module in (administration, directory, messenger, personal, updates):
        exercised += await _exercise_router(
            monkeypatch,
            module,
            request,
            user,
            connection,
            {"update_feed", "download_release", "upload_release"},
        )

    assert exercised >= 25
