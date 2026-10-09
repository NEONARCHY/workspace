"""Private conversations against an explicitly configured disposable PostgreSQL database."""

import asyncio
import os
from datetime import UTC, datetime
from uuid import UUID, uuid4

import pytest
from httpx import ASGITransport, AsyncClient
from pydantic import SecretStr
from sqlalchemy import delete, select
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import create_async_engine

from yuksalish_api.main import create_app
from yuksalish_api.settings import Settings
from yuksalish_api.tables import assistant_chats, assistant_messages


async def exercise(url: str) -> None:
    assert (make_url(url).database or "").startswith("yuksalish_test")
    app = create_app(
        Settings(
            environment="test",
            database_url=url,
            seed_demo_data=True,
            demo_password=SecretStr("Yuksalish-Local-2026!"),
            auth_signing_key=SecretStr("assistant-chat-integration-signing-key"),
        )
    )
    engine = create_async_engine(url)
    created_ids: list[UUID] = []
    created_message_ids: list[UUID] = []
    legacy_message = uuid4()
    try:
        async with (
            app.router.lifespan_context(app),
            AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client,
        ):

            async def login(username: str) -> dict[str, str]:
                result = await client.post(
                    "/api/v1/auth/login",
                    json={
                        "username": username,
                        "password": "Yuksalish-Local-2026!",
                        "deviceLabel": "test",
                    },
                )
                assert result.status_code == 200, result.text
                return {"Authorization": f"Bearer {result.json()['accessToken']}"}

            owner, other = await login("malika"), await login("baxtiyor")
            bootstrap = (await client.get("/api/v1/workspace/bootstrap", headers=owner)).json()
            owner_id = UUID(bootstrap["currentUser"]["id"])
            async with engine.begin() as connection:
                await connection.execute(
                    assistant_messages.insert().values(
                        id=legacy_message,
                        user_id=owner_id,
                        role="user",
                        model="flash-lite",
                        content="Legacy test conversation",
                        created_at=datetime.now(UTC),
                    )
                )
            first_list = (await client.get("/api/v1/assistant/chats", headers=owner)).json()
            second_list = (await client.get("/api/v1/assistant/chats", headers=owner)).json()
            defaults = [chat for chat in first_list if chat["isDefault"]]
            assert len(defaults) == 1
            assert defaults == [chat for chat in second_list if chat["isDefault"]]
            for _ in range(2):
                response = await client.post("/api/v1/assistant/chats", headers=owner)
                assert response.status_code == 200, response.text
                created_ids.append(UUID(response.json()["id"]))
            async with engine.begin() as connection:
                for index, chat_id in enumerate(created_ids):
                    message_id = uuid4()
                    created_message_ids.append(message_id)
                    await connection.execute(
                        assistant_messages.insert().values(
                            id=message_id,
                            user_id=owner_id,
                            chat_id=chat_id,
                            role="user",
                            model="flash-lite",
                            content=f"Test chat {index}",
                            references=[{
                                "label": "Temporary reference",
                                "section": "tasks",
                                "entityId": None,
                            }],
                            created_at=datetime.now(UTC),
                        )
                    )
            for index, chat_id in enumerate(created_ids):
                response = await client.get(
                    f"/api/v1/assistant/messages?chat_id={chat_id}",
                    headers=owner,
                )
                assert [message["content"] for message in response.json()] == [f"Test chat {index}"]
                assert (
                    await client.delete(
                        f"/api/v1/assistant/chats/{chat_id}/messages",
                        headers=other,
                    )
                ).status_code == 404
            cleared = await client.delete(
                f"/api/v1/assistant/chats/{created_ids[0]}/messages",
                headers=owner,
            )
            assert cleared.status_code == 204
            assert (
                await client.get(
                    f"/api/v1/assistant/messages?chat_id={created_ids[0]}",
                    headers=owner,
                )
            ).json() == []
            assert (
                len(
                    (
                        await client.get(
                            f"/api/v1/assistant/messages?chat_id={created_ids[1]}",
                            headers=owner,
                        )
                    ).json()
                )
                == 1
            )
            legacy = (
                await client.get(
                    f"/api/v1/assistant/messages?chat_id={defaults[0]['id']}",
                    headers=owner,
                )
            ).json()
            assert any(message["id"] == str(legacy_message) for message in legacy)
            async with engine.begin() as connection:
                row = (
                    (
                        await connection.execute(
                            select(assistant_messages).where(
                                assistant_messages.c.chat_id == created_ids[0],
                            )
                        )
                    )
                    .mappings()
                    .one()
                )
                assert row["content"] == "" and row["references"] is None
                assert row["cleared_at"] is not None and row["created_at"] is not None
                request_time = row["created_at"]
            pinned = await client.patch(
                f"/api/v1/assistant/chats/{created_ids[1]}/pin",
                json={"pinned": True}, headers=owner,
            )
            assert pinned.status_code == 200, pinned.text
            assert pinned.json()[0]["id"] == str(created_ids[1])
            reloaded = (await client.get("/api/v1/assistant/chats", headers=owner)).json()
            assert reloaded[0]["isPinned"] is True
            assert (await client.patch(
                f"/api/v1/assistant/chats/{created_ids[1]}/pin",
                json={"pinned": False}, headers=other,
            )).status_code == 404
            assert (await client.delete(
                f"/api/v1/assistant/chats/{created_ids[0]}", headers=other,
            )).status_code == 404
            removed = await client.delete(
                f"/api/v1/assistant/chats/{created_ids[0]}", headers=owner,
            )
            assert removed.status_code == 200, removed.text
            for available in [removed.json(), (
                await client.get("/api/v1/assistant/chats", headers=owner)
            ).json()]:
                assert str(created_ids[0]) not in [chat["id"] for chat in available]
                assert defaults[0]["id"] in [chat["id"] for chat in available]
            assert (await client.get(
                f"/api/v1/assistant/messages?chat_id={created_ids[0]}", headers=owner,
            )).status_code == 404
            async with engine.begin() as connection:
                retained = (await connection.execute(select(assistant_messages).where(
                    assistant_messages.c.id == created_message_ids[0],
                ))).mappings().one()
                assert retained["chat_id"] is None and retained["content"] == ""
                assert retained["references"] is None and retained["created_at"] == request_time
    finally:
        async with engine.begin() as connection:
            await connection.execute(
                delete(assistant_messages).where(
                    assistant_messages.c.id.in_([legacy_message, *created_message_ids]),
                )
            )
            if created_ids:
                await connection.execute(
                    delete(assistant_chats).where(
                        assistant_chats.c.id.in_(created_ids),
                    )
                )
        await engine.dispose()


def test_private_chat_persistence_legacy_history_and_clear() -> None:
    url = os.getenv("YUKSALISH_TEST_DATABASE_URL", "")
    if not url:
        pytest.skip("YUKSALISH_TEST_DATABASE_URL is not configured")
    if not (make_url(url).database or "").startswith("yuksalish_test"):
        pytest.skip("Only a dedicated yuksalish_test database is allowed")
    asyncio.run(exercise(url))
