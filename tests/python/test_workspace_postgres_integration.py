import asyncio
import os
from datetime import UTC, date, datetime, timedelta
from uuid import UUID

import pytest
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import create_async_engine

from yuksalish_api.auth import load_authenticated_user
from yuksalish_api.directory_schemas import (
    EmployeeAccessUpdateRequest,
    PositionCreateRequest,
    PositionUpdateRequest,
)
from yuksalish_api.directory_service import (
    create_position,
    load_directory,
    update_employee_access,
    update_position,
)
from yuksalish_api.position_policy import PAYMENT_CREATOR_POSITION_NAMES
from yuksalish_api.repository import (
    WorkspaceRepositoryError,
    act_on_request,
    act_on_trip_request,
    add_task_checklist_item,
    add_task_comment,
    change_project_stage,
    change_task_status,
    create_approval_request,
    create_attachment,
    create_project,
    create_task,
    create_trip_request,
    delete_task_checklist_item,
    find_active_user_by_username,
    get_attachment,
    load_workspace,
    materialize_due_task_cycles,
    publish_workflow,
    remove_task_dependency,
    remove_task_participant,
    save_workflow,
    send_message,
    set_task_cycle,
    set_task_dependency,
    set_task_participant,
    update_approval_request,
    update_project,
    update_task,
    update_task_checklist_item,
    update_trip_request,
)
from yuksalish_api.seed import seed_demo_data
from yuksalish_api.tables import audit_events
from yuksalish_api.workspace_schemas import (
    ApprovalActionRequest,
    ChangeProjectStageRequest,
    ChangeTaskStatusRequest,
    CreateApprovalRequest,
    CreateChecklistItemRequest,
    CreateProjectRequest,
    CreateTaskCommentRequest,
    CreateTaskRequest,
    CreateTripRequest,
    SaveWorkflowRequest,
    SendMessageRequest,
    TaskCycleRequest,
    TaskDependencyRequest,
    TaskParticipantRequest,
    TripActionRequest,
    UpdateApprovalRequest,
    UpdateChecklistItemRequest,
    UpdateProjectRequest,
    UpdateTaskRequest,
    UpdateTripRequest,
    WorkflowEdgeResponse,
    WorkflowNodeResponse,
)


