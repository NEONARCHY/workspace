"""Google is represented only by an HTTP MockTransport; no real mail is touched."""

import asyncio
import base64
import json
from urllib.parse import parse_qs, urlsplit

import httpx
import pytest
from pydantic import SecretStr, ValidationError

from yuksalish_api.access_control import request_module_action
from yuksalish_api.errors import WorkspaceRepositoryError
from yuksalish_api.gmail_client import (
    GMAIL_SCOPES,
    GmailClient,
    GmailError,
    GmailRawMessage,
    decode_data,
    provider_id,
    render_message,
)
from yuksalish_api.mail_crypto import mail_configured, open_text, seal_text
from yuksalish_api.mail_schemas import MailFields
from yuksalish_api.settings import Settings


def mail_settings(**changes):
    return Settings(
        environment="test",
        gmail_client_id="mail-test.apps.googleusercontent.com",
        gmail_client_secret=SecretStr("test-only-oauth-client"),
        gmail_redirect_uri="https://workspace.example/api/v1/mail/oauth/callback",
        gmail_encryption_key=SecretStr(base64.urlsafe_b64encode(b"m" * 32).decode()),
        **changes,
    )


def raw_message(identifier="msg-1", thread="thread-1", html=False):
    body = (
        '<p>Visible</p><script>alert(1)</script><img src="https://tracker.invalid/pixel">'
        if html
        else "Mail body"
    )
    return {
        "id": identifier,
        "threadId": thread,
        "labelIds": ["INBOX", "UNREAD"],
        "internalDate": "1792500000000",
        "snippet": "A &amp; B",
        "payload": {
            "mimeType": "text/html" if html else "text/plain",
            "headers": [
                {"name": "Subject", "value": "Test subject"},
                {"name": "From", "value": "sender@example.com"},
                {"name": "To", "value": "recipient@example.com"},
                {"name": "Message-ID", "value": "<source@example.com>"},
            ],
            "body": {"data": base64.urlsafe_b64encode(body.encode()).decode().rstrip("=")},
        },
    }


def test_mail_crypto_is_bound_to_record_and_never_uses_default_auth_key():
    settings = mail_settings()
    assert mail_configured(settings)
    encrypted = seal_text(settings, "private contents", "draft:one")
    assert "private" not in encrypted
    assert open_text(settings, encrypted, "draft:one") == "private contents"
    with pytest.raises(WorkspaceRepositoryError):
        open_text(settings, encrypted, "draft:another")
    with pytest.raises(WorkspaceRepositoryError):
        open_text(settings, "bad ciphertext", "draft:one")
    assert not mail_configured(Settings())
    for redirect in (
        "https://192.168.0.119:8443/api/v1/mail/oauth/callback",
        "http://workspace.example/api/v1/mail/oauth/callback",
        "https://workspace.example/other",
        "https://user:password@workspace.example/api/v1/mail/oauth/callback",
    ):
        copied = settings.model_copy(update={"gmail_redirect_uri": redirect})
        assert not mail_configured(copied)


def test_mail_text_is_safe_and_identifiers_cannot_escape_provider_paths():
    result = render_message(GmailRawMessage.model_validate(raw_message(html=True)))
    assert "Visible" in result.body
    assert "alert" not in result.body and "tracker.invalid" not in result.body
    assert result.snippet == "A & B" and result.unread
    for value in ("../profile", "id?access_token=secret", "", "x" * 201):
        with pytest.raises(GmailError):
            provider_id(value)
    with pytest.raises(GmailError):
        decode_data("not!base64")
    with pytest.raises(GmailError):
        decode_data(base64.urlsafe_b64encode(b"a" * 30).decode(), 3)
    for field in (
        {"subject": "Subject\r\nBcc: attacker@example.com"},
        {"to": ["name <user@example.com>"]},
        {"to": ["user@example.com\r\nBcc:bad@example.com"]},
        {"to": ["user@example.com", "user@example.com"]},
    ):
        with pytest.raises(ValidationError):
            MailFields.model_validate(field)


