from types import SimpleNamespace
from typing import Any
from uuid import uuid4

import pytest
from fastapi import HTTPException, Request
from fastapi.security import HTTPAuthorizationCredentials

from yuksalish_api import auth
from yuksalish_api.settings import Settings


class PolicyConnection:
    def __init__(self) -> None:
        self.reads = 0

    async def execute(self, _statement: object) -> "PolicyConnection":
        self.reads += 1
        return self

    def mappings(self) -> "PolicyConnection":
        return self

    def one(self) -> dict[str, Any]:
        return {"mandatory": True, "minimum_version": "0.30.0"}


def request_for(path: str, version: str | None) -> Request:
    headers = [(b"x-desktop-version", version.encode())] if version else []
    return Request({
        "type": "http", "path": path, "method": "GET", "headers": headers,
        "scheme": "https", "server": ("workspace.test", 443),
        "app": SimpleNamespace(state=SimpleNamespace(settings=Settings(environment="production"))),
    })


@pytest.mark.anyio
async def test_production_blocks_old_clients_but_allows_the_update_feed(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    actor = auth.AuthenticatedUser(
        id=uuid4(), username="employee", full_name="Employee",
        position_id=None, job_title=None, role="employee",
    )

    async def authenticate(*_args: object) -> auth.AuthenticatedUser:
        return actor

    async def access(*_args: object) -> None:
        return None

    monkeypatch.setattr(auth, "authenticate_access_token", authenticate)
    monkeypatch.setattr(auth, "ensure_request_module_access", access)
    credentials = HTTPAuthorizationCredentials(scheme="Bearer", credentials="test")
    connection = PolicyConnection()

    for version in (None, "0.29.0", "invalid"):
        with pytest.raises(HTTPException) as blocked:
            await auth.require_user(
                request_for("/api/v1/workspace", version), credentials, connection,  # type: ignore[arg-type]
            )
        assert blocked.value.status_code == 426

    assert await auth.require_user(
        request_for("/api/v1/workspace", "0.30.0"), credentials, connection,  # type: ignore[arg-type]
    ) == actor
    reads_before_feed = connection.reads
    assert await auth.require_user(
        request_for("/api/v1/updates/feed/latest.yml", None), credentials, connection,  # type: ignore[arg-type]
    ) == actor
    assert connection.reads == reads_before_feed
