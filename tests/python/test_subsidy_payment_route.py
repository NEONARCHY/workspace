import os
from datetime import UTC, datetime
from unittest.mock import AsyncMock, Mock
from uuid import UUID, uuid4

import pytest
from sqlalchemy import insert, select, update
from sqlalchemy.ext.asyncio import create_async_engine

from yuksalish_api.auth import AuthenticatedUser, load_authenticated_user
from yuksalish_api.project_hub_schemas import ProjectHubWrite, ProjectWorkstreamWrite
from yuksalish_api.project_hub_service import save_project, save_workstream
from yuksalish_api.repository import (
    WorkspaceRepositoryError,
    _can_act_from_config,
    _payment_route_variant_payload,
    act_on_request,
    create_approval_request,
    find_active_user_by_username,
)
from yuksalish_api.seed import seed_demo_data
from yuksalish_api.tables import approval_nodes, users
from yuksalish_api.workspace_schemas import ApprovalActionRequest, CreateApprovalRequest


def _actor(user_id: UUID, username: str, position_id: UUID | None = None) -> AuthenticatedUser:
    return AuthenticatedUser(
        id=user_id, username=username, full_name=username,
        position_id=position_id, job_title=None, role="employee",
    )


def test_subsidy_approver_does_not_change_other_stages_or_projects() -> None:
    askar_id, deputy_id = uuid4(), uuid4()
    askar = _actor(askar_id, "askar_mamatxanov")
    deputy = _actor(deputy_id, "deputy", uuid4())
    config = {"approverPositionId": str(deputy.position_id)}
    subsidy = {
        "payload": {
            "payment_route_variant": "subsidy",
            "subsidy_approver_user_id": str(askar_id),
        },
        "actor_overrides": {},
    }
    normal = {"payload": {}, "actor_overrides": {}}
    assert _can_act_from_config(askar, subsidy, "deputy_chair", config)
    assert not _can_act_from_config(deputy, subsidy, "deputy_chair", config)
    assert _can_act_from_config(deputy, normal, "deputy_chair", config)
    assert not _can_act_from_config(askar, normal, "deputy_chair", config)
    assert _can_act_from_config(deputy, subsidy, "another_stage", config)
    assert _can_act_from_config(
        deputy, {**subsidy, "actor_overrides": {"deputy_chair": str(deputy_id)}},
        "deputy_chair", config,
    )
    assert not _can_act_from_config(
        askar, {"payload": {"payment_route_variant": "subsidy"}, "actor_overrides": {}},
        "deputy_chair", config,
    )


@pytest.mark.anyio
async def test_subsidy_selection_requires_one_active_askar_account() -> None:
    connection = AsyncMock()
    template_id, askar_id = uuid4(), uuid4()
    assert await _payment_route_variant_payload(
        connection, template_id, str(uuid4()), "Другой проект",
    ) == {}
    connection.scalar.assert_not_called()

    connection.scalar.return_value = "deputy_chair"
    rows = Mock()
    rows.mappings.return_value.all.return_value = [
        {"id": askar_id, "username": "askar_mamatxanov", "full_name": "Аскар Маматханов"},
    ]
    connection.execute.return_value = rows
    assert await _payment_route_variant_payload(
        connection, template_id, str(uuid4()), "  СУБСИДИЯ ",
    ) == {
        "payment_route_variant": "subsidy",
        "subsidy_approver_user_id": str(askar_id),
    }
    rows.mappings.return_value.all.return_value.append({
        "id": uuid4(), "username": "different", "full_name": "Маматханов Аскар Махмутович",
    })
    with pytest.raises(WorkspaceRepositoryError) as ambiguous:
        await _payment_route_variant_payload(
            connection, template_id, str(uuid4()), "Субсидия",
        )
    assert ambiguous.value.status_code == 409


