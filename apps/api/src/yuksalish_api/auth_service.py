import base64
import hashlib
import hmac
import secrets
import struct
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any
from urllib.parse import quote
from uuid import UUID, uuid4

from argon2 import PasswordHasher, Type
from argon2.exceptions import VerificationError
from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from pydantic import SecretStr
from sqlalchemy import delete, func, insert, select, update
from sqlalchemy.engine import RowMapping
from sqlalchemy.ext.asyncio import AsyncConnection

from .auth import AuthenticatedUser, issue_access_token
from .auth_schemas import InvitationCreateRequest, PasswordResetCreateRequest
from .settings import Settings
from .tables import (
    audit_events,
    auth_invitations,
    auth_password_resets,
    auth_sessions,
    auth_totp_factors,
    positions,
    users,
)

_PASSWORD_HASHER = PasswordHasher(
    time_cost=3,
    memory_cost=65_536,
    parallelism=4,
    hash_len=32,
    salt_len=16,
    type=Type.ID,
)
_DUMMY_HASH = _PASSWORD_HASHER.hash(secrets.token_urlsafe(32))
Record = Mapping[str, Any] | RowMapping


class AuthServiceError(RuntimeError):
    def __init__(self, status_code: int, detail: str) -> None:
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


@dataclass(frozen=True)
class AuthResult:
    access_token: str
    refresh_token: str
    expires_in: int
    user: Record


def hash_password(password: str) -> str:
    return _PASSWORD_HASHER.hash(password)


def verify_password(password_hash: str, password: str) -> bool:
    try:
        return bool(_PASSWORD_HASHER.verify(password_hash, password))
    except VerificationError:
        return False


def validate_password(password: str, username: str) -> None:
    if len(password) < 12 or len(password) > 128:
        raise AuthServiceError(422, "Password must contain 12-128 characters")
    if username.lower() in password.lower():
        raise AuthServiceError(422, "Password must not contain the username")
    categories = (
        any(character.islower() for character in password),
        any(character.isupper() for character in password),
        any(character.isdigit() for character in password),
        any(not character.isalnum() for character in password),
    )
    if not all(categories):
        raise AuthServiceError(422, "Password must include upper, lower, digit and symbol")


async def bootstrap_initial_admin(
    connection: AsyncConnection,
    username: str,
    full_name: str,
    password: str,
    *,
    now: datetime | None = None,
) -> UUID:
    """Create the first administrator only while the user table is empty."""
    normalized_username = username.strip().lower()
    allowed = set("abcdefghijklmnopqrstuvwxyz0123456789._-")
    if not 3 <= len(normalized_username) <= 64 or any(
        character not in allowed for character in normalized_username
    ):
        raise AuthServiceError(422, "Invalid administrator username")
    normalized_full_name = full_name.strip()
    if not 2 <= len(normalized_full_name) <= 200:
        raise AuthServiceError(422, "Invalid administrator full name")
    validate_password(password, normalized_username)
    user_count = (await connection.execute(select(func.count()).select_from(users))).scalar_one()
    if user_count != 0:
        raise AuthServiceError(
            409, "Initial administrator can only be created in an empty database"
        )

    created_at = datetime.now(UTC) if now is None else now
    user_id = uuid4()
    await connection.execute(
        insert(users).values(
            id=user_id,
            username=normalized_username,
            full_name=normalized_full_name,
            job_title="Tizim administratori",
            password_hash=hash_password(password),
            role="admin",
            status="active",
            department_id=None,
            created_at=created_at,
            updated_at=created_at,
            failed_login_count=0,
            locked_until=None,
            password_changed_at=created_at,
        )
    )
    return user_id


def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _encryption_key(key: SecretStr) -> bytes:
    return hashlib.sha256(key.get_secret_value().encode()).digest()


def encrypt_totp_secret(secret: str, key: SecretStr) -> str:
    nonce = secrets.token_bytes(12)
    ciphertext = AESGCM(_encryption_key(key)).encrypt(nonce, secret.encode(), None)
    return base64.urlsafe_b64encode(nonce + ciphertext).decode()


