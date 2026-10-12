"""Real transactions against an explicitly isolated test database only."""

import hashlib
import os
from collections.abc import AsyncIterator
from dataclasses import replace
from datetime import UTC, datetime
from io import BytesIO
from uuid import uuid4
from zipfile import ZipFile

import httpx
import pytest
from sqlalchemy import insert, select, update
from sqlalchemy.ext.asyncio import create_async_engine

from test_hr_hiring_pdf import fields, signature
from yuksalish_api.auth import AuthenticatedUser, require_user
from yuksalish_api.database import get_connection
from yuksalish_api.hr_hiring_pdf import documents
from yuksalish_api.hr_hiring_tables import hiring_cases, hiring_receipts
from yuksalish_api.main import create_app
from yuksalish_api.object_storage import InMemoryObjectStorage, ObjectStorageError
from yuksalish_api.settings import Settings
from yuksalish_api.tables import audit_events, hr_settings, module_access_rules, users


@pytest.fixture
async def hiring_api() -> AsyncIterator[
    tuple[httpx.AsyncClient, dict[str, AuthenticatedUser], InMemoryObjectStorage, object]
]:
    url = os.environ.get("YUKSALISH_TEST_DATABASE_URL", "")
    if not url:
        pytest.skip("Isolated PostgreSQL not configured")
    if "test" not in url.rsplit("/", 1)[-1]:
        raise RuntimeError("Hiring tests must never run against a production database")
    engine = create_async_engine(url)
    storage = InMemoryObjectStorage()
    async with engine.connect() as connection:
        transaction = await connection.begin()
        actors: dict[str, AuthenticatedUser] = {}
        for name in ("hr", "chair", "other"):
            user_id = uuid4()
            role = "superadmin" if name == "other" else "admin"
            await connection.execute(
                insert(users).values(
                    id=user_id,
                    username=f"hiring-{user_id.hex[:10]}",
                    full_name=f"Synthetic {name}",
                    role=role,
                    status="active",
                    created_at=datetime.now(UTC),
                    updated_at=datetime.now(UTC),
                )
            )
            actors[name] = AuthenticatedUser(
                id=user_id,
                username=name,
                full_name=f"Synthetic {name}",
                role=role,
                position_id=None,
                job_title=None,
            )
        await connection.execute(
            insert(hr_settings).values(
                id=1,
                hr_user_id=actors["hr"].id,
                chair_user_id=actors["chair"].id,
                accountant_user_id=actors["other"].id,
                updated_by_user_id=actors["hr"].id,
                updated_at=datetime.now(UTC),
            )
        )
        active = {"user": actors["hr"]}
        app = create_app(Settings(environment="test", database_url=url))
        app.state.object_storage = storage

        async def current() -> AuthenticatedUser:
            return active["user"]

        async def db() -> AsyncIterator[object]:
            async with connection.begin_nested():
                yield connection

        app.dependency_overrides[require_user] = current
        app.dependency_overrides[get_connection] = db
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app), base_url="https://test"
        ) as client:
            # Dict also holds references to named actors for switching identity in assertions.
            active.update(actors)
            yield client, active, storage, connection
        await transaction.rollback()
    await engine.dispose()


async def create(client: httpx.AsyncClient) -> tuple[str, dict[str, object]]:
    path = f"/api/v1/hr/hiring/{uuid4()}"
    payload = {"expectedRevision": 0, "fields": fields().model_dump(mode="json", by_alias=True)}
    response = await client.put(path, json=payload)
    assert response.status_code == 200, response.text
    assert response.json()["revision"] == 1
    assert response.headers["cache-control"] == "no-store"
    assert (await client.put(path, json=payload)).json()["revision"] == 1
    return path, payload


@pytest.mark.anyio
@pytest.mark.postgres
async def test_complete_workflow_frozen_documents_receipts_and_personal_signing(hiring_api) -> None:
    client, active, _storage, connection = hiring_api
    path, payload = await create(client)
    pdf = documents(fields(), "Synthetic chair")["order"]
    upload = await client.put(path + "/documents/application?expectedRevision=1", content=pdf)
    assert upload.status_code == 200 and upload.json()["revision"] == 2
    assert (
        await client.put(path + "/documents/application?expectedRevision=1", content=pdf)
    ).json()["revision"] == 2
    submit = {"action": "submit", "expectedRevision": 2, "requestId": str(uuid4())}
    response = await client.post(path + "/actions", json=submit)
    assert response.status_code == 200 and response.json()["status"] == "pending"
    assert (await client.post(path + "/actions", json=submit)).json()["revision"] == 3
    unsigned = await client.get(path + "/documents/contract")
    assert unsigned.status_code == 200 and unsigned.content.startswith(b"%PDF-")
    assert (await client.get(path + "/documents/packet")).status_code == 409
    payload["expectedRevision"] = 3
    assert (await client.put(path, json=payload)).status_code == 409
    approve = {"action": "approve", "expectedRevision": 3, "requestId": str(uuid4())}
    active["user"] = active["other"]
    assert (await client.put("/api/v1/hr/hiring/signature", content=signature())).status_code == 403
    assert (await client.post(path + "/actions", json=approve)).status_code == 403
    active["user"] = active["chair"]
    assert (await client.post(path + "/actions", json=approve)).status_code == 409
    assert (await client.put("/api/v1/hr/hiring/signature", content=signature())).status_code == 204
    signed = await client.post(path + "/actions", json=approve)
    assert signed.status_code == 200, signed.text
    assert signed.json()["status"] == "awaiting_employee" and signed.json()["revision"] == 4
    assert (await client.post(path + "/actions", json=approve)).json()["revision"] == 4
    changed = approve | {"comment": "changed"}
    assert (await client.post(path + "/actions", json=changed)).status_code == 409
    for name in ("application", "contract", "order"):
        content = await client.get(path + f"/documents/{name}")
        assert content.status_code == 200
        assert hashlib.sha256(content.content).hexdigest() == signed.json()["documentHashes"][name]
    packet = await client.get(path + "/documents/packet")
    with ZipFile(BytesIO(packet.content)) as archive:
        assert set(archive.namelist()) == {"application.pdf", "contract.pdf", "order.pdf"}
    active["user"] = active["hr"]
    complete = {"action": "complete", "expectedRevision": 4, "requestId": str(uuid4())}
    assert (await client.post(path + "/actions", json=complete)).status_code == 409
    scan = await client.put(path + "/documents/employee-scan?expectedRevision=4", content=pdf)
    assert scan.status_code == 200 and scan.json()["hasEmployeeScan"]
    complete["expectedRevision"] = 5
    finished = await client.post(path + "/actions", json=complete)
    assert finished.status_code == 200 and finished.json()["status"] == "completed"
    assert len((await client.get("/api/v1/hr/hiring")).json()["items"]) == 1
    # Successful retries neither duplicate journal transitions nor include personal values.
    receipts = (await connection.execute(select(hiring_receipts))).all()
    assert len(receipts) == 3
    audit = str((await connection.execute(select(audit_events.c.details))).all())
    assert fields().pinfl not in audit and fields().passport not in audit


