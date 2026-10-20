"""Bounded Gmail transport. A send is NEVER automatically retried."""

import asyncio
import base64
import binascii
import re
from datetime import UTC, datetime
from html import unescape
from html.parser import HTMLParser
from urllib.parse import urlencode

import httpx
from pydantic import BaseModel, Field, ValidationError

from .errors import WorkspaceRepositoryError
from .mail_schemas import (
    MailMessage,
    MailMessageSummary,
    MailPage,
    MailProviderAttachment,
    MailThread,
)
from .settings import Settings

GMAIL_SCOPES = frozenset(
    {
        "https://www.googleapis.com/auth/gmail.readonly",
        "https://www.googleapis.com/auth/gmail.send",
    }
)
_API = "https://gmail.googleapis.com/gmail/v1/users/me"


class GmailError(WorkspaceRepositoryError):
    """Provider errors deliberately exclude its response body, URLs and credentials."""


class GmailTokens(BaseModel):
    access_token: str = Field(min_length=1)
    refresh_token: str = ""
    expires_in: int = Field(default=3600, gt=0, le=86400)
    scope: str = ""


class GmailProfile(BaseModel):
    emailAddress: str


class GmailHeader(BaseModel):
    name: str
    value: str


class GmailBody(BaseModel):
    data: str = ""
    attachmentId: str = ""
    size: int = Field(default=0, ge=0)


class GmailPart(BaseModel):
    mimeType: str = "text/plain"
    filename: str = ""
    headers: list[GmailHeader] = Field(default_factory=list)
    body: GmailBody = Field(default_factory=GmailBody)
    parts: list["GmailPart"] = Field(default_factory=list)


class GmailRawMessage(BaseModel):
    id: str
    threadId: str
    labelIds: list[str] = Field(default_factory=list)
    snippet: str = ""
    internalDate: str = "0"
    payload: GmailPart = Field(default_factory=GmailPart)


class GmailMessageRef(BaseModel):
    id: str


class GmailList(BaseModel):
    messages: list[GmailMessageRef] = Field(default_factory=list)
    nextPageToken: str | None = None


class GmailRawThread(BaseModel):
    messages: list[GmailRawMessage] = Field(default_factory=list)