def decrypt_totp_secret(ciphertext: str, key: SecretStr) -> str:
    try:
        packed = base64.urlsafe_b64decode(ciphertext.encode())
        nonce, encrypted = packed[:12], packed[12:]
        if len(nonce) != 12 or len(encrypted) <= 16:
            raise ValueError("Invalid encrypted secret")
        plaintext: bytes = AESGCM(_encryption_key(key)).decrypt(nonce, encrypted, None)
        return plaintext.decode()
    except (InvalidTag, ValueError, UnicodeDecodeError) as error:
        raise AuthServiceError(500, "TOTP secret cannot be decrypted") from error


def generate_totp(secret: str, *, at_time: int | None = None) -> tuple[str, int]:
    timestamp = int(datetime.now(UTC).timestamp()) if at_time is None else at_time
    step = timestamp // 30
    key = base64.b32decode(secret, casefold=True)
    digest = hmac.new(key, struct.pack(">Q", step), hashlib.sha1).digest()
    offset = digest[-1] & 0x0F
    value = (struct.unpack(">I", digest[offset : offset + 4])[0] & 0x7FFFFFFF) % 1_000_000
    return f"{value:06d}", step


def verify_totp(
    secret: str,
    code: str,
    *,
    at_time: int | None = None,
    last_used_step: int | None = None,
) -> int | None:
    timestamp = int(datetime.now(UTC).timestamp()) if at_time is None else at_time
    for offset in (-30, 0, 30):
        expected, step = generate_totp(secret, at_time=timestamp + offset)
        if hmac.compare_digest(expected, code) and (
            last_used_step is None or step > last_used_step
        ):
            return step
    return None


async def _create_session(
    connection: AsyncConnection,
    user: Record,
    settings: Settings,
    device_label: str,
    *,
    now: datetime | None = None,
) -> AuthResult:
    created_at = datetime.now(UTC) if now is None else now
    session_id = uuid4()
    refresh_token = secrets.token_urlsafe(48)
    await connection.execute(
        insert(auth_sessions).values(
            id=session_id,
            user_id=user["id"],
            refresh_token_hash=_hash_token(refresh_token),
            device_label=device_label,
            created_at=created_at,
            expires_at=created_at + timedelta(days=settings.refresh_token_ttl_days),
            last_seen_at=created_at,
            revoked_at=None,
        )
    )
    return AuthResult(
        access_token=issue_access_token(
            user["id"],
            settings.auth_signing_key,
            session_id=session_id,
            ttl_seconds=settings.access_token_ttl_seconds,
            now=int(created_at.timestamp()),
        ),
        refresh_token=refresh_token,
        expires_in=settings.access_token_ttl_seconds,
        user=user,
    )


async def login_with_password(
    connection: AsyncConnection,
    username: str,
    password: str,
    totp_code: str | None,
    device_label: str,
    settings: Settings,
    *,
    now: datetime | None = None,
) -> AuthResult:
    current_time = datetime.now(UTC) if now is None else now
    row = (
        (
            await connection.execute(
                select(users).where(users.c.username == username).with_for_update()
            )
        )
        .mappings()
        .first()
    )
    if row is None:
        verify_password(_DUMMY_HASH, password)
        raise AuthServiceError(401, "Invalid username or password")
    if row["locked_until"] is not None and row["locked_until"] > current_time:
        raise AuthServiceError(429, "Account is temporarily locked")
    password_hash = row["password_hash"]
    if (
        row["status"] != "active"
        or not isinstance(password_hash, str)
        or not verify_password(password_hash, password)
    ):
        failures = int(row["failed_login_count"] or 0) + 1
        locked_until = None
        if failures >= settings.login_max_failures:
            locked_until = current_time + timedelta(seconds=settings.login_lock_seconds)
        await connection.execute(
            update(users)
            .where(users.c.id == row["id"])
            .values(failed_login_count=failures, locked_until=locked_until)
        )
        raise AuthServiceError(401, "Invalid username or password")

    factor = (
        await connection.execute(
            select(auth_totp_factors).where(
                auth_totp_factors.c.user_id == row["id"],
                auth_totp_factors.c.confirmed_at.is_not(None),
            ).with_for_update()
        )
    ).mappings().first()
    if factor is not None:
        if totp_code is None:
            raise AuthServiceError(401, "TOTP code required")
        secret = decrypt_totp_secret(factor["secret_ciphertext"], settings.auth_encryption_key)
        used_step = verify_totp(
            secret,
            totp_code,
            at_time=int(current_time.timestamp()),
            last_used_step=factor["last_used_step"],
        )
        if used_step is None:
            raise AuthServiceError(401, "Invalid or already used TOTP code")
        await connection.execute(
            update(auth_totp_factors)
            .where(auth_totp_factors.c.user_id == row["id"])
            .values(last_used_step=used_step)
        )

    await connection.execute(
        update(users)
        .where(users.c.id == row["id"])
        .values(failed_login_count=0, locked_until=None, updated_at=current_time)
    )
    return await _create_session(connection, row, settings, device_label, now=current_time)


