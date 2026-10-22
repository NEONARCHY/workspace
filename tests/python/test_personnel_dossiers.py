import asyncio
import os
from contextlib import asynccontextmanager
from datetime import UTC, date, datetime
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
from fastapi import FastAPI, HTTPException, Response
from httpx import ASGITransport, AsyncClient
from pydantic import ValidationError
from sqlalchemy import insert, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import create_async_engine

import yuksalish_api.routers.dossiers as dossier_router
from yuksalish_api import dossier_service as service
from yuksalish_api.auth import AuthenticatedUser, load_authenticated_user, require_user
from yuksalish_api.database import get_connection
from yuksalish_api.dossier_documents import render_dossier_docx
from yuksalish_api.dossier_schemas import (
    DossierAccessRule,
    DossierAccessWrite,
    DossierFields,
    DossierRelative,
    DossierWrite,
)
from yuksalish_api.dossier_tables import dossier_history
from yuksalish_api.errors import WorkspaceRepositoryError
from yuksalish_api.object_storage import ObjectStorage, ObjectStorageError
from yuksalish_api.repository import load_workspace
from yuksalish_api.routers.dossiers import router
from yuksalish_api.seed import seed_demo_data
from yuksalish_api.tables import audit_events, departments, hr_settings, users


@asynccontextmanager
async def scenario():
    url = os.environ.get("YUKSALISH_TEST_DATABASE_URL")
    if not url:
        pytest.skip("YUKSALISH_TEST_DATABASE_URL is not configured")
    if "/yuksalish_test" not in url:
        raise RuntimeError("Personnel dossier checks require a dedicated test database")
    engine = create_async_engine(url)
    try:
        await seed_demo_data(engine)
        async with engine.connect() as connection:
            transaction = await connection.begin()
            try:
                ids = [(await connection.scalar(select(users.c.id).where(
                    users.c.username == name,
                ))) for name in ("baxtiyor", "aziza", "dilshod", "malika")]
                dept_a, dept_b = uuid4(), uuid4()
                await connection.execute(insert(departments), [{
                    "id": identity, "code": str(identity), "name": "QA department",
                    "scope": "central", "created_at": datetime.now(UTC),
                } for identity in (dept_a, dept_b)])
                actors: dict[str, AuthenticatedUser] = {}
                for name, identity in zip(("employee", "hr", "deputy", "admin"), ids, strict=True):
                    await connection.execute(update(users).where(users.c.id == identity).values(
                        role="admin" if name == "admin" else "employee", status="active",
                        job_title="Rais o'rinbosari" if name == "deputy" else "Mutaxassis",
                        department_id=dept_a if name == "employee" else dept_b,
                    ))
                    actor = await load_authenticated_user(connection, identity)
                    assert actor is not None
                    actors[name] = actor
                settings = pg_insert(hr_settings).values(id=1, hr_user_id=actors["hr"].id)
                await connection.execute(settings.on_conflict_do_update(
                    index_elements=[hr_settings.c.id], set_={"hr_user_id": actors["hr"].id,
                                                            "chair_user_id": None},
                ))
                yield connection, actors
            finally:
                await transaction.rollback()
    finally:
        await engine.dispose()


def data(revision=0, status="saved"):
    return DossierWrite(revision=revision, status=status, fields=DossierFields(
        birth_date=date(1991, 5, 12), birth_place="PRIVATE BIRTHPLACE",
        education=[{"institution": "QA University", "graduationYear": 2013}],
        additional_info="PRIVATE NOTES",
    ))


def test_validation_and_explicit_capabilities():
    employee, other, department = uuid4(), uuid4(), uuid4()
    policy = service.DossierPolicy(employee, False, False, False, False, ())
    assert policy.allowed(employee, None, "view")
    assert policy.allowed(employee, None, "edit")
    assert not policy.allowed(other, None, "view")
    photo_only = DossierAccessRule(grantee_user_id=employee, scope="department",
                                    scope_id=department, photo_roster=True)
    policy = service.DossierPolicy(employee, False, False, False, False, (photo_only,))
    assert policy.allowed(other, department, "photo_roster")
    assert not policy.allowed(other, department, "view")
    assert not policy.allowed(other, uuid4(), "photo_roster")
    for payload in ({"birthDate": "2999-01-01"}, {"jobTitle": "Administrator"},
                    {"education": [{"institution": ""}]},
                    {"employment": [{"organization": "A", "position": "B",
                                      "startDate": "2025-02-01", "endDate": "2024-01-01"}]}):
        with pytest.raises(ValidationError):
            DossierFields.model_validate(payload)
    with pytest.raises(ValidationError):
        DossierAccessRule(grantee_user_id=employee, scope="all", edit=True)
    with pytest.raises(ValidationError):
        DossierAccessRule(grantee_user_id=employee, scope="employee", view=True)
    with pytest.raises(ValidationError):
        DossierAccessWrite(revision=0, rules=[photo_only, photo_only], reason="QA duplicate")
    assert service.is_photo_roster_leader("Rais birinchi o'rinbosari \u2013 ijrochi direktor")
    assert not service.is_photo_roster_leader("Rais o'rinbosari yordamchisi")
    assert not service.is_photo_roster_leader("Bo'lim boshlig'i")


