"""Only a superadmin may edit their own organization without changing their role."""

import os
from datetime import UTC, datetime
from uuid import uuid4

import pytest
from pydantic import ValidationError
from sqlalchemy import func, insert, select, update
from sqlalchemy.ext.asyncio import create_async_engine

from yuksalish_api.auth import AuthenticatedUser
from yuksalish_api.directory_schemas import SelfSuperadminOrganizationUpdateRequest
from yuksalish_api.directory_service import (
    DirectoryServiceError,
    update_own_superadmin_organization,
)
from yuksalish_api.tables import audit_events, departments, positions, users


def test_self_organization_request_rejects_role_changes() -> None:
    position_id = uuid4()
    assert (
        SelfSuperadminOrganizationUpdateRequest.model_validate(
            {"positionId": str(position_id)}
        ).position_id
        == position_id
    )
    with pytest.raises(ValidationError):
        SelfSuperadminOrganizationUpdateRequest.model_validate({"role": "employee"})


@pytest.mark.anyio
async def test_regular_admin_is_rejected_before_database_access() -> None:
    admin = AuthenticatedUser(
        id=uuid4(),
        username="admin",
        full_name="Admin Test",
        position_id=None,
        job_title=None,
        role="admin",
    )
    with pytest.raises(DirectoryServiceError) as forbidden:
        await update_own_superadmin_organization(
            None,
            admin,
            SelfSuperadminOrganizationUpdateRequest(),  # type: ignore[arg-type]
        )
    assert forbidden.value.status_code == 403


@pytest.mark.anyio
@pytest.mark.postgres
async def test_superadmin_can_update_own_organization_only() -> None:
    database_url = os.environ.get("YUKSALISH_TEST_DATABASE_URL")
    if not database_url:
        pytest.skip("YUKSALISH_TEST_DATABASE_URL is not configured")
    engine = create_async_engine(database_url)
    self_id, admin_id = uuid4(), uuid4()
    original_department_id, new_department_id = uuid4(), uuid4()
    original_position_id, new_position_id = uuid4(), uuid4()
    now = datetime.now(UTC)
    try:
        async with engine.connect() as connection:
            transaction = await connection.begin()
            try:
                for department_id, suffix in (
                    (original_department_id, "old"),
                    (new_department_id, "new"),
                ):
                    await connection.execute(
                        insert(departments).values(
                            id=department_id,
                            code=f"self-org-{self_id.hex[:8]}-{suffix}",
                            name=f"Test {suffix}",
                            scope="central",
                            created_at=now,
                        )
                    )
                for position_id, name in (
                    (original_position_id, "Original Position"),
                    (new_position_id, "New Position"),
                ):
                    await connection.execute(
                        insert(positions).values(
                            id=position_id,
                            name=name,
                            is_active=True,
                            sort_order=0,
                            source="manual",
                            created_at=now,
                            updated_at=now,
                        )
                    )
                await connection.execute(
                    insert(users).values(
                        id=self_id,
                        username=f"self-org-{self_id.hex[:8]}",
                        full_name="Superadmin Test",
                        role="superadmin",
                        status="active",
                        department_id=original_department_id,
                        position_id=original_position_id,
                        job_title="Original Position",
                        created_at=now,
                        updated_at=now,
                    )
                )
                await connection.execute(
                    insert(users).values(
                        id=admin_id,
                        username=f"self-org-{admin_id.hex[:8]}",
                        full_name="Admin Test",
                        role="admin",
                        status="active",
                        created_at=now,
                        updated_at=now,
                    )
                )
                superadmin = AuthenticatedUser(
                    id=self_id,
                    username="superadmin",
                    full_name="Superadmin Test",
                    position_id=original_position_id,
                    job_title="Original Position",
                    role="superadmin",
                )
                admin = AuthenticatedUser(
                    id=admin_id,
                    username="admin",
                    full_name="Admin Test",
                    position_id=None,
                    job_title=None,
                    role="admin",
                )
                payload = SelfSuperadminOrganizationUpdateRequest(
                    position_id=new_position_id,
                    department_id=new_department_id,
                )
                with pytest.raises(DirectoryServiceError) as forbidden:
                    await update_own_superadmin_organization(connection, admin, payload)
                assert forbidden.value.status_code == 403

                saved = await update_own_superadmin_organization(connection, superadmin, payload)
                assert saved.role == "superadmin"
                assert saved.position_id == str(new_position_id)
                assert saved.department_id == str(new_department_id)
                assert saved.job_title == "New Position"
                persisted = (
                    (
                        await connection.execute(
                            select(
                                users.c.role,
                                users.c.department_id,
                                users.c.position_id,
                                users.c.job_title,
                            ).where(users.c.id == self_id)
                        )
                    )
                    .mappings()
                    .one()
                )
                assert persisted["role"] == "superadmin"
                assert persisted["department_id"] == new_department_id
                assert persisted["position_id"] == new_position_id
                assert persisted["job_title"] == "New Position"
                audit_count = await connection.scalar(
                    select(func.count())
                    .select_from(audit_events)
                    .where(
                        audit_events.c.target_id == self_id,
                        audit_events.c.action == "employee.own_organization_updated",
                    )
                )
                assert audit_count == 1

                await update_own_superadmin_organization(connection, superadmin, payload)
                assert (
                    await connection.scalar(
                        select(func.count())
                        .select_from(audit_events)
                        .where(
                            audit_events.c.target_id == self_id,
                            audit_events.c.action == "employee.own_organization_updated",
                        )
                    )
                    == 1
                )
                with pytest.raises(DirectoryServiceError) as missing_position:
                    await update_own_superadmin_organization(
                        connection,
                        superadmin,
                        SelfSuperadminOrganizationUpdateRequest(position_id=uuid4()),
                    )
                assert missing_position.value.status_code == 422
                await connection.execute(
                    update(positions)
                    .where(positions.c.id == original_position_id)
                    .values(is_active=False)
                )
                with pytest.raises(DirectoryServiceError) as inactive_position:
                    await update_own_superadmin_organization(
                        connection,
                        superadmin,
                        SelfSuperadminOrganizationUpdateRequest(position_id=original_position_id),
                    )
                assert inactive_position.value.status_code == 422
                with pytest.raises(DirectoryServiceError) as missing_department:
                    await update_own_superadmin_organization(
                        connection,
                        superadmin,
                        SelfSuperadminOrganizationUpdateRequest(
                            position_id=new_position_id,
                            department_id=uuid4(),
                        ),
                    )
                assert missing_department.value.status_code == 422
                assert (
                    await connection.scalar(select(users.c.role).where(users.c.id == self_id))
                    == "superadmin"
                )
            finally:
                await transaction.rollback()
    finally:
        await engine.dispose()
