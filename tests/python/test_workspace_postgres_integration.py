import asyncio
import os
from uuid import UUID

import pytest
from sqlalchemy.ext.asyncio import create_async_engine

from yuksalish_api.auth import load_authenticated_user
from yuksalish_api.repository import (
    act_on_request,
    change_task_status,
    create_approval_request,
    create_task,
    find_active_user_by_username,
    load_workspace,
    save_workflow,
    send_message,
)
from yuksalish_api.seed import seed_demo_data
from yuksalish_api.workspace_schemas import (
    ApprovalActionRequest,
    ChangeTaskStatusRequest,
    CreateApprovalRequest,
    CreateTaskRequest,
    SaveWorkflowRequest,
    SendMessageRequest,
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

            initial = await load_workspace(connection, aziza)
            assert len(initial.people) == 4
            assert len(initial.chats) == 4
            assert initial.workflow.nodes

            message = await send_message(
                connection,
                aziza,
                UUID(initial.chats[0].id),
                SendMessageRequest(body="Integration workflow message"),
            )
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

            approval = await create_approval_request(
                connection,
                aziza,
                CreateApprovalRequest(
                    title="Integration payment",
                    amount=84_600_000,
                    source_task_id=task.id,
                ),
            )
            assert approval.active_node_keys == ["manager"]
            approval = await act_on_request(
                connection,
                aziza,
                UUID(approval.id),
                ApprovalActionRequest(action="approve", comment="Integration approval"),
            )
            assert approval.status == "running"
            assert approval.active_node_keys == ["finance"]
            approval = await act_on_request(
                connection,
                aziza,
                UUID(approval.id),
                ApprovalActionRequest(action="return", comment="Correct the amount"),
            )
            assert approval.status == "needs_revision"
            assert approval.active_node_keys == ["correction"]
            approval = await act_on_request(
                connection,
                aziza,
                UUID(approval.id),
                ApprovalActionRequest(action="resubmit", comment="Corrected"),
            )
            assert approval.status == "running"
            assert approval.active_node_keys == ["manager"]

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

            after = await load_workspace(connection, aziza)
            assert message.id in {item.id for item in after.messages}
            assert task.id in {item.id for item in after.tasks}
            assert approval.id in {item.id for item in after.requests}
        finally:
            await transaction.rollback()
    await engine.dispose()


@pytest.mark.postgres
def test_live_workspace_vertical_slice() -> None:
    database_url = os.environ.get("YUKSALISH_TEST_DATABASE_URL")
    if not database_url:
        pytest.skip("YUKSALISH_TEST_DATABASE_URL is not configured")
    asyncio.run(_exercise_live_workspace(database_url))