async def refresh_session(
    connection: AsyncConnection,
    refresh_token: str,
    settings: Settings,
    *,
    now: datetime | None = None,
) -> AuthResult:
    current_time = datetime.now(UTC) if now is None else now
    statement = (
        select(
            auth_sessions.c.id.label("session_id"),
            auth_sessions.c.expires_at,
            auth_sessions.c.revoked_at,
            users.c.id,
            users.c.username,
            users.c.full_name,
            users.c.position_id,
            users.c.job_title,
            users.c.role,
            users.c.status,
        )
        .join(users, users.c.id == auth_sessions.c.user_id)
        .where(auth_sessions.c.refresh_token_hash == _hash_token(refresh_token))
        .with_for_update()
    )
    row = (await connection.execute(statement)).mappings().first()
    if (
        row is None
        or row["revoked_at"] is not None
        or row["expires_at"] <= current_time
        or row["status"] != "active"
    ):
        raise AuthServiceError(401, "Refresh session is not active")
    rotated_token = secrets.token_urlsafe(48)
    await connection.execute(
        update(auth_sessions)
        .where(auth_sessions.c.id == row["session_id"])
        .values(refresh_token_hash=_hash_token(rotated_token), last_seen_at=current_time)
    )
    return AuthResult(
        access_token=issue_access_token(
            row["id"],
            settings.auth_signing_key,
            session_id=row["session_id"],
            ttl_seconds=settings.access_token_ttl_seconds,
            now=int(current_time.timestamp()),
        ),
        refresh_token=rotated_token,
        expires_in=settings.access_token_ttl_seconds,
        user=row,
    )


async def create_invitation(
    connection: AsyncConnection,
    inviter: AuthenticatedUser,
    payload: InvitationCreateRequest,
    settings: Settings,
    *,
    now: datetime | None = None,
) -> dict[str, Any]:
    if inviter.role not in {"admin", "superadmin"}:
        raise AuthServiceError(403, "Administrator role required")
    existing = (
        await connection.execute(select(users.c.id).where(users.c.username == payload.username))
    ).scalar_one_or_none()
    if existing is not None:
        raise AuthServiceError(409, "Username already exists")
    created_at = datetime.now(UTC) if now is None else now
    user_id = uuid4()
    invitation_id = uuid4()
    invite_token = secrets.token_urlsafe(48)
    position_name = payload.job_title.strip() if payload.job_title else None
    if payload.position_id is not None:
        position = (
            await connection.execute(
                select(positions.c.name).where(
                    positions.c.id == payload.position_id,
                    positions.c.is_active.is_(True),
                )
            )
        ).mappings().first()
        if position is None:
            raise AuthServiceError(422, "Position is not active or does not exist")
        position_name = position["name"]
    await connection.execute(
        insert(users).values(
            id=user_id,
            username=payload.username,
            full_name=payload.full_name.strip(),
            job_title=position_name,
            role=payload.role,
            status="pending",
            department_id=payload.department_id,
            position_id=payload.position_id,
            created_at=created_at,
            updated_at=created_at,
            failed_login_count=0,
            locked_until=None,
            password_changed_at=None,
        )
    )
    expires_at = created_at + timedelta(hours=settings.invitation_ttl_hours)
    await connection.execute(
        insert(auth_invitations).values(
            id=invitation_id,
            user_id=user_id,
            invited_by_user_id=inviter.id,
            token_hash=_hash_token(invite_token),
            created_at=created_at,
            expires_at=expires_at,
            accepted_at=None,
            revoked_at=None,
        )
    )
    return {
        "id": str(invitation_id),
        "username": payload.username,
        "full_name": payload.full_name.strip(),
        "role": payload.role,
        "invite_token": invite_token,
        "expires_at": expires_at,
    }


