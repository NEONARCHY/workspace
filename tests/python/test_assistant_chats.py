"""Chat ownership, context isolation, clearing and bounded transient uploads."""

import asyncio
import base64
from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock
from uuid import uuid4

import pytest
from fastapi import FastAPI, HTTPException
from httpx import ASGITransport, AsyncClient
from pydantic import SecretStr
from sqlalchemy.dialects import postgresql

from yuksalish_api.assistant_chats import chat_message_scope, clear_chat, create_chat, list_chats
from yuksalish_api.assistant_service import (
    ask_assistant,
    message_history,
    parse_assistant_attachment,
)
from yuksalish_api.auth import AuthenticatedUser, require_user
from yuksalish_api.database import get_connection
from yuksalish_api.routers.assistant import AskRequest, router


@pytest.mark.parametrize("default", [False, True])
def test_scope_checks_owner_and_locks_selected_chat(default: bool) -> None:
    user_id, chat_id = uuid4(), uuid4()
    connection = SimpleNamespace(
        execute=AsyncMock(
            return_value=Mock(
                one_or_none=lambda: SimpleNamespace(is_default=default),
            )
        )
    )
    assert asyncio.run(chat_message_scope(connection, user_id, chat_id, lock=True)) == (
        None if default else chat_id
    )
    statement = connection.execute.await_args.args[0].compile(dialect=postgresql.dialect())
    assert "assistant_chats.user_id =" in str(statement)
    assert "assistant_chats.id =" in str(statement)
    assert "FOR UPDATE" in str(statement)
    assert user_id in statement.params.values() and chat_id in statement.params.values()


def test_unknown_or_foreign_chat_is_not_readable_or_clearable() -> None:
    connection = SimpleNamespace(execute=AsyncMock(return_value=Mock(one_or_none=lambda: None)))
    with pytest.raises(HTTPException) as failure:
        asyncio.run(clear_chat(connection, uuid4(), uuid4()))
    assert failure.value.status_code == 404
    assert connection.execute.await_count == 1  # No content write after the failed owner check.


@pytest.mark.parametrize("chat_id", [None, uuid4()])
def test_history_filters_by_chat_owner_and_cleared_state(chat_id: object) -> None:
    user_id = uuid4()
    connection = SimpleNamespace(
        execute=AsyncMock(
            return_value=Mock(
                mappings=lambda: Mock(all=lambda: []),
            )
        )
    )
    assert asyncio.run(message_history(connection, user_id, chat_id)) == []
    statement = connection.execute.await_args.args[0].compile(dialect=postgresql.dialect())
    assert "assistant_messages.user_id =" in str(statement)
    assert "assistant_messages.cleared_at IS NULL" in str(statement)
    assert user_id in statement.params.values()
    if chat_id is None:
        assert "assistant_messages.chat_id IS NULL" in str(statement)
    else:
        assert "assistant_messages.chat_id =" in str(statement)
        assert chat_id in statement.params.values()


def test_clear_erases_only_selected_content_and_retains_global_rate_limit_timestamps() -> None:
    user_id, chat_id = uuid4(), uuid4()
    connection = SimpleNamespace(
        execute=AsyncMock(
            side_effect=[
                Mock(one_or_none=lambda: SimpleNamespace(is_default=False)),
                Mock(),
                Mock(),
            ]
        )
    )
    asyncio.run(clear_chat(connection, user_id, chat_id))
    statement = connection.execute.await_args_list[1].args[0].compile(dialect=postgresql.dialect())
    assert "UPDATE assistant_messages" in str(statement)
    assert "assistant_messages.user_id =" in str(statement)
    assert "assistant_messages.chat_id =" in str(statement)
    assert user_id in statement.params.values() and chat_id in statement.params.values()
    assert statement.params["content"] == ""
    assert statement.params["source_labels"] is None
    assert statement.params["references"] is None and statement.params["action_draft"] is None
    assert "cleared_at" in statement.params
    assert "created_at" not in statement.params
    title_update = connection.execute.await_args_list[2].args[0].compile()
    assert "Первый чат" in title_update.params.values()
    assert "Новый чат" in title_update.params.values()