@pytest.mark.anyio
@pytest.mark.postgres
async def test_validation_conflicts_return_and_failed_storage_leave_no_signed_state(
    hiring_api,
) -> None:
    client, active, storage, connection = hiring_api
    path, payload = await create(client)
    invalid = payload | {"fields": {"pinfl": "secret-personal-data"}}
    response = await client.put(path, json=invalid)
    assert response.status_code == 422 and "secret-personal-data" not in response.text
    assert (
        await client.put(path + "/documents/application?expectedRevision=1", content=b"bad")
    ).status_code == 422
    assert (
        await client.put(
            path + "/documents/application?expectedRevision=1",
            content=b"x" * (10 * 1024 * 1024 + 1),
        )
    ).status_code == 413
    pdf = documents(fields(), "Synthetic chair")["order"]
    await client.put(path + "/documents/application?expectedRevision=1", content=pdf)
    submit = {"action": "submit", "expectedRevision": 2, "requestId": str(uuid4())}
    await client.post(path + "/actions", json=submit)
    active["user"] = active["chair"]
    return_action = {"action": "return", "expectedRevision": 3, "requestId": str(uuid4())}
    assert (await client.post(path + "/actions", json=return_action)).status_code == 422
    return_action["comment"] = "Synthetic correction"
    returned = await client.post(path + "/actions", json=return_action)
    assert returned.json()["status"] == "returned"
    active["user"] = active["hr"]
    payload["expectedRevision"] = 1
    assert (await client.put(path, json=payload)).status_code == 409
    payload["expectedRevision"] = 4
    assert (await client.put(path, json=payload)).status_code == 200
    submit["expectedRevision"], submit["requestId"] = 5, str(uuid4())
    await client.post(path + "/actions", json=submit)
    active["user"] = active["chair"]
    await client.put("/api/v1/hr/hiring/signature", content=signature())
    original_put = storage.put

    async def failed_put(key: str, content: bytes, content_type: str) -> None:
        if key.endswith("order.pdf"):
            raise ObjectStorageError("Synthetic storage failure")
        await original_put(key, content, content_type)

    storage.put = failed_put
    approve = {"action": "approve", "expectedRevision": 6, "requestId": str(uuid4())}
    assert (await client.post(path + "/actions", json=approve)).status_code == 503
    row = (await connection.execute(select(hiring_cases))).mappings().one()
    assert row["status"] == "pending" and row["signed_keys"] == {} and row["revision"] == 6
    storage.put = original_put
    assert (await client.post(path + "/actions", json=approve)).status_code == 200


@pytest.mark.anyio
@pytest.mark.postgres
async def test_ordinary_hr_and_chair_grants_do_not_give_unrelated_people_access(hiring_api) -> None:
    client, active, _storage, connection = hiring_api
    for name in ("hr", "chair", "other"):
        actor = replace(active[name], role="employee")
        active[name] = actor
        await connection.execute(
            update(users).where(users.c.id == actor.id).values(role="employee")
        )
        await connection.execute(
            insert(module_access_rules).values(
                id=uuid4(),
                subject_type="user",
                subject_key=str(actor.id),
                module_key="hr",
                permissions={
                    "view": True,
                    "create": True,
                    "edit": True,
                    "approve": True,
                    "admin": False,
                },
                created_at=datetime.now(UTC),
                updated_at=datetime.now(UTC),
            )
        )
    active["user"] = active["hr"]
    path, _ = await create(client)
    active["user"] = active["chair"]
    assert (await client.get(path)).status_code == 404  # Unsubmitted HR draft is private.
    active["user"] = active["other"]
    assert (await client.get(path)).status_code == 404
    assert (await client.get("/api/v1/hr/hiring")).json()["items"] == []
    assert (await client.put("/api/v1/hr/hiring/signature", content=signature())).status_code == 403
    active["user"] = active["hr"]
    pdf = documents(fields(), "Synthetic chair")["order"]
    await client.put(path + "/documents/application?expectedRevision=1", content=pdf)
    submit = {"action": "submit", "expectedRevision": 2, "requestId": str(uuid4())}
    assert (await client.post(path + "/actions", json=submit)).status_code == 200
    active["user"] = active["chair"]
    assert (await client.get(path)).status_code == 200
    assert (await client.put("/api/v1/hr/hiring/signature", content=signature())).status_code == 204
    active["user"] = active["other"]
    assert (await client.get(path + "/documents/contract")).status_code == 404
