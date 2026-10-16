import asyncio
import os
from uuid import UUID

import pytest
from sqlalchemy.ext.asyncio import create_async_engine

from yuksalish_api import messenger_service, repository
from yuksalish_api.auth import load_authenticated_user
from yuksalish_api.seed import seed_demo_data
from yuksalish_api.workspace_schemas import CreateChatRequest, SendMessageRequest


@pytest.mark.postgres
def test_new_message_notification_never_precedes_its_message_in_bootstrap(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    url = os.environ.get("YUKSALISH_TEST_DATABASE_URL")
    if not url:
        pytest.skip("YUKSALISH_TEST_DATABASE_URL is not configured")

    async def exercise() -> None:
        engine = create_async_engine(url)
        try:
            await seed_demo_data(engine)
            async with engine.connect() as connection:
                transaction = await connection.begin()
                try:
                    owner_row = await repository.find_active_user_by_username(connection, "dilshod")
                    peer_row = await repository.find_active_user_by_username(connection, "baxtiyor")
                    assert owner_row and peer_row
                    owner = await load_authenticated_user(connection, owner_row["id"])
                    peer = await load_authenticated_user(connection, peer_row["id"])
                    assert owner and peer
                    chat = await messenger_service.create_chat(
                        connection, owner,
                        CreateChatRequest(
                            kind="group", title="Snapshot race", member_ids=[peer.id],
                        ),
                    )
                    original_sync = repository._sync_notifications_for_user
                    message_id = ""

                    async def insert_before_notifications(*args, **kwargs):
                        nonlocal message_id
                        # Deterministic interleaving: a message becomes visible
                        # just before notifications are materialized/read.
                        message = await messenger_service.send_chat_message(
                            connection, owner, UUID(chat.id),
                            SendMessageRequest(body="Message arriving during bootstrap"),
                        )
                        message_id = message.id
                        return await original_sync(*args, **kwargs)

                    monkeypatch.setattr(
                        repository, "_sync_notifications_for_user", insert_before_notifications,
                    )
                    snapshot = await repository.load_workspace(connection, peer)
                    assert any(item.kind == "message" and item.entity_id == chat.id
                               for item in snapshot.notifications)
                    assert message_id in {item.id for item in snapshot.messages}
                finally:
                    await transaction.rollback()
        finally:
            await engine.dispose()

    asyncio.run(exercise())