async def _exercise_live_workspace(database_url: str) -> None:
    engine = create_async_engine(database_url, pool_pre_ping=True)
    await seed_demo_data(engine)
    async with engine.connect() as connection:
        transaction = await connection.begin()
        try:
            aziza_row = await find_active_user_by_username(connection, "aziza")
            assert aziza_row is not None
            aziza = await load_authenticated_user(connection, aziza_row["id"])
            assert aziza is not None

            admin_row = await find_active_user_by_username(connection, "malika")
            assert admin_row is not None
            admin = await load_authenticated_user(connection, admin_row["id"])
            assert admin is not None

            initial = await load_workspace(connection, aziza)
            assert len(initial.people) == 4
            assert len(initial.chats) == 4
            assert len(initial.projects) == 3
            assert len(initial.trip_requests) == 1
            assert initial.workflow.nodes
            assert initial.workflow.published_version == 6
            assert {node.label for node in initial.workflow.nodes} == {
                "Запуск",
                "Утверждение финансистом проекта",
                "Утверждение финансовым менеджером по проектам",
                "Работа с членами Юксалиш",  # noqa: RUF001 - Cyrillic stage title
                "Утверждение помощником председателя",
                "Утверждение главным бухгалтером",
                "Утверждение заместителя председателя",
                "Утверждение председателем",
                "Ожидает оплаты",
                "Оплата",
                "Доработка",
                "Выполнено",
                "Отмена",
            }

            directory = await load_directory(connection)
            assert len(directory.positions) >= 20
            audit_event_count = await connection.scalar(
                select(func.count()).select_from(audit_events)
            )
            assert audit_event_count is not None
            new_position = await create_position(
                connection,
                admin,
                PositionCreateRequest(name="Integration Position", sort_order=50_000),
            )
            dilshod = next(
                employee for employee in directory.employees if employee.username == "dilshod"
            )
            updated_employee = await update_employee_access(
                connection,
                admin,
                UUID(dilshod.id),
                EmployeeAccessUpdateRequest(
                    role="employee",
                    position_id=UUID(new_position.id),
                ),
            )
            assert updated_employee.role == "employee"
            assert updated_employee.job_title == "Integration Position"
            renamed_position = await update_position(
                connection,
                admin,
                UUID(new_position.id),
                PositionUpdateRequest(name="Integration Lead", is_active=False),
            )
            assert renamed_position.name == "Integration Lead"
            assert renamed_position.assigned_users_count == 1
            assert (
                await connection.scalar(select(func.count()).select_from(audit_events))
                == audit_event_count + 3
            )

            message = await send_message(
                connection,
                aziza,
                UUID(initial.chats[0].id),
                SendMessageRequest(body="Integration workflow message"),
            )
            message_attachment = await create_attachment(
                connection,
                aziza,
                "message",
                UUID(message.id),
                file_name="invoice.txt",
                content_type="text/plain",
                byte_size=7,
                sha256="a" * 64,
                storage_key=f"message/{message.id}/invoice",
            )
            readable_attachment, storage_key = await get_attachment(
                connection,
                aziza,
                UUID(message_attachment.id),
            )
            assert readable_attachment.file_name == "invoice.txt"
            assert storage_key.endswith("/invoice")
            task = await create_task(
                connection,
                aziza,
                CreateTaskRequest(
                    title="Integration workflow task",
                    assignee_id=str(aziza.id),
                    source_message_id=message.id,
                ),
            )
            task = await change_task_status(
                connection,
                aziza,
                UUID(task.id),
                ChangeTaskStatusRequest(status="in_progress"),
            )
            assert task.status == "in_progress"

            task = await update_task(
                connection,
                aziza,
                UUID(task.id),
                UpdateTaskRequest(
                    title="Integration task card",
                    description="Complete BP-5 integration coverage",
                    project="Workspace",
                    assignee_id=str(aziza.id),
                    priority="urgent",
                    due_at=datetime.now(UTC) + timedelta(days=2),
                ),
            )
            assert task.title == "Integration task card"
            assert task.priority == "urgent"
            dilshod_row = await find_active_user_by_username(connection, "dilshod")
            assert dilshod_row is not None
            dilshod_auth = await load_authenticated_user(connection, dilshod_row["id"])
            assert dilshod_auth is not None
            task = await set_task_participant(
                connection,
                aziza,
                UUID(task.id),
                TaskParticipantRequest(
                    user_id=str(dilshod_auth.id),
                    role="observer",
                ),
            )
            assert task.participants[0].role == "observer"
            task = await add_task_comment(
                connection,
                dilshod_auth,
                UUID(task.id),
                CreateTaskCommentRequest(body="Observer integration comment"),
            )
            assert task.comments[-1].body == "Observer integration comment"
            with pytest.raises(WorkspaceRepositoryError, match="cannot be changed"):
                await change_task_status(
                    connection,
                    dilshod_auth,
                    UUID(task.id),
                    ChangeTaskStatusRequest(status="completed"),
                )
            task = await set_task_participant(
                connection,
                aziza,
                UUID(task.id),
                TaskParticipantRequest(
                    user_id=str(dilshod_auth.id),
                    role="co_assignee",
                ),
            )
            assert task.participants[0].role == "co_assignee"

            task = await add_task_checklist_item(
                connection,
                aziza,
                UUID(task.id),
                CreateChecklistItemRequest(title="Integration checklist item"),
            )
            checklist_id = UUID(task.checklist[-1].id)
            task = await update_task_checklist_item(
                connection,
                dilshod_auth,
                UUID(task.id),
                checklist_id,
                UpdateChecklistItemRequest(is_completed=True),
            )
            assert task.checklist_done == 1
            disposable = await add_task_checklist_item(
                connection,
                aziza,
                UUID(task.id),
                CreateChecklistItemRequest(title="Disposable item"),
            )
            task = await delete_task_checklist_item(
                connection,
                aziza,
                UUID(task.id),
                UUID(disposable.checklist[-1].id),
            )
            assert len(task.checklist) == 1

            blocker = await create_task(
                connection,
                aziza,
                CreateTaskRequest(title="Integration blocker", assignee_id=str(aziza.id)),
            )
            task = await set_task_dependency(
                connection,
                aziza,
                UUID(task.id),
                TaskDependencyRequest(depends_on_task_id=blocker.id),
            )
            assert task.dependencies[0].depends_on_task_id == blocker.id
            with pytest.raises(WorkspaceRepositoryError, match="blocking dependencies"):
                await change_task_status(
                    connection,
                    aziza,
                    UUID(task.id),
                    ChangeTaskStatusRequest(status="completed"),
                )
            with pytest.raises(WorkspaceRepositoryError, match="create a cycle"):
                await set_task_dependency(
                    connection,
                    aziza,
                    UUID(blocker.id),
                    TaskDependencyRequest(depends_on_task_id=task.id),
                )
            await change_task_status(
                connection,
                aziza,
                UUID(blocker.id),
                ChangeTaskStatusRequest(status="completed"),
            )
            task = await change_task_status(
                connection,
                aziza,
                UUID(task.id),
                ChangeTaskStatusRequest(status="completed"),
            )
            assert task.status == "completed"
            task = await remove_task_dependency(
                connection,
                aziza,
                UUID(task.id),
                UUID(blocker.id),
            )
            assert task.dependencies == []
            task = await remove_task_participant(
                connection,
                aziza,
                UUID(task.id),
                dilshod_auth.id,
            )
            assert task.participants == []

            task = await set_task_cycle(
                connection,
                aziza,
                UUID(task.id),
                TaskCycleRequest(
                    title="Recurring integration task",
                    schedule_kind="daily",
                    interval=1,
                    next_run_at=datetime.now(UTC) - timedelta(minutes=1),
                ),
            )
            assert task.cycle is not None
            assert task.cycle.schedule_kind == "daily"
            assert await materialize_due_task_cycles(connection) == 1
            assert await materialize_due_task_cycles(connection) == 0
            task = await set_task_cycle(
                connection,
                aziza,
                UUID(task.id),
                TaskCycleRequest(
                    title="Recurring integration task",
                    schedule_kind="daily",
                    interval=1,
                    next_run_at=datetime.now(UTC) - timedelta(minutes=1),
                    is_enabled=False,
                ),
            )
            assert task.cycle is not None
            assert task.cycle.is_enabled is False
            assert await materialize_due_task_cycles(connection) == 0

            approval = await create_approval_request(
                connection,
                aziza,
                CreateApprovalRequest(
                    title="Integration payment",
                    amount=84_600_000,
                    source_task_id=task.id,
                    transfer_type="Другие услуги",
                    project_name="Workspace",
                    project_code="WS-26",
                    source_account="Operating account",
                    destination_account="Supplier account",
                    request_priority="urgent",
                    deadline=datetime.now(UTC) + timedelta(days=3),
                    comment="Integration BP-6 request",
                    trip_purpose="Vendor meeting",
                    trip_start_date=date(2026, 9, 20),
                    trip_end_date=date(2026, 9, 22),
                    employee_ids=[str(dilshod_auth.id)],
                    payment_purpose="Оплата за услуги",
                    payment_reason="Contract 42",
                    responsible_user_id=str(dilshod_auth.id),
                ),
            )
            assert approval.active_node_keys == ["project_financier"]
            assert approval.stage_label == "Утверждение финансистом проекта"
            assert approval.details.project_code == "WS-26"
            assert approval.details.employee_ids == [str(dilshod_auth.id)]
            assert approval.responsible_user_id == str(dilshod_auth.id)
            approval = await act_on_request(
                connection,
                aziza,
                UUID(approval.id),
                ApprovalActionRequest(
                    action="delegate",
                    comment="Delegated for integration coverage",
                    delegate_to_user_id=str(dilshod_auth.id),
                ),
            )
            assert approval.actions[-1].delegated_to_user_id == str(dilshod_auth.id)
            delegated_workspace = await load_workspace(connection, dilshod_auth)
            delegated_request = next(
                item for item in delegated_workspace.requests if item.id == approval.id
            )
            assert delegated_request.active_stages[0].can_act is True
            approval = await act_on_request(
                connection,
                dilshod_auth,
                UUID(approval.id),
                ApprovalActionRequest(action="approve", comment="Integration approval"),
            )
            assert approval.status == "running"
            assert approval.active_node_keys == ["finance_manager_projects"]
            approval = await act_on_request(
                connection,
                aziza,
                UUID(approval.id),
                ApprovalActionRequest(action="return", comment="Correct the amount"),
            )
            assert approval.status == "needs_revision"
            assert approval.actions[-1].action == "return"
            assert approval.actions[-1].comment == "Correct the amount"
            assert approval.active_node_keys == ["correction"]
            approval_attachment = await create_attachment(
                connection,
                aziza,
                "approval_request",
                UUID(approval.id),
                file_name="corrected-invoice.pdf",
                content_type="application/pdf",
                byte_size=11,
                sha256="b" * 64,
                storage_key=f"approval_request/{approval.id}/corrected-invoice",
                document_role="primary",
            )
            assert approval_attachment.owner_type == "approval_request"
            assert approval_attachment.document_role == "primary"
            approval = await update_approval_request(
                connection,
                aziza,
                UUID(approval.id),
                UpdateApprovalRequest(
                    title="Integration payment corrected",
                    amount=82_400_000,
                    currency="UZS",
                    purpose="Corrected integration payment",
                    change_comment="Amount and invoice corrected",
                ),
            )
            assert approval.amount == 82_400_000
            assert approval.revision == 3

            project = await create_project(
                connection,
                aziza,
                CreateProjectRequest(
                    code="INT-BP7",
                    title="Integration BP-7 project",
                    description="Project lifecycle coverage",
                    manager_user_id=str(aziza.id),
                    start_date=date(2026, 9, 10),
                    end_date=date(2026, 12, 1),
                    budget=100_000_000,
                    spent_budget=12_000_000,
                    currency="UZS",
                ),
            )
            assert project.stage == "start"
            assert project.remaining_budget == 88_000_000
            assert project.history[-1].action == "created"
            project = await update_project(
                connection,
                aziza,
                UUID(project.id),
                UpdateProjectRequest(
                    code="INT-BP7",
                    title="Integration BP-7 project updated",
                    description="Updated project lifecycle coverage",
                    manager_user_id=str(admin.id),
                    start_date=date(2026, 9, 10),
                    end_date=date(2026, 12, 1),
                    budget=100_000_000,
                    spent_budget=18_000_000,
                    currency="UZS",
                ),
            )
            assert project.manager_user_id == str(admin.id)
            project = await change_project_stage(
                connection,
                aziza,
                UUID(project.id),
                ChangeProjectStageRequest(stage="preparation"),
            )
            project = await change_project_stage(
                connection,
                aziza,
                UUID(project.id),
                ChangeProjectStageRequest(stage="approval"),
            )
            with pytest.raises(WorkspaceRepositoryError, match="failure comment"):
                await change_project_stage(
                    connection,
                    aziza,
                    UUID(project.id),
                    ChangeProjectStageRequest(stage="failure"),
                )
            project = await change_project_stage(
                connection,
                aziza,
                UUID(project.id),
                ChangeProjectStageRequest(stage="success", comment="Accepted"),
            )
            assert project.status == "completed"
            assert project.history[-1].to_stage == "success"
            with pytest.raises(WorkspaceRepositoryError, match="Only managers"):
                await create_project(
                    connection,
                    dilshod_auth,
                    CreateProjectRequest(
                        code="DENIED",
                        title="Denied project",
                        manager_user_id=str(dilshod_auth.id),
                    ),
                )

            trip = await create_trip_request(
                connection,
                dilshod_auth,
                CreateTripRequest(
                    purpose="Integration trip approval",
                    destination="Samarkand",
                    start_date=date(2026, 10, 5),
                    end_date=date(2026, 10, 7),
                    employee_ids=[str(dilshod_auth.id)],
                ),
            )
            assert trip.stage == "launch"
            assert trip.allowed_actions == ["submit"]
            trip = await act_on_trip_request(
                connection,
                dilshod_auth,
                UUID(trip.id),
                TripActionRequest(action="submit"),
            )
            assert trip.stage == "manager_approval"
            trip = await act_on_trip_request(
                connection,
                aziza,
                UUID(trip.id),
                TripActionRequest(action="return", comment="Fix destination details"),
            )
            assert trip.status == "needs_revision"
            trip = await update_trip_request(
                connection,
                dilshod_auth,
                UUID(trip.id),
                UpdateTripRequest(
                    purpose="Integration trip approval corrected",
                    destination="Samarkand office",
                    start_date=date(2026, 10, 5),
                    end_date=date(2026, 10, 8),
                    employee_ids=[str(dilshod_auth.id)],
                ),
            )
            trip = await act_on_trip_request(
                connection,
                dilshod_auth,
                UUID(trip.id),
                TripActionRequest(action="resubmit", comment="Corrected"),
            )
            trip = await act_on_trip_request(
                connection,
                aziza,
                UUID(trip.id),
                TripActionRequest(action="approve"),
            )
            assert trip.stage == "hr"
            with pytest.raises(WorkspaceRepositoryError, match="not allowed"):
                await act_on_trip_request(
                    connection,
                    aziza,
                    UUID(trip.id),
                    TripActionRequest(action="approve"),
                )
            trip = await act_on_trip_request(
                connection,
                admin,
                UUID(trip.id),
                TripActionRequest(action="approve", comment="HR documents verified"),
            )
            assert trip.stage == "approved"
            assert trip.status == "approved"
            assert trip.finished_at is not None
            assert len(approval.versions) == 3
            assert approval.versions[-1].attachment_ids == [approval_attachment.id]
            approval = await act_on_request(
                connection,
                aziza,
                UUID(approval.id),
                ApprovalActionRequest(action="resubmit", comment="Corrected"),
            )
            assert approval.status == "running"
            assert approval.active_node_keys == ["project_financier"]
            assert approval.amount == 82_400_000
            assert approval.revision == 3

            saved = await save_workflow(
                connection,
                aziza,
                UUID(initial.workflow.id),
                SaveWorkflowRequest(
                    nodes=list(initial.workflow.nodes),
                    edges=list(initial.workflow.edges),
                ),
            )
            assert len(saved.nodes) == len(initial.workflow.nodes)
            next_draft = await publish_workflow(
                connection,
                aziza,
                UUID(initial.workflow.id),
            )
            assert next_draft.version == initial.workflow.version + 1
            assert next_draft.published_version == initial.workflow.version
            assert next_draft.status == "draft"
            with pytest.raises(WorkspaceRepositoryError, match="cannot be edited"):
                await save_workflow(
                    connection,
                    aziza,
                    UUID(initial.workflow.id),
                    SaveWorkflowRequest(
                        nodes=list(initial.workflow.nodes),
                        edges=list(initial.workflow.edges),
                    ),
                )

            after = await load_workspace(connection, aziza)
            assert message.id in {item.id for item in after.messages}
            assert task.id in {item.id for item in after.tasks}
            assert approval.id in {item.id for item in after.requests}
            assert project.id in {item.id for item in after.projects}
            assert trip.id in {item.id for item in after.trip_requests}
            assert message_attachment.id in {item.id for item in after.attachments}
            assert approval_attachment.id in {item.id for item in after.attachments}
        finally:
            await transaction.rollback()
    await engine.dispose()


