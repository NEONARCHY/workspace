"""Directory HTTP requests are intercepted; credentials and people are synthetic."""

import base64
import hashlib
import hmac
import json
from unittest.mock import AsyncMock
from uuid import uuid4

import httpx
import pytest
from fastapi import HTTPException
from pydantic import SecretStr

from yuksalish_api.access_control import request_module_action
from yuksalish_api.auth import AuthenticatedUser
from yuksalish_api.edo_employee_client import (
    EmployeeSyncError,
    deliver_employee,
    directory_headers,
    sync_configured,
)
from yuksalish_api.edo_employee_schemas import EmployeeSyncRequest
from yuksalish_api.edo_employee_sync import employee_sync_status, run_employee_sync_cycle
from yuksalish_api.settings import Settings

pytestmark = pytest.mark.anyio


@pytest.fixture
def anyio_backend():
    return "asyncio"


def settings(**kwargs):
    return Settings(
        environment="test",
        edo_api_url="https://edo.example.test",
        edo_directory_credential=SecretStr("synthetic-directory-credential-long-enough"),
        edo_directory_assertion_key_base64=SecretStr(base64.b64encode(b"d" * 32).decode()),
        **kwargs,
    )


def payload(status="active"):
    return EmployeeSyncRequest(
        employee_id=uuid4(),
        username="synthetic",
        full_name="Synthetic Unicode \u0410",
        status=status,
        revision=1,
    )


def intercept(monkeypatch, handler):
    original = httpx.AsyncClient

    def factory(**kwargs):
        assert kwargs["verify"] is True
        assert kwargs["follow_redirects"] is False
        assert kwargs["trust_env"] is False
        return original(transport=httpx.MockTransport(handler), **kwargs)

    monkeypatch.setattr("yuksalish_api.edo_employee_client.httpx.AsyncClient", factory)


def ack(request, **changes):
    body = json.loads(request.content)
    return {
        "protocol_version": 1,
        "employee_id": body["employee_id"],
        "revision": body["revision"],
        "request_sha256": hashlib.sha256(request.content).hexdigest(),
        "edo_user_id": 101,
        "mapping_active": body["status"] == "active",
        "action": "created",
        **changes,
    }


def test_signature_binds_uuid_method_path_revision_and_exact_body():
    person = payload()
    headers, body, digest = directory_headers(settings(), person, now=1000)
    header, encoded, signature = headers["X-Workspace-Directory-Assertion"].split(".")
    claims = json.loads(base64.urlsafe_b64decode(encoded + "=="))
    assert claims == {
        "iss": "yuksalish-workspace",
        "aud": "edo-directory-sync-v1",
        "sub": "workspace-directory-sync",
        "iat": 1000,
        "exp": 1120,
        "operation": "employee.sync",
        "employee_id": str(person.employee_id),
        "revision": 1,
        "method": "PUT",
        "path": f"/workspace/v1/employees/{person.employee_id}",
        "payload_sha256": digest,
    }
    assert hashlib.sha256(body).hexdigest() == digest
    expected = hmac.new(b"d" * 32, f"{header}.{encoded}".encode(), hashlib.sha256).digest()
    assert hmac.compare_digest(base64.urlsafe_b64decode(signature + "=="), expected)
    assert (
        headers["Idempotency-Key"]
        == directory_headers(settings(), person, now=1100)[0]["Idempotency-Key"]
    )
    assert "password" not in json.loads(body)
    assert "role" not in json.loads(body)
    assert "X-Workspace-Assertion" not in headers


@pytest.mark.parametrize(
    "change",
    [
        {"edo_api_url": "http://edo.example.test"},
        {"edo_api_url": "https://user:pass@edo.example.test"},
        {"edo_api_url": "https://edo.example.test/workspace/v1"},
        {"edo_api_url": "https://edo.example.test:badport"},
        {"edo_api_url": "https://[invalid"},
        {"edo_directory_assertion_key_base64": SecretStr("invalid")},
        {"edo_directory_credential": SecretStr("short")},
    ],
)
def test_invalid_settings_do_not_send(change):
    configured = settings().model_copy(update=change)
    assert not sync_configured(configured)
    with pytest.raises(EmployeeSyncError, match="configuration"):
        directory_headers(configured, payload())


