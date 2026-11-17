from dataclasses import replace
from unittest.mock import AsyncMock
from uuid import UUID, uuid4

import pytest
from pydantic import ValidationError

from yuksalish_api.access_control import can_reopen_completed_tasks, request_module_action
from yuksalish_api.auth import AuthenticatedUser
from yuksalish_api.workspace_schemas import ReopenTaskRequest


def test_reopen_has_its_own_permission_and_requires_an_explanation() -> None:
    assert request_module_action(f"/api/v1/tasks/{uuid4()}/reopen", "POST") == ("tasks", "view")
    assert ReopenTaskRequest(reason="  Повторная проверка  ").reason == "Повторная проверка"
    with pytest.raises(ValidationError):
        ReopenTaskRequest(reason="   ")


@pytest.mark.anyio
async def test_reopen_permission_is_not_implicit_for_managers() -> None:
    connection = AsyncMock()
    user = AuthenticatedUser(uuid4(), "reader", "Reader", None, None, "employee")
    assert await can_reopen_completed_tasks(connection, replace(user, role="admin"))
    assert await can_reopen_completed_tasks(connection, replace(user, role="superadmin"))
    assert not await can_reopen_completed_tasks(connection, replace(user, role="manager"))
    connection.scalar.assert_not_awaited()
    member = replace(user, position_id=uuid4())
    connection.scalar.side_effect = [True, False]
    assert await can_reopen_completed_tasks(connection, member)
    assert not await can_reopen_completed_tasks(connection, member)


@pytest.mark.postgres
@pytest.mark.anyio
async def test_completed_task_reopen_and_position_delegation() -> None:
    import os

    from sqlalchemy.engine import make_url
    from sqlalchemy.ext.asyncio import create_async_engine

    from yuksalish_api.directory_schemas import PositionCreateRequest, PositionUpdateRequest
    from yuksalish_api.directory_service import (
        DirectoryServiceError,
        create_position,
        update_position,
    )
    from yuksalish_api.repository import (
        WorkspaceRepositoryError,
        accept_task_result,
        create_task,
        find_active_user_by_username,
        load_task_history,
        reopen_completed_task,
        submit_task_result,
    )
    from yuksalish_api.seed import seed_demo_data
    from yuksalish_api.workspace_schemas import CreateTaskRequest, SubmitTaskResultRequest

    url = os.environ.get("YUKSALISH_TEST_DATABASE_URL")
    if not url:
        pytest.skip("YUKSALISH_TEST_DATABASE_URL is not configured")
    assert (make_url(url).database or "").startswith("yuksalish_test")
    engine = create_async_engine(url)
    try:
        await seed_demo_data(engine)
        async with engine.connect() as connection:
            transaction = await connection.begin()
            try:
                row = await find_active_user_by_username(connection, "dilshod")
                assert row is not None
                user = AuthenticatedUser(row["id"], "test", "Test Actor", None, None, "employee")
                admin = replace(user, role="admin")
                position = await create_position(
                    connection, admin, PositionCreateRequest(name=f"Test role {uuid4().hex}"),
                )
                position_id = UUID(position.id)
                holder = replace(user, position_id=position_id)
                task = await create_task(connection, user, CreateTaskRequest(title="Reopen test"))
                task_id = UUID(task.id)
                reason = ReopenTaskRequest(reason="Проверить обновлённые данные")
                result = SubmitTaskResultRequest(result_text="Previous result")
                await submit_task_result(connection, user, task_id, result)
                await accept_task_result(connection, user, task_id)
                with pytest.raises(WorkspaceRepositoryError) as denied:
                    await reopen_completed_task(connection, holder, task_id, reason)
                assert denied.value.status_code == 403

                grant = PositionUpdateRequest(can_reopen_completed_tasks=True)
                with pytest.raises(DirectoryServiceError):
                    await update_position(connection, holder, position_id, grant)
                assert (await update_position(
                    connection, admin, position_id, grant,
                )).can_reopen_completed_tasks
                outsider = replace(holder, id=uuid4())
                with pytest.raises(WorkspaceRepositoryError) as missing:
                    await reopen_completed_task(connection, outsider, task_id, reason)
                assert missing.value.status_code == 404
                reopened = await reopen_completed_task(connection, holder, task_id, reason)
                assert reopened.status == "in_progress"
                assert reopened.result_text == "Previous result"
                with pytest.raises(WorkspaceRepositoryError) as duplicate:
                    await reopen_completed_task(connection, admin, task_id, reason)
                assert duplicate.value.status_code == 409
                history = (await load_task_history(connection, user, task_id)).events
                assert history[0].kind == "task_reopened"
                assert history[0].actor_user_id == str(holder.id)
                assert history[0].reason == reason.reason
                assert (history[0].old_status, history[0].status) == ("completed", "in_progress")
                assert sum(item.kind == "task_reopened" for item in history) == 1
                assert any(item.kind == "task_completed" for item in history)

                await submit_task_result(connection, user, task_id, result)
                await accept_task_result(connection, user, task_id)
                await update_position(connection, admin, position_id, PositionUpdateRequest(
                    can_reopen_completed_tasks=False,
                ))
                with pytest.raises(WorkspaceRepositoryError) as revoked:
                    await reopen_completed_task(connection, holder, task_id, reason)
                assert revoked.value.status_code == 403
                assert (await reopen_completed_task(
                    connection, admin, task_id, reason,
                )).status == "in_progress"
            finally:
                await transaction.rollback()
    finally:
        await engine.dispose()
