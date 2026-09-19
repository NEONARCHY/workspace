import asyncio
import os
from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

import pytest
from httpx import ASGITransport, AsyncClient
from pydantic import SecretStr, ValidationError
from sqlalchemy import func, select, update
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import create_async_engine

from yuksalish_api import messenger_service as service
from yuksalish_api.auth import load_authenticated_user
from yuksalish_api.errors import WorkspaceRepositoryError
from yuksalish_api.main import create_app
from yuksalish_api.repository import (
    create_attachment,
    find_active_user_by_username,
    get_attachment,
    load_workspace,
    search_messages,
    validate_attachment_owner,
)
from yuksalish_api.seed import seed_demo_data
from yuksalish_api.settings import Settings
from yuksalish_api.tables import (
    chats,
    message_reactions,
    message_versions,
    messages,
    pinned_messages,
    workspace_notifications,
)
from yuksalish_api.workspace_schemas import (
    AddChatMembersRequest,
    ChatPermissions,
    CreateChatRequest,
    DeleteMessageRequest,
    EditMessageRequest,
    MessageReactionRequest,
    PinMessageRequest,
    SendMessageRequest,
    SetChatMemberRequest,
    TransferChatOwnerRequest,
    UpdateChatRequest,
)


def database_url() -> str:
    value = os.environ.get("YUKSALISH_TEST_DATABASE_URL")
    if not value:
        pytest.skip("YUKSALISH_TEST_DATABASE_URL is not configured")
    return value


def test_chat_payload_validation() -> None:
    for payload in (
        {"kind": "group", "title": "  ", "member_ids": [uuid4()]},
        {"kind": "direct", "member_ids": [uuid4(), uuid4()]},
    ):
        with pytest.raises(ValidationError):
            CreateChatRequest.model_validate(payload)
    same = uuid4()
    with pytest.raises(ValidationError):
        CreateChatRequest(kind="group", title="Duplicate", member_ids=[same, same])
    with pytest.raises(ValidationError):
        UpdateChatRequest(title=" ")
    with pytest.raises(ValidationError):
        SetChatMemberRequest.model_validate({"role": "owner", "permissions": {}})


