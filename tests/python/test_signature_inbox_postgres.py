"""Personal signature queue: real HTTP, rights, pagination and reviewer handoff."""

import os
from datetime import UTC, datetime
from uuid import uuid4

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import delete, insert, update
from sqlalchemy.ext.asyncio import create_async_engine

from test_zoom_postgres import zoom_settings
from yuksalish_api.auth import issue_access_token
from yuksalish_api.main import create_app
from yuksalish_api.tables import ai_referent_letters, module_access_rules, users


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.mark.anyio
@pytest.mark.postgres
async def test_signature_inbox_scopes_counts_and_current_reviewer():
    database_url = os.environ.get("YUKSALISH_TEST_DATABASE_URL")
    if not database_url:
        pytest.skip("YUKSALISH_TEST_DATABASE_URL is not configured")
    settings = zoom_settings(database_url)
    settings.seed_demo_data = False
    app = create_app(settings)
    engine = create_async_engine(database_url)
    ids = {name: uuid4() for name in ("admin", "reviewer", "author", "readonly", "denied")}
    now = datetime.now(UTC)
    rows = []

    def add(reviewer, status="pending_review", kind="delivery", final=None):
        letter_id = uuid4()
        rows.append({
            "id": letter_id, "subject": "QA signature inbox", "recipient_organization": "QA",
            "recipient_address": "qa@example.test", "route": "exat", "note": "",
            "status": status, "workflow_kind": kind, "source": "workspace",
            "created_by_user_id": ids["author"], "reviewer_user_id": ids[reviewer],
            "initial_reviewer_user_id": ids[reviewer],
            "final_reviewer_user_id": ids[final] if final else None,
            "revision": 1, "created_at": now, "updated_at": now,
        })
        return letter_id

    expected = {add("admin", kind="sign_only" if i % 2 else "delivery") for i in range(25)}
    handoff = add("reviewer", final="admin")
    add("reviewer", kind="sign_only")
    for status in ("draft", "needs_revision", "queued", "awaiting_final_send", "failed", "sent"):
        add("admin", status=status)
    add("admin", status="signed", kind="sign_only")
    add("readonly")
    add("denied")

    try:
        async with engine.begin() as connection:
            await connection.execute(insert(users), [{
                "id": uid, "username": f"signature-{uid.hex[:20]}", "full_name": f"QA {name}",
                "job_title": "QA", "role": "admin" if name == "admin" else "employee",
                "status": "active", "created_at": now, "updated_at": now,
            } for name, uid in ids.items()])
            await connection.execute(insert(module_access_rules), [{
                "id": uuid4(), "subject_type": "user", "subject_key": str(ids[name]),
                "module_key": "ai_referent", "permissions": {
                    "view": name != "denied", "approve": name == "reviewer",
                    "create": False, "edit": False, "admin": False,
                }, "created_at": now, "updated_at": now,
            } for name in ("reviewer", "author", "readonly", "denied")])
            await connection.execute(insert(ai_referent_letters), rows)

        def headers(name):
            token = issue_access_token(ids[name], settings.auth_signing_key)
            return {"Authorization": f"Bearer {token}"}

        endpoint = "/api/v1/ai-referent/signature-inbox"
        async with (
            app.router.lifespan_context(app),
            AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client,
        ):
            first = await client.get(endpoint, headers=headers("admin"))
            assert first.status_code == 200, first.text
            assert "no-store" in first.headers["cache-control"]
            data = first.json()
            assert data["totalCount"] == data["pendingReviewCount"] == 25
            assert len(data["letters"]) == 20
            assert all("approve" in row["availableActions"] for row in data["letters"])
            second = await client.get(endpoint, params={"offset": 20}, headers=headers("admin"))
            assert second.status_code == 200, second.text
            assert second.json()["totalCount"] == 25
            assert len(second.json()["letters"]) == 5
            found = {row["id"] for row in data["letters"] + second.json()["letters"]}
            assert found == {str(uid) for uid in expected}
            reviewer = await client.get(endpoint, headers=headers("reviewer"))
            assert reviewer.status_code == 200, reviewer.text
            assert reviewer.json()["totalCount"] == 2
            for name in ("author", "readonly"):
                empty = await client.get(endpoint, headers=headers(name))
                assert empty.status_code == 200, empty.text
                assert empty.json()["totalCount"] == 0
                assert empty.json()["letters"] == []
            assert (await client.get(endpoint, headers=headers("denied"))).status_code == 403
            assert (await client.get(endpoint)).status_code == 401
            assert (await client.get(
                endpoint, params={"offset": -1}, headers=headers("admin")
            )).status_code == 422

            # A second-stage signer must not see the letter before the handoff.
            async with engine.begin() as connection:
                await connection.execute(update(ai_referent_letters).where(
                    ai_referent_letters.c.id == handoff,
                ).values(reviewer_user_id=ids["admin"]))
            after_handoff = await client.get(endpoint, headers=headers("admin"))
            assert after_handoff.json()["totalCount"] == 26
            async with engine.begin() as connection:
                await connection.execute(update(ai_referent_letters).where(
                    ai_referent_letters.c.id == handoff,
                ).values(status="queued"))
            assert (await client.get(endpoint, headers=headers("admin"))).json()["totalCount"] == 25
    finally:
        async with engine.begin() as connection:
            await connection.execute(delete(ai_referent_letters).where(
                ai_referent_letters.c.id.in_([row["id"] for row in rows]),
            ))
            await connection.execute(delete(module_access_rules).where(
                module_access_rules.c.subject_key.in_([str(uid) for uid in ids.values()]),
            ))
            await connection.execute(delete(users).where(users.c.id.in_(ids.values())))
        await engine.dispose()
