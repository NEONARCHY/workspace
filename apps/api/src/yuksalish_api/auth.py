import base64
import hashlib
import hmac
import json
import re
import time
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Annotated, Any
from uuid import UUID

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import SecretStr
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncConnection

from .access_control import ensure_request_module_access
from .database import get_connection
from .settings import Settings
from .tables import auth_sessions, update_policy, users
from .web_security import require_csrf, require_web_origin

bearer = HTTPBearer(auto_error=False)


@dataclass(frozen=True)
class AccessTokenClaims:
    user_id: UUID
    session_id: UUID | None
    expires_at: int


@dataclass(frozen=True)
class AuthenticatedUser:
    id: UUID
    username: str
    full_name: str
    position_id: UUID | None
    job_title: str | None
    role: str
    department_id: UUID | None = None
    session_id: UUID | None = None
    client_kind: str = "desktop"
    csrf_token_hash: str | None = None


class InvalidTokenError(ValueError):
    pass


def _b64encode(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).decode("ascii").rstrip("=")


def _b64decode(value: str) -> bytes:
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


def issue_access_token(
    user_id: UUID,
    signing_key: SecretStr,
    *,
    session_id: UUID | None = None,
    ttl_seconds: int = 12 * 60 * 60,
    now: int | None = None,
) -> str:
    issued_at = int(time.time()) if now is None else now
    payload: dict[str, str | int] = {
        "exp": issued_at + ttl_seconds,
        "iat": issued_at,
        "sub": str(user_id),
        "typ": "access",
    }
    if session_id is not None:
        payload["sid"] = str(session_id)
    encoded = _b64encode(json.dumps(payload, separators=(",", ":"), sort_keys=True).encode())
    signature = hmac.new(
        signing_key.get_secret_value().encode(),
        encoded.encode(),
        hashlib.sha256,
    ).digest()
    return f"{encoded}.{_b64encode(signature)}"


def read_access_token(
    token: str,
    signing_key: SecretStr,
    *,
    now: int | None = None,
) -> AccessTokenClaims:
    try:
        encoded, supplied_signature = token.split(".", maxsplit=1)
        expected_signature = hmac.new(
            signing_key.get_secret_value().encode(),
            encoded.encode(),
            hashlib.sha256,
        ).digest()
        if not hmac.compare_digest(expected_signature, _b64decode(supplied_signature)):
            raise InvalidTokenError("Invalid signature")
        payload: dict[str, Any] = json.loads(_b64decode(encoded))
        current_time = int(time.time()) if now is None else now
        expires_at = payload.get("exp")
        if not isinstance(expires_at, int) or expires_at <= current_time:
            raise InvalidTokenError("Token expired")
        if payload.get("typ") not in {None, "access"}:
            raise InvalidTokenError("Invalid token type")
        session_id = UUID(str(payload["sid"])) if payload.get("sid") is not None else None
        return AccessTokenClaims(
            user_id=UUID(str(payload["sub"])),
            session_id=session_id,
            expires_at=expires_at,
        )
    except (KeyError, TypeError, ValueError, json.JSONDecodeError) as error:
        if isinstance(error, InvalidTokenError):
            raise
        raise InvalidTokenError("Malformed token") from error


def verify_access_token(
    token: str,
    signing_key: SecretStr,
    *,
    now: int | None = None,
) -> UUID:
    return read_access_token(token, signing_key, now=now).user_id


async def load_authenticated_user(
    connection: AsyncConnection,
    user_id: UUID,
    *,
    session_id: UUID | None = None,
    client_kind: str = "desktop",
    csrf_token_hash: str | None = None,
) -> AuthenticatedUser | None:
    statement = select(
        users.c.id,
        users.c.username,
        users.c.full_name,
        users.c.position_id,
        users.c.job_title,
        users.c.role,
        users.c.department_id,
    ).where(users.c.id == user_id, users.c.status == "active")
    row = (await connection.execute(statement)).mappings().first()
    if row is None:
        return None
    return AuthenticatedUser(
        id=row["id"],
        username=row["username"],
        full_name=row["full_name"],
        position_id=row["position_id"],
        job_title=row["job_title"],
        role=row["role"],
        department_id=row["department_id"],
        session_id=session_id,
        client_kind=client_kind,
        csrf_token_hash=csrf_token_hash,
    )


async def authenticate_access_token(
    connection: AsyncConnection,
    token: str,
    settings: Settings,
) -> AuthenticatedUser:
    claims = read_access_token(token, settings.auth_signing_key)
    client_kind = "desktop"
    csrf_token_hash: str | None = None
    if claims.session_id is None:
        if settings.environment not in {"development", "test"}:
            raise InvalidTokenError("Server session required")
    else:
        now = datetime.now(UTC)
        session_record = (
            await connection.execute(
                select(
                    auth_sessions.c.id,
                    auth_sessions.c.client_kind,
                    auth_sessions.c.csrf_token_hash,
                ).where(
                    auth_sessions.c.id == claims.session_id,
                    auth_sessions.c.user_id == claims.user_id,
                    auth_sessions.c.revoked_at.is_(None),
                    auth_sessions.c.expires_at > now,
                )
            )
        ).mappings().first()
        if session_record is None:
            raise InvalidTokenError("Session is no longer active")
        client_kind = session_record["client_kind"]
        csrf_token_hash = session_record["csrf_token_hash"]
    user = await load_authenticated_user(
        connection,
        claims.user_id,
        session_id=claims.session_id,
        client_kind=client_kind,
        csrf_token_hash=csrf_token_hash,
    )
    if user is None:
        raise InvalidTokenError("User is not active")
    return user


async def require_user(
    request: Request,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)],
    connection: Annotated[AsyncConnection, Depends(get_connection)],
) -> AuthenticatedUser:
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Bearer token required",
        )
    try:
        user = await authenticate_access_token(
            connection,
            credentials.credentials,
            request.app.state.settings,
        )
        if user.client_kind == "web" and request.method not in {"GET", "HEAD", "OPTIONS"}:
            require_web_origin(request, request.app.state.settings)
            require_csrf(request, user.csrf_token_hash)
        update_path = f"{request.app.state.settings.api_prefix}/updates/"
        if (
            request.app.state.settings.environment == "production"
            and user.client_kind != "web"
            and not request.url.path.startswith(update_path)
        ):
            policy = (
                await connection.execute(
                    select(update_policy.c.mandatory, update_policy.c.minimum_version).where(
                        update_policy.c.id == 1
                    )
                )
            ).mappings().one()
            minimum = policy["minimum_version"]
            supplied = request.headers.get("X-Desktop-Version", "")
            valid = re.fullmatch(r"\d+\.\d+\.\d+", supplied)
            if policy["mandatory"] and minimum and (
                valid is None
                or tuple(map(int, supplied.split("."))) < tuple(map(int, minimum.split(".")))
            ):
                raise HTTPException(
                    status_code=426,
                    detail=f"Требуется обновить приложение до версии {minimum}",
                )
        await ensure_request_module_access(connection, user, request.url.path, request.method)
        return user
    except InvalidTokenError as error:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(error)) from error
