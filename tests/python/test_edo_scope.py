"""Expanded read scopes must never become impersonation or execution rights."""

import base64
import hashlib
import hmac
import json
from unittest.mock import AsyncMock
from uuid import uuid4

import httpx
import pytest
from fastapi import FastAPI

from test_edo_service import intercept, letter_payload, settings
from yuksalish_api.auth import AuthenticatedUser, require_user
from yuksalish_api.database import get_connection
from yuksalish_api.edo_schemas import EdoAccessUpdate, EdoIncomingPage, EdoPageMeta
from yuksalish_api.edo_scope import SCOPE_HEADER, EdoReadScope
from yuksalish_api.edo_service import (
    EdoBridgeError,
    add_assignment,
    get_letter,
    issue_edo_assertion,
    list_letters,
    stream_attachment,
)
from yuksalish_api.routers import edo_incoming

pytestmark = pytest.mark.anyio


@pytest.fixture
def anyio_backend():
    return "asyncio"


def claims(request):
    return json.loads(
        base64.urlsafe_b64decode(request.headers["x-workspace-assertion"].split(".")[1] + "==")
    )


def test_scope_assertion_retains_actor_and_authenticates_exact_scope():
    actor, employee = uuid4(), uuid4()
    scope = EdoReadScope(mode="employees", employee_ids=(employee, actor))
    token = issue_edo_assertion(actor, settings(), read_scope=scope, now=1000)
    header, encoded, signature = token.split(".")
    value = json.loads(base64.urlsafe_b64decode(encoded + "=="))
    assert value["sub"] == str(actor)
    assert value["incoming_read"] == scope.claim()
    assert value["exp"] - value["iat"] == 120
    expected = hmac.new(b"a" * 32, f"{header}.{encoded}".encode(), hashlib.sha256).digest()
    assert base64.urlsafe_b64decode(signature + "==") == expected
    assert scope.digest() == EdoReadScope(mode="employees", employee_ids=(actor, employee)).digest()


@pytest.mark.parametrize(
    "payload",
    [
        {"mode": "departments", "departmentIds": []},
        {"mode": "all", "departmentIds": [str(uuid4())]},
        {"mode": "assigned", "employeeIds": [str(uuid4())]},
        {"mode": "invalid"},
    ],
)
def test_invalid_rules_rejected(payload):
    with pytest.raises(ValueError):
        EdoAccessUpdate.model_validate({"expectedRevision": 0, **payload})


@pytest.mark.parametrize(
    "scope", [EdoReadScope(mode="all"), EdoReadScope(mode="employees", employee_ids=(uuid4(),))]
)
@pytest.mark.parametrize("ack", [None, "wrong-scope"])
@pytest.mark.parametrize("operation", ["list", "detail", "attachment"])
async def test_old_or_mismatched_edo_cannot_silently_ignore_scope(
    monkeypatch,
    scope,
    ack,
    operation,
):
    payload = letter_payload()
    if scope.mode == "employees":
        payload["assignments"] = [{"user_id": 1, "employee_id": str(scope.employee_ids[0])}]

    def respond(request):
        assert claims(request)["incoming_read"] == scope.claim()
        response = {"data": payload}
        if request.url.path.endswith("/incoming"):
            compact = {key: value for key, value in payload.items() if key != "assignments"}
            response = {"data": [compact], "meta": {"page": 1, "limit": 20, "total": 1}}
        return httpx.Response(200, json=response, headers={SCOPE_HEADER: ack} if ack else {})

    intercept(monkeypatch, httpx.MockTransport(respond))
    with pytest.raises(EdoBridgeError) as caught:
        if operation == "list":
            await list_letters(
                settings(), uuid4(), page=1, limit=20, query="", status=None, read_scope=scope
            )
        elif operation == "detail":
            await get_letter(settings(), uuid4(), 17, read_scope=scope)
        else:
            await stream_attachment(settings(), uuid4(), 17, "1", read_scope=scope)
    assert caught.value.status_code == 503


async def test_department_response_cannot_include_unrelated_letter(monkeypatch):
    scope = EdoReadScope(mode="employees", employee_ids=(uuid4(),))
    intercept(
        monkeypatch,
        httpx.MockTransport(
            lambda _: httpx.Response(
                200, json={"data": letter_payload()}, headers={SCOPE_HEADER: scope.digest()}
            )
        ),
    )
    with pytest.raises(EdoBridgeError) as caught:
        await get_letter(settings(), uuid4(), 17, read_scope=scope)
    assert caught.value.status_code == 502


