"""Participation is intersected with existing visibility before totals/pagination."""

import os
from datetime import UTC, datetime
from uuid import uuid4

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import delete, insert
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
@pytest.mark.parametrize("role,all_count", [("admin", 58), ("manager", 57), ("employee", 56)])
async def test_outgoing_participation_counts_pages_and_permissions(role, all_count):
    url = os.environ.get("YUKSALISH_TEST_DATABASE_URL")
    if not url:
        pytest.skip("YUKSALISH_TEST_DATABASE_URL is not configured")
    settings = zoom_settings(url)
    settings.seed_demo_data = False
    app = create_app(settings)
    engine = create_async_engine(url)
    ids = {name: uuid4() for name in ("viewer", "other", "denied")}
    prefix = f"participation-{uuid4().hex}"
    now = datetime.now(UTC)
    rows = []

    def add(field=None, *, status="pending_review", kind="delivery"):
        row = {
            "id": uuid4(), "subject": prefix, "recipient_organization": "QA",
            "recipient_address": "qa@example.test", "route": "webmail", "note": "",
            "status": status, "workflow_kind": kind, "source": "workspace",
            "created_by_user_id": ids["other"], "reviewer_user_id": ids["other"],
            "initial_reviewer_user_id": ids["other"], "final_reviewer_user_id": ids["other"],
            "revision": 1, "created_at": now, "updated_at": now,
        }
        if field:
            row[field] = ids["viewer"]
        rows.append(row)
        return str(row["id"])

    fields = ("created_by_user_id", "reviewer_user_id", "initial_reviewer_user_id",
              "final_reviewer_user_id")
    mine = {add(fields[index % 4]) for index in range(55)}
    mine.add(add("created_by_user_id", status="sent"))
    hidden_draft = add(status="draft")
    add(status="sent")
    add("final_reviewer_user_id", kind="sign_only")
    try:
        async with engine.begin() as connection:
            await connection.execute(insert(users), [{
                "id": uid, "username": f"participation-{uid.hex[:20]}",
                "full_name": f"QA {name}", "job_title": "QA",
                "role": role if name == "viewer" else "employee", "status": "active",
                "created_at": now, "updated_at": now,
            } for name, uid in ids.items()])
            await connection.execute(insert(module_access_rules), [{
                "id": uuid4(), "subject_type": "user", "subject_key": str(ids[name]),
                "module_key": "ai_referent", "permissions": {
                    "view": name != "denied", "approve": name != "denied",
                    "create": False, "edit": False, "admin": False,
                }, "created_at": now, "updated_at": now,
            } for name in ids])
            await connection.execute(insert(ai_referent_letters), rows)

        def headers(name="viewer"):
            return {"Authorization": "Bearer " + issue_access_token(
                ids[name], settings.auth_signing_key,
            )}

        async with (app.router.lifespan_context(app), AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test",
        ) as client):
            params = {"query": prefix, "workflow_kind": "delivery", "participation": "mine"}

            async def registry(**changes):
                response = await client.get("/api/v1/ai-referent/letters",
                                            headers=headers(), params={**params, **changes})
                assert response.status_code == 200, response.text
                return response.json()

            first = await registry()
            second = await registry(offset=50)
            assert first["participation"] == second["participation"] == "mine"
            assert first["totalCount"] == second["totalCount"] == 56
            assert first["pendingReviewCount"] == 55 and first["sentCount"] == 1
            first_ids = {letter["id"] for letter in first["letters"]}
            second_ids = {letter["id"] for letter in second["letters"]}
            assert len(first_ids) == 50 and len(second_ids) == 6
            assert first_ids.isdisjoint(second_ids) and first_ids | second_ids == mine
            assert (await registry(status="pending_review"))["totalCount"] == 55
            assert (await registry(query=prefix + "-absent"))["totalCount"] == 0
            all_letters = await registry(participation="all")
            assert all_letters["totalCount"] == all_count and all_letters["participation"] == "all"
            default = await client.get("/api/v1/ai-referent/letters", headers=headers(),
                                       params={"query": prefix, "workflow_kind": "delivery"})
            assert default.json()["totalCount"] == all_count
            assert (await registry(workflow_kind="sign_only"))["totalCount"] == 1
            forbidden = await client.get("/api/v1/ai-referent/letters", headers=headers("denied"),
                                         params=params)
            assert forbidden.status_code == 403
            invalid = await client.get("/api/v1/ai-referent/letters", headers=headers(),
                                       params={**params, "participation": "somebody-else"})
            assert invalid.status_code == 422
            detail = await client.get(f"/api/v1/ai-referent/letters/{hidden_draft}",
                                      headers=headers())
            assert detail.status_code == (200 if role == "admin" else 404)
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
