from datetime import UTC, datetime
from uuid import uuid4

import pytest
from pydantic import ValidationError

from yuksalish_api.access_control import request_module_action
from yuksalish_api.auth import AuthenticatedUser
from yuksalish_api.messenger_service import message_response
from yuksalish_api.workspace_schemas import (
    ForwardedContentResponse,
    ForwardMessageRequest,
    NotificationPreferencesResponse,
    NotificationPreferencesUpdate,
    SendMessageRequest,
)


def test_forwarding_contract_is_server_owned() -> None:
    request_id, source_id = uuid4(), uuid4()
    request = ForwardMessageRequest.model_validate(
        {
            "requestId": str(request_id),
            "sourceId": str(source_id),
            "kind": "feed",
            "authorName": "Forged author",
            "body": "Forged announcement",
        }
    )
    assert request.model_dump() == {
        "request_id": request_id,
        "source_id": source_id,
        "kind": "feed",
    }
    normal = SendMessageRequest.model_validate(
        {
            "body": "Переслано от Автор:\nQA message",
            "forwarded": {"kind": "message"},
        }
    )
    assert "forwarded" not in normal.model_dump()
    with pytest.raises(ValidationError):
        ForwardMessageRequest(request_id=request_id, source_id=source_id, kind="unknown")
    with pytest.raises(ValidationError):
        ForwardMessageRequest.model_validate(
            {"requestId": "bad", "sourceId": "bad", "kind": "feed"}
        )
    assert request_module_action("/api/v1/messenger/chats/id/forwards", "POST") == (
        "messenger",
        "edit",
    )
    assert request_module_action("/api/v1/feed/posts/id", "GET") == ("feed", "view")


def test_forwarded_message_cannot_be_edited_and_hidden_feed_is_redacted() -> None:
    actor = AuthenticatedUser(uuid4(), "test", "Test employee", None, None, "employee")
    origin = {"kind": "message", "author_id": str(uuid4()), "author_name": "Original author"}
    row = {
        "id": uuid4(),
        "chat_id": uuid4(),
        "author_user_id": actor.id,
        "body": "Original text",
        "forwarded": origin,
        "system_kind": None,
        "created_at": datetime.now(UTC),
        "edited_at": None,
        "deleted_at": None,
        "reply_to_message_id": None,
        "mention_user_ids": [],
        "revision": 1,
    }
    response = message_response(
        row, actor, forwarded=ForwardedContentResponse.model_validate(origin)
    )
    assert not response.can_edit and response.can_delete
    assert response.forwarded is not None and response.forwarded.author_name == "Original author"
    hidden = ForwardedContentResponse(
        kind="feed", author_id=None, author_name="Недоступно", available=False
    )
    assert message_response(row, actor, forwarded=hidden).body == "Объявление недоступно"
    row["deleted_at"] = datetime.now(UTC)
    deleted = message_response(row, actor, forwarded=hidden)
    assert deleted.body == "" and deleted.forwarded is None


def test_notification_defaults_and_legacy_preference_updates() -> None:
    defaults = NotificationPreferencesResponse()
    assert defaults.feed_enabled and defaults.sound_enabled and defaults.sound_volume == 20
    legacy = defaults.model_dump(exclude={"feed_enabled", "sound_enabled", "sound_volume"})
    update = NotificationPreferencesUpdate.model_validate(legacy)
    assert "feed_enabled" not in update.model_dump(exclude_none=True)
    for volume in (-1, 101):
        with pytest.raises(ValidationError):
            NotificationPreferencesUpdate.model_validate({**legacy, "soundVolume": volume})
    for volume in (0, 100):
        assert (
            NotificationPreferencesUpdate.model_validate(
                {**legacy, "soundVolume": volume}
            ).sound_volume
            == volume
        )
