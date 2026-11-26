# ruff: noqa: RUF001 - Uzbek job titles use the organization's typographic apostrophes.
import os
from datetime import UTC, datetime
from uuid import UUID, uuid4

import pytest
from pydantic import ValidationError
from sqlalchemy import delete, insert, select, update
from sqlalchemy.ext.asyncio import create_async_engine

from yuksalish_api.auth import AuthenticatedUser, load_authenticated_user
from yuksalish_api.payment_routes import ROUTE_ACTORS, ROUTE_STEP, is_payment_deputy
from yuksalish_api.position_policy import EXECUTIVE_LEADER_POSITION_NAME
from yuksalish_api.project_hub_schemas import ProjectHubWrite, ProjectWorkstreamWrite
from yuksalish_api.project_hub_service import save_project, save_workstream
from yuksalish_api.repository import (
    WorkspaceRepositoryError,
    _can_act_from_config,
    act_on_request,
    create_approval_request,
    find_active_user_by_username,
    update_approval_request,
)
from yuksalish_api.seed import seed_demo_data
from yuksalish_api.tables import (
    approval_actions,
    approval_edges,
    approval_nodes,
    approval_requests,
    users,
)
from yuksalish_api.telegram_notification_events import payment_actor
from yuksalish_api.workspace_schemas import (
    ApprovalActionRequest,
    CreateApprovalRequest,
    UpdateApprovalRequest,
)


@pytest.mark.parametrize("title,expected", [
    ("Rais o‘rinbosari", True),
    ("Raisning birinchi o'rinbosari", True),
    ("Rais o‘rinbosari — ijrochi direktor", True),
    ("Rais o‘rinbosari yordamchisi", False),
    ("Bosh hisobchi", False),
    (EXECUTIVE_LEADER_POSITION_NAME.replace("'", "‘"), False),
    (EXECUTIVE_LEADER_POSITION_NAME.replace(" ", "  "), False),
    (None, False),
])
def test_only_deputies_are_payment_choices(title: str | None, expected: bool) -> None:
    assert is_payment_deputy(title) is expected


def test_duplicate_payment_approvers_are_rejected() -> None:
    person = str(uuid4())
    with pytest.raises(ValidationError):
        ProjectHubWrite(code="TEST", title="Test", manager_user_id=person,
                        payment_approver_user_ids=[person, person])


