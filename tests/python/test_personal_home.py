import asyncio
import os
from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, MagicMock
from uuid import UUID

import pytest
from sqlalchemy import delete, update
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import create_async_engine

from yuksalish_api import home_service, messenger_service
from yuksalish_api.auth import load_authenticated_user
from yuksalish_api.catalog import MODULE_CATALOG
from yuksalish_api.repository import find_active_user_by_username
from yuksalish_api.seed import seed_demo_data
from yuksalish_api.tables import chat_members, messages
from yuksalish_api.workspace_schemas import (
    DEFAULT_NAVIGATION,
    CreateChatRequest,
    MessageReactionRequest,
    NavigationOrder,
    SendMessageRequest,
)


def test_home_catalog_and_pre_home_menu_compatibility() -> None:
    module = next(m for m in MODULE_CATALOG if m.key == "home")
    assert module.route == "/home"
    assert set(module.label.model_dump()) == {"ru", "uz_cyrl", "uz_latn"}
    assert DEFAULT_NAVIGATION[0] == "home"
    old_order = [key for key in DEFAULT_NAVIGATION if key != "home"][::-1]
    assert NavigationOrder(order=old_order, revision=0).order == ["home", *old_order]


def test_hidden_messenger_does_not_query_or_count_private_reactions(monkeypatch) -> None:
    check = AsyncMock()
    monkeypatch.setattr(home_service, "ensure_module_action", check)
    monkeypatch.setattr(
        home_service,
        "module_permissions_for_user",
        AsyncMock(return_value={"messenger": {"view": False}}),
    )
    connection = MagicMock()
    result = asyncio.run(home_service.personal_reactions(connection, MagicMock()))
    assert result.model_dump(by_alias=True) == {"totalCount": 0, "reactions": []}
    connection.execute.assert_not_called()
    check.assert_awaited_once()


async def exercise_reactions(url: str) -> None:
    assert (make_url(url).database or "").startswith("yuksalish_test")
    engine = create_async_engine(url)
    try:
        await seed_demo_data(engine)
        async with engine.connect() as connection:
            transaction = await connection.begin()
            try:
                actors = []
                for name in ("dilshod", "baxtiyor", "malika"):
                    row = await find_active_user_by_username(connection, name)
                    assert row
                    actor = await load_authenticated_user(connection, row["id"])
                    assert actor
                    actors.append(actor)
                owner, peer, admin = actors
                baseline = await home_service.personal_reactions(connection, owner)
                admin_baseline = await home_service.personal_reactions(connection, admin)
                group = await messenger_service.create_chat(
                    connection,
                    owner,
                    CreateChatRequest(
                        kind="group", title="Personal Home isolated test", member_ids=[peer.id]
                    ),
                )
                chat_id = UUID(group.id)
                own = await messenger_service.send_chat_message(
                    connection, owner, chat_id, SendMessageRequest(body="Home reactions test")
                )
                foreign = await messenger_service.send_chat_message(
                    connection,
                    peer,
                    chat_id,
                    SendMessageRequest(body="Not the current employee's message"),
                )
                for actor, message_id, emoji in (
                    (owner, own.id, "👍"),
                    (peer, own.id, "👍"),
                    (peer, own.id, "❤️"),
                    (owner, foreign.id, "👍"),
                ):
                    await messenger_service.toggle_message_reaction(
                        connection, actor, UUID(message_id), MessageReactionRequest(emoji=emoji)
                    )
                result = await home_service.personal_reactions(connection, owner)
                assert result.total_count == baseline.total_count + 2
                assert sum(r.count for r in result.reactions) == result.total_count
                assert (
                    await home_service.personal_reactions(connection, admin)
                ).total_count == admin_baseline.total_count
                await connection.execute(
                    update(messages)
                    .where(messages.c.id == UUID(own.id))
                    .values(deleted_at=datetime.now(UTC))
                )
                assert (
                    await home_service.personal_reactions(connection, owner)
                ).total_count == baseline.total_count
                await connection.execute(
                    update(messages).where(messages.c.id == UUID(own.id)).values(deleted_at=None)
                )
                await connection.execute(
                    update(chat_members)
                    .where(
                        chat_members.c.chat_id == chat_id,
                        chat_members.c.user_id == owner.id,
                    )
                    .values(history_visible_from=datetime.now(UTC) + timedelta(days=1))
                )
                assert (
                    await home_service.personal_reactions(connection, owner)
                ).total_count == baseline.total_count
                await connection.execute(
                    delete(chat_members).where(
                        chat_members.c.chat_id == chat_id, chat_members.c.user_id == owner.id
                    )
                )
                assert (
                    await home_service.personal_reactions(connection, owner)
                ).total_count == baseline.total_count
            finally:
                await transaction.rollback()
    finally:
        await engine.dispose()


@pytest.mark.postgres
def test_personal_reactions_owner_self_deleted_history_and_membership() -> None:
    url = os.environ.get("YUKSALISH_TEST_DATABASE_URL")
    if not url:
        pytest.skip("YUKSALISH_TEST_DATABASE_URL is not configured")
    asyncio.run(exercise_reactions(url))