class _TextHTML(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.skip = 0
        self.text: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        del attrs
        if tag in {"script", "style", "head"}:
            self.skip += 1
        if not self.skip and tag in {"br", "p", "div", "li", "tr"}:
            self.text.append("\n")

    def handle_endtag(self, tag: str) -> None:
        if tag in {"script", "style", "head"} and self.skip:
            self.skip -= 1

    def handle_data(self, data: str) -> None:
        if not self.skip:
            self.text.append(data)


def provider_id(value: str, maximum: int = 200) -> str:
    if not value or len(value) > maximum or not re.fullmatch(r"[A-Za-z0-9_-]+", value):
        raise GmailError(422, "Некорректный идентификатор письма")
    return value


def decode_data(data: str, limit: int = 18 * 1024 * 1024) -> bytes:
    if len(data) > limit * 4 // 3 + 8:
        raise GmailError(413, "Почтовое вложение слишком большое")
    try:
        raw = base64.b64decode(data + "=" * (-len(data) % 4), altchars=b"-_", validate=True)
    except (ValueError, binascii.Error) as error:
        raise GmailError(502, "Gmail вернул некорректные данные") from error
    if len(raw) > limit:
        raise GmailError(413, "Почтовое вложение слишком большое")
    return raw


def render_message(raw: GmailRawMessage) -> MailMessage:
    headers = {item.name.lower(): item.value for item in raw.payload.headers}
    plain: list[str] = []
    html: list[str] = []
    attachments: list[MailProviderAttachment] = []
    pending = [raw.payload]
    count = 0
    while pending:
        part = pending.pop()
        count += 1
        if count > 500:
            raise GmailError(413, "Слишком сложная структура письма")
        if part.filename and part.body.attachmentId:
            attachments.append(
                MailProviderAttachment(
                    id=part.body.attachmentId,
                    file_name=part.filename[:240],
                    content_type=part.mimeType[:160],
                    size_bytes=part.body.size,
                )
            )
        elif not part.filename and part.mimeType in {"text/plain", "text/html"} and part.body.data:
            text = decode_data(part.body.data, 2 * 1024 * 1024).decode("utf-8", errors="replace")
            (plain if part.mimeType == "text/plain" else html).append(text)
        pending.extend(reversed(part.parts))
    if plain:
        body = "\n".join(plain)
    else:
        parser = _TextHTML()
        parser.feed("\n".join(html))
        body = "".join(parser.text)
    try:
        received = datetime.fromtimestamp(int(raw.internalDate) / 1000, UTC)
    except (ValueError, OverflowError, OSError) as error:
        raise GmailError(502, "Gmail вернул некорректную дату") from error
    return MailMessage(
        id=raw.id,
        thread_id=raw.threadId,
        subject=headers.get("subject", "Без темы")[:500],
        sender=headers.get("from", "")[:1000],
        recipients=headers.get("to", "")[:4000],
        received_at=received,
        snippet=unescape(raw.snippet)[:1000],
        unread="UNREAD" in raw.labelIds,
        body=body[:100_000],
        message_id=headers.get("message-id", "")[:1000],
        references=headers.get("references", "")[:4000],
        reply_to=headers.get("reply-to", headers.get("from", ""))[:1000],
        attachments=attachments,
    )


class GmailClient:
    def __init__(self, settings: Settings, client: httpx.AsyncClient | None = None) -> None:
        self.settings = settings
        self.http = client or httpx.AsyncClient(timeout=httpx.Timeout(30.0), follow_redirects=False)
        self.owns_client = client is None

    async def aclose(self) -> None:
        if self.owns_client:
            await self.http.aclose()

    def authorization_url(self, state: str, challenge: str) -> str:
        return "https://accounts.google.com/o/oauth2/v2/auth?" + urlencode(
            {
                "client_id": self.settings.gmail_client_id,
                "redirect_uri": self.settings.gmail_redirect_uri,
                "response_type": "code",
                "scope": " ".join(sorted(GMAIL_SCOPES)),
                "state": state,
                "access_type": "offline",
                "prompt": "consent select_account",
                "code_challenge": challenge,
                "code_challenge_method": "S256",
            }
        )

    async def tokens(self, *, code: str = "", verifier: str = "", refresh: str = "") -> GmailTokens:
        data = {
            "client_id": self.settings.gmail_client_id,
            "client_secret": self.settings.gmail_client_secret.get_secret_value(),
        }
        if refresh:
            data.update(grant_type="refresh_token", refresh_token=refresh)
        else:
            data.update(
                grant_type="authorization_code",
                code=code,
                code_verifier=verifier,
                redirect_uri=self.settings.gmail_redirect_uri,
            )
        try:
            response = await self.http.post("https://oauth2.googleapis.com/token", data=data)
            if response.status_code in {400, 401}:
                raise GmailError(401, "Подключите Gmail заново: доступ Google истёк или отозван")
            response.raise_for_status()
            return GmailTokens.model_validate_json(response.content)
        except (httpx.HTTPError, ValidationError) as error:
            raise GmailError(
                502, "Google временно недоступен. Повторите подключение позже"
            ) from error

    async def _get(self, token: str, path: str, params: dict[str, str] | None = None) -> bytes:
        try:
            async with self.http.stream(
                "GET",
                _API + path,
                params=params,
                headers={
                    "Authorization": "Bearer " + token,
                },
            ) as response:
                if response.status_code == 401:
                    raise GmailError(401, "Подключите Gmail заново: доступ Google отозван")
                if response.status_code == 404:
                    raise GmailError(404, "Письмо или вложение больше не доступно в Gmail")
                if response.status_code == 429:
                    raise GmailError(429, "Gmail ограничил частоту запросов. Повторите позже")
                response.raise_for_status()
                content = bytearray()
                async for chunk in response.aiter_bytes():
                    content.extend(chunk)
                    if len(content) > 28 * 1024 * 1024:
                        raise GmailError(413, "Письмо слишком большое для просмотра")
                return bytes(content)
        except httpx.HTTPError as error:
            raise GmailError(502, "Данные Gmail временно недоступны") from error

    async def profile(self, token: str) -> str:
        try:
            profile = GmailProfile.model_validate_json(await self._get(token, "/profile"))
            if not re.fullmatch(r"[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+", profile.emailAddress):
                raise GmailError(502, "Google вернул некорректный адрес")
            return profile.emailAddress.lower()
        except ValidationError as error:
            raise GmailError(502, "Google вернул некорректный профиль") from error

    async def message(self, token: str, message_id: str, *, metadata: bool = False) -> MailMessage:
        try:
            raw = await self._get(
                token,
                f"/messages/{provider_id(message_id)}",
                {"format": "metadata" if metadata else "full"},
            )
            return render_message(GmailRawMessage.model_validate_json(raw))
        except ValidationError as error:
            raise GmailError(502, "Gmail вернул некорректное письмо") from error

    async def list_messages(self, token: str, query: str, page: str = "") -> MailPage:
        params = {"q": query, "maxResults": "20"}
        if page:
            params["pageToken"] = page
        try:
            listed = GmailList.model_validate_json(await self._get(token, "/messages", params))
        except ValidationError as error:
            raise GmailError(502, "Gmail вернул некорректный список") from error
        semaphore = asyncio.Semaphore(4)

        async def summary(item: GmailMessageRef) -> MailMessage:
            async with semaphore:
                return await self.message(token, item.id, metadata=True)

        messages = list(await asyncio.gather(*(summary(item) for item in listed.messages[:20])))
        return MailPage(
            messages=[MailMessageSummary.model_validate(item.model_dump()) for item in messages],
            next_page_token=listed.nextPageToken,
        )

    async def thread(self, token: str, thread_id: str) -> MailThread:
        try:
            raw = await self._get(token, f"/threads/{provider_id(thread_id)}", {"format": "full"})
            result = GmailRawThread.model_validate_json(raw)
            return MailThread(
                messages=[render_message(item) for item in result.messages[-30:]],
                truncated=len(result.messages) > 30,
            )
        except ValidationError as error:
            raise GmailError(502, "Gmail вернул некорректную переписку") from error

    async def attachment(self, token: str, message_id: str, attachment_id: str) -> bytes:
        try:
            message_key = provider_id(message_id)
            attachment_key = provider_id(attachment_id, 2048)
            raw = await self._get(
                token,
                f"/messages/{message_key}/attachments/{attachment_key}",
            )
            return decode_data(GmailBody.model_validate_json(raw).data)
        except ValidationError as error:
            raise GmailError(502, "Gmail вернул некорректное вложение") from error

    async def send(self, token: str, raw: bytes, thread_id: str = "") -> str:
        payload = {"raw": base64.urlsafe_b64encode(raw).decode()}
        if thread_id:
            payload["threadId"] = provider_id(thread_id)
        # After this call starts any network/parse/server error has an UNKNOWN result.
        try:
            response = await self.http.post(
                _API + "/messages/send",
                json=payload,
                headers={
                    "Authorization": "Bearer " + token,
                },
            )
            if 400 <= response.status_code < 500:
                raise GmailError(
                    response.status_code, "Gmail отказал в отправке. Проверьте доступ и получателей"
                )
            response.raise_for_status()
            return GmailMessageRef.model_validate_json(response.content).id
        except (httpx.HTTPError, ValidationError) as error:
            raise GmailError(
                503, "Результат отправки неизвестен. Повторная отправка может создать дубликат"
            ) from error

    async def revoke(self, refresh: str) -> bool:
        try:
            response = await self.http.post(
                "https://oauth2.googleapis.com/revoke", data={"token": refresh}
            )
            return response.status_code in {200, 400}
        except httpx.HTTPError:
            return False