def test_directory_and_letter_credentials_cannot_be_reused():
    configured = settings()
    assert not sync_configured(
        configured.model_copy(
            update={
                "edo_service_credential": configured.edo_directory_credential,
            }
        )
    )
    assert not sync_configured(
        configured.model_copy(
            update={
                "edo_assertion_key_base64": configured.edo_directory_assertion_key_base64,
            }
        )
    )


@pytest.mark.parametrize("status", ["active", "pending", "blocked", "archived"])
async def test_delivery_checks_ack_and_preserves_lifecycle(monkeypatch, status):
    requests = []

    def handler(request):
        requests.append(request)
        assert request.method == "PUT"
        return httpx.Response(201, json=ack(request))

    intercept(monkeypatch, handler)
    person = payload(status)
    first = await deliver_employee(settings(), person)
    second = await deliver_employee(settings(), person)
    assert first == second
    assert first.mapping_active == (status == "active")
    assert requests[0].headers["Idempotency-Key"] == requests[1].headers["Idempotency-Key"]


@pytest.mark.parametrize(
    "code,retryable", [(503, True), (429, True), (409, False), (403, False), (302, False)]
)
async def test_http_errors_are_sanitized(monkeypatch, code, retryable):
    intercept(monkeypatch, lambda request: httpx.Response(code, text="sensitive upstream body"))
    with pytest.raises(EmployeeSyncError) as caught:
        await deliver_employee(settings(), payload())
    assert caught.value.code == f"http_{code}"
    assert caught.value.retryable == retryable
    assert "sensitive" not in str(caught.value)


@pytest.mark.parametrize(
    "changes",
    [
        {"employee_id": str(uuid4())},
        {"revision": 2},
        {"request_sha256": "0" * 64},
        {"mapping_active": False},
        {"edo_user_id": None},
        {"edo_user_id": "101"},
        {"mapping_active": "true"},
        {"revision": True},
    ],
)
async def test_wrong_or_coerced_ack_is_not_success(monkeypatch, changes):
    intercept(monkeypatch, lambda request: httpx.Response(200, json=ack(request, **changes)))
    with pytest.raises(EmployeeSyncError) as caught:
        await deliver_employee(settings(), payload())
    assert caught.value.code in {"invalid_ack", "mismatched_ack"}
    assert caught.value.retryable


async def test_connection_failure_is_retryable(monkeypatch):
    def handler(request):
        raise httpx.ConnectError("private connection information", request=request)

    intercept(monkeypatch, handler)
    with pytest.raises(EmployeeSyncError) as caught:
        await deliver_employee(settings(), payload())
    assert caught.value.code == "connection"
    assert caught.value.retryable


async def test_disabled_sync_does_not_access_database_or_remote():
    engine = AsyncMock()
    assert await run_employee_sync_cycle(engine, settings()) == 0
    engine.begin.assert_not_called()
    assert await run_employee_sync_cycle(engine, Settings(edo_employee_sync_enabled=True)) == 0
    engine.begin.assert_not_called()


async def test_nonadmin_cannot_inspect_directory_queue():
    connection = AsyncMock()
    actor = AuthenticatedUser(
        id=uuid4(),
        username="test",
        full_name="Test",
        position_id=None,
        job_title=None,
        role="employee",
    )
    with pytest.raises(HTTPException) as caught:
        await employee_sync_status(connection, actor, settings())
    assert caught.value.status_code == 403
    connection.execute.assert_not_called()


def test_directory_queue_requires_admin_permission_in_middleware():
    assert request_module_action("/api/v1/incoming-letters/employee-sync", "GET") == (
        "incoming_letters",
        "admin",
    )
    assert request_module_action(
        f"/api/v1/incoming-letters/employee-sync/{uuid4()}/retry",
        "POST",
    ) == ("incoming_letters", "admin")
