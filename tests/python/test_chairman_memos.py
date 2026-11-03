# ruff: noqa: RUF001 - exact Uzbek apostrophes and mixed authored text are intentional fixtures.
"""Only synthetic users in an explicitly configured loopback test database."""

import asyncio
import hashlib
import os
import secrets
from contextlib import asynccontextmanager
from datetime import UTC, date, datetime
from io import BytesIO
from unittest.mock import AsyncMock
from uuid import uuid4

import httpx
import pytest
from fastapi import FastAPI
from pydantic import SecretStr, ValidationError
from pypdf import PdfReader
from sqlalchemy import delete, func, insert, select, update
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import create_async_engine

from yuksalish_api.access_control import request_module_action
from yuksalish_api.auth import issue_access_token
from yuksalish_api.chairman_memo_pdf import memo_pdf
from yuksalish_api.chairman_memo_service import is_memo_deputy
from yuksalish_api.chairman_memo_tables import memoranda
from yuksalish_api.events import WorkspaceEventBus
from yuksalish_api.position_policy import EXECUTIVE_LEADER_POSITION_NAME
from yuksalish_api.routers.chairman_memos import router
from yuksalish_api.settings import Settings
from yuksalish_api.tables import (
    audit_events,
    hr_settings,
    module_access_rules,
    users,
    workspace_notifications,
)

PREFIX = "/api/v1/chairman-memos"


@asynccontextmanager
async def scenario():
    url = os.environ.get("YUKSALISH_TEST_DATABASE_URL")
    if not url:
        pytest.skip("An isolated test database is required")
    parsed = make_url(url)
    assert parsed.host in {"127.0.0.1", "localhost", "::1"}
    assert (parsed.database or "").startswith("yuksalish_test")
    engine = create_async_engine(url)
    people = {key: uuid4() for key in (
        "chair", "deputy", "first", "hr", "accountant", "other", "admin",
    )}
    now = datetime.now(UTC)
    settings = Settings(
        environment="test", database_url=url, auth_signing_key=SecretStr(secrets.token_urlsafe(40))
    )
    headers = {
        key: {"Authorization": "Bearer " + issue_access_token(value, settings.auth_signing_key)}
        for key, value in people.items()
    }
    old_settings = None
    try:
        async with engine.begin() as c:
            old_settings = (
                (await c.execute(select(hr_settings).where(hr_settings.c.id == 1)))
                .mappings()
                .first()
            )
            for key, user_id in people.items():
                await c.execute(
                    insert(users).values(
                        id=user_id,
                        username="memo-" + user_id.hex,
                        full_name="Вымышленный " + key,
                        password_hash="test-not-login-enabled",
                        job_title={
                            "chair": EXECUTIVE_LEADER_POSITION_NAME,
                            "deputy": "Rais o‘rinbosari",
                            "first": "Rais birinchi o‘rinbosari",
                            "hr": "Kadrlar mutaxassisi",
                            "accountant": "Bosh hisobchi",
                        }.get(key, "Mutaxassis"),
                        role="admin"
                        if key == "admin"
                        else "manager"
                        if key in {"chair", "deputy", "first"}
                        else "employee",
                        status="active",
                        created_at=now,
                        updated_at=now,
                    )
                )
            await c.execute(delete(hr_settings).where(hr_settings.c.id == 1))
            await c.execute(
                insert(hr_settings).values(
                    id=1,
                    hr_user_id=people["hr"],
                    accountant_user_id=people["accountant"],
                    chair_user_id=people["chair"],
                    updated_by_user_id=people["admin"],
                    updated_at=now,
                )
            )
        app = FastAPI()
        app.state.database_engine, app.state.settings, app.state.event_bus = (
            engine,
            settings,
            WorkspaceEventBus(),
        )
        app.include_router(router, prefix="/api/v1")
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://127.0.0.1:8197"
        ) as client:
            yield client, headers, engine, people, app
    finally:
        async with engine.begin() as c:
            await c.execute(
                delete(memoranda).where(memoranda.c.requester_user_id.in_(people.values()))
            )
            await c.execute(
                delete(workspace_notifications).where(
                    workspace_notifications.c.user_id.in_(people.values())
                )
            )
            await c.execute(
                delete(audit_events).where(audit_events.c.actor_user_id.in_(people.values()))
            )
            await c.execute(
                delete(module_access_rules).where(
                    module_access_rules.c.subject_key.in_(map(str, people.values()))
                )
            )
            await c.execute(delete(hr_settings).where(hr_settings.c.id == 1))
            if old_settings:
                await c.execute(insert(hr_settings).values(**dict(old_settings)))
            await c.execute(delete(users).where(users.c.id.in_(people.values())))
        await engine.dispose()