@pytest.mark.postgres
def test_live_workspace_vertical_slice() -> None:
    database_url = os.environ.get("YUKSALISH_TEST_DATABASE_URL")
    if not database_url:
        pytest.skip("YUKSALISH_TEST_DATABASE_URL is not configured")
    asyncio.run(_exercise_live_workspace(database_url))


async def _exercise_parallel_workflow(database_url: str) -> None:
    engine = create_async_engine(database_url, pool_pre_ping=True)
    await seed_demo_data(engine)
    async with engine.connect() as connection:
        transaction = await connection.begin()
        try:
            aziza_row = await find_active_user_by_username(connection, "aziza")
            assert aziza_row is not None
            aziza = await load_authenticated_user(connection, aziza_row["id"])
            assert aziza is not None
            workflow = (await load_workspace(connection, aziza)).workflow
            nodes = [
                WorkflowNodeResponse(
                    id="start",
                    kind="start",
                    label="Запуск",
                    detail="",
                    position_x=0,
                    position_y=0,
                ),
                WorkflowNodeResponse(
                    id="split",
                    kind="parallel",
                    label="Параллельная проверка",
                    detail="",
                    position_x=200,
                    position_y=0,
                    config={"decisionMode": "all"},
                ),
                WorkflowNodeResponse(
                    id="finance",
                    kind="approval",
                    label="Финансы",
                    detail="",
                    position_x=400,
                    position_y=-100,
                    config={"approverRole": "manager"},
                ),
                WorkflowNodeResponse(
                    id="director",
                    kind="approval",
                    label="Директор",
                    detail="",
                    position_x=400,
                    position_y=100,
                    config={"approverRole": "manager"},
                ),
                WorkflowNodeResponse(
                    id="done",
                    kind="end",
                    label="Выполнено",
                    detail="",
                    position_x=650,
                    position_y=0,
                ),
            ]
            edges = [
                WorkflowEdgeResponse(id="submit", source="start", target="split", outcome="submit"),
                WorkflowEdgeResponse(
                    id="finance", source="split", target="finance", outcome="branch"
                ),
                WorkflowEdgeResponse(
                    id="director",
                    source="split",
                    target="director",
                    outcome="branch",
                    sort_order=1,
                ),
                WorkflowEdgeResponse(id="finance-done", source="finance", target="done"),
                WorkflowEdgeResponse(id="director-done", source="director", target="done"),
            ]
            await save_workflow(
                connection,
                aziza,
                UUID(workflow.id),
                SaveWorkflowRequest(nodes=nodes, edges=edges),
            )
            next_draft = await publish_workflow(connection, aziza, UUID(workflow.id))
            request = await create_approval_request(
                connection,
                aziza,
                CreateApprovalRequest(title="Parallel all", amount=1_000_000),
            )
            assert set(request.active_node_keys) == {"finance", "director"}
            request = await act_on_request(
                connection,
                aziza,
                UUID(request.id),
                ApprovalActionRequest(action="approve", node_key="finance"),
            )
            assert request.active_node_keys == ["director"]
            request = await act_on_request(
                connection,
                aziza,
                UUID(request.id),
                ApprovalActionRequest(action="approve", node_key="director"),
            )
            assert request.status == "approved"

            any_nodes = [
                node.model_copy(
                    update={"config": {"decisionMode": "any"}} if node.id == "split" else {}
                )
                for node in nodes
            ]
            await save_workflow(
                connection,
                aziza,
                UUID(next_draft.id),
                SaveWorkflowRequest(nodes=any_nodes, edges=edges),
            )
            await publish_workflow(connection, aziza, UUID(next_draft.id))
            request = await create_approval_request(
                connection,
                aziza,
                CreateApprovalRequest(title="Parallel any", amount=2_000_000),
            )
            assert set(request.active_node_keys) == {"finance", "director"}
            request = await act_on_request(
                connection,
                aziza,
                UUID(request.id),
                ApprovalActionRequest(action="approve", node_key="finance"),
            )
            assert request.status == "approved"
            assert request.active_node_keys == []
        finally:
            await transaction.rollback()
    await engine.dispose()


