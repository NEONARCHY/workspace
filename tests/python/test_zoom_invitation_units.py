"""Fast invitation read-model and durable delivery checks without a live database."""

from datetime import UTC, datetime, timedelta
from typing import cast
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest
from sqlalchemy.ext.asyncio import AsyncConnection

from yuksalish_api import messenger_service, zoom_invitations
from yuksalish_api.auth import AuthenticatedUser


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"


def result(rows: list[dict[str, object]]) -> MagicMock:
    query = MagicMock()
    query.mappings.return_value.all.return_value = rows
    return query


@pytest.mark.anyio
async def test_zoom_card_connections_are_filtered_by_current_invitation() -> None:
    owner_id, peer_id, stranger_id, meeting_id, message_id = [uuid4() for _ in range(5)]
    now = datetime.now(UTC)
    meeting = {
        "id": meeting_id, "organizer_user_id": owner_id, "topic": "Review",
        "starts_at": now + timedelta(days=1), "ends_at": now + timedelta(days=1, hours=1),
        "timezone": "Asia/Tashkent", "status": "scheduled",
        "join_url": "https://zoom.us/j/123", "passcode": "4321",
    }
    attendees = [{"meeting_id": meeting_id, "user_id": peer_id, "response": "accepted"}]
    row = {"id": message_id, "zoom_meeting_id": meeting_id}
    connection = AsyncMock()
    user = AuthenticatedUser(peer_id, "peer", "Peer", None, None, "employee")
    connection.execute.side_effect = [result([meeting]), result(attendees)]
    card = (await zoom_invitations.invitation_detail_map(
        cast(AsyncConnection, connection), user, [row],
    ))[message_id]
    assert card.join_url == meeting["join_url"] and card.can_respond
    assert card.response == "accepted"
    connection.execute.side_effect = [result([meeting]), result(attendees)]
    stranger = AuthenticatedUser(stranger_id, "other", "Other", None, None, "admin")
    hidden = (await zoom_invitations.invitation_detail_map(
        cast(AsyncConnection, connection), stranger, [row],
    ))[message_id]
    assert not hidden.available and not hidden.can_respond
    assert hidden.join_url is None and hidden.passcode is None and hidden.participants == []
    connection.execute.side_effect = [result([meeting | {"status": "cancelled"}]),
                                      result(attendees)]
    cancelled = (await zoom_invitations.invitation_detail_map(
        cast(AsyncConnection, connection), user, [row],
    ))[message_id]
    assert not cancelled.can_respond


@pytest.mark.anyio
async def test_delivery_uses_original_organizer_and_records_outbox_atomically(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    owner_id, peer_id, meeting_id, chat_id, message_id = [uuid4() for _ in range(5)]
    now = datetime.now(UTC)
    meeting = {"id": meeting_id, "organizer_user_id": owner_id, "starts_at": now,
               "timezone": "Asia/Tashkent", "topic": "Review",
               "join_url": "https://zoom.us/j/123"}
    owner = AuthenticatedUser(owner_id, "owner", "Owner", None, None, "employee")
    lookup = AsyncMock(return_value=owner)
    monkeypatch.setattr(zoom_invitations, "load_authenticated_user", lookup)
    create = AsyncMock(return_value=MagicMock(id=str(chat_id)))
    send = AsyncMock(return_value=MagicMock(id=str(message_id)))
    monkeypatch.setattr(messenger_service, "create_chat", create)
    monkeypatch.setattr(messenger_service, "send_chat_message", send)
    connection = AsyncMock()
    connection.execute.side_effect = [result([meeting]),
        result([{"meeting_id": meeting_id, "user_id": peer_id}]), result([])]
    assert await zoom_invitations.deliver_zoom_invitations(
        cast(AsyncConnection, connection), meeting_id,
    ) == 1
    assert create.call_args.args[1] == owner
    assert create.call_args.args[2].member_ids == [peer_id]
    assert send.call_args.args[1] == owner and send.call_args.args[2] == chat_id
    assert send.call_args.kwargs["zoom_meeting_id"] == meeting_id
    assert meeting["join_url"] in send.call_args.args[3].body
    stored = connection.execute.call_args.args[0].compile().params
    assert stored["invitation_message_id"] == message_id


@pytest.mark.anyio
async def test_ordinary_messages_do_not_query_zoom() -> None:
    connection = AsyncMock()
    user = AuthenticatedUser(uuid4(), "peer", "Peer", None, None, "employee")
    assert await zoom_invitations.invitation_detail_map(
        cast(AsyncConnection, connection), user, [{"id": uuid4()}],
    ) == {}
    connection.execute.assert_not_called()
