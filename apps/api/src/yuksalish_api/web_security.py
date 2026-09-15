import hashlib
import hmac
from urllib.parse import urlsplit

from fastapi import HTTPException, Request

from .settings import Settings


def token_hash(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def is_allowed_web_origin(origin: str | None, host: str | None, settings: Settings) -> bool:
    if not origin or not host or origin not in settings.cors_origins:
        return False
    parsed = urlsplit(origin)
    return parsed.scheme == "https" and parsed.netloc.casefold() == host.casefold()


def require_web_origin(request: Request, settings: Settings) -> None:
    if not is_allowed_web_origin(
        request.headers.get("origin"), request.headers.get("host"), settings
    ):
        raise HTTPException(status_code=403, detail="Trusted web origin required")
    if request.headers.get("sec-fetch-site") not in {None, "same-origin", "none"}:
        raise HTTPException(status_code=403, detail="Cross-site request rejected")


def require_csrf(request: Request, expected_hash: str | None) -> None:
    supplied = request.headers.get("x-csrf-token", "")
    if not supplied or expected_hash is None or not hmac.compare_digest(
        token_hash(supplied), expected_hash
    ):
        raise HTTPException(status_code=403, detail="CSRF validation failed")