async def test_department_compact_list_preserves_edo_pagination(monkeypatch):
    actor = uuid4()
    scope = EdoReadScope(mode="employees", employee_ids=(actor,))
    requests = []

    def respond(request):
        requests.append(request)
        assert claims(request)["sub"] == str(actor)
        assert claims(request)["incoming_read"] == scope.claim()
        assert dict(request.url.params) == {"page": "2", "limit": "1", "q": "notice"}
        return httpx.Response(
            200,
            json={
                "data": [{"id": 17, "in_num": "TEST-17", "status": 1}],
                "meta": {"page": 2, "limit": 1, "total": 3},
            },
            headers={SCOPE_HEADER: scope.digest()},
        )

    intercept(monkeypatch, httpx.MockTransport(respond))
    page = await list_letters(
        settings(), actor, page=2, limit=1, query="notice", status=None, read_scope=scope
    )
    assert [letter.id for letter in page.data] == [17]
    assert page.data[0].assignments == []
    assert page.meta.model_dump() == {"page": 2, "limit": 1, "total": 3}
    assert page.visibility == "departments"
    assert len(requests) == 1  # No per-letter fetches or local pagination/filtering.


def test_all_scope_digest_matches_edo_php_contract():
    assert EdoReadScope(mode="all").digest() == (
        "5bcd0b94068390657edab2530e6c965227ee0424c10ee72ea0a0cd7b425578e1"
    )


@pytest.mark.parametrize("mode", ["all", "employees"])
async def test_expanded_list_detail_and_attachment_success(monkeypatch, mode):
    actor, member = uuid4(), uuid4()
    scope = EdoReadScope(mode=mode, employee_ids=(actor, member) if mode == "employees" else ())
    payload = {**letter_payload(), "assignments": [{"user_id": 9, "employee_id": str(member)}]}

    def respond(request):
        assert claims(request)["sub"] == str(actor)
        assert claims(request)["incoming_read"] == scope.claim()
        headers = {SCOPE_HEADER: scope.digest()}
        if "/attachments/" in request.url.path:
            return httpx.Response(200, content=b"synthetic-file", headers=headers)
        body = {"data": payload}
        if request.url.path.endswith("/incoming"):
            compact = {key: value for key, value in payload.items() if key != "assignments"}
            body = {"data": [compact], "meta": {"page": 1, "limit": 20, "total": 1}}
        return httpx.Response(200, json=body, headers=headers)

    intercept(monkeypatch, httpx.MockTransport(respond))
    page = await list_letters(
        settings(), actor, page=1, limit=20, query="", status=None, read_scope=scope
    )
    assert page.visibility == scope.visibility
    detail = await get_letter(settings(), actor, 17, read_scope=scope)
    assert detail.visibility == scope.visibility
    chunks = await stream_attachment(settings(), actor, 17, "1", read_scope=scope)
    assert b"".join([chunk async for chunk in chunks]) == b"synthetic-file"


async def test_write_assertion_never_contains_read_grant(monkeypatch):
    def respond(request):
        assert request.method == "POST"
        assert "incoming_read" not in claims(request)
        return httpx.Response(403)

    intercept(monkeypatch, httpx.MockTransport(respond))
    with pytest.raises(EdoBridgeError) as caught:
        await add_assignment(
            settings(),
            uuid4(),
            17,
            target_employee_id=str(uuid4()),
            expected_version=4,
            key="operation-scoped",
        )
    assert caught.value.status_code == 403


@pytest.mark.parametrize("role", ["employee", "manager"])
async def test_non_admin_cannot_read_or_save_access_configuration(monkeypatch, role):
    app = FastAPI()
    app.include_router(edo_incoming.router)
    actor = AuthenticatedUser(
        id=uuid4(),
        username="synthetic",
        full_name="Synthetic",
        position_id=None,
        job_title=None,
        role=role,
    )
    app.dependency_overrides[require_user] = lambda: actor
    connection = AsyncMock()
    app.dependency_overrides[get_connection] = lambda: connection
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        assert (await client.get("/incoming-letters/access")).status_code == 403
        response = await client.put(
            f"/incoming-letters/access/{actor.id}",
            json={
                "expectedRevision": 0,
                "mode": "all",
                "departmentIds": [],
            },
        )
        assert response.status_code == 403
    connection.execute.assert_not_awaited()


async def test_list_uses_server_scope_and_personal_query_only_narrows(monkeypatch):
    app = FastAPI()
    app.state.settings = settings()
    app.include_router(edo_incoming.router)
    actor = AuthenticatedUser(
        id=uuid4(), username="synthetic", full_name="Synthetic", position_id=None,
        job_title=None, role="admin",
    )
    app.dependency_overrides[require_user] = lambda: actor
    app.dependency_overrides[get_connection] = lambda: object()
    monkeypatch.setattr(edo_incoming, "ensure_module_action", AsyncMock())
    resolver = AsyncMock(return_value=EdoReadScope(mode="all"))
    monkeypatch.setattr(edo_incoming, "resolve_read_scope", resolver)
    remote = AsyncMock(return_value=EdoIncomingPage(
        data=[], meta=EdoPageMeta(page=1, limit=20, total=0),
    ))
    monkeypatch.setattr(edo_incoming, "list_letters", remote)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.get("/incoming-letters")
        assert response.status_code == 200
        assert response.headers["cache-control"] == "no-store, private"
        assert remote.await_args.kwargs["read_scope"].mode == "all"
        response = await client.get("/incoming-letters?personal=true")
        assert response.status_code == 200
        assert remote.await_args.kwargs["read_scope"].mode == "assigned"
    resolver.assert_awaited_once()
