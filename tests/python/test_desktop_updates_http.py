"""Exercise the desktop release API with an isolated, rollback-only database transaction."""

import json
import os
from collections.abc import AsyncIterator
from pathlib import Path

import pytest
from httpx import ASGITransport, AsyncClient
from pydantic import SecretStr
from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncConnection, create_async_engine

from yuksalish_api.auth import issue_access_token
from yuksalish_api.auth_service import hash_password, login_with_password
from yuksalish_api.database import get_connection
from yuksalish_api.main import create_app
from yuksalish_api.repository import find_active_user_by_username
from yuksalish_api.seed import seed_demo_data
from yuksalish_api.settings import Settings
from yuksalish_api.tables import users


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"


@pytest.mark.anyio
@pytest.mark.postgres
async def test_desktop_update_http_permissions_upload_feed_and_download(tmp_path: Path) -> None:
    database_url = os.environ.get("YUKSALISH_TEST_DATABASE_URL")
    if not database_url:
        pytest.skip("YUKSALISH_TEST_DATABASE_URL is not configured")

    settings = Settings(
        environment="test",
        database_url=database_url,
        auth_signing_key=SecretStr("desktop-update-http-test-signing-key"),
        update_directory=tmp_path,
        update_max_bytes=32,
        seed_demo_data=False,
    )
    engine = create_async_engine(database_url)
    await seed_demo_data(engine)
    app = create_app(settings)
    try:
        async with engine.connect() as connection:
            transaction = await connection.begin()
            try:
                owner = await find_active_user_by_username(connection, "malika")
                admin = await find_active_user_by_username(connection, "baxtiyor")
                assert owner is not None and admin is not None
                await connection.execute(
                    update(users).where(users.c.id == owner["id"]).values(role="superadmin")
                )
                await connection.execute(
                    update(users).where(users.c.id == admin["id"]).values(role="admin")
                )

                async def connection_override() -> AsyncIterator[AsyncConnection]:
                    yield connection

                app.dependency_overrides[get_connection] = connection_override
                owner_auth = {"Authorization": "Bearer " + issue_access_token(
                    owner["id"], settings.auth_signing_key,
                )}
                admin_auth = {"Authorization": "Bearer " + issue_access_token(
                    admin["id"], settings.auth_signing_key,
                )}
                base = "/api/v1/updates"
                payload = b"MZ" + b"small test installer"
                upload_headers = {**owner_auth, "X-Release-Version": "0.30.9",
                                  "Content-Type": "application/octet-stream"}

                async with (
                    app.router.lifespan_context(app),
                    AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client,
                ):
                    assert (await client.get(f"{base}/policy")).status_code == 401
                    policy = await client.get(f"{base}/policy", headers=admin_auth)
                    assert policy.status_code == 200 and policy.json()["release"] is None
                    forbidden = await client.get(f"{base}/releases", headers=admin_auth)
                    assert forbidden.status_code == 403
                    assert (await client.get(f"{base}/feed/latest.yml", headers=owner_auth)
                            ).status_code == 404
                    assert (await client.put(f"{base}/mandatory", headers=owner_auth,
                                             json={"mandatory": True})).status_code == 409
                    assert (await client.post(f"{base}/releases", headers={
                        **admin_auth, "X-Release-Version": "0.30.9",
                        "Content-Type": "application/octet-stream",
                    }, content=payload)).status_code == 403
                    assert (await client.post(f"{base}/releases", headers={
                        **owner_auth, "X-Release-Version": "0.30.9",
                        "Content-Type": "text/plain",
                    }, content=payload)).status_code == 415
                    assert (await client.post(f"{base}/releases", headers={
                        **owner_auth, "X-Release-Version": "bad/version",
                        "Content-Type": "application/octet-stream",
                    }, content=payload)).status_code == 422
                    assert (await client.post(f"{base}/releases", headers=upload_headers,
                                              content=b"MZ" + b"x" * 32)).status_code == 413
                    assert (await client.post(f"{base}/releases", headers=upload_headers,
                                              content=b"not an exe")).status_code == 422
                    assert (await client.get(f"{base}/releases", headers=owner_auth)
                            ).json() == []

                    staged = await client.post(
                        f"{base}/releases", headers=upload_headers, content=payload,
                    )
                    assert staged.status_code == 201
                    assert staged.json()["sizeBytes"] == len(payload)
                    assert len((await client.get(f"{base}/releases", headers=owner_auth)
                                ).json()) == 1
                    assert (await client.post(f"{base}/releases", headers=upload_headers,
                                              content=payload)).status_code == 409
                    assert (await client.post(f"{base}/releases/0.30.9/publish",
                                              headers=admin_auth)).status_code == 403
                    assert (await client.get(f"{base}/feed/{staged.json()['fileName']}",
                                             headers=owner_auth)).status_code == 404

                    published = await client.post(
                        f"{base}/releases/0.30.9/publish", headers=owner_auth,
                    )
                    assert published.status_code == 200
                    assert published.json()["publishedVersion"] == "0.30.9"
                    manifest = await client.get(f"{base}/feed/latest.yml", headers=owner_auth)
                    assert manifest.status_code == 200
                    assert json.loads(manifest.text)["version"] == "0.30.9"
                    downloaded = await client.get(
                        f"{base}/feed/{staged.json()['fileName']}", headers=owner_auth,
                    )
                    assert downloaded.status_code == 200 and downloaded.content == payload
                    assert (await client.get(f"{base}/feed/other.exe", headers=owner_auth)
                            ).status_code == 404
                    assert (await client.post(f"{base}/releases/0.30.9/publish",
                                              headers=owner_auth)).status_code == 409

                    file_path = tmp_path / staged.json()["fileName"]
                    file_path.unlink()
                    assert (await client.get(f"{base}/feed/{staged.json()['fileName']}",
                                             headers=owner_auth)).status_code == 503
                    assert (await client.put(f"{base}/mandatory", headers=owner_auth,
                                             json={"mandatory": True})).status_code == 409
                    file_path.write_bytes(payload)
                    assert (await client.put(f"{base}/mandatory", headers=admin_auth,
                                             json={"mandatory": True})).status_code == 403
                    required = await client.put(
                        f"{base}/mandatory", headers=owner_auth, json={"mandatory": True},
                    )
                    assert required.status_code == 200
                    assert required.json()["minimumVersion"] == "0.30.9"
                    disabled = await client.put(
                        f"{base}/mandatory", headers=owner_auth, json={"mandatory": False},
                    )
                    assert disabled.status_code == 200 and not disabled.json()["mandatory"]

                    # Once the gate is on, an outdated installed client may still reach
                    # the update feed, but may not continue using normal workspace APIs.
                    reenabled = await client.put(
                        f"{base}/mandatory", headers=owner_auth, json={"mandatory": True},
                    )
                    assert reenabled.status_code == 200
                    password = "Disposable-HTTP-Update-Test-2026!"
                    await connection.execute(
                        update(users).where(users.c.id == admin["id"]).values(
                            password_hash=hash_password(password),
                            failed_login_count=0,
                            locked_until=None,
                        )
                    )
                    production_settings = settings.model_copy(update={"environment": "production"})
                    session = await login_with_password(
                        connection, "baxtiyor", password, None, "Update test", production_settings,
                    )
                    app.state.settings = production_settings
                    installed_auth = {"Authorization": f"Bearer {session.access_token}"}
                    blocked = await client.get("/api/v1/auth/me", headers={
                        **installed_auth, "X-Desktop-Version": "0.30.8",
                    })
                    assert blocked.status_code == 426
                    assert (await client.get(f"{base}/policy", headers=installed_auth)
                            ).status_code == 200
                    assert (await client.get(f"{base}/feed/latest.yml", headers=installed_auth)
                            ).status_code == 200
                    current = await client.get("/api/v1/auth/me", headers={
                        **installed_auth, "X-Desktop-Version": "0.30.9",
                    })
                    assert current.status_code == 200
            finally:
                await transaction.rollback()
    finally:
        await engine.dispose()