async def exercise_permissions(url: str) -> None:
    engine = create_async_engine(url)
    try:
        await seed_demo_data(engine)
        async with engine.connect() as connection:
            transaction = await connection.begin()
            try:
                actors = []
                for username in ("dilshod", "baxtiyor", "malika", "aziza"):
                    row = await find_active_user_by_username(connection, username)
                    assert row is not None
                    actor = await load_authenticated_user(connection, row["id"])
                    assert actor is not None
                    actors.append(actor)
                owner, peer, admin, other = actors
                assert owner.role == "employee"
                group = await service.create_chat(
                    connection,
                    owner,
                    CreateChatRequest(
                        kind="group",
                        title="Private test",
                        member_ids=[peer.id],
                    ),
                )
                group_id = UUID(group.id)
                assert group.owner_id == str(owner.id) and group.permissions.manage_members
                assert group.permissions.manage_messages
                assert len(group.members) == 2 and group.preview == "Сообщений пока нет"
                with pytest.raises(WorkspaceRepositoryError) as denied:
                    await service.chat_summary(connection, admin, group_id)
                assert denied.value.status_code == 404
                project_chat_id = await connection.scalar(
                    select(chats.c.id).where(chats.c.context_type == "project")
                )
                assert project_chat_id is not None
                project_chat = await service.chat_summary(connection, admin, project_chat_id)
                assert project_chat.context_type == "project"
                assert project_chat.context_id is not None
                admin_workspace = await load_workspace(connection, admin)
                assert project_chat.id in {chat.id for chat in admin_workspace.chats}
                assert str(group_id) not in {chat.id for chat in admin_workspace.chats}
                with pytest.raises(WorkspaceRepositoryError):
                    await service.create_chat(
                        connection,
                        owner,
                        CreateChatRequest(
                            kind="group",
                            title="Only me",
                            member_ids=[owner.id],
                        ),
                    )
                with pytest.raises(WorkspaceRepositoryError):
                    await service.create_chat(
                        connection,
                        owner,
                        CreateChatRequest(
                            kind="group",
                            title="Unknown",
                            member_ids=[uuid4()],
                        ),
                    )
                for operation in (
                    service.update_chat(connection, peer, group_id, UpdateChatRequest(title="No")),
                    service.add_chat_members(
                        connection, peer, group_id, AddChatMembersRequest(member_ids=[other.id])
                    ),
                    service.set_chat_member(
                        connection,
                        peer,
                        group_id,
                        peer.id,
                        SetChatMemberRequest(
                            role="moderator", permissions=service.FULL_PERMISSIONS
                        ),
                    ),
                    service.transfer_chat_owner(
                        connection, peer, group_id, TransferChatOwnerRequest(user_id=owner.id)
                    ),
                ):
                    with pytest.raises(WorkspaceRepositoryError):
                        await operation
                await service.set_chat_member(
                    connection,
                    owner,
                    group_id,
                    peer.id,
                    SetChatMemberRequest(role="moderator", permissions=service.FULL_PERMISSIONS),
                )
                renamed = await service.update_chat(
                    connection, peer, group_id, UpdateChatRequest(title="Delegated group")
                )
                assert renamed.title == "Delegated group"
                await service.add_chat_members(
                    connection,
                    peer,
                    group_id,
                    AddChatMembersRequest(member_ids=[admin.id, other.id]),
                )
                duplicate = await service.add_chat_members(
                    connection, peer, group_id, AddChatMembersRequest(member_ids=[admin.id])
                )
                assert len(duplicate.members) == 4
                await service.set_chat_member(
                    connection,
                    owner,
                    group_id,
                    other.id,
                    SetChatMemberRequest(role="moderator", permissions=service.FULL_PERMISSIONS),
                )
                with pytest.raises(WorkspaceRepositoryError):
                    await service.remove_chat_member(connection, peer, group_id, other.id)
                with pytest.raises(WorkspaceRepositoryError):
                    await service.remove_chat_member(connection, owner, group_id, owner.id)
                with pytest.raises(WorkspaceRepositoryError):
                    await service.set_chat_member(
                        connection,
                        owner,
                        group_id,
                        owner.id,
                        SetChatMemberRequest(role="member", permissions=ChatPermissions()),
                    )
                with pytest.raises(WorkspaceRepositoryError):
                    await service.set_chat_member(
                        connection,
                        owner,
                        group_id,
                        uuid4(),
                        SetChatMemberRequest(role="member", permissions=ChatPermissions()),
                    )
                await service.remove_chat_member(connection, peer, group_id, admin.id)
                with pytest.raises(WorkspaceRepositoryError):
                    await service.remove_chat_member(connection, owner, group_id, admin.id)
                text = "Private original body"
                message = await service.send_chat_message(
                    connection, owner, group_id, SendMessageRequest(body=text)
                )
                message_id = UUID(message.id)
                attachment = await create_attachment(
                    connection,
                    owner,
                    "message",
                    message_id,
                    file_name="private.txt",
                    content_type="text/plain",
                    byte_size=10,
                    sha256="a" * 64,
                    storage_key="test/private-file",
                )
                assert (await get_attachment(connection, peer, UUID(attachment.id)))[
                    0
                ].id == attachment.id
                with pytest.raises(WorkspaceRepositoryError):
                    await get_attachment(connection, admin, UUID(attachment.id))
                with pytest.raises(WorkspaceRepositoryError):
                    await service.send_chat_message(
                        connection, admin, group_id, SendMessageRequest(body="No access")
                    )
                assert not await search_messages(connection, admin, text)
                await service.remove_chat_member(connection, owner, group_id, peer.id)
                snapshot = await load_workspace(connection, peer)
                assert group.id not in {item.id for item in snapshot.chats}
                assert attachment.id not in {item.id for item in snapshot.attachments}
                assert not any(item.entity_id == group.id for item in snapshot.notifications)
                with pytest.raises(WorkspaceRepositoryError):
                    await get_attachment(connection, peer, UUID(attachment.id))
                await service.add_chat_members(
                    connection, owner, group_id, AddChatMembersRequest(member_ids=[peer.id])
                )
                assert message.id in {
                    item.id for item in (await load_workspace(connection, peer)).messages
                }
                peer_message = await service.send_chat_message(
                    connection, peer, group_id, SendMessageRequest(body="Attachment restricted")
                )
                await service.set_chat_member(
                    connection,
                    owner,
                    group_id,
                    peer.id,
                    SetChatMemberRequest(
                        role="member", permissions=ChatPermissions(upload_files=False)
                    ),
                )
                with pytest.raises(WorkspaceRepositoryError):
                    await validate_attachment_owner(
                        connection, peer, "message", UUID(peer_message.id), write=True
                    )
                await service.set_chat_member(
                    connection,
                    owner,
                    group_id,
                    peer.id,
                    SetChatMemberRequest(
                        role="member",
                        permissions=ChatPermissions(send_messages=False, upload_files=False),
                    ),
                )
                with pytest.raises(WorkspaceRepositoryError):
                    await service.send_chat_message(
                        connection, peer, group_id, SendMessageRequest(body="Cannot send")
                    )
                with pytest.raises(WorkspaceRepositoryError):
                    await service.change_message(
                        connection,
                        peer,
                        UUID(peer_message.id),
                        EditMessageRequest(body="Cannot edit", expected_revision=1),
                    )
                with pytest.raises(WorkspaceRepositoryError):
                    await service.transfer_chat_owner(
                        connection, owner, group_id, TransferChatOwnerRequest(user_id=admin.id)
                    )
                transferred = await service.transfer_chat_owner(
                    connection, owner, group_id, TransferChatOwnerRequest(user_id=other.id)
                )
                assert transferred.owner_id == str(other.id)
                await service.remove_chat_member(connection, owner, group_id, owner.id)
                direct = await service.create_chat(
                    connection,
                    other,
                    CreateChatRequest(
                        kind="direct",
                        member_ids=[peer.id],
                    ),
                )
                again = await service.create_chat(
                    connection,
                    peer,
                    CreateChatRequest(
                        kind="direct",
                        member_ids=[other.id],
                    ),
                )
                assert direct.id == again.id and len(direct.members) == 2
                with pytest.raises(WorkspaceRepositoryError):
                    await service.add_chat_members(
                        connection,
                        other,
                        UUID(direct.id),
                        AddChatMembersRequest(member_ids=[admin.id]),
                    )
            finally:
                await transaction.rollback()
    finally:
        await engine.dispose()


