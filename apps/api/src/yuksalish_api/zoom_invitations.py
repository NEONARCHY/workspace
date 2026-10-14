"""Server-authored invitations in ordinary private conversations.

The participant row is the durable outbox. Meeting locks serialize delivery and
RSVP; existing meetings are deliberately not backfilled with unsolicited DMs.
"""

from collections.abc import Mapping, Sequence
from datetime import UTC, datetime
from typing import Any
from uuid import UUID
from zoneinfo import ZoneInfo

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncConnection

from .auth import AuthenticatedUser, load_authenticated_user
from .errors import WorkspaceRepositoryError
from .tables import users, zoom_meeting_participants, zoom_meetings
from .workspace_schemas import (
    CreateChatRequest,
    SendMessageRequest,
    ZoomInvitationParticipant,
    ZoomInvitationResponse,
)


async def invitation_detail_map(
    connection: AsyncConnection, user: AuthenticatedUser, rows: Sequence[Mapping[Any, Any]],
) -> dict[UUID, ZoomInvitationResponse]:
    ids = {row["zoom_meeting_id"] for row in rows if row.get("zoom_meeting_id")}
    if not ids:
        return {}
    meetings = (await connection.execute(select(zoom_meetings).where(
        zoom_meetings.c.id.in_(ids),
    ))).mappings().all()
    attendees = (await connection.execute(select(zoom_meeting_participants).where(
        zoom_meeting_participants.c.meeting_id.in_(ids),
    ).order_by(zoom_meeting_participants.c.user_id))).mappings().all()
    by_meeting: dict[UUID, list[ZoomInvitationParticipant]] = {}
    for attendee in attendees:
        by_meeting.setdefault(attendee["meeting_id"], []).append(
            ZoomInvitationParticipant(
                user_id=str(attendee["user_id"]), response=attendee["response"],
            )
        )
    cards: dict[UUID, ZoomInvitationResponse] = {}
    now = datetime.now(UTC)
    for meeting in meetings:
        participants = by_meeting.get(meeting["id"], [])
        own = next((p for p in participants if p.user_id == str(user.id)), None)
        available = own is not None or meeting["organizer_user_id"] == user.id
        cards[meeting["id"]] = ZoomInvitationResponse(
            meeting_id=str(meeting["id"]), topic=meeting["topic"],
            starts_at=meeting["starts_at"], ends_at=meeting["ends_at"],
            timezone=meeting["timezone"], status=meeting["status"],
            organizer_id=(str(meeting["organizer_user_id"])
                          if available and meeting["organizer_user_id"] else None),
            participants=participants if available else [],
            join_url=meeting["join_url"] if available else None,
            passcode=meeting["passcode"] if available else None,
            response=own.response if own else None,
            can_respond=bool(own and meeting["organizer_user_id"] != user.id
                             and meeting["status"] == "scheduled"
                             and meeting["ends_at"] > now),
            available=available,
        )
    return {row["id"]: cards[row["zoom_meeting_id"]]
            for row in rows if row.get("zoom_meeting_id") in cards}


async def deliver_zoom_invitations(
    connection: AsyncConnection, meeting_id: UUID | None = None,
) -> int:
    # Local import prevents the messenger's read-model from forming a cycle.
    from .messenger_service import create_chat, send_chat_message

    statement = select(zoom_meetings).where(
        zoom_meetings.c.status == "scheduled",
        zoom_meetings.c.messenger_invitations_enabled.is_(True),
        zoom_meetings.c.ends_at > datetime.now(UTC),
        zoom_meetings.c.id.in_(select(zoom_meeting_participants.c.meeting_id).where(
            zoom_meeting_participants.c.invitation_message_id.is_(None),
            zoom_meeting_participants.c.user_id != zoom_meetings.c.organizer_user_id,
        )),
    ).order_by(zoom_meetings.c.id).with_for_update(skip_locked=True)
    if meeting_id:
        statement = statement.where(zoom_meetings.c.id == meeting_id)
    meetings = (await connection.execute(statement)).mappings().all()
    delivered = 0
    for meeting in meetings:
        organizer = await load_authenticated_user(connection, meeting["organizer_user_id"])
        if organizer is None:
            continue
        pending = (await connection.execute(select(zoom_meeting_participants).join(
            users, users.c.id == zoom_meeting_participants.c.user_id,
        ).where(
            zoom_meeting_participants.c.meeting_id == meeting["id"],
            zoom_meeting_participants.c.invitation_message_id.is_(None),
            users.c.status == "active",
            users.c.id != organizer.id,
        ).order_by(zoom_meeting_participants.c.user_id))).mappings().all()
        local = meeting["starts_at"].astimezone(ZoneInfo(meeting["timezone"]))
        body = (f"Приглашаю на Zoom: {meeting['topic']}\n"
                f"{local:%d.%m.%Y %H:%M} · {meeting['timezone']}\n{meeting['join_url']}")
        for participant in pending:
            chat = await create_chat(connection, organizer, CreateChatRequest(
                kind="direct", member_ids=[participant["user_id"]],
            ))
            message = await send_chat_message(
                connection, organizer, UUID(chat.id), SendMessageRequest(body=body),
                zoom_meeting_id=meeting["id"],
            )
            await connection.execute(update(zoom_meeting_participants).where(
                zoom_meeting_participants.c.meeting_id == meeting["id"],
                zoom_meeting_participants.c.user_id == participant["user_id"],
            ).values(invitation_message_id=UUID(message.id)))
            delivered += 1
    return delivered


async def reply_to_zoom_invitation(
    connection: AsyncConnection, user: AuthenticatedUser, meeting_id: UUID, response: str,
) -> None:
    if response not in {"accepted", "declined"}:
        raise WorkspaceRepositoryError(422, "Выберите принятие или отказ от приглашения")
    meeting = (await connection.execute(select(zoom_meetings).where(
        zoom_meetings.c.id == meeting_id,
    ).with_for_update())).mappings().first()
    own = await connection.scalar(select(zoom_meeting_participants.c.user_id).where(
        zoom_meeting_participants.c.meeting_id == meeting_id,
        zoom_meeting_participants.c.user_id == user.id,
    ))
    if meeting is None or own is None or meeting["organizer_user_id"] == user.id:
        raise WorkspaceRepositoryError(404, "Приглашение недоступно")
    if meeting["status"] != "scheduled" or meeting["ends_at"] <= datetime.now(UTC):
        raise WorkspaceRepositoryError(409, "Конференция отменена или уже завершилась")
    await connection.execute(update(zoom_meeting_participants).where(
        zoom_meeting_participants.c.meeting_id == meeting_id,
        zoom_meeting_participants.c.user_id == user.id,
    ).values(response=response))
