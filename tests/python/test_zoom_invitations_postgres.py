"""Invitations are real organizer DMs, not synthetic UI messages."""

import asyncio
import os
from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

import httpx
import pytest
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import create_async_engine

from test_zoom_postgres import FakeZoom, zoom_settings
from yuksalish_api.auth import load_authenticated_user
from yuksalish_api.errors import WorkspaceRepositoryError
from yuksalish_api.forward_service import forward_message
from yuksalish_api.messenger_service import chat_summary, create_chat, send_chat_message
from yuksalish_api.repository import find_active_user_by_username
from yuksalish_api.seed import seed_demo_data
from yuksalish_api.tables import (
    chat_members,
    message_receipts,
    messages,
    workspace_notifications,
    zoom_meeting_participants,
    zoom_meetings,
)
from yuksalish_api.workspace_schemas import (
    CreateChatRequest,
    ForwardMessageRequest,
    SendMessageRequest,
)
from yuksalish_api.zoom_client import ZoomClient
from yuksalish_api.zoom_invitations import (
    deliver_zoom_invitations,
    invitation_detail_map,
    reply_to_zoom_invitation,
)
from yuksalish_api.zoom_schemas import CreateZoomMeetingRequest, UpdateZoomMeetingRequest
from yuksalish_api.zoom_service import (
    ZoomServiceError,
    cancel_zoom_meeting,
    create_zoom_meeting,
    reset_host_calendar_cache,
    update_zoom_meeting,
)


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"