@pytest.mark.anyio
@pytest.mark.postgres
async def test_subsidy_payment_uses_askar_and_other_projects_keep_deputy() -> None:
    database_url = os.environ.get("YUKSALISH_TEST_DATABASE_URL")
    if not database_url:
        pytest.skip("YUKSALISH_TEST_DATABASE_URL is not configured")
    engine = create_async_engine(database_url)
    try:
        await seed_demo_data(engine)
        async with engine.connect() as connection:
            transaction = await connection.begin()
            try:
                manager_row = await find_active_user_by_username(connection, "aziza")
                admin_row = await find_active_user_by_username(connection, "malika")
                assert manager_row and admin_row
                manager = await load_authenticated_user(connection, manager_row["id"])
                admin = await load_authenticated_user(connection, admin_row["id"])
                assert manager and admin
                askar_id, deputy_id = uuid4(), uuid4()
                for user_id, username, name in (
                    (askar_id, "askar_mamatxanov", "Аскар Маматханов"),
                    (deputy_id, f"deputy-{deputy_id.hex[:8]}", "Другой согласующий"),
                ):
                    await connection.execute(insert(users).values(
                        id=user_id, username=username, full_name=name,
                        role="employee", status="active",
                        created_at=datetime.now(UTC), updated_at=datetime.now(UTC),
                    ))
                askar = _actor(askar_id, "askar_mamatxanov")
                async def make_request(title: str, linked: bool = True):
                    project = await save_project(connection, manager, ProjectHubWrite(
                        code=f"P-{uuid4().hex[:10].upper()}", title=title,
                        manager_user_id=str(manager.id),
                    ))
                    stream = await save_workstream(
                        connection, manager, UUID(project.id),
                        ProjectWorkstreamWrite(title="Направление"),
                    )
                    return await create_approval_request(
                        connection, manager, CreateApprovalRequest(
                            title=f"Оплата: {title}", amount=1000,
                            project_id=project.id if linked else None,
                            workstream_id=stream.id if linked else None,
                        ),
                    )

                subsidy = await make_request("Субсидия")
                assert subsidy.route_variant == "subsidy"
                deputy_config = await connection.scalar(select(approval_nodes.c.config).where(
                    approval_nodes.c.template_id == UUID(subsidy.workflow_id),
                    approval_nodes.c.node_key == "deputy_chair",
                ))
                assert deputy_config and deputy_config.get("approverPositionId")
                await connection.execute(update(users).where(users.c.id == deputy_id).values(
                    position_id=UUID(deputy_config["approverPositionId"]),
                ))
                deputy = _actor(
                    deputy_id, f"deputy-{deputy_id.hex[:8]}",
                    UUID(deputy_config["approverPositionId"]),
                )
                subsidy = await act_on_request(
                    connection, admin, UUID(subsidy.id),
                    ApprovalActionRequest(action="move", node_key="deputy_chair"),
                )
                assert subsidy.stage_label == "Утверждение первым исполнительным директором"
                with pytest.raises(WorkspaceRepositoryError) as forbidden:
                    await act_on_request(
                        connection, deputy, UUID(subsidy.id),
                        ApprovalActionRequest(action="approve"),
                    )
                assert forbidden.value.status_code == 403
                subsidy = await act_on_request(
                    connection, askar, UUID(subsidy.id),
                    ApprovalActionRequest(action="approve"),
                )
                assert subsidy.active_node_keys == ["chair"]

                ordinary = await make_request("Обычный проект")
                assert ordinary.route_variant is None
                ordinary = await act_on_request(
                    connection, admin, UUID(ordinary.id),
                    ApprovalActionRequest(action="move", node_key="deputy_chair"),
                )
                assert ordinary.stage_label == "Утверждение заместителя председателя"
                with pytest.raises(WorkspaceRepositoryError) as forbidden:
                    await act_on_request(
                        connection, askar, UUID(ordinary.id),
                        ApprovalActionRequest(action="approve"),
                    )
                assert forbidden.value.status_code == 403
                ordinary = await act_on_request(
                    connection, deputy, UUID(ordinary.id),
                    ApprovalActionRequest(action="approve"),
                )
                assert ordinary.active_node_keys == ["chair"]

                legacy_text_only = await create_approval_request(
                    connection, manager, CreateApprovalRequest(
                        title="Старый клиент", amount=1000, project_name="Субсидия",
                    ),
                )
                assert legacy_text_only.route_variant is None

                await connection.execute(update(users).where(users.c.id == askar_id).values(
                    status="inactive",
                ))
                with pytest.raises(WorkspaceRepositoryError) as missing:
                    await make_request("Субсидия")
                assert missing.value.status_code == 409
            finally:
                await transaction.rollback()
    finally:
        await engine.dispose()
