import asyncio
import os
import runpy
from datetime import UTC, datetime, timedelta
from pathlib import Path
from uuid import UUID

import pytest
from pydantic import ValidationError
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import create_async_engine

from yuksalish_api import messenger_service as service
from yuksalish_api.auth import load_authenticated_user
from yuksalish_api.errors import WorkspaceRepositoryError
from yuksalish_api.position_policy import EXECUTIVE_LEADER_POSITION_NAME
from yuksalish_api.repository import find_active_user_by_username, load_workspace, search_messages
from yuksalish_api.seed import seed_demo_data
from yuksalish_api.tables import chat_members, message_versions, users
from yuksalish_api.workspace_schemas import (
    AddChatMembersRequest,
    CreateChatRequest,
    DeleteMessageRequest,
    EditMessageRequest,
    MessageEntity,
    MessageQuote,
    PinMessageRequest,
    SendMessageRequest,
)


def test_migration_freezes_the_same_chairman_position() -> None:
    migration = (
        Path(__file__).resolve().parents[2]
        / "apps/api/migrations/versions/0100_messenger_rich_text.py"
    )
    assert runpy.run_path(str(migration))["EXECUTIVE_TITLE"] == EXECUTIVE_LEADER_POSITION_NAME


@pytest.mark.parametrize(
    "url",
    [
        "javascript:alert(1)",
        "data:text/html,test",
        "file:///test",
        "https://",
        "https://example.org/\n",
    ],
)
def test_reject_unsafe_message_link(url: str) -> None:
    with pytest.raises(ValidationError):
        MessageEntity(type="link", offset=0, length=1, url=url)


def test_utf16_ranges_and_quote_contract() -> None:
    message = SendMessageRequest(
        body="A😀Б", entities=[MessageEntity(type="bold", offset=1, length=2)]
    )
    assert message.entities[0].length == 2
    for offset, length in ((1, 1), (2, 1), (4, 1)):
        with pytest.raises(ValidationError):
            SendMessageRequest(
                body="A😀Б", entities=[MessageEntity(type="bold", offset=offset, length=length)]
            )
    with pytest.raises(ValidationError):
        SendMessageRequest(body="reply", reply_quote=MessageQuote(offset=0, text="source"))
    with pytest.raises(ValidationError):
        PinMessageRequest(pinned=True, scope="self")


@pytest.mark.postgres
def test_rich_messages_quotes_and_protected_personal_pins() -> None:
    url = os.environ.get("YUKSALISH_TEST_DATABASE_URL")
    if not url:
        pytest.skip("YUKSALISH_TEST_DATABASE_URL is not configured")
    asyncio.run(exercise_rich_messages(url))


