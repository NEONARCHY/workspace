import asyncio
import os
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock
from uuid import uuid4

import pytest
from httpx import ASGITransport, AsyncClient
from pydantic import SecretStr, ValidationError
from sqlalchemy import delete
from sqlalchemy.dialects import postgresql
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import create_async_engine

from yuksalish_api import release_read_service
from yuksalish_api.auth import AuthenticatedUser
from yuksalish_api.main import create_app
from yuksalish_api.release_read_schemas import ReleaseReadInput
from yuksalish_api.seed import demo_uuid
from yuksalish_api.settings import Settings
from yuksalish_api.tables import release_read_entries


@pytest.mark.parametrize("payload", [
    {"entryIds": []}, {"entryIds": ["update:a", "update:a"]},
    {"entryIds": ["not-an-entry"]}, {"entryIds": ["update:../private"]},
    {"entryIds": ["update:a"], "userId": str(uuid4())},
    {"entryIds": [f"update:{i}" for i in range(2001)]},
    {"entryIds": ["update:" + "a" * 220]},
])
def test_release_receipts_reject_invalid_or_cross_account_input(payload):
    with pytest.raises(ValidationError):
        ReleaseReadInput.model_validate(payload)


def test_reads_are_scoped_to_authenticated_account_and_never_write():
    user = AuthenticatedUser(uuid4(), "reader", "Reader", None, None, "employee")
    result = Mock()
    result.scalars.return_value.all.return_value = ["update:one"]
    connection = SimpleNamespace(execute=AsyncMock(return_value=result))
    state = asyncio.run(release_read_service.load_reads(connection, user))
    assert state.read_entry_ids == ["update:one"]
    statement = connection.execute.await_args.args[0]
    assert statement.is_select
    assert user.id in statement.compile().params.values()
    connection.execute.assert_awaited_once()


def test_acknowledgements_are_an_additive_idempotent_union():
    user = AuthenticatedUser(uuid4(), "reader", "Reader", None, None, "employee")
    result = Mock()
    result.scalars.return_value.all.return_value = ["release:2.0.0", "update:one"]
    connection = SimpleNamespace(execute=AsyncMock(return_value=result))
    payload = ReleaseReadInput(entry_ids=["update:one"])
    state = asyncio.run(release_read_service.acknowledge_reads(connection, user, payload))
    assert state.read_entry_ids == ["release:2.0.0", "update:one"]
    compiled = connection.execute.await_args_list[0].args[0].compile(
        dialect=postgresql.dialect(),
    )
    assert "ON CONFLICT (user_id, entry_id) DO NOTHING" in str(compiled)
    assert user.id in compiled.params.values()
    assert "update:one" in compiled.params.values()


@pytest.mark.postgres
def test_release_history_http_account_isolation_and_concurrent_devices():
    url = os.environ.get("YUKSALISH_TEST_DATABASE_URL")
    if not url:
        pytest.skip("YUKSALISH_TEST_DATABASE_URL is not configured")
    assert (make_url(url).database or "").startswith("yuksalish_test")
    asyncio.run(exercise_release_history(url))


async def exercise_release_history(url: str) -> None:
    settings = Settings(
        environment="test", database_url=url, seed_demo_data=True,
        demo_password=SecretStr("Yuksalish-Local-2026!"),
        auth_signing_key=SecretStr("release-history-test-signing-key-only"),
    )
    app = create_app(settings)
    async with (
        app.router.lifespan_context(app),
        AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client,
    ):
        async def login(username: str) -> dict[str, str]:
            response = await client.post("/api/v1/auth/login", json={
                "username": username, "password": "Yuksalish-Local-2026!",
                "deviceLabel": "release-history-test",
            })
            assert response.status_code == 200, response.text
            return {"Authorization": f"Bearer {response.json()['accessToken']}"}

        owner, second_device, peer, admin = (
            await login("dilshod"), await login("dilshod"),
            await login("baxtiyor"), await login("malika"),
        )
        engine = create_async_engine(url)
        async with engine.begin() as connection:
            await connection.execute(delete(release_read_entries).where(
                release_read_entries.c.user_id.in_([
                    demo_uuid(f"user/{name}") for name in ("dilshod", "baxtiyor", "malika")
                ]),
            ))
        await engine.dispose()
        base = "/api/v1/personal-preferences/release-history"
        assert (await client.get(base)).status_code == 401
        assert (await client.post(base, json={"entryIds": ["update:a"]})).status_code == 401
        for headers in (owner, second_device, peer, admin):
            response = await client.get(base, headers=headers)
            assert response.status_code == 200, response.text
            assert response.json() == {"readEntryIds": []}

        before = (await client.get("/api/v1/personal-preferences", headers=owner)).json()
        responses = await asyncio.gather(
            client.post(base, headers=owner, json={"entryIds": ["update:new"]}),
            client.post(base, headers=second_device, json={"entryIds": ["update:old"]}),
        )
        assert all(response.status_code == 200 for response in responses)
        expected = {"readEntryIds": ["update:new", "update:old"]}
        assert (await client.get(base, headers=second_device)).json() == expected
        repeated = await client.post(base, headers=owner, json={"entryIds": ["update:old"]})
        assert repeated.json() == expected
        # An older device cannot replace or clear the receipt union.
        assert (await client.post(base, headers=owner, json={"entryIds": []})).status_code == 422
        assert (await client.get(base, headers=owner)).json() == expected
        for headers in (peer, admin):
            assert (await client.get(base, headers=headers)).json() == {"readEntryIds": []}
        forbidden = await client.post(base, headers=admin, json={
            "entryIds": ["update:other"], "userId": str(uuid4()),
        })
        assert forbidden.status_code == 422
        assert (await client.get("/api/v1/personal-preferences", headers=owner)).json() == before
        # A new login reads persisted state, rather than any browser-local flag.
        fresh_device = await login("dilshod")
        assert (await client.get(base, headers=fresh_device)).json() == expected