async def make(client, headers, key="deputy"):
    payload = {
        "requestId": str(uuid4()),
        "title": "Вымышленное обращение",
        "body": "To‘liq matn.\n\nСвободный текст сохраняется точно.",
    }
    response = await client.post(PREFIX, headers=headers[key], json=payload)
    assert response.status_code == 200, response.text
    return response.json(), payload


def test_domain_positions_and_central_gate():
    for title in ["Rais o'rinbosari", "Raisning o‘rinbosari", "Rais birinchi o‘rinbosari"]:
        assert is_memo_deputy(title)
    for title in [None, "Mutaxassis", "Rais o‘rinbosari yordamchisi", "Viloyat rais o‘rinbosari"]:
        assert not is_memo_deputy(title)
    assert request_module_action(PREFIX + "/context", "GET") == ("home", "view")
    assert request_module_action(PREFIX + "/x/decision", "POST") == ("home", "approve")


def test_personal_requester_configuration_is_uuid_only(monkeypatch):
    identifier = uuid4()
    monkeypatch.setenv("YUKSALISH_CHAIRMAN_MEMO_REQUESTER_IDS", '["' + str(identifier) + '"]')
    assert Settings(_env_file=None).chairman_memo_requester_ids == [identifier]
    monkeypatch.setenv("YUKSALISH_CHAIRMAN_MEMO_REQUESTER_IDS", '["not-a-uuid"]')
    with pytest.raises(ValidationError):
        Settings(_env_file=None)


def test_personal_requester_can_prepare_own_memo_but_not_review_or_read_others():
    async def run():
        async with scenario() as (client, headers, _, people, app):
            settings = app.state.settings
            assert not (await client.get(PREFIX + "/context", headers=headers["other"])).json()[
                "canCreate"
            ]
            settings.chairman_memo_requester_ids = [people["other"]]
            access = (await client.get(PREFIX + "/context", headers=headers["other"])).json()
            assert access["canCreate"] and access["enabled"] and not access["canReview"]
            assert not (await client.get(PREFIX + "/context", headers=headers["admin"])).json()[
                "canCreate"
            ]
            foreign, _ = await make(client, headers)
            assert (await client.get(PREFIX + "/" + foreign["id"],
                                     headers=headers["other"])).status_code == 404
            own, payload = await make(client, headers, "other")
            path = PREFIX + "/" + own["id"]
            assert own["canEdit"] and own["canSubmit"] and not own["canDecide"]
            assert (await client.get(path + "/pdf", headers=headers["other"])).status_code == 200
            saved = await client.put(path, headers=headers["other"], json={
                "title": payload["title"], "body": "Исправленный собственный текст",
                "expectedRevision": 1,
            })
            assert saved.status_code == 200 and saved.json()["revision"] == 2
            sent = await client.post(path + "/submit", headers=headers["other"],
                                     json={"expectedRevision": 2})
            assert sent.status_code == 200 and sent.json()["status"] == "pending"
            assert (await client.post(path + "/decision", headers=headers["other"], json={
                "expectedRevision": 3, "decision": "approve",
            })).status_code == 403
            approved = await client.post(path + "/decision", headers=headers["chair"], json={
                "expectedRevision": 3, "decision": "approve",
            })
            assert approved.status_code == 200 and approved.json()["status"] == "hr_pending"

    asyncio.run(run())