def test_self_edit_is_private_versioned_and_not_public_bootstrap():
    async def run():
        async with scenario() as (connection, actors):
            employee, other = actors["employee"], actors["deputy"]
            record = await service.detail(connection, employee, employee.id)
            assert record.status == "empty" and record.revision == 0
            saved = await service.save(connection, employee, employee.id, data(status="draft"))
            assert saved.status == "draft" and saved.revision == 1
            assert saved.full_name == employee.full_name
            await service.save(connection, employee, employee.id, data(1))
            with pytest.raises(WorkspaceRepositoryError) as conflict:
                await service.save(connection, employee, employee.id, data(1))
            assert conflict.value.status_code == 409
            assert (await service.detail(connection, employee, employee.id)).revision == 2
            assert [r.user_id for r in await service.listing(connection, employee)] == [employee.id]
            for operation in (service.detail(connection, other, employee.id),
                              service.save(connection, other, employee.id, data(2)),
                              service.history(connection, other, employee.id),
                              service.photos(connection, employee),
                              service.get_access(connection, employee)):
                with pytest.raises(WorkspaceRepositoryError) as denied:
                    await operation
                assert denied.value.status_code == 403
            assert not (await service.permissions(connection, other, employee.id)).can_view
            history = await service.history(connection, employee, employee.id)
            assert [r.revision for r in history] == [2, 1]
            assert "PRIVATE" not in str([r.model_dump() for r in history])
            audit = (await connection.execute(select(audit_events.c.details).where(
                audit_events.c.target_type == "personnel_dossier",
            ))).scalars().all()
            assert "PRIVATE" not in str(audit)
            bootstrap = await load_workspace(connection, employee)
            assert "PRIVATE" not in bootstrap.model_dump_json()
    asyncio.run(run())


def test_scoped_grants_revocation_and_photo_projection():
    async def run():
        async with scenario() as (connection, actors):
            employee, hr, deputy, admin = (actors[key] for key in
                                           ("employee", "hr", "deputy", "admin"))
            await service.save(connection, hr, employee.id, data())
            assert (await service.detail(connection, hr, employee.id)).permissions.can_edit
            assert (await service.context(connection, deputy)).can_view_photo_roster
            assert not (await service.context(connection, deputy)).can_manage_access
            photos = await service.photos(connection, deputy)
            card = next(item for item in photos if item.user_id == employee.id)
            assert card.birth_year == 1991 and card.universities == ["QA University"]
            assert set(card.model_dump()) == {"user_id", "full_name", "job_title",
                                              "department_id", "birth_year", "universities"}
            assert "PRIVATE" not in card.model_dump_json()
            initial = await service.get_access(connection, admin)
            rule = DossierAccessRule(grantee_user_id=deputy.id, scope="employee",
                                     scope_id=employee.id, view=True)
            for actor in (hr, employee, deputy):
                with pytest.raises(WorkspaceRepositoryError):
                    await service.save_access(connection, actor, DossierAccessWrite(
                        revision=initial.revision, rules=[rule], reason="QA escalation",
                    ))
            granted = await service.save_access(connection, admin, DossierAccessWrite(
                revision=initial.revision, rules=[rule], reason="QA read-only review",
            ))
            assert (await service.detail(connection, deputy, employee.id)).permissions.can_view
            assert not (await service.permissions(connection, deputy, employee.id)).can_edit
            with pytest.raises(WorkspaceRepositoryError):
                await service.save(connection, deputy, employee.id, data(1))
            with pytest.raises(WorkspaceRepositoryError) as stale:
                await service.save_access(connection, admin, DossierAccessWrite(
                    revision=initial.revision, rules=[], reason="QA stale version",
                ))
            assert stale.value.status_code == 409
            await service.save_access(connection, admin, DossierAccessWrite(
                revision=granted.revision, rules=[], reason="QA revoke",
            ))
            assert not (await service.permissions(connection, deputy, employee.id)).can_view
            assert await connection.scalar(select(dossier_history.c.revision).where(
                dossier_history.c.user_id == employee.id,
            )) == 1
    asyncio.run(run())


