import os

import pytest
from httpx import ASGITransport, AsyncClient
from pydantic import SecretStr

from yuksalish_api.main import create_app
from yuksalish_api.settings import Settings


@pytest.mark.anyio
@pytest.mark.postgres
async def test_web_cookie_session_rotation_csrf_and_logout() -> None:
    database_url = os.environ.get("YUKSALISH_TEST_DATABASE_URL")
    if not database_url:
        pytest.skip("YUKSALISH_TEST_DATABASE_URL is not configured")
    password = "Yuksalish-Local-2026!"
    origin = "https://workspace.test"
    settings = Settings(
        environment="test",
        database_url=database_url,
        auth_signing_key=SecretStr("web-session-integration-signing-key"),
        auth_encryption_key=SecretStr("web-session-integration-encryption-key"),
        demo_password=SecretStr(password),
        seed_demo_data=True,
        cors_origins=[origin],
    )
    app = create_app(settings)
    common_headers = {"Origin": origin, "Sec-Fetch-Site": "same-origin"}

    async with (
        app.router.lifespan_context(app),
        AsyncClient(
            transport=ASGITransport(app=app),
            base_url=origin,
        ) as client,
    ):
        rejected_origin = await client.post(
            "/api/v1/auth/web/login",
            headers={"Origin": "https://attacker.test"},
            json={"username": "malika", "password": password},
        )
        assert rejected_origin.status_code == 403

        rejected_cross_site = await client.post(
            "/api/v1/auth/web/login",
            headers={"Origin": origin, "Sec-Fetch-Site": "cross-site"},
            json={"username": "malika", "password": password},
        )
        assert rejected_cross_site.status_code == 403

        login = await client.post(
            "/api/v1/auth/web/login",
            headers=common_headers,
            json={
                "username": "malika",
                "password": password,
                "deviceLabel": "Web integration",
            },
        )
        assert login.status_code == 200
        session = login.json()
        assert "refreshToken" not in session
        assert session["csrfToken"]
        cookies = login.headers.get_list("set-cookie")
        assert any(
            "__Host-yuksalish_refresh=" in value and "HttpOnly" in value
            for value in cookies
        )
        assert any(
            "__Host-yuksalish_csrf=" in value and "HttpOnly" not in value
            for value in cookies
        )

        token_headers = {
            **common_headers,
            "Authorization": f"Bearer {session['accessToken']}",
        }
        workspace = await client.get("/api/v1/workspace/bootstrap", headers=token_headers)
        assert workspace.status_code == 200

        missing_csrf = await client.post(
            "/api/v1/notifications/read-all",
            headers=token_headers,
        )
        assert missing_csrf.status_code == 403

        refreshed = await client.post(
            "/api/v1/auth/web/refresh",
            headers={**common_headers, "X-CSRF-Token": session["csrfToken"]},
        )
        assert refreshed.status_code == 200
        rotated = refreshed.json()
        assert rotated["csrfToken"] != session["csrfToken"]
        assert "refreshToken" not in rotated
        rotated_refresh_cookie = client.cookies.get("__Host-yuksalish_refresh")
        assert rotated_refresh_cookie

        refreshed_workspace = await client.get(
            "/api/v1/workspace/bootstrap",
            headers={
                **common_headers,
                "Authorization": f"Bearer {rotated['accessToken']}",
            },
        )
        assert refreshed_workspace.status_code == 200

        logout = await client.post(
            "/api/v1/auth/web/logout",
            headers={
                **common_headers,
                "Authorization": f"Bearer {rotated['accessToken']}",
                "X-CSRF-Token": rotated["csrfToken"],
            },
        )
        assert logout.status_code == 204
        cleared_cookies = logout.headers.get("set-cookie", "")
        assert "__Host-yuksalish_refresh=" in cleared_cookies
        assert "Max-Age=0" in cleared_cookies
        assert "SameSite=strict" in cleared_cookies

        client.cookies.set(
            "__Host-yuksalish_refresh",
            rotated_refresh_cookie,
            domain="workspace.test",
            path="/",
        )
        client.cookies.set(
            "__Host-yuksalish_csrf",
            rotated["csrfToken"],
            domain="workspace.test",
            path="/",
        )
        revoked_refresh = await client.post(
            "/api/v1/auth/web/refresh",
            headers={**common_headers, "X-CSRF-Token": rotated["csrfToken"]},
        )
        assert revoked_refresh.status_code == 401
        assert "Max-Age=0" in revoked_refresh.headers.get("set-cookie", "")

        after_logout = await client.post(
            "/api/v1/auth/web/refresh",
            headers={**common_headers, "X-CSRF-Token": rotated["csrfToken"]},
        )
        assert after_logout.status_code == 401

        # Existing Electron clients keep the body-token contract and do not receive cookies.
        desktop = await client.post(
            "/api/v1/auth/login",
            json={
                "username": "malika",
                "password": password,
                "deviceLabel": "Electron compatibility",
            },
        )
        assert desktop.status_code == 200
        assert desktop.json()["refreshToken"]
        assert "__Host-yuksalish_refresh" not in desktop.headers.get("set-cookie", "")

        desktop_web_logout = await client.post(
            "/api/v1/auth/web/logout",
            headers={"Authorization": f"Bearer {desktop.json()['accessToken']}"},
        )
        assert desktop_web_logout.status_code == 403
