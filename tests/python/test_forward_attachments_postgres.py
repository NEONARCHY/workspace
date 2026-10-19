import asyncio
import os
from datetime import UTC, datetime
from uuid import UUID, uuid4

import pytest
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import create_async_engine

from yuksalish_api import messenger_service as service
from yuksalish_api.auth import load_authenticated_user
from yuksalish_api.errors import WorkspaceRepositoryError
from yuksalish_api.forward_service import forward_message
from yuksalish_api.object_storage import InMemoryObjectStorage, ObjectStorageError
from yuksalish_api.repository import (
    create_attachment,
    find_active_user_by_username,
    get_attachment,
    load_workspace,
)
from yuksalish_api.seed import seed_demo_data
from yuksalish_api.tables import attachments, chat_members, messages
from yuksalish_api.workspace_schemas import (
    CreateChatRequest,
    ForwardMessageRequest,
    SendMessageRequest,
)


async def exercise(url: str) -> None:
    engine = create_async_engine(url)
    try:
        await seed_demo_data(engine)
        async with engine.connect() as connection:
            transaction = await connection.begin()
            try:
                actors = []
                for username in ("dilshod", "baxtiyor", "aziza"):
                    row = await find_active_user_by_username(connection, username)
                    assert row is not None
                    actor = await load_authenticated_user(connection, row["id"])
                    assert actor is not None
                    actors.append(actor)
                sender, author, recipient = actors
                source_chat = await service.create_chat(
                    connection,
                    author,
                    CreateChatRequest(
                        kind="group",
                        title="Forward source QA",
                        member_ids=[sender.id],
                    ),
                )
                target_chat = await service.create_chat(
                    connection,
                    recipient,
                    CreateChatRequest(
                        kind="group",
                        title="Forward target QA",
                        member_ids=[sender.id],
                    ),
                )
                target_id = UUID(target_chat.id)
                original = await service.send_chat_message(
                    connection,
                    author,
                    UUID(source_chat.id),
                    SendMessageRequest(body="Photo caption"),
                )
                originals = []
                source_keys = {}
                storage = InMemoryObjectStorage()
                for name, kind, mime in [
                    ("photo.png", "image", "image/png"),
                    ("result.pdf", "file", "application/pdf"),
                ]:
                    source_keys[name] = f"qa/{uuid4()}/{name}"
                    await storage.put(source_keys[name], name.encode(), mime)
                    originals.append(
                        await create_attachment(
                            connection,
                            author,
                            "message",
                            UUID(original.id),
                            file_name=name,
                            content_type=mime,
                            byte_size=123,
                            sha256="a" * 64,
                            storage_key=source_keys[name],
                            media_kind="file",
                            image_width=640 if kind == "image" else None,
                            image_height=480 if kind == "image" else None,
                        )
                    )
                request = ForwardMessageRequest(
                    request_id=uuid4(), kind="message", source_id=UUID(original.id)
                )
                await connection.execute(
                    update(chat_members)
                    .where(
                        chat_members.c.chat_id == target_id,
                        chat_members.c.user_id == sender.id,
                    )
                    .values(permissions={"send_messages": True, "upload_files": False})
                )
                with pytest.raises(WorkspaceRepositoryError) as denied:
                    await forward_message(connection, sender, target_id, request, storage)
                assert denied.value.status_code == 403
                assert (
                    await connection.scalar(
                        select(messages.c.id).where(messages.c.id == request.request_id)
                    )
                    is None
                )
                await connection.execute(
                    update(chat_members)
                    .where(
                        chat_members.c.chat_id == target_id,
                        chat_members.c.user_id == sender.id,
                    )
                    .values(permissions={"send_messages": True, "upload_files": True})
                )
                # A storage outage must not create a text-only forwarded message.
                missing = await storage.get(source_keys["result.pdf"])
                await storage.delete(source_keys["result.pdf"])
                with pytest.raises(ObjectStorageError):
                    await forward_message(connection, sender, target_id, request, storage)
                assert (
                    await connection.scalar(
                        select(messages.c.id).where(messages.c.id == request.request_id)
                    )
                    is None
                )
                assert set(storage._objects) == {source_keys["photo.png"]}
                await storage.put(source_keys["result.pdf"], missing, "application/pdf")
                copied = await forward_message(connection, sender, target_id, request, storage)
                retry = await forward_message(connection, sender, target_id, request, storage)
                assert retry.id == copied.id and copied.body == original.body
                assert copied.forwarded and copied.forwarded.author_id == str(author.id)
                rows = list(
                    (
                        await connection.execute(
                            select(attachments).where(
                                attachments.c.owner_type == "message",
                                attachments.c.owner_id == UUID(copied.id),
                            )
                        )
                    ).mappings()
                )
                assert len(rows) == 2
                assert {row["file_name"] for row in rows} == {"photo.png", "result.pdf"}
                assert {str(row["id"]) for row in rows}.isdisjoint(item.id for item in originals)
                for row in rows:
                    assert row["uploaded_by_user_id"] == sender.id
                    attachment, key = await get_attachment(connection, recipient, row["id"])
                    assert key and attachment.byte_size == 123
                    assert key != source_keys[row["file_name"]]
                    assert await storage.get(key) == row["file_name"].encode()
                    if row["file_name"] == "photo.png":
                        assert row["image_width"] == 640 and row["image_height"] == 480
                with pytest.raises(WorkspaceRepositoryError):
                    await get_attachment(connection, recipient, UUID(originals[0].id))
                workspace = await load_workspace(connection, recipient)
                visible_ids = {item.id for item in workspace.attachments}
                assert {str(row["id"]) for row in rows} <= visible_ids
                assert visible_ids.isdisjoint(item.id for item in originals)
                # A second forward owns independent metadata and retains original provenance.
                second = await forward_message(
                    connection,
                    sender,
                    target_id,
                    request.model_copy(
                        update={"request_id": uuid4(), "source_id": UUID(copied.id)},
                    ),
                    storage,
                )
                assert second.forwarded and second.forwarded.author_id == str(author.id)
                assert (
                    await connection.scalar(
                        select(func.count())
                        .select_from(attachments)
                        .where(attachments.c.owner_id == UUID(second.id))
                    )
                    == 2
                )
                await connection.execute(
                    update(messages)
                    .where(messages.c.id == UUID(original.id))
                    .values(deleted_at=datetime.now(UTC))
                )
                # Removing the original does not remove the forwarded private blob/access.
                for key in source_keys.values():
                    await storage.delete(key)
                copied_key = (await get_attachment(connection, recipient, rows[0]["id"]))[1]
                assert await storage.get(copied_key)
            finally:
                await transaction.rollback()
    finally:
        await engine.dispose()


def test_forwarded_attachments_keep_metadata_access_and_retry_identity() -> None:
    url = os.environ.get("YUKSALISH_TEST_DATABASE_URL")
    if not url:
        pytest.skip("YUKSALISH_TEST_DATABASE_URL is not configured")
    asyncio.run(exercise(url))
