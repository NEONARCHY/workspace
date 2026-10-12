import asyncio
import os
from collections.abc import AsyncIterator
from datetime import UTC, datetime
from uuid import UUID, uuid4

import httpx
import pytest
from sqlalchemy import delete, insert, select, update
from sqlalchemy.ext.asyncio import AsyncConnection, create_async_engine

from yuksalish_api.auth import AuthenticatedUser, require_user
from yuksalish_api.database import get_connection
from yuksalish_api.errors import WorkspaceRepositoryError
from yuksalish_api.main import create_app
from yuksalish_api.object_storage import InMemoryObjectStorage, ObjectStorageError
from yuksalish_api.settings import Settings
from yuksalish_api.survey_schemas import SurveyUpdate
from yuksalish_api.survey_service import create_analysis, list_analyses, save_analysis
from yuksalish_api.tables import audit_events, module_access_rules, survey_analyses, users


def database_url() -> str:
    value = os.environ.get("YUKSALISH_TEST_DATABASE_URL")
    if not value:
        pytest.skip("YUKSALISH_TEST_DATABASE_URL is not configured")
    return value


class UnavailableStorage(InMemoryObjectStorage):
    async def get(self, key: str) -> bytes:
        raise ObjectStorageError("synthetic storage outage")

    async def put(self, key: str, content: bytes, content_type: str) -> None:
        raise ObjectStorageError("synthetic storage outage")


async def actor(connection: AsyncConnection, role: str = "employee") -> AuthenticatedUser:
    user_id = uuid4()
    await connection.execute(insert(users).values(
        id=user_id, username=f"survey-{user_id.hex[:12]}", full_name="Survey tester",
        role=role, status="active", created_at=datetime.now(UTC), updated_at=datetime.now(UTC),
    ))
    return AuthenticatedUser(id=user_id, username="survey-test", full_name="Survey tester",
                             position_id=None, job_title=None, role=role)


