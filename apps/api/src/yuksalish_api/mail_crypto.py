"""Separate, deployment-owned AES-GCM key; row/field binding prevents ciphertext swaps."""

import base64
import binascii
import ipaddress
import secrets
from urllib.parse import urlsplit

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from .errors import WorkspaceRepositoryError
from .settings import Settings


def _key(settings: Settings) -> bytes:
    try:
        key = base64.b64decode(
            settings.gmail_encryption_key.get_secret_value(),
            altchars=b"-_",
            validate=True,
        )
    except (ValueError, binascii.Error) as error:
        raise WorkspaceRepositoryError(503, "Ключ шифрования почты не настроен") from error
    if len(key) != 32:
        raise WorkspaceRepositoryError(503, "Ключ шифрования почты не настроен")
    return key


def mail_configured(settings: Settings) -> bool:
    if not settings.gmail_client_id or not settings.gmail_client_secret.get_secret_value():
        return False
    try:
        _key(settings)
        uri = urlsplit(settings.gmail_redirect_uri)
        if uri.query or uri.fragment or uri.username or uri.password or not uri.hostname:
            return False
        if uri.path != f"{settings.api_prefix}/mail/oauth/callback":
            return False
        if settings.environment in {"development", "test"} and uri.hostname == "localhost":
            return uri.scheme in {"https", "http"}
        if uri.scheme != "https" or "." not in uri.hostname:
            return False
        try:
            ipaddress.ip_address(uri.hostname)
        except ValueError:
            return True
        return False
    except (ValueError, WorkspaceRepositoryError):
        return False


def seal_bytes(settings: Settings, value: bytes, context: str) -> bytes:
    nonce = secrets.token_bytes(12)
    return nonce + AESGCM(_key(settings)).encrypt(nonce, value, context.encode())


def open_bytes(settings: Settings, value: bytes, context: str) -> bytes:
    try:
        return AESGCM(_key(settings)).decrypt(value[:12], value[12:], context.encode())
    except (ValueError, InvalidTag) as error:
        raise WorkspaceRepositoryError(503, "Данные почты недоступны для расшифровки") from error


def seal_text(settings: Settings, value: str, context: str) -> str:
    return base64.urlsafe_b64encode(seal_bytes(settings, value.encode(), context)).decode()


def open_text(settings: Settings, value: str, context: str) -> str:
    try:
        raw = base64.b64decode(value, altchars=b"-_", validate=True)
        return open_bytes(settings, raw, context).decode()
    except (ValueError, UnicodeError, binascii.Error) as error:
        raise WorkspaceRepositoryError(503, "Данные почты недоступны для расшифровки") from error