async def accept_invitation(
    connection: AsyncConnection,
    invite_token: str,
    password: str,
    device_label: str,
    settings: Settings,
    *,
    now: datetime | None = None,
) -> AuthResult:
    current_time = datetime.now(UTC) if now is None else now
    statement = (
        select(
            auth_invitations.c.id.label("invitation_id"),
            auth_invitations.c.expires_at,
            auth_invitations.c.accepted_at,
            auth_invitations.c.revoked_at,
            users.c.id,
            users.c.username,
            users.c.full_name,
            users.c.position_id,
            users.c.job_title,
            users.c.role,
            users.c.status,
        )
        .join(users, users.c.id == auth_invitations.c.user_id)
        .where(auth_invitations.c.token_hash == _hash_token(invite_token))
        .with_for_update()
    )
    row = (await connection.execute(statement)).mappings().first()
    if row is None:
        raise AuthServiceError(404, "Invitation was not found")
    if row["accepted_at"] is not None or row["revoked_at"] is not None:
        raise AuthServiceError(409, "Invitation is no longer active")
    if row["expires_at"] <= current_time:
        raise AuthServiceError(410, "Invitation has expired")
    validate_password(password, row["username"])
    await connection.execute(
        update(users)
        .where(users.c.id == row["id"])
        .values(
            password_hash=hash_password(password),
            status="active",
            password_changed_at=current_time,
            updated_at=current_time,
        )
    )
    await connection.execute(
        update(auth_invitations)
        .where(auth_invitations.c.id == row["invitation_id"])
        .values(accepted_at=current_time)
    )
    return await _create_session(connection, row, settings, device_label, now=current_time)


async def create_password_reset(
    connection: AsyncConnection,
    issuer: AuthenticatedUser,
    payload: PasswordResetCreateRequest,
    settings: Settings,
    *,
    now: datetime | None = None,
) -> dict[str, Any]:
    if issuer.role not in {"admin", "superadmin"}:
        raise AuthServiceError(403, "Administrator role required")
    user = (
        (
            await connection.execute(
                select(users.c.id, users.c.username, users.c.role).where(
                    users.c.username == payload.username,
                    users.c.status.in_(("active", "blocked")),
                )
            )
        )
        .mappings()
        .first()
    )
    if user is None:
        raise AuthServiceError(404, "User was not found")
    _require_password_management_permission(issuer, user["id"], user["role"])

    created_at = datetime.now(UTC) if now is None else now
    await connection.execute(
        update(auth_password_resets)
        .where(
            auth_password_resets.c.user_id == user["id"],
            auth_password_resets.c.consumed_at.is_(None),
            auth_password_resets.c.revoked_at.is_(None),
        )
        .values(revoked_at=created_at)
    )
    reset_id = uuid4()
    reset_token = secrets.token_urlsafe(48)
    expires_at = created_at + timedelta(hours=settings.password_reset_ttl_hours)
    await connection.execute(
        insert(auth_password_resets).values(
            id=reset_id,
            user_id=user["id"],
            issued_by_user_id=issuer.id,
            token_hash=_hash_token(reset_token),
            reset_totp=payload.reset_totp,
            created_at=created_at,
            expires_at=expires_at,
            consumed_at=None,
            revoked_at=None,
        )
    )
    return {
        "id": str(reset_id),
        "username": user["username"],
        "reset_token": reset_token,
        "reset_totp": payload.reset_totp,
        "expires_at": expires_at,
    }


def _require_password_management_permission(
    actor: AuthenticatedUser,
    target_id: UUID,
    target_role: str,
) -> None:
    if actor.id == target_id or actor.role == "superadmin":
        return
    if actor.role == "admin" and target_role in {"employee", "manager"}:
        return
    raise AuthServiceError(403, "Password change is not permitted for this account")


