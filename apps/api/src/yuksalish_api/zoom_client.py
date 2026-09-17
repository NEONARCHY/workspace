# Russian user-facing text next to Latin product names trips the ambiguity check.
# ruff: noqa: RUF001
"""Zoom Server-to-Server OAuth client.

Ported from the standalone ZoomBot so both products speak to the same corporate
host the same way. Credentials never leave the server and never reach a log
line: only the HTTP status, the API path and the meeting identifier are logged.
"""

from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
import structlog

from .settings import Settings

logger = structlog.get_logger(__name__)

_MAX_ATTEMPTS = 3
_REQUEST_TIMEOUT = httpx.Timeout(15.0)
_TOKEN_EXPIRY_MARGIN_SECONDS = 60
_MAX_UPCOMING_PAGES = 5
_UPCOMING_PAGE_SIZE = 300


class ZoomError(RuntimeError):
    """Zoom refused an operation or is unreachable; carries a user-facing reason."""

    def __init__(self, status_code: int, detail: str) -> None:
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


@dataclass(frozen=True, slots=True)
class ZoomMeeting:
    meeting_id: str
    join_url: str
    passcode: str | None


@dataclass(frozen=True, slots=True)
class ZoomHostBooking:
    """An occupied interval on the corporate host, whoever created it."""

    meeting_id: str
    topic: str
    starts_at: datetime
    ends_at: datetime


def _parse_zoom_time(value: str) -> datetime | None:
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo is not None else parsed.replace(tzinfo=UTC)