def test_personal_requester_revocation_module_denial_and_inactive_account_are_enforced():
    async def run():
        async with scenario() as (client, headers, engine, people, app):
            app.state.settings.chairman_memo_requester_ids = [people["other"]]
            draft, payload = await make(client, headers, "other")
            path = PREFIX + "/" + draft["id"]
            app.state.settings.chairman_memo_requester_ids = []
            detail = await client.get(path, headers=headers["other"])
            assert detail.status_code == 200 and not detail.json()["canSubmit"]
            assert not detail.json()["canEdit"]
            assert (await client.post(path + "/submit", headers=headers["other"],
                                     json={"expectedRevision": 1})).status_code == 403
            assert (await client.put(path, headers=headers["other"], json={
                "title": payload["title"], "body": payload["body"], "expectedRevision": 1,
            })).status_code == 403
            denied = await client.post(PREFIX, headers=headers["other"],
                                       json={**payload, "requestId": str(uuid4())})
            assert denied.status_code == 403
            app.state.settings.chairman_memo_requester_ids = [people["other"]]
            async with engine.begin() as c:
                await c.execute(insert(module_access_rules).values(
                    id=uuid4(), subject_type="user", subject_key=str(people["other"]),
                    module_key="home", permissions={"view": True},
                    created_by_user_id=people["admin"], created_at=datetime.now(UTC),
                    updated_at=datetime.now(UTC),
                ))
            assert not (await client.get(PREFIX + "/context", headers=headers["other"])).json()[
                "canCreate"
            ]
            assert (await client.post(path + "/submit", headers=headers["other"],
                                     json={"expectedRevision": 1})).status_code == 403
            async with engine.begin() as c:
                await c.execute(update(users).where(users.c.id == people["other"])
                                .values(status="blocked"))
            assert (await client.get(PREFIX + "/context",
                                     headers=headers["other"])).status_code == 401

    asyncio.run(run())


def test_pdf_keeps_authored_text_and_handles_multipage():
    content = memo_pdf(
        chair="Sinov Rais",
        requester="Sinov Xodim o'g'li",
        job_title="Rais o‘rinbosari",
        body="Русский текст и O‘zbekcha matn. <tag> & oddiy.\n" * 90,
        dated=date(2026, 11, 2),
    )
    pdf = PdfReader(BytesIO(content))
    assert len(pdf.pages) > 1
    text = "\n".join(page.extract_text() for page in pdf.pages)
    assert "БИЛДИРГИ" in text and "Русский текст" in text and "<таг> & оддий" in text
    assert "ўғли" in text
    assert pdf.metadata.title == "Yuksalish bildirgi"


def test_creation_privacy_and_idempotency():
    async def run():
        async with scenario() as (client, headers, engine, people, _):
            assert (await client.get(PREFIX + "/context")).status_code == 401
            for key in ["deputy", "first", "hr"]:
                assert (await client.get(PREFIX + "/context", headers=headers[key])).json()[
                    "canCreate"
                ]
            for key in ["other", "admin", "chair"]:
                assert not (await client.get(PREFIX + "/context", headers=headers[key])).json()[
                    "canCreate"
                ]
            draft, payload = await make(client, headers)
            assert (await client.post(PREFIX, headers=headers["deputy"], json=payload)).json()[
                "id"
            ] == draft["id"]
            for key in ["other", "admin", "chair", "first", "hr"]:
                assert (
                    await client.get(PREFIX + "/" + draft["id"], headers=headers[key])
                ).status_code == 404
                assert (
                    await client.get(PREFIX + "/" + draft["id"] + "/pdf", headers=headers[key])
                ).status_code == 404
            assert (
                await client.post(
                    PREFIX, headers=headers["other"], json={**payload, "requestId": str(uuid4())}
                )
            ).status_code == 403
            async with engine.connect() as c:
                assert (
                    await c.scalar(
                        select(func.count())
                        .select_from(memoranda)
                        .where(memoranda.c.requester_user_id == people["deputy"])
                    )
                    == 1
                )

    asyncio.run(run())