async def change_account_password(
    connection: AsyncConnection,
    actor: AuthenticatedUser,
    target_id: UUID,
    password: str,
    *,
    now: datetime | None = None,
) -> None:
    target = (
        await connection.execute(
            select(users.c.id, users.c.username, users.c.role, users.c.status)
            .where(users.c.id == target_id)
            .with_for_update()
        )
    ).mappings().first()
    if target is None:
        raise AuthServiceError(404, "User was not found")
    _require_password_management_permission(actor, target_id, target["role"])
    if target["status"] != "active":
        raise AuthServiceError(409, "Only active accounts can change passwords")
    validate_password(password, target["username"])
    changed_at = datetime.now(UTC) if now is None else now
    await connection.execute(
        update(users)
        .where(users.c.id == target_id)
        .values(
            password_hash=hash_password(password),
            failed_login_count=0,
            locked_until=None,
            password_changed_at=changed_at,
            updated_at=changed_at,
        )
    )
    await connection.execute(
        update(auth_sessions)
        .where(auth_sessions.c.user_id == target_id, auth_sessions.c.revoked_at.is_(None))
        .values(revoked_at=changed_at)
    )
    await connection.execute(
        update(auth_password_resets)
        .where(
            auth_password_resets.c.user_id == target_id,
            auth_password_resets.c.consumed_at.is_(None),
            auth_password_resets.c.revoked_at.is_(None),
        )
        .values(revoked_at=changed_at)
    )
    await connection.execute(
        insert(audit_events).values(
            id=uuid4(),
            actor_user_id=actor.id,
            action="auth.password_changed",
            target_type="user",
            target_id=target_id,
            details={"self_service": actor.id == target_id},
            created_at=changed_at,
        )
    )


async def complete_password_reset(
    connection: AsyncConnection,
    reset_token: str,
    password: str,
    device_label: str,
    settings: Settings,
    *,
    now: datetime | None = None,
) -> AuthResult:
    current_time = datetime.now(UTC) if now is None else now
    row = (
        (
            await connection.execute(
                select(
                    auth_password_resets.c.id.label("reset_id"),
                    auth_password_resets.c.expires_at,
                    auth_password_resets.c.consumed_at,
                    auth_password_resets.c.revoked_at,
                    auth_password_resets.c.reset_totp,
                    users.c.id,
                    users.c.username,
                    users.c.full_name,
                    users.c.position_id,
                    users.c.job_title,
                    users.c.role,
                    users.c.status,
                )
                .join(users, users.c.id == auth_password_resets.c.user_id)
                .where(auth_password_resets.c.token_hash == _hash_token(reset_token))
                .with_for_update()
            )
        )
        .mappings()
        .first()
    )
    if row is None:
        raise AuthServiceError(404, "Password reset was not found")
    if row["consumed_at"] is not None or row["revoked_at"] is not None:
        raise AuthServiceError(409, "Password reset is no longer active")
    if row["expires_at"] <= current_time:
        raise AuthServiceError(410, "Password reset has expired")

    validate_password(password, row["username"])
    await connection.execute(
        update(users)
        .where(users.c.id == row["id"])
        .values(
            password_hash=hash_password(password),
            status="active",
            failed_login_count=0,
            locked_until=None,
            password_changed_at=current_time,
            updated_at=current_time,
        )
    )
    await connection.execute(
        update(auth_sessions)
        .where(auth_sessions.c.user_id == row["id"], auth_sessions.c.revoked_at.is_(None))
        .values(revoked_at=current_time)
    )
    if row["reset_totp"]:
        await connection.execute(
            delete(auth_totp_factors).where(auth_totp_factors.c.user_id == row["id"])
        )
    await connection.execute(
        update(auth_password_resets)
        .where(auth_password_resets.c.id == row["reset_id"])
        .values(consumed_at=current_time)
    )
    return await _create_session(connection, row, settings, device_label, now=current_time)


async def begin_totp_setup(
    connection: AsyncConnection,
    user: AuthenticatedUser,
    settings: Settings,
    *,
    now: datetime | None = None,
) -> dict[str, str]:
    created_at = datetime.now(UTC) if now is None else now
    existing = (
        await connection.execute(
            select(auth_totp_factors.c.confirmed_at).where(auth_totp_factors.c.user_id == user.id)
        )
    ).scalar_one_or_none()
    if existing is not None:
        raise AuthServiceError(409, "TOTP is already enabled")
    secret = base64.b32encode(secrets.token_bytes(20)).decode().rstrip("=")
    ciphertext = encrypt_totp_secret(secret, settings.auth_encryption_key)
    await connection.execute(
        delete(auth_totp_factors).where(auth_totp_factors.c.user_id == user.id)
    )
    await connection.execute(
        insert(auth_totp_factors).values(
            user_id=user.id,
            secret_ciphertext=ciphertext,
            created_at=created_at,
            confirmed_at=None,
            last_used_step=None,
        )
    )
    label = quote(f"Yuksalish Workspace:{user.username}")
    uri = f"otpauth://totp/{label}?secret={secret}&issuer=Yuksalish%20Workspace&digits=6&period=30"
    return {"secret": secret, "otpauth_uri": uri}


