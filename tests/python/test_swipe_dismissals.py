import asyncio
import os
from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, MagicMock
from uuid import UUID, uuid4
from zoneinfo import ZoneInfo

import pytest
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import create_async_engine

from yuksalish_api import messenger_service as service
from yuksalish_api.auth import load_authenticated_user
from yuksalish_api.errors import WorkspaceRepositoryError
from yuksalish_api.repository import (
    _sync_context_chat,
    _upsert_notification,
    dismiss_notification,
    find_active_user_by_username,
    load_workspace,
)
from yuksalish_api.seed import seed_demo_data
from yuksalish_api.tables import (
    chat_dismissals,
    chat_members,
    chats,
    trip_requests,
    workspace_notifications,
)
from yuksalish_api.workspace_schemas import CreateChatRequest, SendMessageRequest


@pytest.mark.parametrize("context", ["project", "project_hub"])
@pytest.mark.parametrize("status,expected", [("active", False), ("completed", True), (None, False)])
def test_project_leave_requires_explicit_completion(
    context: str, status: str | None, expected: bool
) -> None:
    connection = AsyncMock()
    connection.scalar.return_value = status
    assert (
        asyncio.run(
            service.context_chat_finished(
                connection,
                {"context_type": context, "context_id": uuid4()},
            )
        )
        is expected
    )


@pytest.mark.parametrize(
    "status,days,expected",
    [
        ("approved", 2, False),
        ("approved", 0, False),
        ("approved", -1, True),
        ("running", -2, False),
        ("rejected", 2, True),
    ],
)
def test_trip_approval_is_not_the_trip_end(status: str, days: int, expected: bool) -> None:
    connection, result = AsyncMock(), MagicMock()
    result.mappings.return_value.first.return_value = {
        "status": status,
        "end_date": datetime.now(ZoneInfo("Asia/Tashkent")).date() + timedelta(days=days),
    }
    connection.execute.return_value = result
    assert (
        asyncio.run(
            service.context_chat_finished(
                connection,
                {"context_type": "trip", "context_id": uuid4()},
            )
        )
        is expected
    )


def test_unknown_context_never_allows_leaving() -> None:
    assert (
        asyncio.run(
            service.context_chat_finished(
                AsyncMock(),
                {"context_type": "task", "context_id": uuid4()},
            )
        )
        is False
    )