async def exercise_rich_messages(url: str) -> None:
    engine = create_async_engine(url)
    try:
        await seed_demo_data(engine)
        async with engine.connect() as connection:
            transaction = await connection.begin()
            try:
                actors = []
                for username in ("dilshod", "baxtiyor", "aziza"):
                    row = await find_active_user_by_username(connection, username)
                    assert row
                    actor = await load_authenticated_user(connection, row["id"])
                    assert actor
                    actors.append(actor)
                owner, peer, late_member = actors
                group = await service.create_chat(
                    connection,
                    owner,
                    CreateChatRequest(
                        kind="group",
                        title="Rich message tests",
                        member_ids=[peer.id],
                    ),
                )
                chat_id = UUID(group.id)
                marks = [
                    MessageEntity(type="bold", offset=0, length=1),
                    MessageEntity(type="link", offset=3, length=1, url="https://example.org"),
                ]
                original = await service.send_chat_message(
                    connection, owner, chat_id, SendMessageRequest(body="A😀Б", entities=marks)
                )
                assert original.entities == marks
                reply = await service.send_chat_message(
                    connection,
                    peer,
                    chat_id,
                    SendMessageRequest(
                        body="Ответ",
                        reply_to_message_id=UUID(original.id),
                        reply_quote=MessageQuote(offset=1, text="😀"),
                    ),
                )
                assert reply.reply_quote and reply.reply_quote.text == "😀"
                with pytest.raises(WorkspaceRepositoryError) as forged:
                    await service.send_chat_message(
                        connection,
                        peer,
                        chat_id,
                        SendMessageRequest(
                            body="Неверная цитата",
                            reply_to_message_id=UUID(original.id),
                            reply_quote=MessageQuote(offset=0, text="Другая цитата"),
                        ),
                    )
                assert forged.value.status_code == 422
                edited = await service.change_message(
                    connection,
                    owner,
                    UUID(original.id),
                    EditMessageRequest(
                        body="A😀Б",
                        entities=[MessageEntity(type="italic", offset=1, length=2)],
                        expected_revision=1,
                    ),
                )
                assert edited.entities[0].type == "italic"
                versions = (
                    (
                        await connection.execute(
                            select(message_versions.c.entities)
                            .where(message_versions.c.message_id == UUID(original.id))
                            .order_by(message_versions.c.id)
                        )
                    )
                    .scalars()
                    .all()
                )
                assert versions[0][0]["type"] == "bold" and versions[1][0]["type"] == "italic"
                assert (await search_messages(connection, peer, "A😀Б"))[0].entities
                await service.set_message_pin(
                    connection, owner, UUID(original.id), PinMessageRequest(pinned=True)
                )
                hidden = await service.set_message_pin(
                    connection,
                    peer,
                    UUID(original.id),
                    PinMessageRequest(pinned=False, scope="self"),
                )
                assert (
                    hidden.is_pinned and hidden.pin_hidden_for_me and not hidden.can_unpin_for_all
                )
                owner_snapshot = await load_workspace(connection, owner)
                assert not next(
                    m for m in owner_snapshot.messages if m.id == original.id
                ).pin_hidden_for_me
                peer_snapshot = await load_workspace(connection, peer)
                assert next(
                    m for m in peer_snapshot.messages if m.id == original.id
                ).pin_hidden_for_me
                with pytest.raises(WorkspaceRepositoryError) as unauthorized:
                    await service.set_message_pin(
                        connection, peer, UUID(original.id), PinMessageRequest(pinned=False)
                    )
                assert unauthorized.value.status_code == 403
                await service.set_message_pin(
                    connection, owner, UUID(original.id), PinMessageRequest(pinned=False)
                )
                await connection.execute(
                    update(users)
                    .where(users.c.id == owner.id)
                    .values(job_title=EXECUTIVE_LEADER_POSITION_NAME)
                )
                chairman = await load_authenticated_user(connection, owner.id)
                assert chairman
                pinned = await service.set_message_pin(
                    connection, chairman, UUID(original.id), PinMessageRequest(pinned=True)
                )
                assert (
                    pinned.pin_protected and not pinned.pin_hidden_for_me and not pinned.can_delete
                )
                # Protection survives position changes and repeated pin requests.
                await connection.execute(
                    update(users).where(users.c.id == owner.id).values(job_title=owner.job_title)
                )
                repeated = await service.set_message_pin(
                    connection, owner, UUID(original.id), PinMessageRequest(pinned=True)
                )
                assert repeated.pinned_at == pinned.pinned_at and repeated.pin_protected
                for actor, scope in ((peer, "self"), (owner, "all")):
                    with pytest.raises(WorkspaceRepositoryError) as protected:
                        await service.set_message_pin(
                            connection,
                            actor,
                            UUID(original.id),
                            PinMessageRequest(pinned=False, scope=scope),
                        )
                    assert protected.value.status_code == 403
                with pytest.raises(WorkspaceRepositoryError) as protected_delete:
                    await service.change_message(
                        connection,
                        owner,
                        UUID(original.id),
                        DeleteMessageRequest(expected_revision=2),
                    )
                assert protected_delete.value.status_code == 403
                # No-history member cannot recover an old fragment from a newer reply.
                await service.add_chat_members(
                    connection, owner, chat_id, AddChatMembersRequest(member_ids=[late_member.id])
                )
                await connection.execute(
                    update(chat_members)
                    .where(
                        chat_members.c.chat_id == chat_id, chat_members.c.user_id == late_member.id
                    )
                    .values(history_visible_from=datetime.now(UTC) - timedelta(seconds=1))
                )
                latest = await service.send_chat_message(
                    connection,
                    peer,
                    chat_id,
                    SendMessageRequest(
                        body="Новый ответ",
                        reply_to_message_id=UUID(original.id),
                        reply_quote=MessageQuote(offset=1, text="😀"),
                    ),
                )
                # Explicit cutoff between the source and new response, independent of test speed.
                source_created = original.created_at
                await connection.execute(
                    update(chat_members)
                    .where(
                        chat_members.c.chat_id == chat_id, chat_members.c.user_id == late_member.id
                    )
                    .values(history_visible_from=source_created + timedelta(microseconds=1))
                )
                late_snapshot = await load_workspace(connection, late_member)
                assert (
                    next(m for m in late_snapshot.messages if m.id == latest.id).reply_quote is None
                )
                assert not any(m.id == original.id for m in late_snapshot.messages)
            finally:
                await transaction.rollback()
    finally:
        await engine.dispose()