class ZoomClient:
    def __init__(self, settings: Settings, client: httpx.AsyncClient | None = None) -> None:
        self._settings = settings
        self._client = client or httpx.AsyncClient(timeout=_REQUEST_TIMEOUT)
        self._owns_client = client is None
        self._access_token: str | None = None
        self._token_expires_at = 0.0
        self._token_lock = asyncio.Lock()

    async def aclose(self) -> None:
        if self._owns_client:
            await self._client.aclose()

    async def _token(self, *, force: bool = False) -> str:
        if not force and self._access_token and time.monotonic() < self._token_expires_at:
            return self._access_token
        async with self._token_lock:
            if not force and self._access_token and time.monotonic() < self._token_expires_at:
                return self._access_token
            try:
                response = await self._client.post(
                    self._settings.zoom_oauth_url,
                    params={
                        "grant_type": "account_credentials",
                        "account_id": self._settings.zoom_account_id,
                    },
                    auth=(
                        self._settings.zoom_client_id,
                        self._settings.zoom_client_secret.get_secret_value(),
                    ),
                    headers={"Content-Type": "application/x-www-form-urlencoded"},
                )
                response.raise_for_status()
                payload = response.json()
                token = str(payload["access_token"])
                lifetime = int(payload.get("expires_in", 3600))
            except (httpx.HTTPError, KeyError, TypeError, ValueError) as error:
                logger.warning("zoom_token_failed", error=type(error).__name__)
                raise ZoomError(502, "Не удалось авторизоваться в Zoom.") from error
            self._access_token = token
            self._token_expires_at = time.monotonic() + lifetime - _TOKEN_EXPIRY_MARGIN_SECONDS
            return token

    async def _request(
        self,
        method: str,
        path: str,
        *,
        allowed_statuses: frozenset[int] = frozenset(),
        **kwargs: Any,
    ) -> httpx.Response:
        for attempt in range(_MAX_ATTEMPTS):
            token = await self._token(force=attempt == 1)
            try:
                response = await self._client.request(
                    method,
                    f"{self._settings.zoom_api_base_url}{path}",
                    headers={"Authorization": f"Bearer {token}"},
                    **kwargs,
                )
            except httpx.HTTPError as error:
                if attempt + 1 < _MAX_ATTEMPTS:
                    await asyncio.sleep(0.5 * (2**attempt))
                    continue
                logger.warning("zoom_transport_failed", path=path, error=type(error).__name__)
                raise ZoomError(502, "Zoom временно недоступен.") from error
            retryable = response.status_code == 429 or response.status_code >= 500
            if response.status_code == 401 and attempt == 0:
                continue
            if retryable and attempt + 1 < _MAX_ATTEMPTS:
                await asyncio.sleep(min(_retry_delay(response, attempt), 5.0))
                continue
            if response.is_error and response.status_code not in allowed_statuses:
                logger.warning("zoom_api_error", status=response.status_code, path=path)
                raise ZoomError(502, "Zoom отклонил операцию.")
            return response
        raise ZoomError(502, "Zoom временно недоступен.")

    async def create_meeting(
        self,
        *,
        topic: str,
        starts_at: datetime,
        duration_minutes: int,
        description: str | None,
    ) -> ZoomMeeting:
        payload = {
            "topic": topic,
            "type": 2,
            "start_time": starts_at.astimezone(UTC).isoformat().replace("+00:00", "Z"),
            "duration": duration_minutes,
            "timezone": self._settings.zoom_timezone,
            "agenda": description or "",
            "settings": {
                "join_before_host": True,
                "jbh_time": 0,
                "waiting_room": False,
                "mute_upon_entry": True,
                "approval_type": 2,
                "auto_recording": "none",
            },
        }
        response = await self._request(
            "POST", f"/users/{self._settings.zoom_host_user_id}/meetings", json=payload
        )
        data = response.json()
        try:
            meeting_id = str(data["id"])
            join_url = str(data["join_url"])
        except (KeyError, TypeError) as error:
            logger.warning("zoom_create_response_invalid")
            raise ZoomError(502, "Zoom вернул неполный ответ о конференции.") from error
        passcode = data.get("password")
        return ZoomMeeting(meeting_id, join_url, str(passcode) if passcode else None)

    async def update_meeting(
        self,
        meeting_id: str,
        *,
        topic: str,
        starts_at: datetime,
        duration_minutes: int,
        description: str | None,
    ) -> None:
        await self._request(
            "PATCH",
            f"/meetings/{meeting_id}",
            json={
                "topic": topic,
                "start_time": starts_at.astimezone(UTC).isoformat().replace("+00:00", "Z"),
                "duration": duration_minutes,
                "timezone": self._settings.zoom_timezone,
                "agenda": description or "",
            },
        )

    async def delete_meeting(self, meeting_id: str) -> None:
        # A meeting already removed in the Zoom console must not block our cancellation.
        await self._request(
            "DELETE", f"/meetings/{meeting_id}", allowed_statuses=frozenset({404})
        )

    async def list_upcoming(self) -> list[ZoomHostBooking]:
        """Every future booking of the corporate host, including ones made outside Workspace."""
        bookings: list[ZoomHostBooking] = []
        next_page = ""
        for _ in range(_MAX_UPCOMING_PAGES):
            params: dict[str, Any] = {"type": "upcoming", "page_size": _UPCOMING_PAGE_SIZE}
            if next_page:
                params["next_page_token"] = next_page
            response = await self._request(
                "GET", f"/users/{self._settings.zoom_host_user_id}/meetings", params=params
            )
            data = response.json()
            if not isinstance(data, dict):
                raise ZoomError(502, "Zoom вернул неожиданный список конференций.")
            for item in data.get("meetings") or []:
                booking = _booking_from(item)
                if booking is not None:
                    bookings.append(booking)
            next_page = str(data.get("next_page_token") or "")
            if not next_page:
                break
        return bookings


def _retry_delay(response: httpx.Response, attempt: int) -> float:
    fallback = 0.5 * (2.0**attempt)
    header = response.headers.get("Retry-After")
    if header is None:
        return fallback
    try:
        return float(header)
    except ValueError:
        return fallback


def _booking_from(item: object) -> ZoomHostBooking | None:
    # Recurring meetings without a fixed time occupy no interval, so they are skipped.
    if not isinstance(item, dict):
        return None
    raw_start = item.get("start_time")
    if not isinstance(raw_start, str):
        return None
    starts_at = _parse_zoom_time(raw_start)
    if starts_at is None:
        return None
    try:
        duration = int(item.get("duration") or 0)
    except (TypeError, ValueError):
        return None
    if duration <= 0:
        return None
    return ZoomHostBooking(
        meeting_id=str(item.get("id") or ""),
        topic=str(item.get("topic") or "Конференция Zoom"),
        starts_at=starts_at,
        ends_at=starts_at + timedelta(minutes=duration),
    )
