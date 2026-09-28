# ruff: noqa: RUF001 - Russian test messages are intentional.
"""Birthday and assistant routes against a dedicated yuksalish_test* database."""

import asyncio
import os
from datetime import date
from uuid import UUID

import pytest
from httpx import ASGITransport, AsyncClient
from pydantic import SecretStr
from sqlalchemy import delete, func, select
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import create_async_engine

from yuksalish_api.birthday_service import materialize_birthdays
from yuksalish_api.main import create_app
from yuksalish_api.settings import Settings
from yuksalish_api.tables import assistant_messages, feed_posts, workspace_notifications


async def exercise(url: str, monkeypatch: pytest.MonkeyPatch) -> None:
    assert (make_url(url).database or "").startswith("yuksalish_test")
    settings = Settings(
        environment="test", database_url=url, seed_demo_data=True,
        demo_password=SecretStr("Yuksalish-Local-2026!"),
        auth_signing_key=SecretStr("assistant-birthday-integration-signing-key"),
        gemini_api_key=SecretStr(""),
    )
    app = create_app(settings)
    async with (
        app.router.lifespan_context(app),
        AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client,
    ):
        async def login(username: str) -> dict[str, str]:
            result = await client.post("/api/v1/auth/login", json={
                "username": username, "password": "Yuksalish-Local-2026!", "deviceLabel": "test",
            })
            assert result.status_code == 200, result.text
            return {"Authorization": f"Bearer {result.json()['accessToken']}"}

        owner, colleague = await login("malika"), await login("baxtiyor")
        owner_bootstrap = (await client.get("/api/v1/workspace/bootstrap", headers=owner)).json()
        owner_id = UUID(owner_bootstrap["currentUser"]["id"])
        colleague_id = UUID(next(
            item["id"] for item in owner_bootstrap["people"] if item["username"] == "baxtiyor"
        ))
        cleared = await client.put(
            "/api/v1/assistant/birthday", headers=owner, json={"month": None, "day": None}
        )
        assert cleared.status_code == 200, cleared.text
        assert (await client.get("/api/v1/assistant/birthday", headers=owner)).json() == {
            "month": None, "day": None,
        }
        invalid = await client.put(
            "/api/v1/assistant/birthday", headers=owner, json={"month": 2, "day": 30}
        )
        assert invalid.status_code == 422
        saved = await client.put(
            "/api/v1/assistant/birthday", headers=owner, json={"month": 4, "day": 12}
        )
        assert saved.status_code == 200, saved.text
        assert saved.json() == {"month": 4, "day": 12}
        assert (await client.get("/api/v1/assistant/birthday", headers=colleague)).json() == {
            "month": None, "day": None,
        }

        engine = create_async_engine(url)
        try:
            async with engine.begin() as connection:
                await materialize_birthdays(connection, date(2027, 4, 12))
                await materialize_birthdays(connection, date(2027, 4, 12))
                posts = (
                    await connection.execute(select(feed_posts).where(
                        feed_posts.c.birthday_user_id == owner_id,
                        feed_posts.c.birthday_year == 2027,
                    ))
                ).mappings().all()
                assert len(posts) == 1
                post_id = posts[0]["id"]
                assert posts[0]["author_user_id"] is None
                assert await connection.scalar(select(func.count()).select_from(
                    workspace_notifications
                ).where(
                    workspace_notifications.c.user_id == colleague_id,
                    workspace_notifications.c.event_key == f"birthday:{owner_id}:2027",
                )) == 1
                assert await connection.scalar(select(func.count()).select_from(
                    workspace_notifications
                ).where(
                    workspace_notifications.c.user_id == owner_id,
                    workspace_notifications.c.event_key == f"birthday:{owner_id}:2027",
                )) == 0
        finally:
            await engine.dispose()

        feed = (await client.get("/api/v1/workspace/bootstrap", headers=colleague)).json()
        birthday_post = next(item for item in feed["feedPosts"] if item["id"] == str(post_id))
        assert birthday_post["systemKind"] == "birthday"
        assert birthday_post["canDelete"] is False
        assert birthday_post["birthdayUserId"] == str(owner_id)
        denied = await client.post(
            "/api/v1/assistant/birthday-greeting", headers=owner,
            json={"post_id": str(post_id), "language": "ru"},
        )
        assert denied.status_code == 403
        no_key = await client.post(
            "/api/v1/assistant/birthday-greeting", headers=colleague,
            json={"post_id": str(post_id), "language": "uz_latn"},
        )
        assert no_key.status_code == 503
        ask = await client.post(
            "/api/v1/assistant/messages", headers=colleague,
            json={"model": "flash", "message": "Какие у меня задачи?"},
        )
        assert ask.status_code == 503
        assert (await client.get("/api/v1/assistant/messages", headers=colleague)).json() == []

        sent_context: list[str] = []

        async def fake_gemini(
            _key: str, _model: str, system_text: str, _contents: list[dict[str, object]],
        ) -> str:
            sent_context.append(system_text)
            return "Короткий тестовый ответ"

        monkeypatch.setattr("yuksalish_api.assistant_service.generate_text", fake_gemini)
        monkeypatch.setattr("yuksalish_api.routers.assistant.generate_text", fake_gemini)
        settings.gemini_api_key = SecretStr("test-only-key")
        answer = await client.post(
            "/api/v1/assistant/messages", headers=colleague,
            json={"model": "flash", "message": "Расскажи о моих задачах и проектах"},
        )
        assert answer.status_code == 200, answer.text
        assert answer.json()["content"] == "Короткий тестовый ответ"
        assert "Доступные сотруднику задачи" in sent_context[0]
        assert "Доступные сотруднику проекты" in sent_context[0]
        assert len((await client.get("/api/v1/assistant/messages", headers=colleague)).json()) == 2
        assert (await client.get("/api/v1/assistant/messages", headers=owner)).json() == []
        greeting = await client.post(
            "/api/v1/assistant/birthday-greeting", headers=colleague,
            json={"post_id": str(post_id), "language": "uz_latn"},
        )
        assert greeting.status_code == 200, greeting.text
        assert greeting.json()["text"] == "Короткий тестовый ответ"

        cleanup_engine = create_async_engine(url)
        try:
            async with cleanup_engine.begin() as connection:
                await connection.execute(delete(assistant_messages).where(
                    assistant_messages.c.user_id == colleague_id
                ))
                await connection.execute(delete(workspace_notifications).where(
                    workspace_notifications.c.event_key == f"birthday:{owner_id}:2027"
                ))
                await connection.execute(delete(feed_posts).where(
                    feed_posts.c.birthday_user_id == owner_id,
                    feed_posts.c.birthday_year == 2027,
                ))
        finally:
            await cleanup_engine.dispose()
        await client.put(
            "/api/v1/assistant/birthday", headers=owner, json={"month": None, "day": None}
        )


def test_assistant_birthdays_postgres(monkeypatch: pytest.MonkeyPatch) -> None:
    url = os.getenv("YUKSALISH_TEST_DATABASE_URL")
    if not url:
        pytest.skip("YUKSALISH_TEST_DATABASE_URL is not configured")
    asyncio.run(exercise(url, monkeypatch))
