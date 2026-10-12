"""Dedicated signed directory requests; never reuse employee/read credentials."""

import base64
import binascii
import hashlib
import hmac
import json
import ssl
import time
from urllib.parse import urlsplit

import httpx
from pydantic import ValidationError

from .edo_employee_schemas import EmployeeSnapshot, EmployeeSyncAck, EmployeeSyncRequest
from .settings import Settings


class EmployeeSyncError(Exception):
    def __init__(self, code: str, *, retryable: bool = False) -> None:
        super().__init__(code)
        self.code = code
        self.retryable = retryable


def canonical_bytes(value: dict[str, object]) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode(
        "ascii"
    )


def snapshot_hash(snapshot: EmployeeSnapshot) -> str:
    return hashlib.sha256(canonical_bytes(snapshot.model_dump(mode="json"))).hexdigest()


def directory_key(settings: Settings) -> bytes:
    try:
        key = base64.b64decode(
            settings.edo_directory_assertion_key_base64.get_secret_value(), validate=True
        )
    except (ValueError, binascii.Error) as error:
        raise EmployeeSyncError("configuration") from error
    if len(key) < 32:
        raise EmployeeSyncError("configuration")
    return key


def sync_configured(settings: Settings) -> bool:
    try:
        parsed = urlsplit(settings.edo_api_url.strip().rstrip("/"))
        _ = parsed.port  # Reject invalid port syntax before constructing the HTTP client.
    except ValueError:
        return False
    if (
        parsed.scheme != "https"
        or not parsed.hostname
        or parsed.username
        or parsed.password
        or parsed.path not in {"", "/"}
        or parsed.query
        or parsed.fragment
        or not settings.edo_workspace_id
        or len(settings.edo_directory_credential.get_secret_value()) < 32
        or (settings.edo_ca_bundle is not None and not settings.edo_ca_bundle.is_file())
    ):
        return False
    try:
        key = directory_key(settings)
    except EmployeeSyncError:
        return False
    if settings.edo_directory_credential.get_secret_value() == (
        settings.edo_service_credential.get_secret_value()
    ):
        return False
    try:
        if key == base64.b64decode(
            settings.edo_assertion_key_base64.get_secret_value(), validate=True
        ):
            return False
    except (ValueError, binascii.Error):
        pass  # Letter-read credentials are independent of directory credentials.
    return True


def directory_headers(
    settings: Settings,
    payload: EmployeeSyncRequest,
    *,
    now: int | None = None,
) -> tuple[dict[str, str], bytes, str]:
    if not sync_configured(settings):
        raise EmployeeSyncError("configuration")
    body = canonical_bytes(payload.model_dump(mode="json"))
    digest = hashlib.sha256(body).hexdigest()
    issued = int(time.time()) if now is None else now
    path = f"/workspace/v1/employees/{payload.employee_id}"
    claims: dict[str, object] = {
        "iss": settings.edo_workspace_id,
        "aud": "edo-directory-sync-v1",
        "sub": "workspace-directory-sync",
        "iat": issued,
        "exp": issued + 120,
        "operation": "employee.sync",
        "employee_id": str(payload.employee_id),
        "revision": payload.revision,
        "method": "PUT",
        "path": path,
        "payload_sha256": digest,
    }

    def b64(value: bytes) -> str:
        return base64.urlsafe_b64encode(value).decode("ascii").rstrip("=")

    unsigned = b64(b'{"alg":"HS256","typ":"JWT"}') + "." + b64(canonical_bytes(claims))
    signature = b64(
        hmac.new(directory_key(settings), unsigned.encode("ascii"), hashlib.sha256).digest()
    )
    return (
        {
            "Authorization": "Bearer " + settings.edo_directory_credential.get_secret_value(),
            "X-Workspace-Directory-Assertion": unsigned + "." + signature,
            "Idempotency-Key": f"employee:{payload.employee_id}:v{payload.revision}:{digest[:16]}",
            "Accept": "application/json",
            "Content-Type": "application/json",
        },
        body,
        digest,
    )


async def deliver_employee(settings: Settings, payload: EmployeeSyncRequest) -> EmployeeSyncAck:
    headers, body, digest = directory_headers(settings, payload)
    verify: bool | str = str(settings.edo_ca_bundle) if settings.edo_ca_bundle else True
    try:
        async with httpx.AsyncClient(
            verify=verify,
            follow_redirects=False,
            trust_env=False,
            timeout=httpx.Timeout(10, read=35),
        ) as client:
            response = await client.put(
                settings.edo_api_url.strip().rstrip("/")
                + f"/workspace/v1/employees/{payload.employee_id}",
                content=body,
                headers=headers,
            )
    except (httpx.InvalidURL, ssl.SSLError, OSError) as error:
        raise EmployeeSyncError("configuration") from error
    except httpx.RequestError as error:
        raise EmployeeSyncError("connection", retryable=True) from error
    if response.status_code not in {200, 201}:
        retryable = response.status_code in {408, 425, 429} or response.status_code >= 500
        # Never store/log an upstream body; it may contain secrets or employee data.
        raise EmployeeSyncError(f"http_{response.status_code}", retryable=retryable)
    try:
        ack = EmployeeSyncAck.model_validate(response.json())
    except (ValueError, ValidationError) as error:
        raise EmployeeSyncError("invalid_ack", retryable=True) from error
    if (
        ack.employee_id != payload.employee_id
        or ack.revision != payload.revision
        or ack.request_sha256 != digest
        or ack.mapping_active != (payload.status == "active")
        or (payload.status in {"active", "pending"} and ack.edo_user_id is None)
    ):
        raise EmployeeSyncError("mismatched_ack", retryable=True)
    return ack