@pytest.mark.anyio
@pytest.mark.postgres
async def test_zoom_dms_delivery_rsvp_updates_and_privacy() -> None:
    url = os.environ.get("YUKSALISH_TEST_DATABASE_URL")
    if not url:
        pytest.skip("YUKSALISH_TEST_DATABASE_URL is not configured")
    engine = create_async_engine(url)
    fake = FakeZoom()
    settings = zoom_settings(url)
    client = ZoomClient(settings, httpx.AsyncClient(transport=httpx.MockTransport(fake.handler)))
    try:
        await seed_demo_data(engine)
        async with engine.begin() as connection:
            await connection.execute(delete(zoom_meeting_participants))
            await connection.execute(delete(zoom_meetings))
            people = []
            for name in ("dilshod", "aziza", "malika", "baxtiyor"):
                person = await find_active_user_by_username(connection, name)
                assert person
                user = await load_authenticated_user(connection, person["id"])
                assert user
                people.append(user)
            owner, peer, admin, outsider = people
            chat = await create_chat(connection, owner, CreateChatRequest(
                kind="direct", member_ids=[peer.id],
            ))
            history = await send_chat_message(connection, owner, UUID(chat.id),
                                              SendMessageRequest(body="Existing history"))
        reset_host_calendar_cache()
        starts = (datetime.now(UTC) + timedelta(days=12)).replace(
            hour=8, minute=0, second=0, microsecond=0,
        )
        payload = CreateZoomMeetingRequest(
            topic="Project review", starts_at=starts, duration_minutes=60,
            participant_ids=[str(peer.id), str(owner.id)],
        )
        meeting = await create_zoom_meeting(engine, owner, settings, client, payload)
        async with engine.begin() as connection:
            invitation_rows = (await connection.execute(select(messages).where(
                messages.c.zoom_meeting_id == UUID(meeting.id),
            ))).mappings().all()
            assert len(invitation_rows) == 1
            row = invitation_rows[0]
            assert row["author_user_id"] == owner.id and row["chat_id"] == UUID(chat.id)
            assert meeting.join_url in row["body"]
            assert await connection.scalar(select(messages.c.id).where(
                messages.c.id == UUID(history.id),
            ))
            members = set((await connection.execute(select(chat_members.c.user_id).where(
                chat_members.c.chat_id == row["chat_id"],
            ))).scalars())
            assert members == {owner.id, peer.id}
            receipts = (await connection.execute(select(message_receipts).where(
                message_receipts.c.message_id == row["id"],
                message_receipts.c.user_id == peer.id,
            ))).mappings().one()
            assert receipts["read_at"] is None
            notice = (await connection.execute(select(workspace_notifications).where(
                workspace_notifications.c.user_id == peer.id,
                workspace_notifications.c.event_key == f"message:{row['id']}",
            ))).mappings().one()
            assert "https://" not in notice["body"]
            card = (await invitation_detail_map(connection, peer, [row]))[row["id"]]
            assert card.join_url == meeting.join_url and card.can_respond
            hidden = (await invitation_detail_map(connection, outsider, [row]))[row["id"]]
            assert not hidden.available and hidden.join_url is None and hidden.participants == []
            with pytest.raises(WorkspaceRepositoryError) as forbidden:
                await reply_to_zoom_invitation(connection, outsider, UUID(meeting.id), "declined")
            assert forbidden.value.status_code == 404
            await reply_to_zoom_invitation(connection, peer, UUID(meeting.id), "declined")
            await reply_to_zoom_invitation(connection, peer, UUID(meeting.id), "declined")
            answered = (await invitation_detail_map(connection, peer, [row]))[row["id"]]
            assert answered.response == "declined"

        async def repeat_delivery() -> int:
            async with engine.begin() as connection:
                return await deliver_zoom_invitations(connection, UUID(meeting.id))

        assert await asyncio.gather(repeat_delivery(), repeat_delivery()) == [0, 0]
        moved = await update_zoom_meeting(engine, admin, settings, client, UUID(meeting.id),
            UpdateZoomMeetingRequest(
                topic="Rescheduled review", starts_at=starts + timedelta(days=1),
                duration_minutes=45, participant_ids=[str(peer.id), str(outsider.id)],
            ))
        async with engine.begin() as connection:
            rows = (await connection.execute(select(messages).where(
                messages.c.zoom_meeting_id == UUID(meeting.id),
            ))).mappings().all()
            assert len(rows) == 2 and all(r["author_user_id"] == owner.id for r in rows)
            current = (await invitation_detail_map(connection, peer, [row]))[row["id"]]
            assert current.topic == moved.topic and current.starts_at == moved.starts_at
            assert current.response == "declined"
            await reply_to_zoom_invitation(connection, peer, UUID(meeting.id), "accepted")
        await update_zoom_meeting(engine, owner, settings, client, UUID(meeting.id),
            UpdateZoomMeetingRequest(
                topic=moved.topic, starts_at=moved.starts_at, duration_minutes=45,
                participant_ids=[str(outsider.id)],
            ))
        async with engine.begin() as connection:
            withdrawn = (await invitation_detail_map(connection, peer, [row]))[row["id"]]
            assert not withdrawn.available and withdrawn.join_url is None
            preview = await chat_summary(connection, peer, UUID(chat.id))
            assert preview.preview == "Приглашение на Zoom"
            with pytest.raises(WorkspaceRepositoryError) as forwarding:
                await forward_message(connection, peer, UUID(chat.id), ForwardMessageRequest(
                    request_id=uuid4(), kind="message", source_id=row["id"],
                ))
            assert forwarding.value.status_code == 404
        await cancel_zoom_meeting(engine, owner, settings, client, UUID(meeting.id))
        async with engine.begin() as connection:
            cancelled = (await invitation_detail_map(connection, owner, [row]))[row["id"]]
            assert cancelled.status == "cancelled" and not cancelled.can_respond
        fake.refuse_create = True
        with pytest.raises(ZoomServiceError):
            await create_zoom_meeting(engine, owner, settings, client,
                payload.model_copy(update={"starts_at": starts + timedelta(days=2)}))
        async with engine.begin() as connection:
            failed_id = await connection.scalar(select(zoom_meetings.c.id).where(
                zoom_meetings.c.status == "failed",
            ))
            assert not (await connection.execute(select(messages.c.id).where(
                messages.c.zoom_meeting_id == failed_id,
            ))).first()
    finally:
        await client.aclose()
        await engine.dispose()
        reset_host_calendar_cache()
