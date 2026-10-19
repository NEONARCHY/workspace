"""Transactional reference catalog behavior on an isolated PostgreSQL database."""

import os
from datetime import UTC, datetime
from uuid import UUID, uuid4

import pytest
from fastapi import HTTPException
from sqlalchemy import insert
from sqlalchemy.ext.asyncio import create_async_engine

from yuksalish_api.access_control import ensure_module_action
from yuksalish_api.auth import AuthenticatedUser
from yuksalish_api.errors import WorkspaceRepositoryError
from yuksalish_api.object_storage import InMemoryObjectStorage
from yuksalish_api.reference_schemas import (
    ExpertFields,
    PartnerFields,
    ProfileWrite,
    TemplateFields,
)
from yuksalish_api.reference_service import (
    create_expert,
    create_partner,
    create_template,
    get_template_version,
    load_directory,
    save_profile,
    upload_template_version,
)
from yuksalish_api.tables import users


def actor(user_id: UUID, role: str) -> AuthenticatedUser:
    return AuthenticatedUser(
        id=user_id, username=f"ref-{user_id.hex[:8]}", full_name="Test User",
        position_id=None, job_title=None, role=role,
    )


@pytest.mark.anyio
@pytest.mark.postgres
async def test_reference_records_versions_permissions_and_revisions() -> None:
    database_url = os.environ.get("YUKSALISH_TEST_DATABASE_URL")
    if not database_url:
        pytest.skip("YUKSALISH_TEST_DATABASE_URL is not configured")
    engine = create_async_engine(database_url)
    admin_id, employee_id = uuid4(), uuid4()
    storage = InMemoryObjectStorage()
    try:
        async with engine.connect() as connection:
            transaction = await connection.begin()
            try:
                for user_id, role in ((admin_id, "admin"), (employee_id, "employee")):
                    await connection.execute(insert(users).values(
                        id=user_id, username=f"ref-{user_id.hex[:12]}",
                        full_name="Test User", role=role, status="active",
                        created_at=datetime.now(UTC), updated_at=datetime.now(UTC),
                    ))
                admin, employee = actor(admin_id, "admin"), actor(employee_id, "employee")
                await ensure_module_action(connection, employee, "reference", "view")
                with pytest.raises(HTTPException) as denied:
                    await ensure_module_action(connection, employee, "reference", "edit")
                assert getattr(denied.value, "status_code", None) == 403

                initial = await load_directory(connection)
                assert initial.profile.revision == 0
                assert initial.profile.legal_name == ""
                saved = await save_profile(connection, admin, ProfileWrite(
                    legal_name="Yuksalish test", tin="123456789", expected_revision=0,
                ))
                assert saved.revision == 1
                with pytest.raises(WorkspaceRepositoryError) as stale:
                    await save_profile(connection, admin, ProfileWrite(
                        legal_name="Stale", expected_revision=0,
                    ))
                assert stale.value.status_code == 409

                partner = await create_partner(connection, admin, PartnerFields(
                    name="Test donor", kind="donor", tin="998877665",
                ))
                with pytest.raises(WorkspaceRepositoryError) as duplicate:
                    await create_partner(connection, admin, PartnerFields(
                        name="Another donor", kind="donor", tin="998877665",
                    ))
                assert duplicate.value.status_code == 409
                expert = await create_expert(connection, admin, ExpertFields(
                    name="Test Expert", specialization="Grants", partner_id=partner.id,
                ))
                assert expert.partner_id == partner.id
                template = await create_template(connection, admin, TemplateFields(
                    title="Grant application", kind="grant", locale="ru",
                ))
                assert not (await load_directory(connection)).templates
                drafts = await load_directory(connection, include_drafts=True)
                assert drafts.templates[0].id == template.id
                first = await upload_template_version(
                    connection, admin, storage, template.id, template.revision,
                    "grant.pdf", b"%PDF-1.4\n%%EOF",
                )
                assert first.version == 1
                stored = await get_template_version(connection, template.id)
                assert await storage.get(str(stored["storage_key"])) == b"%PDF-1.4\n%%EOF"
                with pytest.raises(WorkspaceRepositoryError) as stale_upload:
                    await upload_template_version(
                        connection, admin, storage, template.id, template.revision,
                        "grant.pdf", b"%PDF-1.4\n%%EOF",
                    )
                assert stale_upload.value.status_code == 409
                loaded = await load_directory(connection)
                assert loaded.templates[0].versions[0].version == 1
                assert loaded.changes[0].action == "reference.template.file_uploaded"
            finally:
                await transaction.rollback()
    finally:
        await engine.dispose()
