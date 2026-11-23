import os
from dataclasses import replace
from datetime import UTC, datetime
from uuid import UUID, uuid4

import pytest
from sqlalchemy import insert, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import create_async_engine

from yuksalish_api.assistant_service import _visible_notification_rows
from yuksalish_api.auth import AuthenticatedUser
from yuksalish_api.position_policy import EXECUTIVE_LEADER_POSITION_NAME
from yuksalish_api.repository import (
    WorkspaceRepositoryError,
    _task_access_row,
    _task_response,
    add_task_checklist_item,
    create_attachment,
    create_task,
    get_attachment,
    load_task_history,
    load_workspace,
    mark_notification_read,
)
from yuksalish_api.seed import seed_demo_data
from yuksalish_api.tables import (
    departments,
    hr_settings,
    task_participants,
    users,
    workspace_notifications,
)
from yuksalish_api.task_plan_schemas import TaskPlanWrite
from yuksalish_api.task_plan_service import change_link, create_plan, list_plans
from yuksalish_api.task_visibility import has_global_task_title_access
from yuksalish_api.workspace_schemas import (
    CreateChecklistItemRequest,
    CreateTaskRequest,
    TaskCreateDependencyRequest,
    TaskCreateParticipantRequest,
)


def actor(role: str = "employee", title: str | None = None) -> AuthenticatedUser:
    identifier = uuid4()
    return AuthenticatedUser(identifier, f"scope-{identifier.hex}", "Task scope", None, title, role)


@pytest.mark.parametrize(("role", "title", "expected"), [
    ("admin", None, True), ("superadmin", None, True),
    ("employee", EXECUTIVE_LEADER_POSITION_NAME, True),
    ("employee", "Rais o\u2018rinbosari", True),
    ("employee", "Raisning birinchi o'rinbosari \u2013 ijrochi direktor", True),
    ("employee", "Kadrlar bo'yicha bosh mutaxassis", True),
    ("manager", None, False), ("employee", None, False),
    ("manager", "Tahlil bo'limi boshlig'i", False),
    ("employee", "Rais o'rinbosari yordamchisi", False),
    ("manager", "Viloyat rais o'rinbosari", False),
])
def test_only_confirmed_global_positions_and_admins_have_all_task_access(
    role: str, title: str | None, expected: bool,
) -> None:
    assert has_global_task_title_access(actor(role, title)) is expected


