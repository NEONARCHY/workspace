import asyncio
import os
from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

import pytest
from sqlalchemy import delete, func, insert, select, update
from sqlalchemy.ext.asyncio import create_async_engine

from yuksalish_api import messenger_service as service
from yuksalish_api.auth import load_authenticated_user
from yuksalish_api.errors import WorkspaceRepositoryError
from yuksalish_api.forward_service import forward_message
from yuksalish_api.repository import (
    create_feed_post,
    delete_feed_post,
    find_active_user_by_username,
    get_notification_preferences,
    load_feed_post,
    load_workspace,
    notify_feed_publication,
    search_messages,
    update_notification_preferences,
)
from yuksalish_api.seed import seed_demo_data
from yuksalish_api.tables import (
    chat_members,
    messages,
    module_access_rules,
    workspace_notifications,
)
from yuksalish_api.workspace_schemas import (
    AddChatMembersRequest,
    CreateChatRequest,
    CreateFeedPostRequest,
    EditMessageRequest,
    ForwardMessageRequest,
    NotificationPreferencesUpdate,
    SendMessageRequest,
)


async def exercise_forwarding(url: str) -> None:
    engine = create_async_engine(url)
    try:
        await seed_demo_data(engine)
        async with engine.connect() as connection:
            transaction = await connection.begin()
            try:
                actors = []
                for username in ("dilshod", "baxtiyor", "malika", "aziza"):
                    user = await find_active_user_by_username(connection, username)
                    assert user is not None
                    actor = await load_authenticated_user(connection, user["id"])
                    assert actor is not None
                    actors.append(actor)
                owner, peer, admin, other = actors
                source_chat = await service.create_chat(
                    connection,
                    owner,
                    CreateChatRequest(
                        kind="group",
                        title="Original test",
                        member_ids=[peer.id],
                    ),
                )
                target_chat = await service.create_chat(
                    connection,
                    owner,
                    CreateChatRequest(
                        kind="group",
                        title="Destination test",
                        member_ids=[peer.id],
                    ),
                )
                source_id, target_id = UUID(source_chat.id), UUID(target_chat.id)
                original = await service.send_chat_message(
                    connection, peer, source_id, SendMessageRequest(body="Original test text")
                )
                request = ForwardMessageRequest(
                    request_id=uuid4(), kind="message", source_id=UUID(original.id)
                )
                copied = await forward_message(connection, owner, target_id, request)
                assert copied.forwarded is not None
                assert copied.forwarded.author_id == str(peer.id)
                assert copied.forwarded.author_name == peer.full_name
                assert copied.body == original.body and not copied.can_edit
                retry = await forward_message(connection, owner, target_id, request)
                assert retry.id == copied.id
                assert (
                    await connection.scalar(
                        select(func.count())
                        .select_from(messages)
                        .where(
                            messages.c.id == request.request_id,
                        )
                    )
                    == 1
                )
                with pytest.raises(WorkspaceRepositoryError) as conflict:
                    await forward_message(connection, owner, source_id, request)
                assert conflict.value.status_code == 409
                with pytest.raises(WorkspaceRepositoryError) as immutable:
                    await service.change_message(
                        connection,
                        owner,
                        UUID(copied.id),
                        EditMessageRequest(body="Forged", expected_revision=1),
                    )
                assert immutable.value.status_code == 403
                recopied = await forward_message(
                    connection,
                    owner,
                    source_id,
                    ForwardMessageRequest(
                        request_id=uuid4(),
                        kind="message",
                        source_id=UUID(copied.id),
                    ),
                )
                assert recopied.forwarded is not None and recopied.forwarded.author_id == str(
                    peer.id
                )
                ordinary = await service.send_chat_message(
                    connection,
                    owner,
                    target_id,
                    SendMessageRequest.model_validate(
                        {
                            "body": "Переслано от Кто-то:\nQA message",
                            "forwarded": {"kind": "message"},
                        }
                    ),
                )
                assert ordinary.forwarded is None
                with pytest.raises(WorkspaceRepositoryError) as inaccessible:
                    await forward_message(
                        connection,
                        admin,
                        target_id,
                        request.model_copy(update={"request_id": uuid4()}),
                    )
                assert inaccessible.value.status_code == 404
                await connection.execute(
                    update(chat_members)
                    .where(
                        chat_members.c.chat_id == target_id,
                        chat_members.c.user_id == peer.id,
                    )
                    .values(permissions={"send_messages": False, "upload_files": False})
                )
                with pytest.raises(WorkspaceRepositoryError) as readonly:
                    await forward_message(
                        connection,
                        peer,
                        target_id,
                        request.model_copy(update={"request_id": uuid4()}),
                    )
                assert readonly.value.status_code == 403
                await connection.execute(
                    update(chat_members)
                    .where(
                        chat_members.c.chat_id == source_id,
                        chat_members.c.user_id == owner.id,
                    )
                    .values(history_visible_from=datetime.now(UTC) + timedelta(seconds=1))
                )
                with pytest.raises(WorkspaceRepositoryError) as history:
                    await forward_message(
                        connection,
                        owner,
                        target_id,
                        request.model_copy(update={"request_id": uuid4()}),
                    )
                assert history.value.status_code == 404
                await connection.execute(
                    update(chat_members)
                    .where(
                        chat_members.c.chat_id == source_id,
                        chat_members.c.user_id == owner.id,
                    )
                    .values(history_visible_from=None)
                )
                with pytest.raises(WorkspaceRepositoryError) as missing:
                    await forward_message(
                        connection,
                        owner,
                        target_id,
                        ForwardMessageRequest(
                            request_id=uuid4(),
                            kind="message",
                            source_id=uuid4(),
                        ),
                    )
                assert missing.value.status_code == 404

                # Delivery follows recipient preferences and feed access.
                prefs = await get_notification_preferences(connection, peer)
                await update_notification_preferences(
                    connection,
                    peer,
                    NotificationPreferencesUpdate.model_validate(
                        {
                            **prefs.model_dump(),
                            "feed_enabled": False,
                            "sound_enabled": False,
                            "sound_volume": 35,
                        }
                    ),
                )
                legacy = prefs.model_dump(exclude={"feed_enabled", "sound_enabled", "sound_volume"})
                await update_notification_preferences(
                    connection, peer, NotificationPreferencesUpdate.model_validate(legacy)
                )
                saved = await get_notification_preferences(connection, peer)
                assert (
                    not saved.feed_enabled and not saved.sound_enabled and saved.sound_volume == 35
                )
                await connection.execute(
                    delete(module_access_rules).where(
                        module_access_rules.c.subject_type == "user",
                        module_access_rules.c.subject_key == str(other.id),
                        module_access_rules.c.module_key == "feed",
                    )
                )
                await connection.execute(
                    insert(module_access_rules).values(
                        id=uuid4(),
                        subject_type="user",
                        subject_key=str(other.id),
                        module_key="feed",
                        permissions={"view": False},
                        created_by_user_id=admin.id,
                        created_at=datetime.now(UTC),
                        updated_at=datetime.now(UTC),
                    )
                )
                post = await create_feed_post(
                    connection,
                    owner,
                    CreateFeedPostRequest(
                        title="Forwarding integration announcement",
                        body="Full announcement " * 40,
                    ),
                )
                post_id = UUID(post.id)
                notices = (
                    (
                        await connection.execute(
                            select(workspace_notifications).where(
                                workspace_notifications.c.event_key == f"feed:{post_id}",
                            )
                        )
                    )
                    .mappings()
                    .all()
                )
                recipients = {row["user_id"] for row in notices}
                assert admin.id in recipients
                assert (
                    owner.id not in recipients
                    and peer.id not in recipients
                    and other.id not in recipients
                )
                await notify_feed_publication(
                    connection, owner, post_id, post.title, post.created_at
                )
                assert await connection.scalar(
                    select(func.count())
                    .select_from(workspace_notifications)
                    .where(
                        workspace_notifications.c.event_key == f"feed:{post_id}",
                    )
                ) == len(notices)
                with pytest.raises(WorkspaceRepositoryError) as denied:
                    await load_feed_post(connection, other, post_id)
                assert denied.value.status_code == 403
                feed_request = ForwardMessageRequest(
                    request_id=uuid4(), kind="feed", source_id=post_id
                )
                feed_copy = await forward_message(connection, owner, target_id, feed_request)
                assert feed_copy.forwarded is not None and feed_copy.forwarded.post_id == post.id
                assert feed_copy.forwarded.title == post.title and len(feed_copy.body) == 240
                await service.add_chat_members(
                    connection,
                    owner,
                    target_id,
                    AddChatMembersRequest(member_ids=[other.id]),
                )
                row = (
                    (
                        await connection.execute(
                            select(messages).where(messages.c.id == UUID(feed_copy.id))
                        )
                    )
                    .mappings()
                    .one()
                )
                details = await service.forward_detail_map(connection, other, [row])
                redacted = details[UUID(feed_copy.id)]
                assert (
                    not redacted.available and redacted.title is None and redacted.author_id is None
                )
                await delete_feed_post(connection, owner, post_id)
                results = await search_messages(connection, owner, "Full announcement")
                assert len(results) == 1 and results[0].body == "Объявление недоступно"
                assert results[0].forwarded is not None and not results[0].forwarded.available
                workspace = await load_workspace(connection, owner)
                hidden = next(item for item in workspace.messages if item.id == feed_copy.id)
                assert hidden.forwarded is not None and not hidden.forwarded.available
                assert (
                    await connection.scalar(
                        select(func.count())
                        .select_from(workspace_notifications)
                        .where(
                            workspace_notifications.c.event_key == f"feed:{post_id}",
                        )
                    )
                    == 0
                )
                with pytest.raises(WorkspaceRepositoryError) as deleted:
                    await forward_message(
                        connection,
                        owner,
                        target_id,
                        feed_request.model_copy(update={"request_id": uuid4()}),
                    )
                assert deleted.value.status_code == 404
            finally:
                await transaction.rollback()
    finally:
        await engine.dispose()


def test_forwarding_and_feed_delivery_postgres() -> None:
    url = os.environ.get("YUKSALISH_TEST_DATABASE_URL")
    if not url:
        pytest.skip("YUKSALISH_TEST_DATABASE_URL is not configured")
    asyncio.run(exercise_forwarding(url))
