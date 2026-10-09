"""Real transactions and current department membership; synthetic data only."""

import asyncio
import os
from datetime import UTC, datetime
from uuid import uuid4

import pytest
from fastapi import HTTPException
from sqlalchemy import delete, insert, select, update
from sqlalchemy.ext.asyncio import create_async_engine

from yuksalish_api.auth import AuthenticatedUser
from yuksalish_api.edo_access import read_access, resolve_read_scope, save_access
from yuksalish_api.edo_schemas import EdoAccessUpdate
from yuksalish_api.tables import audit_events, departments, edo_incoming_access, users


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.mark.anyio
@pytest.mark.postgres
async def test_visibility_rules_membership_revocation_audit_and_concurrent_saves():
    url = os.environ.get("YUKSALISH_TEST_DATABASE_URL")
    if not url:
        pytest.skip("YUKSALISH_TEST_DATABASE_URL is not configured")
    engine = create_async_engine(url)
    ids = {
        key: uuid4() for key in ("admin", "superadmin", "manager", "member", "outside", "blocked")
    }
    dept, other_dept = uuid4(), uuid4()
    now = datetime.now(UTC)

    def actor(key):
        return AuthenticatedUser(
            id=ids[key],
            username="synthetic",
            full_name="Synthetic",
            position_id=None,
            job_title=None,
            role=key if key in {"admin", "superadmin", "manager"} else "employee",
        )

    try:
        async with engine.begin() as connection:
            await connection.execute(
                insert(departments),
                [
                    {
                        "id": value,
                        "name": f"EDO test {value}",
                        "code": value.hex,
                        "created_at": now,
                        "updated_at": now,
                    }
                    for value in (dept, other_dept)
                ],
            )
            await connection.execute(
                insert(users),
                [
                    {
                        "id": value,
                        "username": f"edo-test-{value.hex}",
                        "full_name": "Synthetic",
                        "role": key if key in {"admin", "superadmin", "manager"} else "employee",
                        "status": "blocked" if key == "blocked" else "active",
                        "department_id": dept if key in {"member", "blocked"} else other_dept,
                        "created_at": now,
                        "updated_at": now,
                    }
                    for key, value in ids.items()
                ],
            )
        async with engine.begin() as connection:
            for key in ("admin", "superadmin"):
                assert (await resolve_read_scope(connection, actor(key))).mode == "all"
            assert (await resolve_read_scope(connection, actor("manager"))).mode == "assigned"
            saved = await save_access(
                connection,
                actor("admin"),
                ids["manager"],
                EdoAccessUpdate(
                    expected_revision=0,
                    mode="departments",
                    department_ids=[dept],
                ),
            )
            assert saved.revision == 1
            scope = await resolve_read_scope(connection, actor("manager"))
            assert set(scope.employee_ids) == {ids["manager"], ids["member"]}
            assert ids["blocked"] not in scope.employee_ids
            config = await read_access(connection, actor("admin"))
            assert not next(item for item in config.rules if item.user_id == ids["admin"]).editable
            assert next(item for item in config.rules if item.user_id == ids["manager"]).editable

        # Moving a member removes them without saving a new manager rule.
        async with engine.begin() as connection:
            await connection.execute(
                update(users).where(users.c.id == ids["member"]).values(department_id=other_dept)
            )
            assert (await resolve_read_scope(connection, actor("manager"))).employee_ids == (
                ids["manager"],
            )
            await connection.execute(
                update(users).where(users.c.id == ids["outside"]).values(department_id=dept)
            )
            scope = await resolve_read_scope(connection, actor("manager"))
            assert set(scope.employee_ids) == {ids["manager"], ids["outside"]}
            await connection.execute(
                update(users).where(users.c.id == ids["outside"]).values(status="blocked")
            )
            assert (await resolve_read_scope(connection, actor("manager"))).employee_ids == (
                ids["manager"],
            )

        for target, payload, status in (
            (ids["admin"], EdoAccessUpdate(expected_revision=0, mode="assigned"), 422),
            (ids["manager"], EdoAccessUpdate(expected_revision=0, mode="all"), 409),
            (
                ids["manager"],
                EdoAccessUpdate(expected_revision=1, mode="departments", department_ids=[uuid4()]),
                422,
            ),
        ):
            with pytest.raises(HTTPException) as caught:
                async with engine.begin() as connection:
                    await save_access(connection, actor("admin"), target, payload)
            assert caught.value.status_code == status

        async def concurrent_save(mode):
            try:
                async with engine.begin() as connection:
                    await save_access(
                        connection,
                        actor("admin"),
                        ids["manager"],
                        EdoAccessUpdate(
                            expected_revision=1,
                            mode=mode,
                        ),
                    )
                return 200
            except HTTPException as error:
                return error.status_code

        assert sorted(
            await asyncio.gather(concurrent_save("all"), concurrent_save("assigned"))
        ) == [200, 409]
        async with engine.begin() as connection:
            row = (
                (
                    await connection.execute(
                        select(edo_incoming_access).where(
                            edo_incoming_access.c.user_id == ids["manager"]
                        )
                    )
                )
                .mappings()
                .one()
            )
            assert row["revision"] == 2
            events = (
                (
                    await connection.execute(
                        select(audit_events.c.details).where(
                            audit_events.c.target_id == ids["manager"],
                            audit_events.c.action == "edo.incoming_visibility_updated",
                        )
                    )
                )
                .scalars()
                .all()
            )
            assert len(events) == 2
            await save_access(
                connection,
                actor("superadmin"),
                ids["manager"],
                EdoAccessUpdate(
                    expected_revision=2,
                    mode="assigned",
                ),
            )
            assert (await resolve_read_scope(connection, actor("manager"))).mode == "assigned"
    finally:
        async with engine.begin() as connection:
            await connection.execute(
                delete(audit_events).where(audit_events.c.target_id.in_(ids.values()))
            )
            await connection.execute(
                delete(edo_incoming_access).where(edo_incoming_access.c.user_id.in_(ids.values()))
            )
            await connection.execute(delete(users).where(users.c.id.in_(ids.values())))
            await connection.execute(
                delete(departments).where(departments.c.id.in_([dept, other_dept]))
            )
        await engine.dispose()
