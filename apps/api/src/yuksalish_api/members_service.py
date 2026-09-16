# ruff: noqa: RUF001
from __future__ import annotations

import asyncio
import hashlib
import hmac
import time
from dataclasses import dataclass

import httpx
from fastapi import HTTPException, status
from pydantic import ValidationError

from .members_schemas import MembersRegistryResponse
from .settings import Settings


@dataclass
class _CachedRegistry:
    expires_at: float
    value: MembersRegistryResponse


_cache: _CachedRegistry | None = None
_cache_lock = asyncio.Lock()


def _signature(key: str, timestamp: str, request_path: str) -> str:
    message = (f"{timestamp}.GET" + chr(10) + request_path + chr(10)).encode()
    return hmac.new(key.encode(), message, hashlib.sha256).hexdigest()


async def load_members_registry(settings: Settings) -> MembersRegistryResponse:
    """Load the roster only through the hosting's signed, read-only endpoint."""
    if not settings.members_api_url or not settings.members_integration_key.get_secret_value():
        return MembersRegistryResponse(configured=False)

    global _cache
    now = time.monotonic()
    if _cache is not None and _cache.expires_at > now:
        return _cache.value

    async with _cache_lock:
        now = time.monotonic()
        if _cache is not None and _cache.expires_at > now:
            return _cache.value
        endpoint = httpx.URL(settings.members_api_url)
        timestamp = str(int(time.time()))
        request_path = endpoint.raw_path.decode("ascii") or "/"
        headers = {
            "Accept": "application/json",
            "X-Yuksalish-Timestamp": timestamp,
            "X-Yuksalish-Signature": _signature(
                settings.members_integration_key.get_secret_value(), timestamp, request_path
            ),
        }
        try:
            async with httpx.AsyncClient(timeout=15.0, follow_redirects=False) as client:
                response = await client.get(endpoint, headers=headers)
            response.raise_for_status()
            result = MembersRegistryResponse.model_validate(response.json())
        except (httpx.HTTPError, ValidationError, ValueError) as error:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="Не удалось получить реестр членов. Повторите обновление позже.",
            ) from error
        _cache = _CachedRegistry(
            expires_at=now + max(30, settings.members_cache_seconds), value=result
        )
        return result