def test_submit_return_approve_notifications_and_immutable_pdf():
    async def run():
        async with scenario() as (client, headers, engine, people, _):
            draft, _ = await make(client, headers)
            path = PREFIX + "/" + draft["id"]
            submitted = await client.post(
                path + "/submit", headers=headers["deputy"], json={"expectedRevision": 1}
            )
            assert submitted.status_code == 200
            assert submitted.json()["status"] == "pending"
            assert (await client.get(PREFIX + "/context", headers=headers["chair"])).json()[
                "pendingCount"
            ] == 1
            assert (await client.get(path, headers=headers["chair"])).json()["canDecide"]
            denied = await client.post(
                path + "/decision",
                headers=headers["deputy"],
                json={"expectedRevision": 2, "decision": "approve"},
            )
            assert denied.status_code == 403
            assert (
                await client.post(
                    path + "/decision",
                    headers=headers["chair"],
                    json={"expectedRevision": 2, "decision": "return"},
                )
            ).status_code == 422
            returned = await client.post(
                path + "/decision",
                headers=headers["chair"],
                json={"expectedRevision": 2, "decision": "return", "comment": "Уточните основание"},
            )
            assert returned.json()["status"] == "needs_revision"
            updated = await client.put(
                path,
                headers=headers["deputy"],
                json={
                    "expectedRevision": 3,
                    "title": draft["title"],
                    "body": "Исправленный точный текст",
                },
            )
            assert updated.status_code == 200
            assert (
                await client.post(
                    path + "/submit", headers=headers["deputy"], json={"expectedRevision": 4}
                )
            ).status_code == 200
            before = await client.get(path + "/pdf", headers=headers["chair"])
            approved = await client.post(
                path + "/decision",
                headers=headers["chair"],
                json={"expectedRevision": 5, "decision": "approve", "comment": "Согласовано"},
            )
            assert approved.json()["status"] == "hr_pending"
            assert not approved.json()["canEdit"] and not approved.json()["canDecide"]
            after = await client.get(path + "/pdf", headers=headers["deputy"])
            assert (
                hashlib.sha256(before.content).hexdigest()
                == hashlib.sha256(after.content).hexdigest()
            )
            assert after.headers["cache-control"] == "private, no-store"
            assert (
                await client.put(
                    path,
                    headers=headers["deputy"],
                    json={"expectedRevision": 6, "title": "Changed", "body": "Changed"},
                )
            ).status_code == 409
            assert (
                await client.post(
                    path + "/decision",
                    headers=headers["chair"],
                    json={"expectedRevision": 5, "decision": "approve"},
                )
            ).status_code == 409
            async with engine.connect() as c:
                notes = (
                    (
                        await c.execute(
                            select(workspace_notifications).where(
                                workspace_notifications.c.entity_id == draft["id"]
                            )
                        )
                    )
                    .mappings()
                    .all()
                )
                assert sum(n["title"] == "Председатель одобрил вашу билдирги" for n in notes) == 1
                assert {n["user_id"] for n in notes} == {
                    people["deputy"], people["chair"], people["hr"],
                }
                assert {
                    n["user_id"] for n in notes
                    if n["requires_action"] and n["resolved_at"] is None
                } == {people["hr"]}

    asyncio.run(run())


