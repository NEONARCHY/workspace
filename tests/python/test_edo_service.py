"""The EDO bridge is tested with intercepted HTTP, never against working mail."""

import base64
import json
from unittest.mock import AsyncMock
from uuid import uuid4

import httpx
import pytest
from fastapi import FastAPI, HTTPException
from pydantic import SecretStr

from yuksalish_api.access_control import request_module_action
from yuksalish_api.auth import AuthenticatedUser, require_user
from yuksalish_api.database import get_connection
from yuksalish_api.edo_schemas import EdoIncomingDetail, EdoIncomingLetter
from yuksalish_api.edo_service import (
    EdoBridgeError,
    add_assignment,
    get_letter,
    issue_edo_assertion,
    list_letters,
)
from yuksalish_api.routers import edo_incoming
from yuksalish_api.settings import Settings

pytestmark = pytest.mark.anyio


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"


def settings() -> Settings:
    return Settings(
        environment="test",
        edo_api_url="https://edo.example.test",
        edo_service_credential=SecretStr("service-credential-with-more-than-32-characters"),
        edo_assertion_key_base64=SecretStr(base64.b64encode(b"a" * 32).decode()),
    )


def intercept(monkeypatch: pytest.MonkeyPatch, handler: httpx.MockTransport) -> None:
    original = httpx.AsyncClient

    def client_factory(**kwargs: object) -> httpx.AsyncClient:
        return original(transport=handler, **kwargs)

    monkeypatch.setattr("yuksalish_api.edo_service.httpx.AsyncClient", client_factory)


def letter_payload() -> dict[str, object]:
    return {
        "id": 17,
        "version": 4,
        "status": 1,
        "in_num": "EX-17",
        "description": "Synthetic letter",
        "deadline": "2026-10-01 00:00:00",
        "assignments": [],
        "attachments": [],
    }


def test_assertion_is_scoped_to_active_employee() -> None:
    employee_id = uuid4()
    signed = issue_edo_assertion(employee_id, settings(), now=1_000)
    header, claims, signature = signed.split(".")
    payload = json.loads(base64.urlsafe_b64decode(claims + "=="))
    assert json.loads(base64.urlsafe_b64decode(header + "=="))["alg"] == "HS256"
    assert payload == {
        "iss": "yuksalish-workspace", "aud": "edo-workspace-v1", "sub": str(employee_id),
        "iat": 1_000, "exp": 1_120, "active": True,
    }
    assert signature