@pytest.mark.anyio
@pytest.mark.postgres
async def test_private_api_lifecycle_idempotency_conflicts_and_admin_isolation() -> None:
    engine = create_async_engine(database_url())
    storage = InMemoryObjectStorage()
    actor_ids: list[UUID] = []
    try:
        async with engine.begin() as connection:
            owner = await actor(connection)
            admin = await actor(connection, "superadmin")
            actor_ids = [owner.id, admin.id]
        selected = {"user": owner}
        app = create_app(Settings(environment="test", database_url=database_url()))
        app.state.object_storage = storage

        async def user() -> AuthenticatedUser:
            return selected["user"]

        async def transaction() -> AsyncIterator[AsyncConnection]:
            async with engine.begin() as connection:
                yield connection

        app.dependency_overrides[require_user] = user
        app.dependency_overrides[get_connection] = transaction
        request_id = str(uuid4())
        query = {"requestId": request_id}
        content = b"Q,N\nA,20\nB,30"
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app), base_url="https://test",
            headers={"X-Survey-Filename": "private.csv"},
        ) as client:
            created = await client.post("/api/v1/survey-analyses", params=query, content=content)
            assert created.status_code == 201, created.text
            data = created.json()
            survey_id = data["analysis"]["id"]
            path = f"/api/v1/survey-analyses/{survey_id}"
            assert data["workbook"]["sheets"][0]["rows"][1] == ["A", "20"]
            assert "original_key" not in created.text and "parsed_key" not in created.text
            retry = await client.post("/api/v1/survey-analyses", params=query, content=content)
            assert retry.json()["analysis"]["id"] == survey_id
            assert (await client.post("/api/v1/survey-analyses", params=query,
                                      content=b"Q\nOther")).status_code == 409
            assert (await client.get(path)).headers["cache-control"] == "no-store"
            original = await client.get(f"{path}/original")
            assert original.content == content
            assert original.headers["x-content-type-options"] == "nosniff"
            exported = await client.post(f"{path}/export", json={
                "configuration": data["analysis"]["configuration"], "rowNumbers": [2],
            })
            assert exported.status_code == 200 and exported.content.startswith(b"PK")
            payload = {"expectedRevision": 1, "title": "Saved", "archived": False,
                       "configuration": data["analysis"]["configuration"]}
            updated = await client.put(path, json=payload)
            assert updated.status_code == 200 and updated.json()["revision"] == 2
            assert (await client.put(path, json=payload)).status_code == 409
            payload["expectedRevision"] = 2
            payload["configuration"]["sheet"] = 19
            assert (await client.put(path, json=payload)).status_code == 422
            payload["configuration"]["sheet"] = 0
            payload["archived"] = True
            assert (await client.put(path, json=payload)).json()["archived"] is True
            selected["user"] = admin
            assert (await client.get("/api/v1/survey-analyses")).json() == []
            assert (await client.get(path)).status_code == 404
            assert (await client.get(f"{path}/original")).status_code == 404
            assert (await client.post(f"{path}/export", json={
                "configuration": data["analysis"]["configuration"], "rowNumbers": [2],
            })).status_code == 404
            assert (await client.put(path, json=payload)).status_code == 404
            selected["user"] = owner
            assert len((await client.get("/api/v1/survey-analyses")).json()) == 1
            app.state.object_storage = UnavailableStorage()
            assert (await client.get(path)).status_code == 503
            assert (await client.get(f"{path}/original")).status_code == 503
            assert (await client.post(f"{path}/export", json={
                "configuration": data["analysis"]["configuration"], "rowNumbers": [2],
            })).status_code == 503
            unavailable_save = await client.put(path, json={**payload, "expectedRevision": 3})
            assert unavailable_save.status_code == 503
            assert (await client.post("/api/v1/survey-analyses", params={
                **query, "requestId": str(uuid4()),
            }, content=content)).status_code == 503
            assert len((await client.get("/api/v1/survey-analyses")).json()) == 1
            app.state.object_storage = storage
            async with engine.begin() as connection:
                now = datetime.now(UTC)
                await connection.execute(insert(module_access_rules).values(
                    id=uuid4(), subject_type="user", subject_key=str(owner.id),
                    module_key="survey_analytics", created_by_user_id=owner.id,
                    permissions={"view": True, "create": False, "edit": False,
                                 "approve": False, "admin": False},
                    created_at=now, updated_at=now,
                ))
            assert (await client.get(path)).status_code == 200
            assert (await client.post(f"{path}/export", json={
                "configuration": data["analysis"]["configuration"], "rowNumbers": [2],
            })).status_code == 200
            assert (await client.put(path, json=payload)).status_code == 403
            assert (await client.post("/api/v1/survey-analyses", params={
                **query, "requestId": str(uuid4()),
            }, content=content)).status_code == 403
            async with engine.begin() as connection:
                await connection.execute(update(module_access_rules).where(
                    module_access_rules.c.subject_key == str(owner.id),
                ).values(permissions={}))
            assert (await client.get(path)).status_code == 403
            assert (await client.get(f"{path}/original")).status_code == 403
            async with engine.begin() as connection:
                await connection.execute(delete(module_access_rules).where(
                    module_access_rules.c.subject_key == str(owner.id),
                ))
            invalid_name = await client.post("/api/v1/survey-analyses", params={
                **query, "requestId": str(uuid4()),
            }, content=content, headers={"X-Survey-Filename": "..%2Fsecret.csv"})
            assert invalid_name.status_code == 422
            assert (await client.post("/api/v1/survey-analyses", params={
                **query, "requestId": str(uuid4()),
            }, content=b"not,a,valid\n\"csv")).status_code == 422
            assert (await client.put(path, json={
                **payload, "title": "   ", "expectedRevision": 3,
            })).status_code == 422
            async with engine.begin() as connection:
                source = (await connection.execute(select(survey_analyses).where(
                    survey_analyses.c.id == UUID(survey_id),
                ))).mappings().one()
                await connection.execute(insert(survey_analyses), [
                    {**dict(source), "id": uuid4(), "request_id": uuid4()} for _ in range(49)
                ])
            assert (await client.post("/api/v1/survey-analyses", params={
                **query, "requestId": str(uuid4()),
            }, content=content)).status_code == 409
        async with engine.begin() as connection:
            logs = (await connection.execute(select(audit_events.c.details).where(
                audit_events.c.actor_user_id == owner.id,
            ))).scalars().all()
            assert logs and all(value == {} for value in logs)
    finally:
        async with engine.begin() as connection:
            await connection.execute(delete(module_access_rules).where(
                module_access_rules.c.subject_key.in_([str(value) for value in actor_ids]),
            ))
            await connection.execute(delete(audit_events).where(
                audit_events.c.actor_user_id.in_(actor_ids),
            ))
            await connection.execute(delete(survey_analyses).where(
                survey_analyses.c.owner_user_id.in_(actor_ids),
            ))
            await connection.execute(delete(users).where(users.c.id.in_(actor_ids)))
        await engine.dispose()


@pytest.mark.anyio
@pytest.mark.postgres
async def test_concurrent_import_is_once_only_and_saved_revision_is_atomic() -> None:
    engine = create_async_engine(database_url())
    storage = InMemoryObjectStorage()
    owner: AuthenticatedUser | None = None
    try:
        async with engine.begin() as connection:
            owner = await actor(connection)
        request_id = uuid4()

        async def upload() -> str:
            assert owner is not None
            async with engine.begin() as connection:
                result = await create_analysis(connection, owner, storage, request_id,
                                               "sample.csv", b"Q\nA", "utf-8-sig", ",")
                return result.analysis.id

        ids = await asyncio.gather(upload(), upload())
        assert ids[0] == ids[1]
        async with engine.begin() as connection:
            analyses = await list_analyses(connection, owner)
            assert len(analyses) == 1
            payload = SurveyUpdate(expected_revision=1, title="Reviewed", archived=False,
                                   configuration=analyses[0].configuration)

        async def save() -> int:
            assert owner is not None
            try:
                async with engine.begin() as connection:
                    await save_analysis(connection, owner, UUID(ids[0]), payload, storage)
                return 200
            except WorkspaceRepositoryError as error:
                return error.status_code

        assert sorted(await asyncio.gather(save(), save())) == [200, 409]
    finally:
        if owner:
            async with engine.begin() as connection:
                await connection.execute(delete(audit_events).where(
                    audit_events.c.actor_user_id == owner.id,
                ))
                await connection.execute(delete(survey_analyses).where(
                    survey_analyses.c.owner_user_id == owner.id,
                ))
                await connection.execute(delete(users).where(users.c.id == owner.id))
        await engine.dispose()