@pytest.mark.anyio
@pytest.mark.postgres
async def test_task_scope_is_shared_by_lists_cards_files_plans_history_and_notices() -> None:
    database_url = os.environ.get("YUKSALISH_TEST_DATABASE_URL")
    if not database_url:
        pytest.skip("YUKSALISH_TEST_DATABASE_URL is not configured")
    engine = create_async_engine(database_url)
    try:
        await seed_demo_data(engine)
        async with engine.connect() as connection:
            transaction = await connection.begin()
            try:
                department_id, other_department_id = uuid4(), uuid4()
                now = datetime.now(UTC)
                for identifier in [department_id, other_department_id]:
                    await connection.execute(insert(departments).values(
                        id=identifier, code=f"S-{identifier.hex[:12]}", name="Task scope",
                        scope="central", created_at=now,
                    ))
                actors = {
                    "admin": actor("admin"), "superadmin": actor("superadmin"),
                    "chair": actor("manager", EXECUTIVE_LEADER_POSITION_NAME),
                    "deputy": actor(title="Rais o\u2018rinbosari"),
                    "first_deputy": actor(
                        title="Rais birinchi o\u2018rinbosari \u2013 ijrochi direktor",
                    ),
                    "hr": actor(title="Kadrlar bo'yicha bosh mutaxassis"),
                    "appointed_hr": actor(title="Inson kapitali bo'yicha bo'lim"),
                    "no_department": actor("manager"),
                    "manager": replace(actor("manager"), department_id=department_id),
                    "head": replace(actor(title="Tahlil bo'limi boshlig'i"),
                                    department_id=department_id),
                    "member": replace(actor(), department_id=department_id),
                    "nested": replace(actor(), department_id=department_id),
                    "peer": replace(actor(), department_id=department_id),
                    "regular": replace(actor(), department_id=department_id),
                    "other": replace(actor(), department_id=other_department_id),
                    "outsider": actor(),
                }
                for key in ["admin", "superadmin", "chair", "deputy", "first_deputy",
                            "hr", "appointed_hr"]:
                    actors[key] = replace(actors[key], department_id=department_id)
                for person in actors.values():
                    await connection.execute(insert(users).values(
                        id=person.id, username=person.username, full_name=person.full_name,
                        role=person.role, job_title=person.job_title,
                        department_id=person.department_id, status="active",
                        created_at=now, updated_at=now,
                    ))
                for member, manager in [("member", "manager"), ("nested", "member"),
                                        ("peer", "head"), ("other", "manager")]:
                    await connection.execute(update(users).where(
                        users.c.id == actors[member].id,
                    ).values(direct_manager_user_id=actors[manager].id))
                # A department's reporting contact is not automatically its boss.
                await connection.execute(update(departments).where(
                    departments.c.id == department_id,
                ).values(lead_user_id=actors["regular"].id))
                await connection.execute(pg_insert(hr_settings).values(
                    id=1, hr_user_id=actors["appointed_hr"].id,
                ).on_conflict_do_update(index_elements=[hr_settings.c.id], set_={
                    "hr_user_id": actors["appointed_hr"].id,
                }))
                admin = actors["admin"]
                records = {}
                for key in ["member", "nested", "peer", "regular", "other", "manager",
                            "head", "no_department", "outsider"]:
                    records[key] = await create_task(connection, admin, CreateTaskRequest(
                        title=f"Scoped task {key}", assignee_id=str(actors[key].id),
                    ))
                records["own_author"] = await create_task(
                    connection, actors["manager"], CreateTaskRequest(
                        title="Scoped task own_author", assignee_id=str(actors["other"].id),
                    ),
                )
                records["regular_author"] = await create_task(
                    connection, actors["regular"], CreateTaskRequest(
                        title="Scoped task regular_author", assignee_id=str(actors["other"].id),
                    ),
                )
                for key, author, assignee in [
                    ("leaders_private", "first_deputy", "deputy"),
                    ("chair_private", "chair", "appointed_hr"),
                    ("hr_private", "admin", "hr"),
                ]:
                    records[key] = await create_task(connection, actors[author], CreateTaskRequest(
                        title=f"Scoped task {key}", assignee_id=str(actors[assignee].id),
                    ))
                for key, person, role in [("own_observer", "manager", "observer"),
                                          ("team_observer", "member", "observer"),
                                          ("regular_observer", "regular", "observer"),
                                          ("co_assignee", "regular", "co_assignee")]:
                    records[key] = await create_task(connection, admin, CreateTaskRequest(
                        title=f"Scoped task {key}", assignee_id=str(admin.id), participants=[
                            TaskCreateParticipantRequest(user_id=str(actors[person].id), role=role),
                        ],
                    ))
                records["linked"] = await create_task(connection, admin, CreateTaskRequest(
                    title="Scoped task linked", assignee_id=str(actors["member"].id),
                    parent_task_id=records["outsider"].id, dependencies=[
                        TaskCreateDependencyRequest(depends_on_task_id=records["outsider"].id),
                    ],
                ))
                all_ids = {item.id for item in records.values()}
                expected = {key: set(records) for key in [
                    "admin", "superadmin", "chair", "deputy", "first_deputy", "hr", "appointed_hr",
                ]}
                expected.update({
                    "manager": {"member", "nested", "manager", "own_author", "own_observer",
                                "team_observer", "linked"},
                    "head": set(records) - {"other", "no_department", "outsider",
                                            "leaders_private", "chair_private", "hr_private"},
                    "regular": {"regular", "co_assignee", "regular_author", "regular_observer"},
                    "no_department": {"no_department"},
                    "outsider": {"outsider"},
                })
                attachment = await create_attachment(
                    connection, admin, "task", UUID(records["other"].id),
                    file_name="scope.txt", content_type="text/plain", byte_size=1,
                    sha256="a" * 64, storage_key=f"scope/{uuid4()}",
                )
                plan = await create_plan(connection, admin, TaskPlanWrite(title="Scoped plan"))
                for record in records.values():
                    await change_link(
                        connection, admin, UUID(plan.id), UUID(record.id), linked=True,
                    )
                for key, visible_keys in expected.items():
                    person = actors[key]
                    visible_ids = {records[item].id for item in visible_keys}
                    snapshot = await load_workspace(connection, person)
                    assert {item.id for item in snapshot.tasks} & all_ids == visible_ids, key
                    listed = next(item for item in await list_plans(connection, person)
                                  if item.id == plan.id)
                    assert set(listed.task_ids) == visible_ids, key
                    for item in records.values():
                        if item.id in visible_ids:
                            row = await _task_access_row(connection, person, UUID(item.id))
                            assert row["id"] == UUID(item.id)
                        else:
                            with pytest.raises(WorkspaceRepositoryError) as denied:
                                await _task_access_row(connection, person, UUID(item.id))
                            assert denied.value.status_code == 404
                            with pytest.raises(WorkspaceRepositoryError) as denied_edit:
                                await _task_access_row(connection, person, UUID(item.id), edit=True)
                            assert denied_edit.value.status_code == 404
                    if records["other"].id not in visible_ids:
                        with pytest.raises(WorkspaceRepositoryError) as denied_file:
                            await get_attachment(connection, person, UUID(attachment.id))
                        assert denied_file.value.status_code == 404
                        with pytest.raises(WorkspaceRepositoryError) as denied_history:
                            await load_task_history(connection, person, UUID(records["other"].id))
                        assert denied_history.value.status_code == 404
                    else:
                        file, _ = await get_attachment(connection, person, UUID(attachment.id))
                        assert file.id == attachment.id
                linked = await _task_response(connection, UUID(records["linked"].id),
                                              actors["manager"])
                assert linked.parent_task_title is None
                assert linked.parent_task_id is None
                assert linked.dependencies == []
                changed = await add_task_checklist_item(
                    connection, actors["manager"], UUID(linked.id),
                    CreateChecklistItemRequest(title="Scoped checklist item"),
                )
                assert changed.parent_task_title is None
                assert changed.parent_task_id is None
                assert changed.dependencies == []
                for key in ["hr", "appointed_hr", "deputy", "first_deputy", "chair"]:
                    with pytest.raises(WorkspaceRepositoryError) as read_only:
                        await _task_access_row(
                            connection, actors[key], UUID(records["other"].id), edit=True,
                        )
                    assert read_only.value.status_code == 403
                # Role changes and department moves revoke stale notices and reads.
                notice_id = uuid4()
                manager = actors["manager"]
                await connection.execute(insert(workspace_notifications).values(
                    id=notice_id, user_id=manager.id, event_key=f"task:scope:{notice_id}",
                    kind="task", priority="normal", title="Private task", body="Private details",
                    section="tasks", entity_id=UUID(records["other"].id),
                    requires_action=False, is_reminder=False, occurred_at=now,
                ))
                assert str(notice_id) not in {item.id for item in (
                    await load_workspace(connection, manager)
                ).notifications}
                assert notice_id not in {item.id for item in await _visible_notification_rows(
                    connection, manager, limit=300,
                )}
                with pytest.raises(WorkspaceRepositoryError) as denied_notice:
                    await mark_notification_read(connection, manager, notice_id)
                assert denied_notice.value.status_code == 404
                await connection.execute(update(users).where(
                    users.c.id == actors["member"].id,
                ).values(department_id=other_department_id))
                with pytest.raises(WorkspaceRepositoryError) as moved:
                    await _task_access_row(connection, manager, UUID(records["member"].id))
                assert moved.value.status_code == 404
                # Removing personal participation also revokes an ordinary reader.
                await connection.execute(task_participants.delete().where(
                    task_participants.c.task_id == UUID(records["co_assignee"].id),
                ))
                with pytest.raises(WorkspaceRepositoryError) as removed:
                    await _task_access_row(connection, actors["regular"],
                                           UUID(records["co_assignee"].id))
                assert removed.value.status_code == 404
                # Cyclic reporting data must terminate and never leave the department.
                await connection.execute(update(users).where(
                    users.c.id == actors["member"].id,
                ).values(department_id=department_id, direct_manager_user_id=actors["nested"].id))
                await _task_access_row(connection, actors["member"], UUID(records["nested"].id))
            finally:
                await transaction.rollback()
    finally:
        await engine.dispose()