@pytest.mark.postgres
def test_private_groups_and_delegated_permissions() -> None:
    asyncio.run(exercise_permissions(database_url()))


async def exercise_messages(url: str) -> None:
    engine = create_async_engine(url)
    try:
        await seed_demo_data(engine)
        async with engine.connect() as connection:
            transaction = await connection.begin()
            try:
                owner_row = await find_active_user_by_username(connection, "dilshod")
                peer_row = await find_active_user_by_username(connection, "baxtiyor")
                assert owner_row and peer_row
                owner = await load_authenticated_user(connection, owner_row["id"])
                peer = await load_authenticated_user(connection, peer_row["id"])
                assert owner and peer
                group = await service.create_chat(
                    connection,
                    owner,
                    CreateChatRequest(
                        kind="group",
                        title="x" * 240,
                        member_ids=[peer.id],
                    ),
                )
                group_id = UUID(group.id)
                parent = await service.send_chat_message(
                    connection, owner, group_id, SendMessageRequest(body="Original private text")
                )
                reply = await service.send_chat_message(
                    connection,
                    peer,
                    group_id,
                    SendMessageRequest(
                        body="Reply",
                        reply_to_message_id=UUID(parent.id),
                        mention_user_ids=[owner.id],
                    ),
                )
                assert reply.reply_to_message_id == parent.id and reply.can_edit
                reacted = await service.toggle_message_reaction(
                    connection,
                    owner,
                    UUID(parent.id),
                    MessageReactionRequest(emoji="👍"),
                )
                assert reacted.reactions[0].count == 1
                assert reacted.reactions[0].reacted_by_current_user
                reacted_by_peer = await service.toggle_message_reaction(
                    connection,
                    peer,
                    UUID(parent.id),
                    MessageReactionRequest(emoji="👍"),
                )
                assert reacted_by_peer.reactions[0].count == 2
                with pytest.raises(WorkspaceRepositoryError):
                    await service.set_message_pin(
                        connection,
                        peer,
                        UUID(parent.id),
                        PinMessageRequest(pinned=True),
                    )
                pinned = await service.set_message_pin(
                    connection,
                    owner,
                    UUID(parent.id),
                    PinMessageRequest(pinned=True),
                )
                assert pinned.is_pinned and pinned.pinned_by_user_id == str(owner.id)
                peer_snapshot = await load_workspace(connection, peer)
                peer_parent = next(item for item in peer_snapshot.messages if item.id == parent.id)
                assert peer_parent.is_pinned
                assert peer_parent.reactions[0].count == 2
                notifications = (
                    (
                        await connection.execute(
                            select(workspace_notifications).where(
                                workspace_notifications.c.entity_id == group_id,
                            )
                        )
                    )
                    .mappings()
                    .all()
                )
                assert len(notifications) == 2
                assert any(
                    item["priority"] == "attention" and item["user_id"] == owner.id
                    for item in notifications
                )
                with pytest.raises(WorkspaceRepositoryError):
                    await service.send_chat_message(
                        connection,
                        owner,
                        group_id,
                        SendMessageRequest(body="Bad mention", mention_user_ids=[uuid4()]),
                    )
                unrelated = await service.create_chat(
                    connection,
                    owner,
                    CreateChatRequest(
                        kind="group",
                        title="Other group",
                        member_ids=[peer.id],
                    ),
                )
                with pytest.raises(WorkspaceRepositoryError):
                    await service.send_chat_message(
                        connection,
                        owner,
                        UUID(unrelated.id),
                        SendMessageRequest(body="Bad quote", reply_to_message_id=UUID(parent.id)),
                    )
                with pytest.raises(WorkspaceRepositoryError):
                    await service.change_message(
                        connection, owner, UUID(reply.id), DeleteMessageRequest(expected_revision=1)
                    )
                edited = await service.change_message(
                    connection,
                    owner,
                    UUID(parent.id),
                    EditMessageRequest(
                        body="Changed private text",
                        mention_user_ids=[peer.id],
                        expected_revision=1,
                    ),
                )
                assert edited.revision == 2 and edited.edited_at
                assert (
                    await connection.scalar(
                        select(func.count())
                        .select_from(workspace_notifications)
                        .where(workspace_notifications.c.event_key == f"mention:{parent.id}:2")
                    )
                    == 1
                )
                with pytest.raises(WorkspaceRepositoryError) as stale:
                    await service.change_message(
                        connection,
                        owner,
                        UUID(parent.id),
                        EditMessageRequest(body="Stale", expected_revision=1),
                    )
                assert stale.value.status_code == 409
                removed = await service.change_message(
                    connection, owner, UUID(parent.id), DeleteMessageRequest(expected_revision=2)
                )
                assert removed.revision == 3 and removed.deleted_at and not removed.body
                assert not removed.can_edit
                assert (
                    await connection.scalar(
                        select(func.count())
                        .select_from(message_reactions)
                        .where(message_reactions.c.message_id == UUID(parent.id))
                    )
                    == 0
                )
                assert (
                    await connection.scalar(
                        select(func.count())
                        .select_from(pinned_messages)
                        .where(pinned_messages.c.message_id == UUID(parent.id))
                    )
                    == 0
                )
                history = list(
                    (
                        await connection.execute(
                            select(message_versions.c.body)
                            .where(
                                message_versions.c.message_id == UUID(parent.id),
                            )
                            .order_by(message_versions.c.id)
                        )
                    ).scalars()
                )
                assert history == ["Original private text", "Changed private text", ""]
                nested = await connection.begin_nested()
                with pytest.raises(DBAPIError, match="append-only"):
                    await connection.execute(
                        update(message_versions)
                        .where(
                            message_versions.c.message_id == UUID(parent.id),
                        )
                        .values(body="tamper")
                    )
                await nested.rollback()
                snapshot = await load_workspace(connection, peer)
                assert next(item for item in snapshot.messages if item.id == parent.id).body == ""
                assert not await search_messages(connection, peer, "Changed private text")
                assert not any("private text" in item.body for item in snapshot.notifications)
                with pytest.raises(WorkspaceRepositoryError):
                    await service.send_chat_message(
                        connection,
                        peer,
                        group_id,
                        SendMessageRequest(
                            body="Deleted quote", reply_to_message_id=UUID(parent.id)
                        ),
                    )
                await connection.execute(
                    update(messages)
                    .where(messages.c.id == UUID(reply.id))
                    .values(
                        created_at=datetime.now(UTC) - timedelta(hours=25),
                    )
                )
                with pytest.raises(WorkspaceRepositoryError):
                    await service.change_message(
                        connection,
                        peer,
                        UUID(reply.id),
                        EditMessageRequest(body="Too late", expected_revision=1),
                    )
                with pytest.raises(WorkspaceRepositoryError):
                    await service.change_message(
                        connection, peer, uuid4(), DeleteMessageRequest(expected_revision=1)
                    )
            finally:
                await transaction.rollback()
    finally:
        await engine.dispose()