@pytest.mark.postgres
def test_personal_dismissals_and_managed_leave_persist_without_deleting_history() -> None:
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
                    actors = []
                    for username in ("dilshod", "baxtiyor", "malika"):
                        row = await find_active_user_by_username(connection, username)
                        assert row is not None
                        actor = await load_authenticated_user(connection, row["id"])
                        assert actor is not None
                        actors.append(actor)
                    owner, peer, outsider = actors
                    direct = await service.create_chat(
                        connection,
                        owner,
                        CreateChatRequest(
                            kind="direct",
                            member_ids=[peer.id],
                        ),
                    )
                    chat_id = UUID(direct.id)
                    await service.dismiss_direct_chat(connection, peer, chat_id)
                    assert (
                        await connection.scalar(
                            select(chats.c.deleted_at).where(
                                chats.c.id == chat_id,
                            )
                        )
                        is None
                    )
                    assert direct.id not in {
                        chat.id
                        for chat in (
                            await load_workspace(
                                connection,
                                peer,
                            )
                        ).chats
                    }
                    assert direct.id in {
                        chat.id
                        for chat in (
                            await load_workspace(
                                connection,
                                owner,
                            )
                        ).chats
                    }
                    with pytest.raises(WorkspaceRepositoryError, match="Чат недоступен"):
                        await service.dismiss_direct_chat(connection, outsider, chat_id)
                    restored = await service.create_chat(
                        connection,
                        peer,
                        CreateChatRequest(
                            kind="direct",
                            member_ids=[owner.id],
                        ),
                    )
                    assert restored.id == direct.id
                    assert (
                        await connection.scalar(
                            select(chat_dismissals.c.chat_id).where(
                                chat_dismissals.c.chat_id == chat_id,
                                chat_dismissals.c.user_id == peer.id,
                            )
                        )
                        is None
                    )
                    assert restored.can_delete is True
                    await service.dismiss_direct_chat(connection, peer, chat_id)
                    message = await service.send_chat_message(
                        connection, owner, chat_id, SendMessageRequest(body="QA новое сообщение")
                    )
                    assert message.chat_id == direct.id
                    assert (
                        await connection.scalar(
                            select(chat_dismissals.c.chat_id).where(
                                chat_dismissals.c.chat_id == chat_id,
                                chat_dismissals.c.user_id == peer.id,
                            )
                        )
                        is None
                    )
                    await service.delete_chat(connection, peer, chat_id)
                    assert (
                        await connection.scalar(
                            select(chats.c.deleted_at).where(chats.c.id == chat_id)
                        )
                        is not None
                    )
                    for actor in (owner, peer):
                        with pytest.raises(WorkspaceRepositoryError, match="Чат недоступен"):
                            await service.chat_access(connection, actor, chat_id)

                    trip = (
                        (await connection.execute(select(trip_requests).limit(1)))
                        .mappings()
                        .first()
                    )
                    assert trip is not None
                    trip_id = trip["id"]
                    today = datetime.now(ZoneInfo("Asia/Tashkent")).date()
                    await connection.execute(
                        update(trip_requests)
                        .where(
                            trip_requests.c.id == trip_id,
                        )
                        .values(
                            status="approved", stage="approved", end_date=today + timedelta(days=2)
                        )
                    )
                    managed_id = await _sync_context_chat(
                        connection,
                        context_type="trip",
                        context_id=trip_id,
                        title="QA поездка",
                        description="QA",
                        owner_user_id=owner.id,
                        member_user_ids=[peer.id],
                    )
                    assert (
                        await service.chat_summary(connection, peer, managed_id)
                    ).can_leave is False
                    with pytest.raises(WorkspaceRepositoryError, match="после завершения"):
                        await service.remove_chat_member(connection, peer, managed_id, peer.id)
                    await connection.execute(
                        update(trip_requests)
                        .where(
                            trip_requests.c.id == trip_id,
                        )
                        .values(end_date=today - timedelta(days=1))
                    )
                    assert (
                        await service.chat_summary(connection, peer, managed_id)
                    ).can_leave is True
                    with pytest.raises(WorkspaceRepositoryError):
                        await service.remove_chat_member(connection, peer, managed_id, owner.id)
                    await service.remove_chat_member(connection, peer, managed_id, peer.id)
                    await _sync_context_chat(
                        connection,
                        context_type="trip",
                        context_id=trip_id,
                        title="QA поездка",
                        description="QA",
                        owner_user_id=owner.id,
                        member_user_ids=[peer.id],
                    )
                    assert (
                        await connection.scalar(
                            select(chat_members.c.user_id).where(
                                chat_members.c.chat_id == managed_id,
                                chat_members.c.user_id == peer.id,
                            )
                        )
                        is None
                    )
                    assert (
                        await connection.scalar(
                            select(chats.c.deleted_at).where(
                                chats.c.id == managed_id,
                            )
                        )
                        is None
                    )
                    assert (
                        await service.chat_summary(connection, owner, managed_id)
                    ).can_delete is False
                    with pytest.raises(WorkspaceRepositoryError):
                        await service.chat_access(connection, peer, managed_id)

                    key = f"swipe-test:{uuid4()}"
                    event = dict(
                        user_id=owner.id,
                        event_key=key,
                        kind="calendar",
                        priority="normal",
                        title="QA",
                        body="QA",
                        section="calendar",
                        entity_id=None,
                        requires_action=True,
                        occurred_at=datetime.now(UTC),
                    )
                    await _upsert_notification(connection, **event)
                    notification_id = await connection.scalar(
                        select(workspace_notifications.c.id).where(
                            workspace_notifications.c.event_key == key,
                        )
                    )
                    assert notification_id is not None
                    with pytest.raises(WorkspaceRepositoryError):
                        await dismiss_notification(connection, peer, notification_id)
                    await dismiss_notification(connection, owner, notification_id)
                    await dismiss_notification(connection, owner, notification_id)
                    await _upsert_notification(connection, **event)
                    stored = (
                        (
                            await connection.execute(
                                select(workspace_notifications).where(
                                    workspace_notifications.c.id == notification_id,
                                )
                            )
                        )
                        .mappings()
                        .one()
                    )
                    assert stored["dismissed_at"] is not None
                    assert stored["read_at"] is None and stored["resolved_at"] is None
                    assert str(notification_id) not in {
                        item.id
                        for item in (
                            await load_workspace(
                                connection,
                                owner,
                            )
                        ).notifications
                    }
                finally:
                    await transaction.rollback()
        finally:
            await engine.dispose()

    asyncio.run(exercise())