def test_live_authority_withdraw_and_concurrent_decision():
    async def run():
        async with scenario() as (client, headers, engine, people, _):
            draft, _ = await make(client, headers, "hr")
            path = PREFIX + "/" + draft["id"]
            assert (
                await client.post(
                    path + "/submit", headers=headers["hr"], json={"expectedRevision": 1}
                )
            ).status_code == 200
            assert (
                await client.post(
                    path + "/withdraw", headers=headers["hr"], json={"expectedRevision": 2}
                )
            ).json()["status"] == "draft"
            assert (
                await client.post(
                    path + "/decision",
                    headers=headers["chair"],
                    json={"expectedRevision": 3, "decision": "approve"},
                )
            ).status_code == 404
            await client.post(path + "/submit", headers=headers["hr"], json={"expectedRevision": 3})
            responses = await asyncio.gather(
                *[
                    client.post(
                        path + "/decision",
                        headers=headers["chair"],
                        json={"expectedRevision": 4, "decision": "approve"},
                    )
                    for _ in range(2)
                ]
            )
            assert sorted(r.status_code for r in responses) == [200, 409]
            async with engine.begin() as c:
                await c.execute(
                    update(users)
                    .where(users.c.id == people["deputy"])
                    .values(job_title="Mutaxassis")
                )
            assert not (await client.get(PREFIX + "/context", headers=headers["deputy"])).json()[
                "canCreate"
            ]

    asyncio.run(run())


def test_module_rights_and_invalid_configuration_are_live():
    async def run():
        async with scenario() as (client, headers, engine, people, _):
            draft, payload = await make(client, headers)
            path = PREFIX + "/" + draft["id"]
            assert (
                await client.post(
                    PREFIX,
                    headers=headers["deputy"],
                    json={**payload, "requesterUserId": str(people["hr"])},
                )
            ).status_code == 422
            await client.post(
                path + "/submit", headers=headers["deputy"], json={"expectedRevision": 1}
            )
            async with engine.begin() as c:
                for key in ("deputy", "chair"):
                    await c.execute(
                        insert(module_access_rules).values(
                            id=uuid4(),
                            subject_type="user",
                            subject_key=str(people[key]),
                            module_key="home",
                            permissions={"view": True},
                            created_by_user_id=people["admin"],
                            created_at=datetime.now(UTC),
                            updated_at=datetime.now(UTC),
                        )
                    )
            assert not (await client.get(PREFIX + "/context", headers=headers["deputy"])).json()[
                "canCreate"
            ]
            assert not (await client.get(path, headers=headers["chair"])).json()["canDecide"]
            assert (
                await client.post(
                    path + "/decision",
                    headers=headers["chair"],
                    json={"expectedRevision": 2, "decision": "approve"},
                )
            ).status_code == 403
            async with engine.begin() as c:
                await c.execute(
                    update(hr_settings).where(hr_settings.c.id == 1).values(chair_user_id=None)
                )
            error = (await client.get(PREFIX + "/context", headers=headers["hr"])).json()[
                "configurationError"
            ]
            assert error and "председателя" in error
            assert (
                await client.post(
                    PREFIX, headers=headers["hr"], json={**payload, "requestId": str(uuid4())}
                )
            ).status_code == 409

    asyncio.run(run())


def test_notification_failure_rolls_back_submission(monkeypatch):
    from yuksalish_api import chairman_memo_service

    async def run():
        async with scenario() as (client, headers, _engine, _people, _):
            draft, _payload = await make(client, headers)
            path = PREFIX + "/" + draft["id"]
            monkeypatch.setattr(
                chairman_memo_service,
                "notify",
                AsyncMock(side_effect=RuntimeError("synthetic notification failure")),
            )
            with pytest.raises(RuntimeError, match="synthetic notification failure"):
                await client.post(
                    path + "/submit", headers=headers["deputy"], json={"expectedRevision": 1}
                )
            restored = (await client.get(path, headers=headers["deputy"])).json()
            assert restored["status"] == "draft" and restored["revision"] == 1

    asyncio.run(run())