def test_list_preserves_legacy_chat_and_handles_concurrent_initialization() -> None:
    user_id, chat_id, now = uuid4(), uuid4(), datetime.now(UTC)
    connection = SimpleNamespace(
        execute=AsyncMock(
            side_effect=[
                Mock(),
                Mock(
                    mappings=lambda: Mock(
                        all=lambda: [
                            {
                                "id": chat_id,
                                "title": "Первый чат",
                                "is_default": True,
                                "created_at": now,
                                "updated_at": now,
                            }
                        ]
                    ),
                ),
            ]
        )
    )
    assert asyncio.run(list_chats(connection, user_id))[0]["id"] == str(chat_id)
    statement = connection.execute.await_args_list[0].args[0].compile(dialect=postgresql.dialect())
    assert "ON CONFLICT (user_id) WHERE is_default DO NOTHING" in str(statement)
    listing = connection.execute.await_args_list[1].args[0].compile()
    assert user_id in listing.params.values()


def test_new_chat_is_owned_empty_and_does_not_delete_existing_history() -> None:
    user_id = uuid4()
    connection = SimpleNamespace(execute=AsyncMock())
    result = asyncio.run(create_chat(connection, user_id))
    assert result["title"] == "Новый чат" and not result["isDefault"]
    assert connection.execute.await_count == 1
    statement = connection.execute.await_args.args[0].compile()
    assert "INSERT INTO assistant_chats" in str(statement)
    assert user_id in statement.params.values()


def test_new_chats_cannot_bypass_account_request_limit() -> None:
    user = AuthenticatedUser(uuid4(), "reader", "Reader", None, None, "employee")
    connection = SimpleNamespace(scalar=AsyncMock(return_value=30), execute=AsyncMock())
    with pytest.raises(OverflowError):
        asyncio.run(
            ask_assistant(connection, user, "test-key", "flash-lite", "Привет", chat_id=uuid4())
        )
    statement = connection.scalar.await_args.args[0].compile()
    assert "assistant_messages.chat_id" not in str(statement)
    assert "assistant_messages.cleared_at" not in str(statement)
    assert user.id in statement.params.values()
    connection.execute.assert_not_called()


def test_reply_context_and_inserted_turns_stay_in_selected_chat(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    chat_id = uuid4()
    user = AuthenticatedUser(uuid4(), "reader", "Reader", None, None, "employee")
    connection = SimpleNamespace(scalar=AsyncMock(return_value=0), execute=AsyncMock())
    history = AsyncMock(return_value=[])
    monkeypatch.setattr("yuksalish_api.assistant_service.message_history", history)
    monkeypatch.setattr(
        "yuksalish_api.assistant_service.generate_text", AsyncMock(return_value="Привет")
    )
    asyncio.run(ask_assistant(connection, user, "test-key", "flash-lite", "Hello", chat_id=chat_id))
    history.assert_awaited_once_with(connection, user.id, chat_id)
    assert connection.execute.await_count == 2
    for call in connection.execute.await_args_list:
        parameters = call.args[0].compile().params
        assert parameters["chat_id"] == chat_id and parameters["user_id"] == user.id


def test_pdf_exactly_50_mb_passes_service_and_request_schema() -> None:
    content = b"%PDF-" + b"x" * (50_000_000 - 5)
    encoded = base64.b64encode(content).decode("ascii")
    request = AskRequest(
        message="Прочитай",
        attachment={
            "name": "large.pdf",
            "mime_type": "application/pdf",
            "data_base64": encoded,
        },
    )
    assert request.attachment is not None
    assert parse_assistant_attachment("large.pdf", "application/pdf", encoded).content == content


def test_http_endpoints_deny_another_users_chat_before_read_write_or_model_call() -> None:
    user = AuthenticatedUser(uuid4(), "reader", "Reader", None, None, "employee")
    foreign_chat = uuid4()
    connection = SimpleNamespace(execute=AsyncMock(return_value=Mock(one_or_none=lambda: None)))
    app = FastAPI()
    app.include_router(router)
    app.state.settings = SimpleNamespace(gemini_api_key=SecretStr("test-key"))
    app.dependency_overrides[require_user] = lambda: user
    app.dependency_overrides[get_connection] = lambda: connection

    async def exercise() -> None:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            response = await client.get(f"/assistant/messages?chat_id={foreign_chat}")
            assert response.status_code == 404
            response = await client.delete(f"/assistant/chats/{foreign_chat}/messages")
            assert response.status_code == 404
            response = await client.post(
                "/assistant/messages",
                json={
                    "message": "Hello",
                    "chat_id": str(foreign_chat),
                },
            )
            assert response.status_code == 404

    asyncio.run(exercise())
    assert connection.execute.await_count == 3
    for call in connection.execute.await_args_list:
        assert str(call.args[0]).startswith("SELECT")