async def test_list_uses_two_server_only_credentials_and_preserves_unknown_deadline(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    employee_id = uuid4()

    def respond(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/workspace/v1/incoming"
        assert request.url.params["q"] == "EX-17"
        assert request.headers["authorization"].startswith("Bearer service-credential")
        assert request.headers["x-workspace-assertion"].count(".") == 2
        return httpx.Response(200, json={
            "data": [letter_payload()], "meta": {"page": 1, "limit": 20, "total": 1},
        })

    intercept(monkeypatch, httpx.MockTransport(respond))
    result = await list_letters(
        settings(), employee_id, page=1, limit=20, query="EX-17", status=None
    )
    assert result.data[0].id == 17
    assert result.data[0].overdue is None
    assert result.deadline_timezone_verified is False


async def test_detail_read_does_not_write_and_keeps_edo_status(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def respond(request: httpx.Request) -> httpx.Response:
        assert request.method == "GET"
        assert request.url.path == "/workspace/v1/incoming/17"
        return httpx.Response(200, json={"data": letter_payload()})

    intercept(monkeypatch, httpx.MockTransport(respond))
    result = await get_letter(settings(), uuid4(), 17)
    assert result.data.status == 1
    assert result.data.version == 4


async def test_assignment_forwards_exact_version_and_idempotency_key(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def respond(request: httpx.Request) -> httpx.Response:
        assert request.method == "POST"
        assert request.headers["idempotency-key"] == "operation-123"
        assert json.loads(request.content) == {"expected_version": 4, "employee_id": "next-person"}
        return httpx.Response(200, json={"data": {**letter_payload(), "version": 5}})

    intercept(monkeypatch, httpx.MockTransport(respond))
    result = await add_assignment(
        settings(), uuid4(), 17, target_employee_id="next-person",
        expected_version=4, key="operation-123",
    )
    assert result.data.version == 5


async def test_mutation_timeout_is_not_retried(monkeypatch: pytest.MonkeyPatch) -> None:
    calls = 0

    def respond(request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        raise httpx.ReadTimeout("synthetic", request=request)

    intercept(monkeypatch, httpx.MockTransport(respond))
    with pytest.raises(EdoBridgeError) as caught:
        await add_assignment(
            settings(), uuid4(), 17, target_employee_id="next-person",
            expected_version=4, key="operation-123",
        )
    assert calls == 1
    assert caught.value.status_code == 504
    assert "неизвестен" in caught.value.message


async def test_redirect_is_not_followed(monkeypatch: pytest.MonkeyPatch) -> None:
    intercept(monkeypatch, httpx.MockTransport(lambda _: httpx.Response(302, headers={
        "Location": "https://unexpected.example/",
    })))
    with pytest.raises(EdoBridgeError) as caught:
        await get_letter(settings(), uuid4(), 17)
    assert caught.value.status_code == 502


async def test_bridge_requires_https_and_server_secrets() -> None:
    insecure = settings().model_copy(update={"edo_api_url": "http://edo.example.test"})
    with pytest.raises(EdoBridgeError) as caught:
        await get_letter(insecure, uuid4(), 17)
    assert caught.value.status_code == 503


def test_module_access_mapping() -> None:
    assert request_module_action("/incoming-letters", "GET") == ("incoming_letters", "view")
    assert request_module_action("/incoming-letters/17/complete", "POST") == (
        "incoming_letters", "edit"
    )


@pytest.mark.anyio
async def test_workspace_route_checks_module_permission_before_read(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    application = FastAPI()
    application.state.settings = settings()
    application.include_router(edo_incoming.router, prefix="/api/v1")
    user = AuthenticatedUser(
        id=uuid4(), username="synthetic", full_name="Synthetic Person",
        position_id=None, job_title=None, role="employee",
    )
    application.dependency_overrides[require_user] = lambda: user
    application.dependency_overrides[get_connection] = lambda: object()
    remote_read = AsyncMock(return_value=EdoIncomingDetail(data=EdoIncomingLetter(id=17)))
    monkeypatch.setattr(edo_incoming, "get_letter", remote_read)
    permission = AsyncMock(side_effect=HTTPException(403, "Module permission required"))
    monkeypatch.setattr(edo_incoming, "ensure_module_action", permission)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=application), base_url="http://test"
    ) as client:
        denied = await client.get("/api/v1/incoming-letters/17")
        assert denied.status_code == 403
        assert remote_read.await_count == 0
        permission.side_effect = None
        allowed = await client.get("/api/v1/incoming-letters/17")
    assert allowed.status_code == 200
    assert allowed.json()["data"]["id"] == 17
    remote_read.assert_awaited_once()


async def test_assignment_route_rejects_inactive_workspace_target(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    application = FastAPI()
    application.state.settings = settings()
    application.include_router(edo_incoming.router, prefix="/api/v1")
    user = AuthenticatedUser(
        id=uuid4(), username="synthetic", full_name="Synthetic Person",
        position_id=None, job_title=None, role="employee",
    )
    target = uuid4()
    connection = AsyncMock()
    connection.scalar.return_value = None
    application.dependency_overrides[require_user] = lambda: user
    application.dependency_overrides[get_connection] = lambda: connection
    monkeypatch.setattr(edo_incoming, "ensure_module_action", AsyncMock())
    remote_assign = AsyncMock(return_value=EdoIncomingDetail(data=EdoIncomingLetter(id=17)))
    monkeypatch.setattr(edo_incoming, "add_assignment", remote_assign)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=application), base_url="http://test"
    ) as client:
        response = await client.post(
            "/api/v1/incoming-letters/17/assignments",
            headers={"Idempotency-Key": "operation-123"},
            json={"expected_version": 4, "employee_id": str(target)},
        )
        assert response.status_code == 422
        remote_assign.assert_not_awaited()
        connection.scalar.return_value = target
        response = await client.post(
            "/api/v1/incoming-letters/17/assignments",
            headers={"Idempotency-Key": "operation-123"},
            json={"expected_version": 4, "employee_id": str(target)},
        )
    assert response.status_code == 200
    assert remote_assign.await_args.kwargs["target_employee_id"] == str(target)