@pytest.mark.postgres
def test_parallel_workflow_all_and_any_decisions() -> None:
    database_url = os.environ.get("YUKSALISH_TEST_DATABASE_URL")
    if not database_url:
        pytest.skip("YUKSALISH_TEST_DATABASE_URL is not configured")
    asyncio.run(_exercise_parallel_workflow(database_url))


async def _exercise_payment_position_policy(database_url: str) -> None:
    engine = create_async_engine(database_url, pool_pre_ping=True)
    await seed_demo_data(engine)
    async with engine.connect() as connection:
        transaction = await connection.begin()
        try:
            actors = {}
            for username in ("aziza", "baxtiyor", "dilshod", "malika"):
                row = await find_active_user_by_username(connection, username)
                assert row is not None
                actor = await load_authenticated_user(connection, row["id"])
                assert actor is not None
                assert actor.position_id is not None
                actors[username] = actor

            nargiza = actors["aziza"]
            javohir = actors["baxtiyor"]
            umid = actors["dilshod"]
            bobur = actors["malika"]
            assert nargiza.job_title == PAYMENT_CREATOR_POSITION_NAMES[0]
            assert javohir.job_title == PAYMENT_CREATOR_POSITION_NAMES[1]
            assert umid.job_title == PAYMENT_CREATOR_POSITION_NAMES[2]
            assert bobur.job_title == PAYMENT_CREATOR_POSITION_NAMES[3]

            workspace = await load_workspace(connection, nargiza)
            assert workspace.workflow.published_version == 6
            assert all(
                not any("Ѐ" <= character <= "ԯ" for character in position.name)
                for position in workspace.positions
            )
            node_config = {node.id: node.config for node in workspace.workflow.nodes}
            expected_creator_ids = {
                str(actor.position_id) for actor in (nargiza, javohir, umid, bobur)
            }
            assert set(node_config["start"]["creatorPositionIds"]) == expected_creator_ids
            assert node_config["project_financier"]["approverPositionId"] == str(
                nargiza.position_id
            )
            assert node_config["chair_assistant"]["approverPositionId"] == str(javohir.position_id)
            assert node_config["deputy_chair"]["approverPositionId"] == str(umid.position_id)
            assert node_config["chair"]["approverPositionId"] == str(bobur.position_id)
            assert set(node_config["correction"]["approverPositionIds"]) == (expected_creator_ids)

            request = await create_approval_request(
                connection,
                nargiza,
                CreateApprovalRequest(title="Position-routed payment", amount=1_000_000),
            )
            for node_key in (
                "project_financier",
                "finance_manager_projects",
                "members",
            ):
                assert request.active_node_keys == [node_key]
                request = await act_on_request(
                    connection,
                    nargiza,
                    UUID(request.id),
                    ApprovalActionRequest(action="approve", node_key=node_key),
                )
            with pytest.raises(WorkspaceRepositoryError, match="cannot decide"):
                await act_on_request(
                    connection,
                    nargiza,
                    UUID(request.id),
                    ApprovalActionRequest(action="approve", node_key="chair_assistant"),
                )
            stage_actors = (
                ("chair_assistant", javohir),
                ("chief_accountant", nargiza),
                ("deputy_chair", umid),
                ("chair", bobur),
                ("awaiting_payment", nargiza),
                ("payment", nargiza),
            )
            for node_key, actor in stage_actors:
                assert request.active_node_keys == [node_key]
                request = await act_on_request(
                    connection,
                    actor,
                    UUID(request.id),
                    ApprovalActionRequest(action="approve", node_key=node_key),
                )
            assert request.status == "approved"

            for actor in (nargiza, javohir, umid, bobur):
                correction = await create_approval_request(
                    connection,
                    nargiza,
                    CreateApprovalRequest(title="Correction policy", amount=500_000),
                )
                correction = await act_on_request(
                    connection,
                    nargiza,
                    UUID(correction.id),
                    ApprovalActionRequest(action="return", comment="Fix details"),
                )
                assert correction.status == "needs_revision"
                correction = await act_on_request(
                    connection,
                    actor,
                    UUID(correction.id),
                    ApprovalActionRequest(action="resubmit", comment="Ready"),
                )
                assert correction.active_node_keys == ["project_financier"]

            outsider_position = await create_position(
                connection,
                bobur,
                PositionCreateRequest(name="Sinov mutaxassisi", sort_order=90_000),
            )
            await update_employee_access(
                connection,
                bobur,
                umid.id,
                EmployeeAccessUpdateRequest(
                    role="employee",
                    position_id=UUID(outsider_position.id),
                ),
            )
            outsider = await load_authenticated_user(connection, umid.id)
            assert outsider is not None
            with pytest.raises(WorkspaceRepositoryError, match="cannot create"):
                await create_approval_request(
                    connection,
                    outsider,
                    CreateApprovalRequest(title="Forbidden payment", amount=100_000),
                )
        finally:
            await transaction.rollback()
    await engine.dispose()


@pytest.mark.postgres
def test_payment_position_policy() -> None:
    database_url = os.environ.get("YUKSALISH_TEST_DATABASE_URL")
    if not database_url:
        pytest.skip("YUKSALISH_TEST_DATABASE_URL is not configured")
    asyncio.run(_exercise_payment_position_policy(database_url))
