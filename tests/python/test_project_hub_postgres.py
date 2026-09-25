import os
from datetime import UTC, date, datetime, timedelta
from uuid import UUID, uuid4

import pytest
from sqlalchemy import insert, select
from sqlalchemy.ext.asyncio import create_async_engine

from yuksalish_api.auth import AuthenticatedUser
from yuksalish_api.project_hub_schemas import (
    ProjectFundingAction,
    ProjectFundingWrite,
    ProjectHubWrite,
    ProjectWorkCommentWrite,
    ProjectWorkItemWrite,
    ProjectWorkStatusWrite,
    ProjectWorkstreamWrite,
)
from yuksalish_api.project_hub_service import (
    add_item_comment,
    create_funding_request,
    decide_funding_request,
    load_funding_requests,
    load_hub,
    load_request_targets,
    materialize_project_reminders,
    publish_event,
    save_item,
    save_project,
    save_workstream,
    set_item_status,
)
from yuksalish_api.repository import (
    WorkspaceRepositoryError,
    cancel_calendar_event,
    update_calendar_event,
    validate_attachment_owner,
)
from yuksalish_api.tables import attachments, users, workspace_notifications
from yuksalish_api.workspace_schemas import UpdateCalendarEventRequest


def actor(user_id: UUID, role: str) -> AuthenticatedUser:
    return AuthenticatedUser(
        id=user_id,
        username=f"hub-{str(user_id)[:8]}",
        full_name="Test User",
        position_id=None,
        job_title=None,
        role=role,
    )