@pytest.mark.anyio
@pytest.mark.postgres
async def test_project_routes_preserve_full_workflow_and_submitted_snapshots() -> None:
    database_url = os.environ.get("YUKSALISH_TEST_DATABASE_URL")
    if not database_url:
        pytest.skip("YUKSALISH_TEST_DATABASE_URL is not configured")
    engine = create_async_engine(database_url)
    try:
        await seed_demo_data(engine)
        async with engine.connect() as connection:
            transaction = await connection.begin()
            try:
                admin_row = await find_active_user_by_username(connection, "malika")
                assert admin_row
                admin = await load_authenticated_user(connection, admin_row["id"])
                assert admin
                deputies = []
                for title in ("Rais o‘rinbosari", "Rais birinchi o‘rinbosari"):
                    person_id = uuid4()
                    name = f"Deputy {len(deputies) + 1}"
                    username = f"route-{person_id.hex[:12]}"
                    await connection.execute(insert(users).values(
                        id=person_id, username=username, full_name=name,
                        role="employee", status="active", job_title=title,
                        created_at=datetime.now(UTC), updated_at=datetime.now(UTC),
                    ))
                    deputies.append(AuthenticatedUser(
                        id=person_id, username=username, full_name=name,
                        position_id=None, job_title=title, role="employee",
                    ))
                first, second = deputies
                config = ProjectHubWrite(code=f"R-{uuid4().hex[:8]}", title="Асосий хисоб",
                                         manager_user_id=str(admin.id))
                project = await save_project(connection, admin, config)
                project_id = UUID(project.id)
                with pytest.raises(WorkspaceRepositoryError) as unrelated_editor:
                    await save_project(connection, first, config, project_id)
                assert unrelated_editor.value.status_code == 403
                stream = await save_workstream(connection, admin, project_id,
                                               ProjectWorkstreamWrite(title="Работа"))

                async def submit():
                    return await create_approval_request(connection, admin, CreateApprovalRequest(
                        title="Оплата", amount=100, project_id=project.id, workstream_id=stream.id,
                    ))

                async def decide(request_id: str, actor=admin, action="approve"):
                    return await act_on_request(connection, actor, UUID(request_id),
                        ApprovalActionRequest(action=action, comment="Test"))

                # This is a pre-existing request with no new route snapshot.
                old = await submit()
                assert old.payment_approval_route is None
                config = config.model_copy(update={"payment_approver_user_ids": []})
                project = await save_project(connection, admin, config, project_id)
                assert project.payment_approver_user_ids == []
                direct = await submit()
                assert direct.payment_approval_route == []
                initial_nodes = ["project_financier", "finance_manager_projects", "members",
                                 "chair_assistant", "chief_accountant"]
                for key in initial_nodes:
                    assert direct.active_node_keys == [key]
                    assert old.active_node_keys == [key]
                    direct = await decide(direct.id)
                    old = await decide(old.id)
                assert direct.active_node_keys == ["chair"]
                assert old.active_node_keys == ["deputy_chair"]
                with pytest.raises(WorkspaceRepositoryError) as skipped:
                    await act_on_request(connection, admin, UUID(direct.id),
                        ApprovalActionRequest(action="move", node_key="deputy_chair"))
                assert skipped.value.status_code == 409
                # Steps after the chairman are unchanged too.
                for key in ("chair", "awaiting_payment", "payment"):
                    assert direct.active_node_keys == [key]
                    direct = await decide(direct.id)
                assert direct.status == "approved"
                assert direct.active_node_keys == []

                # Skipping the deputy must not complete a parallel join ahead of another branch.
                template_id = UUID(direct.workflow_id)
                extra_keys = ["route_parallel", "route_audit"]
                for key, kind in zip(extra_keys, ["parallel", "approval"], strict=True):
                    await connection.execute(insert(approval_nodes).values(
                        id=uuid4(), template_id=template_id, node_key=key, kind=kind,
                        title=key, config={"decisionMode": "all"}, position_x=0, position_y=0,
                    ))
                incoming = (approval_edges.c.template_id == template_id) & (
                    approval_edges.c.source_node_key == "chief_accountant"
                ) & (approval_edges.c.outcome == "approve")
                await connection.execute(update(approval_edges).where(incoming)
                                         .values(target_node_key="route_parallel"))
                edge_ids = []
                for source, target in (("route_parallel", "deputy_chair"),
                                       ("route_parallel", "route_audit"), ("route_audit", "chair")):
                    edge_id = uuid4()
                    edge_ids.append(edge_id)
                    await connection.execute(insert(approval_edges).values(
                        id=edge_id, template_id=template_id, source_node_key=source,
                        target_node_key=target, outcome="approve", condition={},
                        sort_order=len(edge_ids),
                    ))
                parallel = await submit()
                for key in initial_nodes:
                    assert parallel.active_node_keys == [key]
                    parallel = await decide(parallel.id)
                assert parallel.active_node_keys == ["route_audit"]
                parallel = await decide(parallel.id)
                assert parallel.active_node_keys == ["chair"]
                await connection.execute(delete(approval_edges)
                                         .where(approval_edges.c.id.in_(edge_ids)))
                await connection.execute(update(approval_edges).where(incoming)
                                         .values(target_node_key="deputy_chair"))
                await connection.execute(delete(approval_nodes).where(
                    approval_nodes.c.template_id == template_id,
                    approval_nodes.c.node_key.in_(extra_keys),
                ))

                ids = [str(first.id), str(second.id)]
                config = config.model_copy(update={"payment_approver_user_ids": ids})
                await save_project(connection, admin, config, project_id)
                ordered = await submit()
                assert ordered.payment_approval_route
                assert [actor.user_id for actor in ordered.payment_approval_route] == ids
                # Changing the project to direct does not affect this submitted request.
                await save_project(connection, admin,
                                   config.model_copy(update={"payment_approver_user_ids": []}),
                                   project_id)
                ordered = await update_approval_request(connection, admin, UUID(ordered.id),
                    UpdateApprovalRequest(title="Исправленная оплата", amount=101,
                                          change_comment="Уточнение суммы"))
                assert ordered.payment_approval_route
                assert [actor.user_id for actor in ordered.payment_approval_route] == ids
                for key in initial_nodes:
                    assert ordered.active_node_keys == [key]
                    ordered = await decide(ordered.id)
                assert ordered.stage_label == f"Согласование: {first.full_name}"
                with pytest.raises(WorkspaceRepositoryError) as manual_skip:
                    await act_on_request(connection, first, UUID(ordered.id),
                                         ApprovalActionRequest(action="move", node_key="chair"))
                assert manual_skip.value.status_code == 403
                with pytest.raises(WorkspaceRepositoryError) as forbidden:
                    await decide(ordered.id, second)
                assert forbidden.value.status_code == 403
                ordered = await decide(ordered.id, first)
                assert ordered.active_node_keys == ["deputy_chair"]
                assert ordered.payment_approval_step == 1
                assert ordered.stage_label == f"Согласование: {second.full_name}"
                # The first deputy retains read access but cannot approve the second decision.
                with pytest.raises(WorkspaceRepositoryError) as repeated:
                    await decide(ordered.id, first)
                assert repeated.value.status_code == 403
                ordered = await decide(ordered.id, second, "return")
                assert ordered.status == "needs_revision"
                ordered = await decide(ordered.id, admin, "resubmit")
                for key in initial_nodes:
                    assert ordered.active_node_keys == [key]
                    ordered = await decide(ordered.id)
                assert ordered.payment_approval_step == 0
                ordered = await decide(ordered.id, first)
                ordered = await decide(ordered.id, second)
                assert ordered.active_node_keys == ["chair"]
                actions = (await connection.execute(select(approval_actions.c.actor_user_id).where(
                    approval_actions.c.request_id == UUID(ordered.id),
                    approval_actions.c.node_key == "deputy_chair",
                    approval_actions.c.action == "approve",
                ).order_by(approval_actions.c.created_at))).scalars().all()
                assert actions == [first.id, first.id, second.id]
                # A blocked deputy stops new submissions; it never silently skips their decision.
                await save_project(connection, admin, config, project_id)
                await connection.execute(update(users).where(users.c.id == second.id)
                                         .values(status="blocked"))
                with pytest.raises(WorkspaceRepositoryError) as inactive:
                    await submit()
                assert inactive.value.status_code == 409
                # A regular project editor cannot substitute an arbitrary employee.
                with pytest.raises(WorkspaceRepositoryError) as invalid:
                    await save_project(connection, admin, config.model_copy(
                        update={"payment_approver_user_ids": [str(admin.id)]}), project_id)
                assert invalid.value.status_code == 422
                # Old clients omit the field and must not erase the saved project setting.
                await connection.execute(update(users).where(users.c.id == second.id)
                                         .values(status="active"))
                omitted = ProjectHubWrite(code=config.code, title=config.title,
                                          manager_user_id=config.manager_user_id)
                unchanged = await save_project(connection, admin, omitted, project_id)
                assert unchanged.payment_approver_user_ids == ids
                old_payload = await connection.scalar(select(approval_requests.c.payload)
                    .where(approval_requests.c.id == UUID(old.id)))
                assert ROUTE_ACTORS not in old_payload
            finally:
                await transaction.rollback()
    finally:
        await engine.dispose()


def test_snapshot_permissions_and_telegram_only_target_current_deputy() -> None:
    first_id, second_id = uuid4(), uuid4()
    first = AuthenticatedUser(id=first_id, username="first", full_name="First",
                              position_id=None, job_title=None, role="employee")
    second = AuthenticatedUser(id=second_id, username="second", full_name="Second",
                               position_id=None, job_title=None, role="employee")
    for step, actor in enumerate((first, second)):
        row = {"payload": {ROUTE_ACTORS: [
            {"user_id": str(first_id), "name": "First"},
            {"user_id": str(second_id), "name": "Second"},
        ], ROUTE_STEP: step}, "actor_overrides": {"deputy_chair": str(first_id)}}
        for person in (first, second):
            assert _can_act_from_config(person, row, "deputy_chair", {}) is (person == actor)
            assert payment_actor(person, row, "deputy_chair", {}) is (person == actor)
        assert not _can_act_from_config(actor, {"payload": {ROUTE_ACTORS: []}}, "deputy_chair", {})