def test_gmail_oauth_read_thread_attachment_and_send_transport():
    async def check():
        requests = []

        def handler(request):
            requests.append(request)
            if request.url.path == "/token":
                assert "client_secret=" in request.content.decode()
                return httpx.Response(
                    200,
                    json={
                        "access_token": "test-access",
                        "refresh_token": "test-refresh",
                        "expires_in": 3600,
                        "scope": " ".join(GMAIL_SCOPES),
                    },
                )
            if request.url.path.endswith("/profile"):
                return httpx.Response(200, json={"emailAddress": "USER@gmail.com"})
            if request.url.path.endswith("/messages/send"):
                assert "raw" in json.loads(request.content)
                return httpx.Response(200, json={"id": "sent-1"})
            if "/attachments/" in request.url.path:
                return httpx.Response(200, json={"data": "ZmlsZQ"})
            if "/threads/" in request.url.path:
                return httpx.Response(
                    200, json={"messages": [raw_message(str(i)) for i in range(31)]}
                )
            if request.url.path.endswith("/messages"):
                return httpx.Response(
                    200, json={"messages": [{"id": "msg-1"}], "nextPageToken": "page-2"}
                )
            if "/messages/" in request.url.path:
                return httpx.Response(200, json=raw_message())
            if request.url.path == "/revoke":
                return httpx.Response(200)
            raise AssertionError(f"Unexpected route {request.url.path}")

        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
            client = GmailClient(mail_settings(), http)
            url = client.authorization_url("opaque-state", "challenge")
            query = parse_qs(urlsplit(url).query)
            assert query["code_challenge_method"] == ["S256"]
            assert set(query["scope"][0].split()) == GMAIL_SCOPES
            tokens = await client.tokens(code="test-code", verifier="verifier")
            assert tokens.refresh_token == "test-refresh"
            await client.tokens(refresh="test-refresh")
            assert await client.profile("test-access") == "user@gmail.com"
            page = await client.list_messages("test-access", "in:inbox")
            assert page.next_page_token == "page-2" and page.messages[0].subject == "Test subject"
            assert not hasattr(page.messages[0], "body")
            assert (await client.message("test-access", "msg-1")).body == "Mail body"
            thread = await client.thread("test-access", "thread-1")
            assert thread.truncated and len(thread.messages) == 30
            assert await client.attachment("test-access", "msg-1", "a" * 400) == b"file"
            assert await client.send("test-access", b"mime", "thread-1") == "sent-1"
            assert await client.revoke("test-refresh")
            await client.aclose()
        assert all(
            request.url.host in {"oauth2.googleapis.com", "gmail.googleapis.com"}
            for request in requests
        )

    asyncio.run(check())


@pytest.mark.parametrize("failure", ["timeout", "server", "parse", "refused"])
def test_gmail_send_never_retries_or_exposes_provider_secrets(failure):
    async def check():
        calls = 0

        def handler(request):
            nonlocal calls
            calls += 1
            if failure == "timeout":
                raise httpx.ReadTimeout("provider-private-details", request=request)
            if failure == "server":
                return httpx.Response(500, text="provider-private-details")
            if failure == "parse":
                return httpx.Response(200, json={"secret": "provider-private-details"})
            return httpx.Response(403, text="provider-private-details")

        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
            with pytest.raises(GmailError) as error:
                await GmailClient(mail_settings(), http).send("test-token", b"mime")
            assert calls == 1
            assert "provider-private-details" not in str(error.value)
            assert error.value.status_code == (403 if failure == "refused" else 503)

    asyncio.run(check())


def test_mail_read_search_and_task_export_do_not_require_mail_writing_permission():
    assert request_module_action("/api/v1/mail/messages/search", "POST") == ("mail", "view")
    assert request_module_action("/api/v1/mail/tasks", "POST") == ("mail", "view")
    assert request_module_action("/api/v1/mail/drafts", "POST") == ("mail", "create")