@pytest.mark.anyio
@pytest.mark.postgres
async def test_project_hub_is_independent_and_snapshots_approval_route() -> None:
    database_url = os.environ.get("YUKSALISH_TEST_DATABASE_URL")
    if not database_url:
        pytest.skip("YUKSALISH_TEST_DATABASE_URL is not configured")
    engine = create_async_engine(database_url)
    manager_id, first_id, second_id, outsider_id = (uuid4() for _ in range(4))
    try:
        async with engine.connect() as connection:
            transaction = await connection.begin()
            try:
                for user_id, role in (
                    (manager_id, "manager"),
                    (first_id, "employee"),
                    (second_id, "employee"),
                    (outsider_id, "employee"),
                ):
                    await connection.execute(
                        insert(users).values(
                            id=user_id,
                            username=f"hub-{user_id.hex[:12]}",
                            full_name=f"User {user_id.hex[:8]}",
                            role=role,
                            status="active",
                            created_at=datetime.now(UTC),
                            updated_at=datetime.now(UTC),
                        )
                    )
                manager = actor(manager_id, "manager")
                first = actor(first_id, "employee")
                second = actor(second_id, "employee")
                outsider = actor(outsider_id, "employee")
                details = ProjectHubWrite(
                    code=f"P-{manager_id.hex[:8]}",
                    title="Новый проект",
                    manager_user_id=str(manager_id),
                    responsible_user_ids=[str(first_id)],
                    approver_user_ids=[str(first_id), str(second_id)],
                    budget=1000,
                    access_status="closed",
                )
                project = await save_project(connection, manager, details)
                workstream = await save_workstream(
                    connection,
                    manager,
                    UUID(project.id),
                    ProjectWorkstreamWrite(
                        title="Проведение форума",
                        start_date=date(2030, 9, 1),
                        end_date=date(2030, 10, 1),
                    ),
                )
                assert workstream.end_date == date(2030, 10, 1)
                old_client_edit = await save_workstream(
                    connection, manager, UUID(project.id),
                    ProjectWorkstreamWrite(title="Проведение форума", description="Уточнено"),
                    UUID(workstream.id),
                )
                assert old_client_edit.end_date == date(2030, 10, 1)
                assert project.approver_user_ids == [str(first_id), str(second_id)]
                assert any(
                    candidate.id == workstream.id
                    for candidate in (await load_hub(connection, manager)).workstreams
                )
                with pytest.raises(WorkspaceRepositoryError) as duplicate_workstream:
                    await save_workstream(
                        connection, manager, UUID(project.id),
                        ProjectWorkstreamWrite(title="Проведение форума"),
                    )
                assert duplicate_workstream.value.status_code == 409
                with pytest.raises(WorkspaceRepositoryError) as forbidden_workstream:
                    await save_workstream(
                        connection, outsider, UUID(project.id),
                        ProjectWorkstreamWrite(title="Чужое направление"),
                    )
                assert forbidden_workstream.value.status_code == 404
                assert len((await load_hub(connection, outsider)).projects) == 0
                due = datetime.now(UTC) + timedelta(days=10)
                with pytest.raises(WorkspaceRepositoryError) as missing_workstream:
                    await save_item(
                        connection, manager, UUID(project.id),
                        ProjectWorkItemWrite(
                            workstream_id=str(uuid4()), kind="task", title="Без направления"
                        ),
                    )
                assert missing_workstream.value.status_code == 404
                item = await save_item(
                    connection,
                    manager,
                    UUID(project.id),
                    ProjectWorkItemWrite(
                        workstream_id=workstream.id,
                        kind="task",
                        title="Подготовить форум",
                        due_at=due,
                        budget=600,
                        assignee_user_ids=[str(first_id)],
                    ),
                )
                targets = await load_request_targets(connection, first)
                assert [candidate.id for candidate in targets.items] == [item.id]
                assert targets.items[0].actions == []
                assert not (await load_request_targets(connection, outsider)).items
                started = await set_item_status(
                    connection,
                    manager,
                    UUID(project.id),
                    UUID(item.id),
                    ProjectWorkStatusWrite(status="active", expected_status="planned"),
                )
                assert started.status == "active" and started.actions[-1].to_status == "active"
                with pytest.raises(WorkspaceRepositoryError) as stale_status:
                    await set_item_status(
                        connection,
                        manager,
                        UUID(project.id),
                        UUID(item.id),
                        ProjectWorkStatusWrite(status="completed", expected_status="planned"),
                    )
                assert stale_status.value.status_code == 409
                commented = await add_item_comment(
                    connection,
                    first,
                    UUID(project.id),
                    UUID(item.id),
                    ProjectWorkCommentWrite(comment="Площадка согласована"),
                )
                assert commented.actions[-1].comment == "Площадка согласована"
                with pytest.raises(WorkspaceRepositoryError) as outsider_comment:
                    await add_item_comment(
                        connection,
                        outsider,
                        UUID(project.id),
                        UUID(item.id),
                        ProjectWorkCommentWrite(comment="outsider"),
                    )
                assert outsider_comment.value.status_code == 404
                with pytest.raises(WorkspaceRepositoryError) as no_reason:
                    await set_item_status(
                        connection,
                        manager,
                        UUID(project.id),
                        UUID(item.id),
                        ProjectWorkStatusWrite(status="cancelled", expected_status="active"),
                    )
                assert no_reason.value.status_code == 422
                cancelled_task = await save_item(
                    connection, manager, UUID(project.id),
                    ProjectWorkItemWrite(
                        workstream_id=workstream.id, kind="task", title="Отменить"
                    ),
                )
                cancelled_with_reason = await set_item_status(
                    connection, manager, UUID(project.id), UUID(cancelled_task.id),
                    ProjectWorkStatusWrite(
                        status="cancelled", expected_status="planned", comment="План изменён"
                    ),
                )
                assert cancelled_with_reason.actions[-1].comment == "План изменён"
                rejected_task = await save_item(
                    connection, manager, UUID(project.id),
                    ProjectWorkItemWrite(
                        workstream_id=workstream.id, kind="task", title="Проверить"
                    ),
                )
                rejected_with_reason = await set_item_status(
                    connection, manager, UUID(project.id), UUID(rejected_task.id),
                    ProjectWorkStatusWrite(
                        status="rejected", expected_status="planned", comment="Нужна доработка"
                    ),
                )
                assert rejected_with_reason.status == "rejected"
                assert rejected_with_reason.actions[-1].comment == "Нужна доработка"
                reopened = await set_item_status(
                    connection, manager, UUID(project.id), UUID(rejected_task.id),
                    ProjectWorkStatusWrite(status="active", expected_status="rejected"),
                )
                assert reopened.status == "active"
                request = await create_funding_request(
                    connection,
                    manager,
                    UUID(project.id),
                    ProjectFundingWrite(
                        item_id=item.id, title="Аренда", amount=400,
                        approval_due_at=due,
                    ),
                )
                assert request.approval_due_at == due
                with pytest.raises(WorkspaceRepositoryError) as past_deadline:
                    await create_funding_request(
                        connection, manager, UUID(project.id),
                        ProjectFundingWrite(
                            item_id=item.id, title="Просроченная", amount=1,
                            approval_due_at=datetime.now(UTC) - timedelta(days=1),
                        ),
                    )
                assert past_deadline.value.status_code == 422
                await validate_attachment_owner(
                    connection, manager, "project_funding_request", UUID(request.id), write=True
                )
                await validate_attachment_owner(
                    connection, first, "project_funding_request", UUID(request.id), write=False
                )
                with pytest.raises(WorkspaceRepositoryError) as forbidden_file:
                    await validate_attachment_owner(
                        connection, first, "project_funding_request", UUID(request.id), write=True
                    )
                assert forbidden_file.value.status_code == 404
                await connection.execute(
                    insert(attachments).values(
                        id=uuid4(), owner_type="project_funding_request",
                        owner_id=UUID(request.id), file_name="smeta.pdf",
                        content_type="application/pdf", byte_size=100, sha256="0" * 64,
                        storage_key=f"tests/{request.id}/smeta.pdf", uploaded_by_user_id=manager_id,
                        document_role="general", media_kind="file", created_at=datetime.now(UTC),
                    )
                )
                funding = await load_funding_requests(connection, manager)
                assert funding[0].attachments[0].file_name == "smeta.pdf"
                assert request.current_step == 0
                with pytest.raises(WorkspaceRepositoryError) as denied:
                    await decide_funding_request(
                        connection,
                        outsider,
                        UUID(request.id),
                        ProjectFundingAction(action="approve"),
                    )
                assert denied.value.status_code in {403, 404}
                updated = await save_project(
                    connection,
                    manager,
                    details.model_copy(
                        update={
                            "approver_user_ids": [str(second_id)],
                        }
                    ),
                    UUID(project.id),
                )
                assert updated.approver_user_ids == [str(second_id)]
                first_decision = await decide_funding_request(
                    connection,
                    first,
                    UUID(request.id),
                    ProjectFundingAction(action="approve"),
                )
                assert first_decision.status == "pending" and first_decision.current_step == 1
                final = await decide_funding_request(
                    connection,
                    second,
                    UUID(request.id),
                    ProjectFundingAction(action="approve"),
                )
                assert final.status == "approved" and final.approver_user_ids == [
                    str(first_id),
                    str(second_id),
                ]
                with pytest.raises(WorkspaceRepositoryError) as closed_file:
                    await validate_attachment_owner(
                        connection, manager, "project_funding_request", UUID(request.id),
                        write=True,
                    )
                assert closed_file.value.status_code == 404
                assert (await load_hub(connection, manager)).projects[0].approved_amount == 400
                with pytest.raises(WorkspaceRepositoryError) as reduced_budget:
                    await save_project(
                        connection,
                        manager,
                        details.model_copy(
                            update={
                                "budget": 300,
                            }
                        ),
                        UUID(project.id),
                    )
                assert reduced_budget.value.status_code == 409
                assert len(await load_funding_requests(connection, outsider)) == 0
                second_request = await create_funding_request(
                    connection,
                    manager,
                    UUID(project.id),
                    ProjectFundingWrite(
                        item_id=item.id, title="Дополнительные расходы", amount=700,
                        approval_due_at=due,
                    ),
                )
                with pytest.raises(WorkspaceRepositoryError) as over_budget:
                    await decide_funding_request(
                        connection,
                        second,
                        UUID(second_request.id),
                        ProjectFundingAction(action="approve"),
                    )
                assert over_budget.value.status_code == 409
                assert await materialize_project_reminders(connection) == 2
                assert await materialize_project_reminders(connection) == 0
                notices = (
                    (
                        await connection.execute(
                            select(workspace_notifications).where(
                                workspace_notifications.c.section == "project_hub",
                                workspace_notifications.c.entity_id == UUID(project.id),
                            )
                        )
                    )
                    .mappings()
                    .all()
                )
                assert len(notices) == 2
                event = await save_item(
                    connection,
                    manager,
                    UUID(project.id),
                    ProjectWorkItemWrite(
                        workstream_id=workstream.id,
                        kind="event",
                        title="Встреча команды",
                        starts_at=due,
                        due_at=due + timedelta(hours=1),
                    ),
                )
                with pytest.raises(WorkspaceRepositoryError) as rejected_event:
                    await set_item_status(
                        connection, manager, UUID(project.id), UUID(event.id),
                        ProjectWorkStatusWrite(status="rejected", comment="Нет"),
                    )
                assert rejected_event.value.status_code == 422
                published = await publish_event(
                    connection,
                    manager,
                    UUID(project.id),
                    UUID(event.id),
                )
                assert published.calendar_event_id is not None
                repeated = await publish_event(
                    connection,
                    manager,
                    UUID(project.id),
                    UUID(event.id),
                )
                assert repeated.calendar_event_id == published.calendar_event_id
                changed = await update_calendar_event(
                    connection,
                    manager,
                    UUID(published.calendar_event_id),
                    UpdateCalendarEventRequest(
                        title="Встреча по бюджету",
                        description="Новая повестка",
                        event_type="general",
                        starts_at=due,
                        ends_at=due + timedelta(hours=2),
                    ),
                )
                assert changed.title == "Встреча по бюджету"
                refreshed_event = next(
                    candidate for candidate in (await load_hub(connection, manager)).items
                    if candidate.id == event.id
                )
                assert refreshed_event.title == "Встреча по бюджету"
                assert refreshed_event.due_at == due + timedelta(hours=2)
                await cancel_calendar_event(connection, manager, UUID(published.calendar_event_id))
                cancelled = next(
                    candidate for candidate in (await load_hub(connection, manager)).items
                    if candidate.id == event.id
                )
                assert cancelled.status == "cancelled"
                with pytest.raises(WorkspaceRepositoryError):
                    await set_item_status(
                        connection, manager, UUID(project.id), UUID(event.id),
                        ProjectWorkStatusWrite(status="active"),
                    )
                legacy_item = await save_item(
                    connection, manager, UUID(project.id),
                    ProjectWorkItemWrite(kind="task", title="Работа старого клиента"),
                )
                legacy_stream = next(
                    candidate for candidate in (await load_hub(connection, manager)).workstreams
                    if candidate.id == legacy_item.workstream_id
                )
                assert legacy_stream.title == "Ранее добавленные работы"
                edited_legacy = await save_item(
                    connection, manager, UUID(project.id),
                    ProjectWorkItemWrite(kind="task", title="Изменённая работа"),
                    UUID(legacy_item.id),
                )
                assert edited_legacy.workstream_id == legacy_item.workstream_id
            finally:
                await transaction.rollback()
    finally:
        await engine.dispose()
