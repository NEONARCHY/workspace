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
    delete_position,
    load_directory,
    update_employee_access,
    update_position,
)
from yuksalish_api.position_policy import PAYMENT_CREATOR_POSITION_NAMES
from yuksalish_api.repository import (
    WorkspaceRepositoryError,
    accept_task_result,
    act_on_request,
    act_on_trip_request,
    add_feed_comment,
    add_task_checklist_item,
    add_task_comment,
    cancel_calendar_event,
    change_project_stage,
    change_task_status,
    create_approval_request,
    create_attachment,
    create_calendar_event,
    create_feed_post,
    create_project,
    create_task,
    create_trip_request,
    delete_feed_post,
    delete_task,
    delete_task_checklist_item,
    find_active_user_by_username,
    get_attachment,
    load_workspace,
    mark_chat_read,
    mark_notification_read,
    materialize_due_notifications,
    materialize_due_task_cycles,
    pin_feed_post,
    publish_workflow,
    remove_task_dependency,
    remove_task_participant,
    return_task_for_revision,
    save_workflow,
    search_messages,
    send_message,
    set_feed_like,
    set_task_cycle,
    set_task_dependency,
    set_task_participant,
    submit_task_result,
    update_approval_request,
    update_calendar_event,
    update_notification_preferences,
    update_project,
    update_task,
    update_task_checklist_item,
    update_trip_request,
)
from yuksalish_api.seed import seed_demo_data
from yuksalish_api.tables import audit_events, chat_members, chats, task_cycles, tasks
from yuksalish_api.workspace_schemas import (
    ApprovalActionRequest,
    ChangeProjectStageRequest,
    ChangeTaskStatusRequest,
    CreateApprovalRequest,
    CreateCalendarEventRequest,
    CreateChecklistItemRequest,
    CreateFeedCommentRequest,
    CreateFeedPostRequest,
    CreateProjectRequest,
    CreateTaskCommentRequest,
    CreateTaskRequest,
    CreateTripRequest,
    NotificationPreferencesUpdate,
    PinFeedPostRequest,
    ReturnTaskForRevisionRequest,
    SaveWorkflowRequest,
    SendMessageRequest,
    SubmitTaskResultRequest,
    TaskCreateChecklistItemRequest,
    TaskCreateCycleRequest,
    TaskCreateDependencyRequest,
    TaskCreateParticipantRequest,
    TaskCycleRequest,
    TaskDependencyRequest,
    TaskParticipantRequest,
    TripActionRequest,
    UpdateApprovalRequest,
    UpdateCalendarEventRequest,
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

            employee_row = await find_active_user_by_username(connection, "dilshod")
            assert employee_row is not None
            employee = await load_authenticated_user(connection, employee_row["id"])
            assert employee is not None

            admin_only_task = await create_task(
                connection,
                admin,
                CreateTaskRequest(
                    title="Administrator private task",
                    assignee_id=str(admin.id),
                ),
            )
            manager_workspace = await load_workspace(connection, aziza)
            assert admin_only_task.id in {task.id for task in manager_workspace.tasks}
            admin_workspace = await load_workspace(connection, admin)
            assert admin_only_task.id in {task.id for task in admin_workspace.tasks}
            employee_workspace = await load_workspace(connection, employee)
            assert admin_only_task.id not in {task.id for task in employee_workspace.tasks}
            with pytest.raises(WorkspaceRepositoryError, match="Task was not found"):
                await change_task_status(
                    connection,
                    employee,
                    UUID(admin_only_task.id),
                    ChangeTaskStatusRequest(status="in_progress"),
                )

            initial = await load_workspace(connection, aziza)
            assert len(initial.people) == 4
            assert len(initial.chats) == 7
            assert len([chat for chat in initial.chats if chat.kind == "task"]) == 3
            assert len(initial.projects) == 3
            assert len(initial.trip_requests) == 1
            assert len(initial.feed_posts) == 2
            assert initial.feed_posts[0].is_pinned is True
            assert len(initial.calendar_events) == 3
            assert sum(chat.unread for chat in initial.chats) >= 2
            assert initial.workflow.nodes
            assert initial.workflow.published_version == 6
            assert {item.workflow_id for item in initial.requests}.issubset(
                {item.id for item in initial.request_workflows}
            )
            assert initial.notifications
            assert len({item.id for item in initial.notifications}) == len(initial.notifications)
            assert any(
                item.requires_action and item.resolved_at is None for item in initial.notifications
            )
            first_notification = initial.notifications[0]
            marked_notification = await mark_notification_read(
                connection,
                aziza,
                UUID(first_notification.id),
            )
            assert marked_notification.read_at is not None
            repeated_workspace = await load_workspace(connection, aziza)
            assert (
                next(
                    item
                    for item in repeated_workspace.notifications
                    if item.id == first_notification.id
                ).read_at
                == marked_notification.read_at
            )
            saved_preferences = await update_notification_preferences(
                connection,
                aziza,
                NotificationPreferencesUpdate(
                    desktop_enabled=False,
                    messages_enabled=True,
                    tasks_enabled=True,
                    approvals_enabled=True,
                    trips_enabled=True,
                    calendar_enabled=True,
                    reminders_enabled=True,
                ),
            )
            assert saved_preferences.desktop_enabled is False
            await materialize_due_notifications(connection)
            assert await materialize_due_notifications(connection) == 0
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
            detached_count = await delete_position(connection, admin, UUID(new_position.id))
            assert detached_count == 1
            directory_after_delete = await load_directory(connection)
            deleted_employee = next(
                employee
                for employee in directory_after_delete.employees
                if employee.id == dilshod.id
            )
            assert deleted_employee.position_id is None
            assert deleted_employee.job_title is None
            assert all(item.id != new_position.id for item in directory_after_delete.positions)

            message = await send_message(
                connection,
                aziza,
                UUID(initial.chats[0].id),
                SendMessageRequest(body="Integration workflow message"),
            )
            found_messages = await search_messages(connection, aziza, "workflow message")
            assert found_messages[0].id == message.id
            finance_chat = next(chat for chat in initial.chats if chat.title == "Финансы и закупки")
            await mark_chat_read(connection, aziza, UUID(finance_chat.id))
            after_read = await load_workspace(connection, aziza)
            assert next(chat for chat in after_read.chats if chat.id == finance_chat.id).unread == 0

            feed_post = await create_feed_post(
                connection,
                aziza,
                CreateFeedPostRequest(
                    title="Integration announcement",
                    body="Feed persistence check",
                ),
            )
            feed_post = await add_feed_comment(
                connection,
                admin,
                UUID(feed_post.id),
                CreateFeedCommentRequest(body="Integration comment"),
            )
            assert feed_post.comments[-1].body == "Integration comment"
            feed_post = await set_feed_like(connection, aziza, UUID(feed_post.id), True)
            assert feed_post.liked_by_current_user is True
            assert feed_post.like_count == 1
            feed_post = await pin_feed_post(
                connection,
                admin,
                UUID(feed_post.id),
                PinFeedPostRequest(is_pinned=True),
            )
            assert feed_post.is_pinned is True
            await delete_feed_post(connection, admin, UUID(feed_post.id))
            assert all(
                item.id != feed_post.id
                for item in (await load_workspace(connection, aziza)).feed_posts
            )

            with pytest.raises(WorkspaceRepositoryError, match="past date"):
                await create_calendar_event(
                    connection,
                    aziza,
                    CreateCalendarEventRequest(
                        title="Backdated calendar event",
                        starts_at=datetime.now(UTC) - timedelta(days=2),
                        ends_at=datetime.now(UTC) - timedelta(days=2) + timedelta(hours=1),
                    ),
                )

            calendar_event = await create_calendar_event(
                connection,
                aziza,
                CreateCalendarEventRequest(
                    title="Integration planning",
                    description="Calendar persistence check",
                    event_type="meeting",
                    starts_at=datetime.now(UTC) + timedelta(days=10),
                    ends_at=datetime.now(UTC) + timedelta(days=10, hours=1),
                    attendee_ids=[str(aziza.id), str(admin.id)],
                ),
            )
            calendar_event = await update_calendar_event(
                connection,
                aziza,
                UUID(calendar_event.id),
                UpdateCalendarEventRequest(
                    title="Integration planning updated",
                    description="Updated calendar persistence check",
                    event_type="meeting",
                    starts_at=datetime.now(UTC) + timedelta(days=11),
                    ends_at=datetime.now(UTC) + timedelta(days=11, hours=1),
                    attendee_ids=[str(aziza.id)],
                ),
            )
            assert calendar_event.title.endswith("updated")
            calendar_event = await update_calendar_event(
                connection,
                aziza,
                UUID(calendar_event.id),
                UpdateCalendarEventRequest(
                    title="Past event correction",
                    starts_at=datetime.now(UTC) - timedelta(days=2),
                    ends_at=datetime.now(UTC) - timedelta(days=2) + timedelta(hours=1),
                    attendee_ids=[str(aziza.id)],
                ),
            )
            assert calendar_event.title == "Past event correction"
            calendar_event = await cancel_calendar_event(
                connection,
                aziza,
                UUID(calendar_event.id),
            )
            assert calendar_event.status == "cancelled"
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
            assert task.chat_id is not None
            task_chat_id = UUID(task.chat_id)
            assert await connection.scalar(
                select(func.count()).select_from(chat_members).where(
                    chat_members.c.chat_id == task_chat_id,
                    chat_members.c.user_id == aziza.id,
                )
            ) == 1
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
            assert await connection.scalar(
                select(chats.c.title).where(chats.c.id == task_chat_id)
            ) == "Задача · Integration task card"
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
            assert await connection.scalar(
                select(func.count()).select_from(chat_members).where(
                    chat_members.c.chat_id == task_chat_id,
                )
            ) == 2
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
            detailed_task = await create_task(
                connection,
                aziza,
                CreateTaskRequest(
                    title="Detailed task composer",
                    description="Created with one final confirmation",
                    project="Workspace UX",
                    assignee_id=str(aziza.id),
                    priority="high",
                    due_at=datetime.now(UTC) + timedelta(days=12),
                    participants=[
                        TaskCreateParticipantRequest(
                            user_id=str(dilshod_auth.id),
                            role="observer",
                        )
                    ],
                    checklist=[
                        TaskCreateChecklistItemRequest(title="Confirm requirements"),
                        TaskCreateChecklistItemRequest(title="Attach result"),
                    ],
                    dependencies=[
                        TaskCreateDependencyRequest(
                            depends_on_task_id=blocker.id,
                            dependency_kind="relates",
                        )
                    ],
                    cycle=TaskCreateCycleRequest(
                        title="Detailed task composer",
                        schedule_kind="weekly",
                        interval=2,
                        next_run_at=datetime.now(UTC) + timedelta(days=13),
                    ),
                ),
            )
            assert detailed_task.description == "Created with one final confirmation"
            assert detailed_task.priority == "high"
            assert detailed_task.participants[0].role == "observer"
            assert [item.title for item in detailed_task.checklist] == [
                "Confirm requirements",
                "Attach result",
            ]
            assert detailed_task.dependencies[0].depends_on_task_id == blocker.id
            assert detailed_task.cycle is not None
            assert detailed_task.cycle.schedule_kind == "weekly"
            assert detailed_task.cycle.interval == 2
            assert detailed_task.chat_id is not None
            assert await connection.scalar(
                select(func.count()).select_from(chat_members).where(
                    chat_members.c.chat_id == UUID(detailed_task.chat_id),
                    chat_members.c.user_id == dilshod_auth.id,
                )
            ) == 1
            task = await set_task_dependency(
                connection,
                aziza,
                UUID(task.id),
                TaskDependencyRequest(depends_on_task_id=blocker.id),
            )
            assert task.dependencies[0].depends_on_task_id == blocker.id
            with pytest.raises(WorkspaceRepositoryError, match="blocking dependencies"):
                await submit_task_result(
                    connection,
                    aziza,
                    UUID(task.id),
                    SubmitTaskResultRequest(result_text="Ready for review"),
                )
            with pytest.raises(WorkspaceRepositoryError, match="create a cycle"):
                await set_task_dependency(
                    connection,
                    aziza,
                    UUID(blocker.id),
                    TaskDependencyRequest(depends_on_task_id=task.id),
                )
            await submit_task_result(
                connection,
                aziza,
                UUID(blocker.id),
                SubmitTaskResultRequest(result_text="Blocking work is done"),
            )
            await accept_task_result(connection, aziza, UUID(blocker.id))
            subtask = await create_task(
                connection,
                aziza,
                CreateTaskRequest(
                    title="Integration subtask",
                    assignee_id=str(dilshod_auth.id),
                    parent_task_id=task.id,
                    project=task.project,
                ),
            )
            assert subtask.parent_task_id == task.id
            assert subtask.parent_task_title == task.title
            task = await submit_task_result(
                connection,
                dilshod_auth,
                UUID(task.id),
                SubmitTaskResultRequest(result_text="Parent result for review"),
            )
            assert task.status == "awaiting_review"
            with pytest.raises(WorkspaceRepositoryError, match="every subtask"):
                await accept_task_result(connection, aziza, UUID(task.id))
            subtask = await submit_task_result(
                connection,
                dilshod_auth,
                UUID(subtask.id),
                SubmitTaskResultRequest(result_text="Subtask result"),
            )
            assert subtask.status == "awaiting_review"
            await accept_task_result(connection, aziza, UUID(subtask.id))
            task = await return_task_for_revision(
                connection,
                aziza,
                UUID(task.id),
                ReturnTaskForRevisionRequest(
                    reason_code="corrections_required",
                    reason_text="Add the final figures",
                ),
            )
            assert task.status == "in_progress"
            assert task.latest_return is not None
            assert task.latest_return.reason_text == "Add the final figures"
            await submit_task_result(
                connection,
                aziza,
                UUID(task.id),
                SubmitTaskResultRequest(result_text="Corrected parent result"),
            )
            task = await accept_task_result(connection, aziza, UUID(task.id))
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
            assert await connection.scalar(
                select(func.count()).select_from(chat_members).where(
                    chat_members.c.chat_id == task_chat_id,
                )
            ) == 1

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

            calendar_start = datetime(2026, 9, 7, 4, tzinfo=UTC)
            task = await set_task_cycle(
                connection,
                aziza,
                UUID(task.id),
                TaskCycleRequest(
                    title="Calendar integration task",
                    schedule_kind="calendar",
                    calendar_rule="weekdays",
                    weekdays=[0, 2],
                    timezone="Asia/Tashkent",
                    next_run_at=calendar_start,
                ),
            )
            assert task.cycle is not None
            assert task.cycle.schedule_kind == "calendar"
            assert task.cycle.calendar_rule == "weekdays"
            assert task.cycle.weekdays == [0, 2]
            assert task.cycle.next_run_at == calendar_start
            assert await materialize_due_task_cycles(connection, calendar_start) == 1
            assert await connection.scalar(
                select(func.count())
                .select_from(tasks.join(chats, chats.c.context_id == tasks.c.id))
                .where(
                    tasks.c.title == "Calendar integration task",
                    chats.c.context_type == "task",
                )
            ) == 1
            assert await connection.scalar(
                select(task_cycles.c.next_run_at).where(task_cycles.c.id == UUID(task.cycle.id))
            ) == datetime(2026, 9, 9, 4, tzinfo=UTC)

            disposable_task = await create_task(
                connection,
                aziza,
                CreateTaskRequest(
                    title="Task that its author can delete",
                    assignee_id=str(dilshod_auth.id),
                ),
            )
            disposable_subtask = await create_task(
                connection,
                aziza,
                CreateTaskRequest(
                    title="Child removed with its parent",
                    assignee_id=str(dilshod_auth.id),
                    parent_task_id=disposable_task.id,
                ),
            )
            with pytest.raises(WorkspaceRepositoryError, match="author or an administrator"):
                await delete_task(connection, dilshod_auth, UUID(disposable_task.id))
            await delete_task(connection, aziza, UUID(disposable_task.id))
            assert await connection.scalar(
                select(func.count()).select_from(tasks).where(
                    tasks.c.id.in_({UUID(disposable_task.id), UUID(disposable_subtask.id)})
                )
            ) == 0
            admin_deleted_task = await create_task(
                connection,
                aziza,
                CreateTaskRequest(
                    title="Task that an administrator can delete",
                    assignee_id=str(dilshod_auth.id),
                ),
            )
            await delete_task(connection, admin, UUID(admin_deleted_task.id))
            assert await connection.scalar(
                select(func.count()).select_from(tasks).where(
                    tasks.c.id == UUID(admin_deleted_task.id)
                )
            ) == 0

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
            with pytest.raises(WorkspaceRepositoryError, match="destination workflow stage"):
                await act_on_request(
                    connection,
                    admin,
                    UUID(approval.id),
                    ApprovalActionRequest(action="move"),
                )
            with pytest.raises(WorkspaceRepositoryError, match="not a movable workflow stage"):
                await act_on_request(
                    connection,
                    admin,
                    UUID(approval.id),
                    ApprovalActionRequest(action="move", node_key="start"),
                )
            with pytest.raises(WorkspaceRepositoryError, match="cannot move"):
                await act_on_request(
                    connection,
                    dilshod_auth,
                    UUID(approval.id),
                    ApprovalActionRequest(action="move", node_key="project_financier"),
                )
            approval = await act_on_request(
                connection,
                admin,
                UUID(approval.id),
                ApprovalActionRequest(
                    action="move",
                    node_key="project_financier",
                    comment="Administrative rollback coverage",
                ),
            )
            assert approval.status == "running"
            assert approval.active_node_keys == ["project_financier"]
            assert approval.actions[-1].action == "move"
            assert approval.actions[-1].comment == "Administrative rollback coverage"
            approval = await act_on_request(
                connection,
                aziza,
                UUID(approval.id),
                ApprovalActionRequest(action="move", node_key="finance_manager_projects"),
            )
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

            with pytest.raises(WorkspaceRepositoryError, match="Only administrators"):
                await save_workflow(
                    connection,
                    aziza,
                    UUID(initial.workflow.id),
                    SaveWorkflowRequest(
                        nodes=list(initial.workflow.nodes),
                        edges=list(initial.workflow.edges),
                    ),
                )

            saved = await save_workflow(
                connection,
                admin,
                UUID(initial.workflow.id),
                SaveWorkflowRequest(
                    nodes=list(initial.workflow.nodes),
                    edges=list(initial.workflow.edges),
                ),
            )
            assert len(saved.nodes) == len(initial.workflow.nodes)
            next_draft = await publish_workflow(
                connection,
                admin,
                UUID(initial.workflow.id),
            )
            assert next_draft.version == initial.workflow.version + 1
            assert next_draft.published_version == initial.workflow.version
            assert next_draft.status == "draft"
            with pytest.raises(WorkspaceRepositoryError, match="cannot be edited"):
                await save_workflow(
                    connection,
                    admin,
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
            admin_row = await find_active_user_by_username(connection, "malika")
            assert admin_row is not None
            admin = await load_authenticated_user(connection, admin_row["id"])
            assert admin is not None
            workflow = (await load_workspace(connection, aziza)).workflow
            assert workflow is not None
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
                admin,
                UUID(workflow.id),
                SaveWorkflowRequest(nodes=nodes, edges=edges),
            )
            next_draft = await publish_workflow(connection, admin, UUID(workflow.id))
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
                admin,
                UUID(next_draft.id),
                SaveWorkflowRequest(nodes=any_nodes, edges=edges),
            )
            await publish_workflow(connection, admin, UUID(next_draft.id))
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