def test_department_scope_follows_current_membership_and_http_responses_are_private():
    async def run():
        async with scenario() as (connection, actors):
            employee, deputy, admin = (actors[key] for key in ("employee", "deputy", "admin"))
            initial = await service.get_access(connection, admin)
            await service.save_access(connection, admin, DossierAccessWrite(
                revision=initial.revision, reason="QA scoped edit", rules=[DossierAccessRule(
                    grantee_user_id=deputy.id, scope="department", scope_id=employee.department_id,
                    view=True, edit=True,
                )],
            ))
            assert (await service.permissions(connection, deputy, employee.id)).can_edit
            app = FastAPI()
            app.include_router(router, prefix="/api/v1")
            app.dependency_overrides[require_user] = lambda: deputy
            async def get_test_connection():
                yield connection
            app.dependency_overrides[get_connection] = get_test_connection
            async with AsyncClient(
                transport=ASGITransport(app=app), base_url="http://test",
            ) as client:
                response = await client.put(f"/api/v1/personnel-dossiers/{employee.id}",
                                            json=data().model_dump(mode="json", by_alias=True))
                assert response.status_code == 200
                assert response.headers["cache-control"] == "no-store"
                assert response.json()["revision"] == 1
                await connection.execute(update(users).where(users.c.id == employee.id).values(
                    department_id=deputy.department_id,
                ))
                assert not (await service.permissions(connection, deputy, employee.id)).can_view
                response = await client.get(f"/api/v1/personnel-dossiers/{employee.id}")
                assert response.status_code == 403 and "PRIVATE" not in response.text
                response = await client.put("/api/v1/personnel-dossiers/access", json={
                    "revision": 1, "rules": [], "reason": "Forbidden mutation",
                })
                assert response.status_code == 403
    asyncio.run(run())


def test_word_export_is_private_revision_checked_and_revocable():
    async def run():
        async with scenario() as (connection, actors):
            employee, deputy, admin = (actors[key] for key in ("employee", "deputy", "admin"))
            payload = data()
            payload.fields.relatives = [DossierRelative(
                relationship="PRIVATE KINSHIP", full_name="PRIVATE RELATIVE",
                address="PRIVATE ADDRESS",
            )]
            await service.save(connection, employee, employee.id, payload)
            storage = AsyncMock(spec=ObjectStorage)
            app = FastAPI()
            app.state.object_storage = storage
            app.include_router(router, prefix="/api/v1")
            app.dependency_overrides[require_user] = lambda: employee
            async def get_test_connection():
                yield connection
            app.dependency_overrides[get_connection] = get_test_connection
            url = f"/api/v1/personnel-dossiers/{employee.id}/word"
            async with AsyncClient(
                transport=ASGITransport(app=app), base_url="http://test",
            ) as client:
                exported = await client.get(url, params={"revision": 1})
                assert exported.status_code == 200 and exported.content.startswith(b"PK")
                assert exported.headers["cache-control"] == "private, no-store"
                assert "attachment;" in exported.headers["content-disposition"]
                assert (await client.get(url, params={"revision": 2})).status_code == 409
                assert (await client.get(url, params={"revision": 0})).status_code == 422
                app.dependency_overrides[require_user] = lambda: deputy
                forbidden = await client.get(url, params={"revision": 1})
                assert forbidden.status_code == 403
                assert forbidden.headers["cache-control"] == "no-store"
                assert "PRIVATE" not in forbidden.text
                storage.get.assert_not_awaited()
                initial = await service.get_access(connection, admin)
                rule = DossierAccessRule(grantee_user_id=deputy.id, scope="employee",
                                         scope_id=employee.id, view=True)
                granted = await service.save_access(connection, admin, DossierAccessWrite(
                    revision=initial.revision, rules=[rule], reason="QA export review",
                ))
                assert (await client.get(url, params={"revision": 1})).status_code == 200
                assert not (await service.permissions(connection, deputy, employee.id)).can_edit
                await service.save_access(connection, admin, DossierAccessWrite(
                    revision=granted.revision, rules=[], reason="QA revoke export",
                ))
                assert (await client.get(url, params={"revision": 1})).status_code == 403
                app.dependency_overrides[require_user] = lambda: employee
                await connection.execute(update(users).where(users.c.id == employee.id).values(
                    avatar_storage_key="qa-failed-avatar",
                ))
                storage.get.side_effect = ObjectStorageError("Storage unavailable")
                assert (await client.get(url, params={"revision": 1})).status_code == 503
            rows = (await connection.execute(select(audit_events.c.details).where(
                audit_events.c.target_id == employee.id,
                audit_events.c.action == "dossier.word_exported",
            ))).scalars().all()
            assert len(rows) == 2
            assert all(value == {"revision": 1} for value in rows)
            assert "PRIVATE" not in str(await service.photos(connection, deputy))
    asyncio.run(run())


