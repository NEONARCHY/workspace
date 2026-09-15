import asyncio
import os
from uuid import uuid4

import pytest
from httpx import ASGITransport, AsyncClient
from pydantic import SecretStr, ValidationError
from sqlalchemy import delete
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import create_async_engine

from yuksalish_api.events import WorkspaceEventBus
from yuksalish_api.main import create_app
from yuksalish_api.settings import Settings
from yuksalish_api.tables import personal_preferences
from yuksalish_api.workspace_schemas import (
    DEFAULT_NAVIGATION,
    NavigationOrder,
    PersonalChatAction,
    PinnedChatOrder,
)


def test_personal_payloads_reject_unknown_fields_duplicates_and_missing_modules() -> None:
    same = uuid4()
    for payload in ({"chatIds": [same, same], "revision": 0}, {"chatIds": [], "revision": -1}):
        with pytest.raises(ValidationError):
            PinnedChatOrder.model_validate(payload)
    for order in (DEFAULT_NAVIGATION[:-1], ["crm"] * 11, [*DEFAULT_NAVIGATION[:-1], "other"]):
        with pytest.raises(ValidationError):
            NavigationOrder.model_validate({"order": order, "revision": 0})
    with pytest.raises(ValidationError):
        PersonalChatAction.model_validate({"action": "archive", "userId": str(uuid4())})


