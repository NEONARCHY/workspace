"""Authenticated server-to-server bridge to the separate document-flow system."""

# Russian user-facing messages intentionally contain Cyrillic confusables.
# ruff: noqa: RUF001

import base64
import binascii
import hashlib
import hmac
import json
import re
import time
from collections.abc import AsyncIterator
from datetime import datetime
from typing import Any
from urllib.parse import urlsplit
from uuid import UUID
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import httpx
from pydantic import ValidationError

from .edo_schemas import EdoIncomingDetail, EdoIncomingLetter, EdoIncomingPage
from .settings import Settings

_ATTACHMENT_ID = re.compile(r"[A-Za-z0-9_-]{1,128}\Z")
_IDEMPOTENCY_KEY = re.compile(r"[A-Za-z0-9._:-]{8,128}\Z")


class EdoBridgeError(Exception):
    def __init__(self, status_code: int, message: str) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.message = message


def _base64url(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).decode("ascii").rstrip("=")


def issue_edo_assertion(employee_id: UUID, settings: Settings, *, now: int | None = None) -> str:
    """Create a short-lived standard HS256 JWT; never expose it to the renderer."""
    try:
        key = base64.b64decode(
            settings.edo_assertion_key_base64.get_secret_value(), validate=True
        )
    except (ValueError, binascii.Error) as error:
        raise EdoBridgeError(503, "Интеграция писем не настроена.") from error
    if len(key) < 32:
        raise EdoBridgeError(503, "Интеграция писем не настроена.")
    issued = int(time.time()) if now is None else now
    header = _base64url(b'{"alg":"HS256","typ":"JWT"}')
    payload = _base64url(json.dumps({
        "iss": settings.edo_workspace_id,
        "aud": "edo-workspace-v1",
        "sub": str(employee_id),
        "iat": issued,
        "exp": issued + 120,
        "active": True,
    }, separators=(",", ":"), ensure_ascii=True).encode("utf-8"))
    signing_input = f"{header}.{payload}"
    signature = _base64url(hmac.new(key, signing_input.encode("ascii"), hashlib.sha256).digest())
    return f"{signing_input}.{signature}"


def _configured_base(settings: Settings) -> str:
    raw = settings.edo_api_url.strip().rstrip("/")
    parsed = urlsplit(raw)
    credential = settings.edo_service_credential.get_secret_value()
    if (
        parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password
        or parsed.path not in {"", "/"} or parsed.query or parsed.fragment
        or len(credential) < 32 or not settings.edo_workspace_id
    ):
        raise EdoBridgeError(503, "Интеграция писем не настроена.")
    if settings.edo_ca_bundle is not None and not settings.edo_ca_bundle.is_file():
        raise EdoBridgeError(503, "Сертификат ЭДО не настроен.")
    return raw


def _headers(settings: Settings, employee_id: UUID, *, key: str | None = None) -> dict[str, str]:
    headers = {
        "Accept": "application/json",
        "Authorization": f"Bearer {settings.edo_service_credential.get_secret_value()}",
        "X-Workspace-Assertion": issue_edo_assertion(employee_id, settings),
    }
    if key is not None:
        if not _IDEMPOTENCY_KEY.fullmatch(key):
            raise EdoBridgeError(422, "Некорректный ключ операции.")
        headers["Idempotency-Key"] = key
    return headers


def _client(settings: Settings) -> httpx.AsyncClient:
    verify: bool | str = str(settings.edo_ca_bundle) if settings.edo_ca_bundle else True
    return httpx.AsyncClient(
        timeout=httpx.Timeout(10.0, read=35.0),
        follow_redirects=False,
        trust_env=False,
        verify=verify,
    )


def _raise_upstream(status_code: int, code: str | None = None) -> None:
    if status_code == 404:
        raise EdoBridgeError(404, "Письмо не найдено или доступ к нему закрыт.")
    if status_code == 403:
        raise EdoBridgeError(403, "Сотрудник не сопоставлен с ЭДО или действие запрещено.")
    if status_code == 409:
        message = (
            "Письмо изменилось. Обновите карточку перед действием."
            if code == "version_conflict" else
            "Действие конфликтует с текущим состоянием письма. Обновите карточку."
        )
        raise EdoBridgeError(409, message)
    if status_code == 503:
        raise EdoBridgeError(503, "Интеграция ЭДО пока недоступна.")
    if status_code in {400, 401, 405, 413, 415, 422}:
        raise EdoBridgeError(502, "ЭДО отклонил запрос интеграции.")
    raise EdoBridgeError(502, "Не удалось получить ответ от ЭДО.")


def _overdue(letter: EdoIncomingLetter, settings: Settings) -> bool | None:
    if letter.status in {2, 3}:
        return False
    if not letter.deadline or not settings.edo_legacy_timezone:
        return None
    try:
        zone = ZoneInfo(settings.edo_legacy_timezone)
        deadline = datetime.fromisoformat(letter.deadline.replace(" ", "T", 1))
        local_deadline = deadline.astimezone(zone) if deadline.tzinfo else deadline
        return local_deadline.date() < datetime.now(zone).date()
    except (ValueError, ZoneInfoNotFoundError):
        return None


def _decorate(letter: EdoIncomingLetter, settings: Settings) -> EdoIncomingLetter:
    return letter.model_copy(update={"overdue": _overdue(letter, settings)})