async def confirm_totp_setup(
    connection: AsyncConnection,
    user: AuthenticatedUser,
    code: str,
    settings: Settings,
    *,
    now: datetime | None = None,
) -> None:
    current_time = datetime.now(UTC) if now is None else now
    factor = (
        (
            await connection.execute(
                select(auth_totp_factors).where(auth_totp_factors.c.user_id == user.id)
            )
        )
        .mappings()
        .first()
    )
    if factor is None:
        raise AuthServiceError(404, "Start TOTP setup first")
    if factor["confirmed_at"] is not None:
        raise AuthServiceError(409, "TOTP is already enabled")
    secret = decrypt_totp_secret(factor["secret_ciphertext"], settings.auth_encryption_key)
    if verify_totp(secret, code, at_time=int(current_time.timestamp())) is None:
        raise AuthServiceError(422, "Invalid TOTP code")
    await connection.execute(
        update(auth_totp_factors)
        .where(auth_totp_factors.c.user_id == user.id)
        .values(confirmed_at=current_time)
    )


async def totp_enabled(connection: AsyncConnection, user_id: UUID) -> bool:
    confirmed_at = (
        await connection.execute(
            select(auth_totp_factors.c.confirmed_at).where(auth_totp_factors.c.user_id == user_id)
        )
    ).scalar_one_or_none()
    return confirmed_at is not None


async def disable_totp(
    connection: AsyncConnection,
    user: AuthenticatedUser,
    password: str,
    code: str,
    settings: Settings,
    *,
    now: datetime | None = None,
) -> None:
    current_time = datetime.now(UTC) if now is None else now
    user_row = (
        (await connection.execute(select(users).where(users.c.id == user.id))).mappings().one()
    )
    password_hash = user_row["password_hash"]
    if not isinstance(password_hash, str) or not verify_password(password_hash, password):
        raise AuthServiceError(401, "Invalid password")
    factor = (
        (
            await connection.execute(
                select(auth_totp_factors).where(
                    auth_totp_factors.c.user_id == user.id,
                    auth_totp_factors.c.confirmed_at.is_not(None),
                )
            )
        )
        .mappings()
        .first()
    )
    if factor is None:
        raise AuthServiceError(404, "TOTP is not enabled")
    secret = decrypt_totp_secret(factor["secret_ciphertext"], settings.auth_encryption_key)
    if verify_totp(secret, code, at_time=int(current_time.timestamp())) is None:
        raise AuthServiceError(401, "Invalid TOTP code")
    await connection.execute(
        delete(auth_totp_factors).where(auth_totp_factors.c.user_id == user.id)
    )


async def list_user_sessions(
    connection: AsyncConnection,
    user: AuthenticatedUser,
    *,
    now: datetime | None = None,
) -> list[dict[str, Any]]:
    current_time = datetime.now(UTC) if now is None else now
    rows = (
        (
            await connection.execute(
                select(auth_sessions)
                .where(
                    auth_sessions.c.user_id == user.id,
                    auth_sessions.c.revoked_at.is_(None),
                    auth_sessions.c.expires_at > current_time,
                )
                .order_by(auth_sessions.c.last_seen_at.desc())
            )
        )
        .mappings()
        .all()
    )
    return [
        {
            "id": str(row["id"]),
            "device_label": row["device_label"],
            "created_at": row["created_at"],
            "last_seen_at": row["last_seen_at"],
            "expires_at": row["expires_at"],
            "current": row["id"] == user.session_id,
        }
        for row in rows
    ]


async def revoke_session(
    connection: AsyncConnection,
    user: AuthenticatedUser,
    session_id: UUID,
    *,
    now: datetime | None = None,
) -> None:
    current_time = datetime.now(UTC) if now is None else now
    result = await connection.execute(
        update(auth_sessions)
        .where(
            auth_sessions.c.id == session_id,
            auth_sessions.c.user_id == user.id,
            auth_sessions.c.revoked_at.is_(None),
        )
        .values(revoked_at=current_time)
    )
    if result.rowcount != 1:
        raise AuthServiceError(404, "Session was not found")
