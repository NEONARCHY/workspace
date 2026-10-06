"""Real HTTP/SQL scopes, totals, files and audited visibility changes."""

import os
from datetime import UTC, datetime
from uuid import uuid4

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import delete, insert, select
from sqlalchemy.ext.asyncio import create_async_engine

from test_zoom_postgres import zoom_settings
from yuksalish_api.auth import issue_access_token
from yuksalish_api.main import create_app
from yuksalish_api.tables import (
    ai_referent_agents,
    ai_referent_incoming_access,
    ai_referent_incoming_letters,
    audit_events,
    module_access_rules,
    users,
)


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.mark.anyio
@pytest.mark.postgres
async def test_incoming_visibility_scopes_and_admin_controls():
    database_url = os.environ.get("YUKSALISH_TEST_DATABASE_URL")
    if not database_url:
        pytest.skip("YUKSALISH_TEST_DATABASE_URL is not configured")
    settings = zoom_settings(database_url)
    settings.seed_demo_data = False
    app = create_app(settings)
    engine = create_async_engine(database_url)
    ids = {name: uuid4() for name in ("admin", "superadmin", "employee", "botir", "saida", "askar")}
    letter_ids = {name: uuid4() for name in ("botir", "saida", "askar", "other-pc")}
    rule_id = uuid4()
    now = datetime.now(UTC)
    agent = f"visibility-{uuid4().hex}"
    subject = f"visibility-letter-{uuid4().hex}"
    names = {"botir": "Botir Mardaev", "saida": "Saida Mustafaeva", "askar": "Askar Mamatxanov"}
    async with engine.begin() as connection:
        await connection.execute(
            insert(users),
            [
                {
                    "id": user_id,
                    "username": f"visibility-{user_id.hex[:20]}",
                    "full_name": names.get(key, f"Visibility {key}"),
                    "job_title": "QA",
                    "role": key if key in {"admin", "superadmin"} else "employee",
                    "status": "active",
                    "password_hash": None,
                    "created_at": now,
                    "updated_at": now,
                }
                for key, user_id in ids.items()
            ],
        )
        await connection.execute(
            insert(ai_referent_agents),
            [
                {
                    "agent_id": source,
                    "display_name": "QA",
                    "last_seen_at": now,
                    "created_at": now,
                    "updated_at": now,
                }
                for source in (agent, f"{agent}-other")
            ],
        )
        await connection.execute(
            insert(ai_referent_incoming_letters),
            [
                {
                    "id": letter_id,
                    "agent_id": agent if key != "other-pc" else f"{agent}-other",
                    "external_id": str(letter_id),
                    "sequence_number": str(index),
                    "responsible_external_id": "botir" if key == "other-pc" else key,
                    "responsible_display_name": "Other Person" if key == "other-pc" else names[key],
                    "responsible_user_id": ids[
                        "botir"
                    ],  # deliberately stale mapping must not grant access
                    "sender_organization": "QA",
                    "subject": subject,
                    "status": "platform_submitted",
                    "has_attachments": True,
                    "attachments_count": 1,
                    "source": "exat",
                    "revision": 1,
                    "payload_sha256": "a" * 64,
                    "created_at": now,
                    "updated_at": now,
                }
                for index, (key, letter_id) in enumerate(letter_ids.items())
            ],
        )

    def headers(key):
        return {
            "Authorization": f"Bearer {issue_access_token(ids[key], settings.auth_signing_key)}"
        }

    base = "/api/v1/ai-referent"
    try:
        async with (
            app.router.lifespan_context(app),
            AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client,
        ):
            for key in ("admin", "superadmin"):
                response = await client.get(
                    f"{base}/incoming", params={"query": subject}, headers=headers(key)
                )
                assert response.status_code == 200, response.text
                assert response.json()["totalCount"] == 4
                visibility = await client.get(f"{base}/visibility", headers=headers(key))
                assert visibility.json()["incomingMode"] == "all"
                assert visibility.json()["canManageVisibility"] is True
            for key in ("botir", "saida", "askar"):
                response = await client.get(
                    f"{base}/incoming", params={"query": subject}, headers=headers(key)
                )
                assert response.status_code == 200, response.text
                assert [row["id"] for row in response.json()["letters"]] == [str(letter_ids[key])]
                assert response.json()["totalCount"] == response.json()["filteredCount"] == 1
                assert response.json()["withAttachmentsCount"] == 1
                assert response.json()["journal"]["available"] is False
                own = await client.get(
                    f"{base}/packets/incoming/{letter_ids[key]}", headers=headers(key)
                )
                assert own.status_code == 200, own.text
                foreign = "saida" if key == "botir" else "botir"
                for suffix in ("", "/zip", f"/files/{uuid4()}"):
                    denied = await client.get(
                        f"{base}/packets/incoming/{letter_ids[foreign]}{suffix}",
                        headers=headers(key),
                    )
                    assert denied.status_code == 404, denied.text
                for path in (
                    "journal/latest",
                    "journals",
                    "archive",
                    f"packets/journal/{uuid4()}",
                    f"packets/archive/{uuid4()}",
                ):
                    denied = await client.get(f"{base}/{path}", headers=headers(key))
                    assert denied.status_code == 403, denied.text
            denied = await client.get(f"{base}/incoming", headers=headers("employee"))
            assert denied.status_code == 403
            assert (
                await client.get(f"{base}/incoming-access", headers=headers("employee"))
            ).status_code == 403
            endpoint = f"{base}/incoming-access/{ids['employee']}"
            payload = {
                "mode": "assigned",
                "expectedRevision": 0,
                "responsibles": [{"agentId": agent, "externalId": "botir"}],
            }
            assert (
                await client.put(endpoint, headers=headers("employee"), json=payload)
            ).status_code == 403
            assert (
                await client.put(
                    endpoint,
                    headers=headers("admin"),
                    json={
                        **payload,
                        "responsibles": [{"agentId": agent, "externalId": "unknown"}],
                    },
                )
            ).status_code == 422
            saved = await client.put(endpoint, headers=headers("admin"), json=payload)
            assert saved.status_code == 200, saved.text
            assert saved.json()["revision"] == 1
            assert (
                await client.put(endpoint, headers=headers("admin"), json=payload)
            ).status_code == 409
            response = await client.get(
                f"{base}/incoming", params={"query": subject}, headers=headers("employee")
            )
            assert [row["id"] for row in response.json()["letters"]] == [str(letter_ids["botir"])]
            # A source's external ID from a different PC is not the same responsibility.
            denied = await client.get(
                f"{base}/packets/incoming/{letter_ids['other-pc']}", headers=headers("employee")
            )
            assert denied.status_code == 404
            configuration = await client.get(f"{base}/incoming-access", headers=headers("admin"))
            assert configuration.status_code == 200
            assert all("subject" not in option for option in configuration.json()["responsibles"])
            immutable = await client.put(
                f"{base}/incoming-access/{ids['superadmin']}",
                headers=headers("admin"),
                json={"mode": "none", "expectedRevision": 0},
            )
            assert immutable.status_code == 422
            # Changing to full/none/default is immediate and does not mutate mail or the robot.
            for revision, mode, status in ((1, "all", 200), (2, "none", 403), (3, "default", 403)):
                saved = await client.put(
                    endpoint,
                    headers=headers("superadmin"),
                    json={"mode": mode, "expectedRevision": revision},
                )
                assert saved.status_code == 200, saved.text
                response = await client.get(
                    f"{base}/incoming", params={"query": subject}, headers=headers("employee")
                )
                assert response.status_code == status
                if mode == "all":
                    assert response.json()["totalCount"] == 4
            async with engine.begin() as connection:
                await connection.execute(
                    insert(module_access_rules).values(
                        id=rule_id,
                        subject_type="user",
                        subject_key=str(ids["botir"]),
                        module_key="ai_referent",
                        permissions={
                            "view": False,
                            "create": False,
                            "edit": False,
                            "approve": False,
                            "admin": False,
                        },
                        created_by_user_id=ids["admin"],
                        created_at=now,
                        updated_at=now,
                    )
                )
            assert (
                await client.get(f"{base}/incoming", headers=headers("botir"))
            ).status_code == 403
            async with engine.connect() as connection:
                audit = (
                    (
                        await connection.execute(
                            select(audit_events).where(
                                audit_events.c.target_id == ids["employee"],
                                audit_events.c.action == "ai_referent.incoming_visibility_updated",
                            )
                        )
                    )
                    .mappings()
                    .all()
                )
                assert len(audit) == 4
                assert (
                    await connection.scalar(
                        select(ai_referent_incoming_letters.c.revision).where(
                            ai_referent_incoming_letters.c.id == letter_ids["botir"]
                        )
                    )
                    == 1
                )
    finally:
        async with engine.begin() as connection:
            await connection.execute(
                delete(module_access_rules).where(module_access_rules.c.id == rule_id)
            )
            await connection.execute(
                delete(audit_events).where(audit_events.c.target_id.in_(ids.values()))
            )
            await connection.execute(
                delete(ai_referent_incoming_access).where(
                    ai_referent_incoming_access.c.user_id.in_(ids.values())
                )
            )
            await connection.execute(
                delete(ai_referent_incoming_letters).where(
                    ai_referent_incoming_letters.c.id.in_(letter_ids.values())
                )
            )
            await connection.execute(
                delete(ai_referent_agents).where(
                    ai_referent_agents.c.agent_id.in_((agent, f"{agent}-other"))
                )
            )
            await connection.execute(delete(users).where(users.c.id.in_(ids.values())))
        await engine.dispose()
