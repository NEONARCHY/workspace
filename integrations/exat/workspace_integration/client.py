"""Small HTTPS client. Secrets are held in Windows Credential Manager or environment."""

from __future__ import annotations

import json
import os
import ssl
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, HTTPSHandler, Request, build_opener

TOKEN_TARGET = "AIReferent.Workspace.Agent"


class WorkspaceError(RuntimeError):
    def __init__(self, message: str, status: int = 0):
        super().__init__(message)
        self.status = status


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(
        self, req: Any, fp: Any, code: int, msg: str, headers: Any, newurl: str
    ) -> None:
        raise WorkspaceError("Перенаправление API запрещено. Проверьте адрес сервера.")


def connection_path() -> Path:
    return Path(os.environ.get("LOCALAPPDATA", str(Path.home()))) / "AIReferent" / "workspace.json"


def connection_settings() -> dict[str, str]:
    path = connection_path()
    data = json.loads(path.read_text(encoding="utf-8")) if path.is_file() else {}
    return {
        "api_url": os.environ.get("YUKSALISH_API_BASE_URL", data.get("api_url", "")),
        "ca_file": os.environ.get("YUKSALISH_WORKSPACE_CA_FILE", data.get("ca_file", "")),
        "agent_id": os.environ.get(
            "YUKSALISH_AI_REFERENT_AGENT_ID", data.get("agent_id", "referent-pc")
        ),
    }


def legacy_bindings() -> dict[str, str]:
    path = connection_path()
    data = json.loads(path.read_text(encoding="utf-8")) if path.is_file() else {}
    return dict(data.get("legacy_bindings", {}))


def validate_url(value: str) -> str:
    value = value.strip().rstrip("/")
    parts = urlsplit(value)
    if (
        parts.scheme != "https"
        or not parts.hostname
        or parts.username
        or parts.password
        or parts.query
        or parts.fragment
    ):
        raise WorkspaceError("Укажите HTTPS-адрес Workspace без логина и пароля.")
    return value if value.endswith("/api/v1") else value + "/api/v1"


def save_connection(
    api_url: str, ca_file: str, token: str, initial_bindings: dict[str, str] | None = None
) -> None:
    from src.security.credential_store import write_windows_generic_credential

    api_url = validate_url(api_url)
    ssl.create_default_context(cafile=ca_file or None)
    if token:
        try:
            from pywintypes import error as CredentialError
        except ImportError:
            raise WorkspaceError(
                "Для хранения ключа установите зависимости Windows версии Exat."
            ) from None
        try:
            write_windows_generic_credential(TOKEN_TARGET, "workspace-agent", token)
        except (CredentialError, RuntimeError):
            raise WorkspaceError(
                "Windows не разрешила сохранить ключ в хранилище учётных данных."
            ) from None
    path = connection_path()
    previous = json.loads(path.read_text(encoding="utf-8")) if path.is_file() else {}
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(".tmp")
    temporary.write_text(
        json.dumps(
            {
                **previous,
                "api_url": api_url,
                "ca_file": ca_file,
                "legacy_bindings": previous.get("legacy_bindings", initial_bindings or {}),
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    temporary.replace(path)


class WorkspaceClient:
    def __init__(self, *, settings: dict[str, str] | None = None, token: str | None = None):
        self.settings = settings if settings is not None else connection_settings()
        self.api_url = validate_url(self.settings.get("api_url", ""))
        self.agent_id = self.settings.get("agent_id", "referent-pc")
        if token is None:
            token = os.environ.get("YUKSALISH_AI_REFERENT_AGENT_TOKEN", "")
            if not token:
                from src.security.credential_store import read_windows_generic_credential

                _, token = read_windows_generic_credential(TOKEN_TARGET)
        if not token:
            raise WorkspaceError("Сохраните ключ подключения агента Workspace.")
        self.token = token
        context = ssl.create_default_context(cafile=self.settings.get("ca_file") or None)
        self.opener = build_opener(NoRedirect(), HTTPSHandler(context=context))

    def request(
        self,
        path: str,
        payload: dict[str, Any] | None = None,
        *,
        method: str = "GET",
        access_token: str | None = None,
        agent: bool = True,
    ) -> dict[str, Any]:
        headers = {"Content-Type": "application/json"}
        if access_token:
            headers["Authorization"] = f"Bearer {access_token}"
        elif agent:
            headers["X-AI-Referent-Agent-Token"] = self.token
        body = json.dumps(payload).encode("utf-8") if payload is not None else None
        request = Request(self.api_url + path, data=body, method=method, headers=headers)
        try:
            with self.opener.open(request, timeout=12) as response:
                content = response.read()
                return json.loads(content) if content else {}
        except HTTPError as exc:
            messages = {
                401: "Сеанс или ключ недействителен. Подключитесь заново.",
                403: "Изменять согласующих может только администратор Workspace.",
                409: "Настройки изменены на другом устройстве. Обновите и сравните значения.",
                422: "Проверьте логины и числовые Telegram ID: значения должны быть уникальны.",
            }
            raise WorkspaceError(
                messages.get(exc.code, f"Ошибка API: HTTP {exc.code}"), exc.code
            ) from None
        except (URLError, TimeoutError, OSError) as exc:
            raise WorkspaceError(
                "Workspace недоступен. Проверьте сеть, адрес и сертификат."
            ) from exc

    def configuration(self) -> dict[str, Any]:
        return self.request("/ai-referent/agent/configuration")

    def login(self, username: str, password: str, totp: str = "") -> str:
        result = self.request(
            "/auth/login",
            {
                "username": username.strip().removeprefix("@"),
                "password": password,
                "totpCode": totp or None,
                "deviceLabel": "Exat: настройки согласующих",
            },
            method="POST",
            agent=False,
        )
        if result.get("user", {}).get("role") not in {"admin", "superadmin"}:
            raise WorkspaceError("Войдите под аккаунтом администратора Workspace.", 403)
        return str(result["accessToken"])

    def save(self, payload: dict[str, Any], access_token: str) -> dict[str, Any]:
        return self.request(
            "/ai-referent/configuration", payload, method="PUT", access_token=access_token
        )

    def logout(self, access_token: str) -> None:
        self.request("/auth/logout", method="POST", access_token=access_token)

    def acknowledge(self, revision: int, error: str | None = None) -> None:
        self.request(
            "/ai-referent/agent/configuration:ack",
            {
                "agentId": self.agent_id,
                "agentName": "Exat · бот исходящих",
                "revision": revision,
                "error": error,
            },
            method="POST",
        )