@pytest.mark.postgres
def test_replies_mentions_revision_history_and_tombstones() -> None:
    asyncio.run(exercise_messages(database_url()))


async def exercise_http(url: str) -> None:
    password = "Yuksalish-Local-2026!"
    app = create_app(
        Settings(
            environment="test",
            database_url=url,
            seed_demo_data=True,
            demo_password=SecretStr(password),
            auth_signing_key=SecretStr("messenger-test-signing-key"),
            auth_encryption_key=SecretStr("messenger-test-encryption-key"),
        )
    )
    async with (
        app.router.lifespan_context(app),
        AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client,
    ):
        sessions = {}
        for name in ("dilshod", "malika", "baxtiyor"):
            result = await client.post(
                "/api/v1/auth/login", json={"username": name, "password": password}
            )
            assert result.status_code == 200
            sessions[name] = result.json()
        owner = sessions["dilshod"]
        peer_id = sessions["malika"]["user"]["id"]
        third_id = sessions["baxtiyor"]["user"]["id"]
        headers = {"Authorization": f"Bearer {owner['accessToken']}"}
        outsider = {"Authorization": f"Bearer {sessions['baxtiyor']['accessToken']}"}
        created = await client.post(
            "/api/v1/chats",
            headers=headers,
            json={"kind": "group", "title": "HTTP private group", "memberIds": [peer_id]},
        )
        assert created.status_code == 201, created.text
        chat_id = created.json()["id"]
        assert created.json()["ownerId"] == owner["user"]["id"]
        base = f"/api/v1/chats/{chat_id}"
        assert (
            await client.patch(base, headers=headers, json={"title": "HTTP renamed"})
        ).status_code == 200
        assert (
            await client.patch(base, headers=outsider, json={"title": "Forbidden"})
        ).status_code == 404
        assert (
            await client.post(f"{base}/members", headers=headers, json={"memberIds": [third_id]})
        ).status_code == 200
        assert (
            await client.put(
                f"{base}/members/{third_id}",
                headers=headers,
                json={
                    "role": "moderator",
                    "permissions": {"inviteMembers": True, "manageMembers": True},
                },
            )
        ).status_code == 200
        message = await client.post(
            f"{base}/messages",
            headers=headers,
            json={"body": "HTTP message", "mentionUserIds": [peer_id]},
        )
        assert message.status_code == 201, message.text
        path = f"/api/v1/messages/{message.json()['id']}"
        reaction = await client.post(path + "/reactions", headers=headers, json={"emoji": "🎉"})
        assert reaction.status_code == 200
        assert reaction.json()["reactions"] == [
            {"emoji": "🎉", "count": 1, "reactedByCurrentUser": True}
        ]
        assert (
            await client.post(path + "/reactions", headers=headers, json={"emoji": "🚀"})
        ).status_code == 422
        pinned = await client.put(path + "/pin", headers=headers, json={"pinned": True})
        assert pinned.status_code == 200 and pinned.json()["isPinned"]
        edited = await client.patch(
            path, headers=headers, json={"body": "HTTP edited", "expectedRevision": 1}
        )
        assert edited.status_code == 200 and edited.json()["revision"] == 2
        assert (
            await client.patch(path, headers=outsider, json={"body": "No", "expectedRevision": 2})
        ).status_code == 403
        deleted = await client.request(
            "DELETE", path, headers=headers, json={"expectedRevision": 2}
        )
        assert deleted.status_code == 200 and deleted.json()["deletedAt"]
        voice_message = await client.post(
            f"{base}/messages", headers=headers, json={"body": "Голосовое сообщение"}
        )
        assert voice_message.status_code == 201
        voice_path = f"/api/v1/attachments/message/{voice_message.json()['id']}"
        voice_query = (
            "?fileName=voice.webm&documentRole=general&mediaKind=voice"
            "&mediaDurationMs=1000&mediaCodec=opus"
        )
        voice_bytes = b"\x1a\x45\xdf\xa3" + b"\x00" * 20 + b"OpusHead" + b"\x00" * 200
        uploaded = await client.put(
            voice_path + voice_query,
            headers={**headers, "Content-Type": "audio/webm;codecs=opus"},
            content=voice_bytes,
        )
        assert uploaded.status_code == 201, uploaded.text
        assert uploaded.json()["mediaKind"] == "voice"
        assert uploaded.json()["mediaDurationMs"] == 1000
        invalid_voice = await client.put(
            voice_path + voice_query.replace("voice.webm", "bad.webm"),
            headers={**headers, "Content-Type": "audio/webm"},
            content=b"not-webm-or-opus",
        )
        assert invalid_voice.status_code == 422
        assert (
            await client.post(f"{base}/owner", headers=headers, json={"userId": peer_id})
        ).status_code == 200
        assert (
            await client.delete(f"{base}/members/{third_id}", headers=headers)
        ).status_code == 403
        assert (
            await client.delete(f"{base}/members/{third_id}", headers=outsider)
        ).status_code == 204
        assert (
            await client.post(f"{base}/messages", headers=outsider, json={"body": "No membership"})
        ).status_code == 404


@pytest.mark.postgres
def test_messenger_http_contract() -> None:
    asyncio.run(exercise_http(database_url()))


async def exercise_concurrent_directs(url: str) -> None:
    engine = create_async_engine(url)
    try:
        await seed_demo_data(engine)
        async with engine.connect() as connection:
            first_row = await find_active_user_by_username(connection, "dilshod")
            second_row = await find_active_user_by_username(connection, "baxtiyor")
            assert first_row and second_row
            first = await load_authenticated_user(connection, first_row["id"])
            second = await load_authenticated_user(connection, second_row["id"])
            assert first and second

        async def open_direct(reverse: bool) -> str:
            assert first and second
            actor, colleague = (second, first) if reverse else (first, second)
            async with engine.begin() as connection:
                result = await service.create_chat(
                    connection, actor, CreateChatRequest(kind="direct", member_ids=[colleague.id])
                )
                return result.id

        results = await asyncio.gather(open_direct(False), open_direct(True))
        assert results[0] == results[1]
    finally:
        await engine.dispose()


@pytest.mark.postgres
def test_concurrent_direct_creation_reuses_the_same_pair() -> None:
    asyncio.run(exercise_concurrent_directs(database_url()))