async def exercise_personal_preferences(url: str) -> None:
    # Permit an isolated per-run database while still refusing the live database.
    assert (make_url(url).database or "").startswith("yuksalish_test")
    settings = Settings(
        environment="test",
        database_url=url,
        seed_demo_data=True,
        auth_signing_key=SecretStr("personal-preferences-test-signing-key"),
    )
    app = create_app(settings)
    async with (
        app.router.lifespan_context(app),
        AsyncClient(
            transport=ASGITransport(app=app),
            base_url="http://test",
        ) as client,
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

        owner, peer, admin = await login("dilshod"), await login("baxtiyor"), await login("malika")
        bootstrap = (await client.get("/api/v1/workspace/bootstrap", headers=owner)).json()
        owner_id = bootstrap["currentUser"]["id"]
        peer_id = next(
            person["id"] for person in bootstrap["people"] if person["username"] == "baxtiyor"
        )
        engine = create_async_engine(url)
        async with engine.begin() as connection:
            await connection.execute(
                delete(personal_preferences).where(
                    personal_preferences.c.user_id.in_([owner_id, peer_id]),
                )
            )
        await engine.dispose()
        base = "/api/v1/personal-preferences"
        assert (await client.get(base)).status_code == 401
        assert (await client.get(base, headers=owner)).json()[
            "navigationOrder"
        ] == DEFAULT_NAVIGATION
        chats = []
        for title in ("Personal organization A", "Personal organization B"):
            created = await client.post(
                "/api/v1/chats",
                headers=owner,
                json={
                    "kind": "group",
                    "title": title,
                    "memberIds": [peer_id],
                },
            )
            assert created.status_code == 201, created.text
            chats.append(created.json()["id"])

        async def action(chat_id: str, name: str, headers: dict[str, str] = owner) -> dict:
            response = await client.patch(
                f"{base}/chats/{chat_id}", headers=headers, json={"action": name}
            )
            assert response.status_code == 200, response.text
            return response.json()

        first = await action(chats[0], "pin")
        second = await action(chats[1], "pin")
        assert second["pinnedChatIds"] == list(reversed(chats))
        assert (await client.get(base, headers=peer)).json()["pinnedChatIds"] == []
        assert (
            await client.patch(f"{base}/chats/{chats[0]}", headers=admin, json={"action": "pin"})
        ).status_code == 404
        assert (
            await client.patch(f"{base}/chats/{uuid4()}", headers=owner, json={"action": "archive"})
        ).status_code == 404
        assert (
            await client.put(
                f"{base}/pinned-chats",
                headers=owner,
                json={"chatIds": chats, "revision": first["revision"]},
            )
        ).status_code == 409
        assert (
            await client.put(
                f"{base}/pinned-chats",
                headers=owner,
                json={"chatIds": [str(uuid4())], "revision": second["revision"]},
            )
        ).status_code == 409
        reordered = await client.put(
            f"{base}/pinned-chats",
            headers=owner,
            json={"chatIds": chats, "revision": second["revision"]},
        )
        assert reordered.status_code == 200
        assert reordered.json()["pinnedChatIds"] == chats
        archived = await action(chats[0], "archive")
        assert archived["pinnedChatIds"] == [chats[1]] and archived["archivedChatIds"] == [chats[0]]
        # Repeated actions do not duplicate entries; new content leaves chats archived.
        assert (await action(chats[0], "archive"))["archivedChatIds"] == [chats[0]]
        sent = await client.post(
            f"/api/v1/chats/{chats[0]}/messages",
            headers=peer,
            json={"body": "Archive keeps content"},
        )
        assert sent.status_code == 201, sent.text
        after = (await client.get("/api/v1/workspace/bootstrap", headers=owner)).json()
        assert chats[0] in [chat["id"] for chat in after["chats"]]
        assert after["personalPreferences"]["archivedChatIds"] == [chats[0]]
        assert any(message["body"] == "Archive keeps content" for message in after["messages"])
        assert (
            await client.patch(f"{base}/chats/{chats[0]}", headers=owner, json={"action": "pin"})
        ).status_code == 409
        restored = await action(chats[0], "unarchive")
        assert restored["archivedChatIds"] == [] and chats[0] not in restored["pinnedChatIds"]
        nav = await client.put(
            f"{base}/navigation",
            headers=owner,
            json={"order": DEFAULT_NAVIGATION[::-1], "revision": restored["revision"]},
        )
        assert nav.status_code == 200, nav.text
        assert (await client.get(base, headers=await login("dilshod"))).json() == nav.json()
        assert (await client.get(base, headers=peer)).json()[
            "navigationOrder"
        ] == DEFAULT_NAVIGATION
        await action(chats[1], "unpin")
        await asyncio.gather(action(chats[0], "pin"), action(chats[1], "pin"))
        assert set((await client.get(base, headers=owner)).json()["pinnedChatIds"]) == set(chats)
        # Membership deletion must hide stale personal IDs as well as chat content.
        await action(chats[0], "archive", peer)
        removed = await client.delete(f"/api/v1/chats/{chats[0]}/members/{peer_id}", headers=owner)
        assert removed.status_code == 204
        assert (await client.get(base, headers=peer)).json()["archivedChatIds"] == []


@pytest.mark.postgres
def test_personal_preferences_http_persistence_isolation_and_concurrency() -> None:
    url = os.environ.get("YUKSALISH_TEST_DATABASE_URL")
    if not url:
        pytest.skip("YUKSALISH_TEST_DATABASE_URL is not configured")
    asyncio.run(exercise_personal_preferences(url))


def test_personal_event_goes_only_to_owners_connections() -> None:
    class Socket:
        def __init__(self) -> None:
            self.events: list[dict] = []

        async def send_json(self, event: dict) -> None:
            self.events.append(event)

    async def exercise() -> None:
        bus = WorkspaceEventBus()
        owner_id, peer_id = uuid4(), uuid4()
        first, second, peer = Socket(), Socket(), Socket()
        await bus.connect(owner_id, first)  # type: ignore[arg-type]
        await bus.connect(owner_id, second)  # type: ignore[arg-type]
        await bus.connect(peer_id, peer)  # type: ignore[arg-type]
        await bus.publish({"type": "personal.preferences"}, recipient_id=owner_id)
        assert len(first.events) == len(second.events) == 1 and peer.events == []

    asyncio.run(exercise())