def test_import_preview_and_pdf_use_object_permissions_and_never_autosave(monkeypatch):
    converter = AsyncMock(return_value=Response(b"%PDF-1.7\nQA", media_type="application/pdf",
                                               headers={"Cache-Control": "private, no-store"}))
    monkeypatch.setattr(dossier_router, "render_word_pdf", converter)
    async def run():
        async with scenario() as (connection, actors):
            employee, deputy, admin = (actors[key] for key in ("employee", "deputy", "admin"))
            await service.save(connection, employee, employee.id, data())
            record = await service.detail(connection, employee, employee.id)
            record.fields.birth_place = "IMPORTED ONLY, NOT SAVED"
            document = render_dossier_docx(record)
            app = FastAPI()
            app.state.object_storage = AsyncMock(spec=ObjectStorage)
            app.state.settings = object()
            app.include_router(router, prefix="/api/v1")
            app.dependency_overrides[require_user] = lambda: deputy
            async def get_test_connection():
                yield connection
            app.dependency_overrides[get_connection] = get_test_connection
            base = f"/api/v1/personnel-dossiers/{employee.id}"
            async with AsyncClient(
                transport=ASGITransport(app=app), base_url="http://test",
            ) as client:
                forbidden = await client.post(f"{base}/import-preview", content=document)
                assert forbidden.status_code == 403
                assert (await client.get(f"{base}/pdf?revision=1")).status_code == 403
                converter.assert_not_awaited()
                app.dependency_overrides[require_user] = lambda: employee
                preview = await client.post(f"{base}/import-preview", content=document)
                assert preview.status_code == 200
                assert preview.headers["cache-control"] == "no-store"
                assert preview.json()["fields"]["birthPlace"] == "IMPORTED ONLY, NOT SAVED"
                unchanged = await service.detail(connection, employee, employee.id)
                assert unchanged.revision == 1
                assert unchanged.fields.birth_place == "PRIVATE BIRTHPLACE"
                malformed = await client.post(f"{base}/import-preview", content=b"fake")
                assert malformed.status_code == 422
                assert (await client.post(f"{base}/import-preview",
                                         content=b"x" * (5 * 1024 * 1024 + 1))).status_code == 413
                pdf = await client.get(f"{base}/pdf?revision=1")
                assert pdf.status_code == 200 and pdf.content.startswith(b"%PDF-")
                assert pdf.headers["content-type"] == "application/pdf"
                assert "personnel-dossier.pdf" in pdf.headers["content-disposition"]
                assert (await client.get(f"{base}/pdf?revision=2")).status_code == 409
                initial = await service.get_access(connection, admin)
                await service.save_access(connection, admin, DossierAccessWrite(
                    revision=initial.revision, reason="QA read only", rules=[DossierAccessRule(
                        grantee_user_id=deputy.id, scope="employee", scope_id=employee.id,
                        view=True,
                    )],
                ))
                app.dependency_overrides[require_user] = lambda: deputy
                forbidden = await client.post(f"{base}/import-preview", content=document)
                assert forbidden.status_code == 403
                assert (await client.get(f"{base}/pdf?revision=1")).status_code == 200
                converter.side_effect = HTTPException(503, "Converter busy")
                assert (await client.get(f"{base}/pdf?revision=1")).status_code == 503
            exported = (await connection.execute(select(audit_events.c.details).where(
                audit_events.c.target_id == employee.id,
                audit_events.c.action == "dossier.pdf_exported",
            ))).scalars().all()
            assert exported == [{"revision": 1}, {"revision": 1}]
            imported = (await connection.execute(select(audit_events.c.details).where(
                audit_events.c.target_id == employee.id,
                audit_events.c.action == "dossier.import_previewed",
            ))).scalars().all()
            assert len(imported) == 1 and list(imported[0]) == ["fieldCount"]
    asyncio.run(run())