def _verified(settings: Settings) -> bool:
    if not settings.edo_legacy_timezone:
        return False
    try:
        ZoneInfo(settings.edo_legacy_timezone)
        return True
    except ZoneInfoNotFoundError:
        return False


async def _request_json(
    settings: Settings,
    employee_id: UUID,
    method: str,
    path: str,
    *,
    params: dict[str, str | int] | None = None,
    body: dict[str, object] | None = None,
    key: str | None = None,
) -> dict[str, Any]:
    base = _configured_base(settings)
    headers = _headers(settings, employee_id, key=key)
    try:
        async with _client(settings) as client:
            response = await client.request(
                method, f"{base}/workspace/v1{path}", params=params, json=body, headers=headers
            )
    except httpx.TimeoutException as error:
        message = (
            "Ответ ЭДО не получен. Результат действия неизвестен; обновите карточку перед повтором."
            if method == "POST" else "ЭДО не ответил вовремя. Повторите загрузку."
        )
        raise EdoBridgeError(504, message) from error
    except httpx.RequestError as error:
        message = (
            "Связь с ЭДО прервана. Результат действия неизвестен; обновите карточку."
            if method == "POST" else "Нет связи с ЭДО. Повторите загрузку позже."
        )
        raise EdoBridgeError(502, message) from error
    if response.status_code != 200:
        code: str | None = None
        if response.status_code == 409:
            try:
                value = response.json()
                code = value.get("error", {}).get("code") if isinstance(value, dict) else None
            except ValueError:
                pass
        _raise_upstream(response.status_code, code)
    try:
        value = response.json()
    except ValueError as error:
        raise EdoBridgeError(502, "ЭДО вернул некорректный ответ.") from error
    if not isinstance(value, dict):
        raise EdoBridgeError(502, "ЭДО вернул некорректный ответ.")
    return value


async def list_letters(
    settings: Settings,
    employee_id: UUID,
    *,
    page: int,
    limit: int,
    query: str,
    status: str | None,
) -> EdoIncomingPage:
    params: dict[str, str | int] = {"page": page, "limit": limit}
    if query:
        params["q"] = query
    if status:
        params["status"] = status
    payload = await _request_json(settings, employee_id, "GET", "/incoming", params=params)
    try:
        result = EdoIncomingPage.model_validate(payload)
    except ValidationError as error:
        raise EdoBridgeError(502, "Формат списка ЭДО не соответствует контракту.") from error
    return result.model_copy(update={
        "data": [_decorate(letter, settings) for letter in result.data],
        "deadline_timezone_verified": _verified(settings),
    })


async def get_letter(settings: Settings, employee_id: UUID, letter_id: int) -> EdoIncomingDetail:
    payload = await _request_json(settings, employee_id, "GET", f"/incoming/{letter_id}")
    try:
        result = EdoIncomingDetail.model_validate(payload)
    except ValidationError as error:
        raise EdoBridgeError(502, "Формат письма ЭДО не соответствует контракту.") from error
    return result.model_copy(update={
        "data": _decorate(result.data, settings),
        "deadline_timezone_verified": _verified(settings),
    })


async def add_assignment(
    settings: Settings,
    employee_id: UUID,
    letter_id: int,
    *,
    target_employee_id: str,
    expected_version: int,
    key: str,
) -> EdoIncomingDetail:
    payload = await _request_json(
        settings, employee_id, "POST", f"/incoming/{letter_id}/assignments",
        body={"expected_version": expected_version, "employee_id": target_employee_id}, key=key,
    )
    try:
        result = EdoIncomingDetail.model_validate(payload)
    except ValidationError as error:
        raise EdoBridgeError(502, "Формат письма ЭДО не соответствует контракту.") from error
    return result.model_copy(update={
        "data": _decorate(result.data, settings),
        "deadline_timezone_verified": _verified(settings),
    })


async def complete_letter(
    settings: Settings,
    employee_id: UUID,
    letter_id: int,
    *,
    body: dict[str, object],
    key: str,
) -> EdoIncomingDetail:
    payload = await _request_json(
        settings, employee_id, "POST", f"/incoming/{letter_id}/complete", body=body, key=key
    )
    try:
        result = EdoIncomingDetail.model_validate(payload)
    except ValidationError as error:
        raise EdoBridgeError(502, "Формат письма ЭДО не соответствует контракту.") from error
    return result.model_copy(update={
        "data": _decorate(result.data, settings),
        "deadline_timezone_verified": _verified(settings),
    })


async def stream_attachment(
    settings: Settings,
    employee_id: UUID,
    letter_id: int,
    attachment_id: str,
) -> AsyncIterator[bytes]:
    if not _ATTACHMENT_ID.fullmatch(attachment_id):
        raise EdoBridgeError(404, "Файл не найден.")
    base = _configured_base(settings)
    client = _client(settings)
    try:
        request = client.build_request(
            "GET", f"{base}/workspace/v1/incoming/{letter_id}/attachments/{attachment_id}",
            headers=_headers(settings, employee_id),
        )
        response = await client.send(request, stream=True)
    except httpx.RequestError as error:
        await client.aclose()
        raise EdoBridgeError(502, "Не удалось скачать файл из ЭДО.") from error
    if response.status_code != 200:
        await response.aclose()
        await client.aclose()
        _raise_upstream(response.status_code)

    async def chunks() -> AsyncIterator[bytes]:
        try:
            async for chunk in response.aiter_bytes():
                yield chunk
        finally:
            await response.aclose()
            await client.aclose()

    return chunks()
