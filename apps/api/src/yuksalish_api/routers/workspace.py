import asyncio
import hashlib
from pathlib import PurePosixPath
from typing import Annotated, Literal, cast
from urllib.parse import quote
from uuid import UUID, uuid4

from fastapi import (
    APIRouter,
    Depends,
    HTTPException,
    Query,
    Request,
    Response,
    WebSocket,
    WebSocketDisconnect,
)
from sqlalchemy.ext.asyncio import AsyncConnection, AsyncEngine

from yuksalish_api.absence_service import (
    AbsenceError,
    act_on_absence,
    create_absence,
    update_absence,
)
from yuksalish_api.access_control import ModuleAction, ensure_module_action
from yuksalish_api.auth import (
    AuthenticatedUser,
    InvalidTokenError,
    authenticate_access_token,
    require_user,
)
from yuksalish_api.database import get_connection
from yuksalish_api.efficiency_service import load_efficiency_overview
from yuksalish_api.events import WorkspaceEventBus
from yuksalish_api.object_storage import ObjectStorage, ObjectStorageError
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
    delete_approval_request,
    delete_feed_post,
    delete_task,
    delete_task_checklist_item,
    get_attachment,
    load_workspace,
    mark_all_notifications_read,
    mark_chat_read,
    mark_notification_desktop_delivered,
    mark_notification_read,
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
    set_task_efficiency_exclusion,
    set_task_participant,
    submit_task_result,
    update_approval_request,
    update_calendar_event,
    update_notification_preferences,
    update_project,
    update_task,
    update_task_checklist_item,
    update_trip_request,
    validate_attachment_owner,
)
from yuksalish_api.web_security import is_allowed_web_origin
from yuksalish_api.workspace_schemas import (
    AbsenceActionRequest,
    AbsenceRequestResponse,
    AbsenceWriteRequest,
    ApprovalActionRequest,
    ApprovalRequestResponse,
    AttachmentOwnerType,
    AttachmentResponse,
    CalendarEventResponse,
    ChangeProjectStageRequest,
    ChangeTaskStatusRequest,
    ChatMessageResponse,
    CreateApprovalRequest,
    CreateCalendarEventRequest,
    CreateChecklistItemRequest,
    CreateFeedCommentRequest,
    CreateFeedPostRequest,
    CreateProjectRequest,
    CreateTaskCommentRequest,
    CreateTaskRequest,
    CreateTripRequest,
    EfficiencyOverviewResponse,
    FeedPostResponse,
    NotificationPreferencesResponse,
    NotificationPreferencesUpdate,
    NotificationResponse,
    PinFeedPostRequest,
    ProjectResponse,
    ReturnTaskForRevisionRequest,
    SaveWorkflowRequest,
    SendMessageRequest,
    SubmitTaskResultRequest,
    TaskCycleRequest,
    TaskDependencyRequest,
    TaskEfficiencyExclusionRequest,
    TaskParticipantRequest,
    TaskResponse,
    TripActionRequest,
    TripRequestResponse,
    UpdateApprovalRequest,
    UpdateCalendarEventRequest,
    UpdateChecklistItemRequest,
    UpdateProjectRequest,
    UpdateTaskRequest,
    UpdateTripRequest,
    WorkflowResponse,
    WorkspaceBootstrapResponse,
)

router = APIRouter(tags=["workspace"])


def _translate(error: WorkspaceRepositoryError) -> HTTPException:
    return HTTPException(status_code=error.status_code, detail=error.detail)


def _translate_absence(error: AbsenceError) -> HTTPException:
    return HTTPException(status_code=error.status_code, detail=error.detail)


def _event_bus(request: Request) -> WorkspaceEventBus:
    return cast(WorkspaceEventBus, request.app.state.event_bus)


def _object_storage(request: Request) -> ObjectStorage:
    return cast(ObjectStorage, request.app.state.object_storage)


def _safe_file_name(value: str) -> str:
    normalized = PurePosixPath(value.replace("\\", "/")).name.strip()
    if (
        not normalized
        or normalized in {".", ".."}
        or len(normalized) > 255
        or any(ord(character) < 32 for character in normalized)
    ):
        raise HTTPException(status_code=422, detail="Invalid file name")
    return normalized


@router.get("/workspace/bootstrap", response_model=WorkspaceBootstrapResponse)
async def workspace_bootstrap(
    current_user: Annotated[AuthenticatedUser, Depends(require_user)],
    connection: Annotated[AsyncConnection, Depends(get_connection)],
) -> WorkspaceBootstrapResponse:
    try:
        return await load_workspace(connection, current_user)
    except WorkspaceRepositoryError as error:
        raise _translate(error) from error


@router.get("/efficiency", response_model=EfficiencyOverviewResponse)
async def efficiency_overview(
    current_user: Annotated[AuthenticatedUser, Depends(require_user)],
    connection: Annotated[AsyncConnection, Depends(get_connection)],
    period: Annotated[str | None, Query(pattern=r"^\d{4}-(0[1-9]|1[0-2])$")] = None,
) -> EfficiencyOverviewResponse:
    try:
        result = await load_efficiency_overview(connection, current_user, period)
        return EfficiencyOverviewResponse.model_validate(result)
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error


@router.patch("/notifications/{notification_id}/read", response_model=NotificationResponse)
async def patch_notification_read(
    notification_id: UUID,
    request: Request,
    current_user: Annotated[AuthenticatedUser, Depends(require_user)],
    connection: Annotated[AsyncConnection, Depends(get_connection)],
) -> NotificationResponse:
    try:
        result = await mark_notification_read(connection, current_user, notification_id)
    except WorkspaceRepositoryError as error:
        raise _translate(error) from error
    await _event_bus(request).publish(
        {"type": "notification.read", "entityId": result.id, "userId": str(current_user.id)}
    )
    return result


@router.post("/notifications/read-all", status_code=204)
async def post_notifications_read_all(
    request: Request,
    current_user: Annotated[AuthenticatedUser, Depends(require_user)],
    connection: Annotated[AsyncConnection, Depends(get_connection)],
) -> Response:
    await mark_all_notifications_read(connection, current_user)
    await _event_bus(request).publish(
        {"type": "notifications.read", "userId": str(current_user.id)}
    )
    return Response(status_code=204)


@router.patch(
    "/notifications/{notification_id}/desktop-delivered",
    response_model=NotificationResponse,
)
async def patch_notification_desktop_delivered(
    notification_id: UUID,
    current_user: Annotated[AuthenticatedUser, Depends(require_user)],
    connection: Annotated[AsyncConnection, Depends(get_connection)],
) -> NotificationResponse:
    try:
        return await mark_notification_desktop_delivered(connection, current_user, notification_id)
    except WorkspaceRepositoryError as error:
        raise _translate(error) from error


@router.put("/notification-preferences", response_model=NotificationPreferencesResponse)
async def put_notification_preferences(
    payload: NotificationPreferencesUpdate,
    request: Request,
    current_user: Annotated[AuthenticatedUser, Depends(require_user)],
    connection: Annotated[AsyncConnection, Depends(get_connection)],
) -> NotificationPreferencesResponse:
    result = await update_notification_preferences(connection, current_user, payload)
    await _event_bus(request).publish(
        {"type": "notification.preferences", "userId": str(current_user.id)}
    )
    return result


@router.post("/chats/{chat_id}/messages", response_model=ChatMessageResponse, status_code=201)
async def post_message(
    chat_id: UUID,
    payload: SendMessageRequest,
    request: Request,
    current_user: Annotated[AuthenticatedUser, Depends(require_user)],
    connection: Annotated[AsyncConnection, Depends(get_connection)],
) -> ChatMessageResponse:
    try:
        result = await send_message(connection, current_user, chat_id, payload)
    except WorkspaceRepositoryError as error:
        raise _translate(error) from error
    await connection.commit()
    await _event_bus(request).publish({"type": "message.created", "entityId": result.id})
    return result


@router.post("/chats/{chat_id}/read", status_code=204)
async def post_chat_read(
    chat_id: UUID,
    current_user: Annotated[AuthenticatedUser, Depends(require_user)],
    connection: Annotated[AsyncConnection, Depends(get_connection)],
) -> Response:
    try:
        await mark_chat_read(connection, current_user, chat_id)
    except WorkspaceRepositoryError as error:
        raise _translate(error) from error
    return Response(status_code=204)


@router.get("/messages/search", response_model=list[ChatMessageResponse])
async def get_message_search(
    current_user: Annotated[AuthenticatedUser, Depends(require_user)],
    connection: Annotated[AsyncConnection, Depends(get_connection)],
    q: Annotated[str, Query(min_length=1, max_length=240)],
) -> list[ChatMessageResponse]:
    return await search_messages(connection, current_user, q)


@router.post("/feed/posts", response_model=FeedPostResponse, status_code=201)
async def post_feed_post(
    payload: CreateFeedPostRequest,
    request: Request,
    current_user: Annotated[AuthenticatedUser, Depends(require_user)],
    connection: Annotated[AsyncConnection, Depends(get_connection)],
) -> FeedPostResponse:
    result = await create_feed_post(connection, current_user, payload)
    await _event_bus(request).publish({"type": "feed.created", "entityId": result.id})
    return result


@router.post("/feed/posts/{post_id}/comments", response_model=FeedPostResponse, status_code=201)
async def post_feed_comment(
    post_id: UUID,
    payload: CreateFeedCommentRequest,
    request: Request,
    current_user: Annotated[AuthenticatedUser, Depends(require_user)],
    connection: Annotated[AsyncConnection, Depends(get_connection)],
) -> FeedPostResponse:
    try:
        result = await add_feed_comment(connection, current_user, post_id, payload)
    except WorkspaceRepositoryError as error:
        raise _translate(error) from error
    await _event_bus(request).publish({"type": "feed.updated", "entityId": result.id})
    return result


@router.put("/feed/posts/{post_id}/like", response_model=FeedPostResponse)
async def put_feed_like(
    post_id: UUID,
    request: Request,
    current_user: Annotated[AuthenticatedUser, Depends(require_user)],
    connection: Annotated[AsyncConnection, Depends(get_connection)],
) -> FeedPostResponse:
    try:
        result = await set_feed_like(connection, current_user, post_id, True)
    except WorkspaceRepositoryError as error:
        raise _translate(error) from error
    await _event_bus(request).publish({"type": "feed.updated", "entityId": result.id})
    return result


@router.delete("/feed/posts/{post_id}/like", response_model=FeedPostResponse)
async def delete_feed_like(
    post_id: UUID,
    request: Request,
    current_user: Annotated[AuthenticatedUser, Depends(require_user)],
    connection: Annotated[AsyncConnection, Depends(get_connection)],
) -> FeedPostResponse:
    try:
        result = await set_feed_like(connection, current_user, post_id, False)
    except WorkspaceRepositoryError as error:
        raise _translate(error) from error
    await _event_bus(request).publish({"type": "feed.updated", "entityId": result.id})
    return result


@router.delete("/feed/posts/{post_id}", status_code=204)
async def remove_feed_post(
    post_id: UUID,
    request: Request,
    current_user: Annotated[AuthenticatedUser, Depends(require_user)],
    connection: Annotated[AsyncConnection, Depends(get_connection)],
) -> None:
    try:
        await delete_feed_post(connection, current_user, post_id)
    except WorkspaceRepositoryError as error:
        raise _translate(error) from error
    await _event_bus(request).publish({"type": "feed.deleted", "entityId": str(post_id)})


@router.patch("/feed/posts/{post_id}/pin", response_model=FeedPostResponse)
async def patch_feed_pin(
    post_id: UUID,
    payload: PinFeedPostRequest,
    request: Request,
    current_user: Annotated[AuthenticatedUser, Depends(require_user)],
    connection: Annotated[AsyncConnection, Depends(get_connection)],
) -> FeedPostResponse:
    try:
        result = await pin_feed_post(connection, current_user, post_id, payload)
    except WorkspaceRepositoryError as error:
        raise _translate(error) from error
    await _event_bus(request).publish({"type": "feed.updated", "entityId": result.id})
    return result


@router.post("/calendar/events", response_model=CalendarEventResponse, status_code=201)
async def post_calendar_event(
    payload: CreateCalendarEventRequest,
    request: Request,
    current_user: Annotated[AuthenticatedUser, Depends(require_user)],
    connection: Annotated[AsyncConnection, Depends(get_connection)],
) -> CalendarEventResponse:
    try:
        result = await create_calendar_event(connection, current_user, payload)
    except WorkspaceRepositoryError as error:
        raise _translate(error) from error
    await _event_bus(request).publish({"type": "calendar.created", "entityId": result.id})
    return result


@router.patch("/calendar/events/{event_id}", response_model=CalendarEventResponse)
async def patch_calendar_event(
    event_id: UUID,
    payload: UpdateCalendarEventRequest,
    request: Request,
    current_user: Annotated[AuthenticatedUser, Depends(require_user)],
    connection: Annotated[AsyncConnection, Depends(get_connection)],
) -> CalendarEventResponse:
    try:
        result = await update_calendar_event(connection, current_user, event_id, payload)
    except WorkspaceRepositoryError as error:
        raise _translate(error) from error
    await _event_bus(request).publish({"type": "calendar.updated", "entityId": result.id})
    return result


@router.post("/calendar/events/{event_id}/cancel", response_model=CalendarEventResponse)
async def post_calendar_cancel(
    event_id: UUID,
    request: Request,
    current_user: Annotated[AuthenticatedUser, Depends(require_user)],
    connection: Annotated[AsyncConnection, Depends(get_connection)],
) -> CalendarEventResponse:
    try:
        result = await cancel_calendar_event(connection, current_user, event_id)
    except WorkspaceRepositoryError as error:
        raise _translate(error) from error
    await _event_bus(request).publish({"type": "calendar.updated", "entityId": result.id})
    return result


@router.post("/tasks", response_model=TaskResponse, status_code=201)
async def post_task(
    payload: CreateTaskRequest,
    request: Request,
    current_user: Annotated[AuthenticatedUser, Depends(require_user)],
    connection: Annotated[AsyncConnection, Depends(get_connection)],
) -> TaskResponse:
    try:
        result = await create_task(connection, current_user, payload)
    except WorkspaceRepositoryError as error:
        raise _translate(error) from error
    await _event_bus(request).publish({"type": "task.created", "entityId": result.id})
    return result


@router.patch("/tasks/{task_id}/status", response_model=TaskResponse)
async def patch_task_status(
    task_id: UUID,
    payload: ChangeTaskStatusRequest,
    request: Request,
    current_user: Annotated[AuthenticatedUser, Depends(require_user)],
    connection: Annotated[AsyncConnection, Depends(get_connection)],
) -> TaskResponse:
    try:
        result = await change_task_status(connection, current_user, task_id, payload)
    except WorkspaceRepositoryError as error:
        raise _translate(error) from error
    await _event_bus(request).publish({"type": "task.updated", "entityId": result.id})
    return result


@router.post("/tasks/{task_id}/submit-result", response_model=TaskResponse)
async def post_task_submit_result(
    task_id: UUID,
    payload: SubmitTaskResultRequest,
    request: Request,
    current_user: Annotated[AuthenticatedUser, Depends(require_user)],
    connection: Annotated[AsyncConnection, Depends(get_connection)],
) -> TaskResponse:
    try:
        result = await submit_task_result(connection, current_user, task_id, payload)
    except WorkspaceRepositoryError as error:
        raise _translate(error) from error
    await _event_bus(request).publish({"type": "task.updated", "entityId": result.id})
    return result


@router.post("/tasks/{task_id}/accept-result", response_model=TaskResponse)
async def post_task_accept_result(
    task_id: UUID,
    request: Request,
    current_user: Annotated[AuthenticatedUser, Depends(require_user)],
    connection: Annotated[AsyncConnection, Depends(get_connection)],
) -> TaskResponse:
    try:
        result = await accept_task_result(connection, current_user, task_id)
    except WorkspaceRepositoryError as error:
        raise _translate(error) from error
    await _event_bus(request).publish({"type": "task.updated", "entityId": result.id})
    return result


@router.post("/tasks/{task_id}/return-for-revision", response_model=TaskResponse)
async def post_task_return_for_revision(
    task_id: UUID,
    payload: ReturnTaskForRevisionRequest,
    request: Request,
    current_user: Annotated[AuthenticatedUser, Depends(require_user)],
    connection: Annotated[AsyncConnection, Depends(get_connection)],
) -> TaskResponse:
    try:
        result = await return_task_for_revision(connection, current_user, task_id, payload)
    except WorkspaceRepositoryError as error:
        raise _translate(error) from error
    await _event_bus(request).publish({"type": "task.updated", "entityId": result.id})
    return result


@router.put("/tasks/{task_id}/efficiency-exclusion", response_model=TaskResponse)
async def put_task_efficiency_exclusion(
    task_id: UUID,
    payload: TaskEfficiencyExclusionRequest,
    request: Request,
    current_user: Annotated[AuthenticatedUser, Depends(require_user)],
    connection: Annotated[AsyncConnection, Depends(get_connection)],
) -> TaskResponse:
    try:
        result = await set_task_efficiency_exclusion(connection, current_user, task_id, payload)
    except WorkspaceRepositoryError as error:
        raise _translate(error) from error
    await _event_bus(request).publish({"type": "task.updated", "entityId": result.id})
    return result


@router.patch("/tasks/{task_id}", response_model=TaskResponse)
async def patch_task(
    task_id: UUID,
    payload: UpdateTaskRequest,
    request: Request,
    current_user: Annotated[AuthenticatedUser, Depends(require_user)],
    connection: Annotated[AsyncConnection, Depends(get_connection)],
) -> TaskResponse:
    try:
        result = await update_task(connection, current_user, task_id, payload)
    except WorkspaceRepositoryError as error:
        raise _translate(error) from error
    await _event_bus(request).publish({"type": "task.updated", "entityId": result.id})
    return result


@router.delete("/tasks/{task_id}", status_code=204)
async def remove_task(
    task_id: UUID,
    request: Request,
    current_user: Annotated[AuthenticatedUser, Depends(require_user)],
    connection: Annotated[AsyncConnection, Depends(get_connection)],
) -> None:
    try:
        await delete_task(connection, current_user, task_id)
    except WorkspaceRepositoryError as error:
        raise _translate(error) from error
    await _event_bus(request).publish({"type": "task.deleted", "entityId": str(task_id)})


@router.put("/tasks/{task_id}/participants", response_model=TaskResponse)
async def put_task_participant(
    task_id: UUID,
    payload: TaskParticipantRequest,
    request: Request,
    current_user: Annotated[AuthenticatedUser, Depends(require_user)],
    connection: Annotated[AsyncConnection, Depends(get_connection)],
) -> TaskResponse:
    try:
        result = await set_task_participant(connection, current_user, task_id, payload)
    except WorkspaceRepositoryError as error:
        raise _translate(error) from error
    await _event_bus(request).publish({"type": "task.updated", "entityId": result.id})
    return result


@router.delete("/tasks/{task_id}/participants/{user_id}", response_model=TaskResponse)
async def delete_task_participant(
    task_id: UUID,
    user_id: UUID,
    request: Request,
    current_user: Annotated[AuthenticatedUser, Depends(require_user)],
    connection: Annotated[AsyncConnection, Depends(get_connection)],
) -> TaskResponse:
    try:
        result = await remove_task_participant(connection, current_user, task_id, user_id)
    except WorkspaceRepositoryError as error:
        raise _translate(error) from error
    await _event_bus(request).publish({"type": "task.updated", "entityId": result.id})
    return result


@router.post("/tasks/{task_id}/checklist", response_model=TaskResponse, status_code=201)
async def post_task_checklist_item(
    task_id: UUID,
    payload: CreateChecklistItemRequest,
    request: Request,
    current_user: Annotated[AuthenticatedUser, Depends(require_user)],
    connection: Annotated[AsyncConnection, Depends(get_connection)],
) -> TaskResponse:
    try:
        result = await add_task_checklist_item(connection, current_user, task_id, payload)
    except WorkspaceRepositoryError as error:
        raise _translate(error) from error
    await _event_bus(request).publish({"type": "task.updated", "entityId": result.id})
    return result


@router.patch("/tasks/{task_id}/checklist/{item_id}", response_model=TaskResponse)
async def patch_task_checklist_item(
    task_id: UUID,
    item_id: UUID,
    payload: UpdateChecklistItemRequest,
    request: Request,
    current_user: Annotated[AuthenticatedUser, Depends(require_user)],
    connection: Annotated[AsyncConnection, Depends(get_connection)],
) -> TaskResponse:
    try:
        result = await update_task_checklist_item(
            connection, current_user, task_id, item_id, payload
        )
    except WorkspaceRepositoryError as error:
        raise _translate(error) from error
    await _event_bus(request).publish({"type": "task.updated", "entityId": result.id})
    return result


@router.delete("/tasks/{task_id}/checklist/{item_id}", response_model=TaskResponse)
async def remove_task_checklist_item(
    task_id: UUID,
    item_id: UUID,
    request: Request,
    current_user: Annotated[AuthenticatedUser, Depends(require_user)],
    connection: Annotated[AsyncConnection, Depends(get_connection)],
) -> TaskResponse:
    try:
        result = await delete_task_checklist_item(connection, current_user, task_id, item_id)
    except WorkspaceRepositoryError as error:
        raise _translate(error) from error
    await _event_bus(request).publish({"type": "task.updated", "entityId": result.id})
    return result


@router.post("/tasks/{task_id}/comments", response_model=TaskResponse, status_code=201)
async def post_task_comment(
    task_id: UUID,
    payload: CreateTaskCommentRequest,
    request: Request,
    current_user: Annotated[AuthenticatedUser, Depends(require_user)],
    connection: Annotated[AsyncConnection, Depends(get_connection)],
) -> TaskResponse:
    try:
        result = await add_task_comment(connection, current_user, task_id, payload)
    except WorkspaceRepositoryError as error:
        raise _translate(error) from error
    await _event_bus(request).publish({"type": "task.updated", "entityId": result.id})
    return result


@router.put("/tasks/{task_id}/dependencies", response_model=TaskResponse)
async def put_task_dependency(
    task_id: UUID,
    payload: TaskDependencyRequest,
    request: Request,
    current_user: Annotated[AuthenticatedUser, Depends(require_user)],
    connection: Annotated[AsyncConnection, Depends(get_connection)],
) -> TaskResponse:
    try:
        result = await set_task_dependency(connection, current_user, task_id, payload)
    except WorkspaceRepositoryError as error:
        raise _translate(error) from error
    await _event_bus(request).publish({"type": "task.updated", "entityId": result.id})
    return result


@router.delete("/tasks/{task_id}/dependencies/{depends_on_task_id}", response_model=TaskResponse)
async def delete_task_dependency(
    task_id: UUID,
    depends_on_task_id: UUID,
    request: Request,
    current_user: Annotated[AuthenticatedUser, Depends(require_user)],
    connection: Annotated[AsyncConnection, Depends(get_connection)],
) -> TaskResponse:
    try:
        result = await remove_task_dependency(connection, current_user, task_id, depends_on_task_id)
    except WorkspaceRepositoryError as error:
        raise _translate(error) from error
    await _event_bus(request).publish({"type": "task.updated", "entityId": result.id})
    return result


@router.put("/tasks/{task_id}/cycle", response_model=TaskResponse)
async def put_task_cycle(
    task_id: UUID,
    payload: TaskCycleRequest,
    request: Request,
    current_user: Annotated[AuthenticatedUser, Depends(require_user)],
    connection: Annotated[AsyncConnection, Depends(get_connection)],
) -> TaskResponse:
    try:
        result = await set_task_cycle(connection, current_user, task_id, payload)
    except WorkspaceRepositoryError as error:
        raise _translate(error) from error
    await _event_bus(request).publish({"type": "task.updated", "entityId": result.id})
    return result


@router.put("/approval-templates/{template_id}/graph", response_model=WorkflowResponse)
async def put_workflow(
    template_id: UUID,
    payload: SaveWorkflowRequest,
    request: Request,
    current_user: Annotated[AuthenticatedUser, Depends(require_user)],
    connection: Annotated[AsyncConnection, Depends(get_connection)],
) -> WorkflowResponse:
    try:
        result = await save_workflow(connection, current_user, template_id, payload)
    except WorkspaceRepositoryError as error:
        raise _translate(error) from error
    await _event_bus(request).publish({"type": "workflow.updated", "entityId": result.id})
    return result


@router.post("/approval-templates/{template_id}/publish", response_model=WorkflowResponse)
async def post_publish_workflow(
    template_id: UUID,
    request: Request,
    current_user: Annotated[AuthenticatedUser, Depends(require_user)],
    connection: Annotated[AsyncConnection, Depends(get_connection)],
) -> WorkflowResponse:
    try:
        result = await publish_workflow(connection, current_user, template_id)
    except WorkspaceRepositoryError as error:
        raise _translate(error) from error
    await _event_bus(request).publish({"type": "workflow.published", "entityId": str(template_id)})
    return result


@router.post("/approval-requests", response_model=ApprovalRequestResponse, status_code=201)
async def post_approval_request(
    payload: CreateApprovalRequest,
    request: Request,
    current_user: Annotated[AuthenticatedUser, Depends(require_user)],
    connection: Annotated[AsyncConnection, Depends(get_connection)],
) -> ApprovalRequestResponse:
    try:
        result = await create_approval_request(connection, current_user, payload)
    except WorkspaceRepositoryError as error:
        raise _translate(error) from error
    await _event_bus(request).publish({"type": "approval.created", "entityId": result.id})
    return result


@router.patch("/approval-requests/{request_id}", response_model=ApprovalRequestResponse)
async def patch_approval_request(
    request_id: UUID,
    payload: UpdateApprovalRequest,
    request: Request,
    current_user: Annotated[AuthenticatedUser, Depends(require_user)],
    connection: Annotated[AsyncConnection, Depends(get_connection)],
) -> ApprovalRequestResponse:
    try:
        result = await update_approval_request(connection, current_user, request_id, payload)
    except WorkspaceRepositoryError as error:
        raise _translate(error) from error
    await _event_bus(request).publish({"type": "approval.updated", "entityId": result.id})
    return result


@router.delete("/approval-requests/{request_id}", status_code=204)
async def remove_approval_request(
    request_id: UUID,
    request: Request,
    current_user: Annotated[AuthenticatedUser, Depends(require_user)],
    connection: Annotated[AsyncConnection, Depends(get_connection)],
) -> None:
    try:
        await delete_approval_request(connection, current_user, request_id)
    except WorkspaceRepositoryError as error:
        raise _translate(error) from error
    await _event_bus(request).publish({"type": "approval.deleted", "entityId": str(request_id)})


@router.post("/approval-requests/{request_id}/actions", response_model=ApprovalRequestResponse)
async def post_approval_action(
    request_id: UUID,
    payload: ApprovalActionRequest,
    request: Request,
    current_user: Annotated[AuthenticatedUser, Depends(require_user)],
    connection: Annotated[AsyncConnection, Depends(get_connection)],
) -> ApprovalRequestResponse:
    permission_action: ModuleAction = (
        "edit" if payload.action in {"resubmit", "cancel"} else "approve"
    )
    await ensure_module_action(connection, current_user, "payment_requests", permission_action)
    try:
        result = await act_on_request(connection, current_user, request_id, payload)
    except WorkspaceRepositoryError as error:
        raise _translate(error) from error
    await _event_bus(request).publish({"type": "approval.updated", "entityId": result.id})
    return result


@router.post("/projects", response_model=ProjectResponse, status_code=201)
async def post_project(
    payload: CreateProjectRequest,
    request: Request,
    current_user: Annotated[AuthenticatedUser, Depends(require_user)],
    connection: Annotated[AsyncConnection, Depends(get_connection)],
) -> ProjectResponse:
    try:
        result = await create_project(connection, current_user, payload)
    except WorkspaceRepositoryError as error:
        raise _translate(error) from error
    await _event_bus(request).publish({"type": "project.created", "entityId": result.id})
    return result


@router.patch("/projects/{project_id}", response_model=ProjectResponse)
async def patch_project(
    project_id: UUID,
    payload: UpdateProjectRequest,
    request: Request,
    current_user: Annotated[AuthenticatedUser, Depends(require_user)],
    connection: Annotated[AsyncConnection, Depends(get_connection)],
) -> ProjectResponse:
    try:
        result = await update_project(connection, current_user, project_id, payload)
    except WorkspaceRepositoryError as error:
        raise _translate(error) from error
    await _event_bus(request).publish({"type": "project.updated", "entityId": result.id})
    return result


@router.patch("/projects/{project_id}/stage", response_model=ProjectResponse)
async def patch_project_stage(
    project_id: UUID,
    payload: ChangeProjectStageRequest,
    request: Request,
    current_user: Annotated[AuthenticatedUser, Depends(require_user)],
    connection: Annotated[AsyncConnection, Depends(get_connection)],
) -> ProjectResponse:
    try:
        result = await change_project_stage(connection, current_user, project_id, payload)
    except WorkspaceRepositoryError as error:
        raise _translate(error) from error
    await _event_bus(request).publish({"type": "project.moved", "entityId": result.id})
    return result


@router.post("/absence-requests", response_model=AbsenceRequestResponse, status_code=201)
async def post_absence_request(
    payload: AbsenceWriteRequest,
    request: Request,
    current_user: Annotated[AuthenticatedUser, Depends(require_user)],
    connection: Annotated[AsyncConnection, Depends(get_connection)],
) -> AbsenceRequestResponse:
    await ensure_module_action(connection, current_user, "absences", "create")
    try:
        result = await create_absence(connection, current_user, payload)
    except AbsenceError as error:
        raise _translate_absence(error) from error
    await _event_bus(request).publish({"type": "absence.created", "entityId": result.id})
    return result


@router.patch("/absence-requests/{request_id}", response_model=AbsenceRequestResponse)
async def patch_absence_request(
    request_id: UUID,
    payload: AbsenceWriteRequest,
    request: Request,
    current_user: Annotated[AuthenticatedUser, Depends(require_user)],
    connection: Annotated[AsyncConnection, Depends(get_connection)],
) -> AbsenceRequestResponse:
    await ensure_module_action(connection, current_user, "absences", "edit")
    try:
        result = await update_absence(connection, current_user, request_id, payload)
    except AbsenceError as error:
        raise _translate_absence(error) from error
    await _event_bus(request).publish({"type": "absence.updated", "entityId": result.id})
    return result


@router.post("/absence-requests/{request_id}/actions", response_model=AbsenceRequestResponse)
async def post_absence_action(
    request_id: UUID,
    payload: AbsenceActionRequest,
    request: Request,
    current_user: Annotated[AuthenticatedUser, Depends(require_user)],
    connection: Annotated[AsyncConnection, Depends(get_connection)],
) -> AbsenceRequestResponse:
    await ensure_module_action(
        connection,
        current_user,
        "absences",
        "approve" if payload.action in {"approve", "acknowledge", "reject"} else "edit",
    )
    try:
        result = await act_on_absence(connection, current_user, request_id, payload)
    except AbsenceError as error:
        raise _translate_absence(error) from error
    await _event_bus(request).publish({"type": "absence.updated", "entityId": result.id})
    return result


@router.post("/trip-requests", response_model=TripRequestResponse, status_code=201)
async def post_trip_request(
    payload: CreateTripRequest,
    request: Request,
    current_user: Annotated[AuthenticatedUser, Depends(require_user)],
    connection: Annotated[AsyncConnection, Depends(get_connection)],
) -> TripRequestResponse:
    try:
        result = await create_trip_request(connection, current_user, payload)
    except WorkspaceRepositoryError as error:
        raise _translate(error) from error
    await _event_bus(request).publish({"type": "trip.created", "entityId": result.id})
    return result


@router.patch("/trip-requests/{request_id}", response_model=TripRequestResponse)
async def patch_trip_request(
    request_id: UUID,
    payload: UpdateTripRequest,
    request: Request,
    current_user: Annotated[AuthenticatedUser, Depends(require_user)],
    connection: Annotated[AsyncConnection, Depends(get_connection)],
) -> TripRequestResponse:
    try:
        result = await update_trip_request(connection, current_user, request_id, payload)
    except WorkspaceRepositoryError as error:
        raise _translate(error) from error
    await _event_bus(request).publish({"type": "trip.updated", "entityId": result.id})
    return result


@router.post("/trip-requests/{request_id}/actions", response_model=TripRequestResponse)
async def post_trip_action(
    request_id: UUID,
    payload: TripActionRequest,
    request: Request,
    current_user: Annotated[AuthenticatedUser, Depends(require_user)],
    connection: Annotated[AsyncConnection, Depends(get_connection)],
) -> TripRequestResponse:
    permission_action: ModuleAction = (
        "edit" if payload.action in {"submit", "resubmit"} else "approve"
    )
    await ensure_module_action(connection, current_user, "trip_approvals", permission_action)
    try:
        result = await act_on_trip_request(connection, current_user, request_id, payload)
    except WorkspaceRepositoryError as error:
        raise _translate(error) from error
    await _event_bus(request).publish({"type": "trip.updated", "entityId": result.id})
    return result


@router.put(
    "/attachments/{owner_type}/{owner_id}",
    response_model=AttachmentResponse,
    status_code=201,
)
async def put_attachment(
    owner_type: AttachmentOwnerType,
    owner_id: UUID,
    request: Request,
    current_user: Annotated[AuthenticatedUser, Depends(require_user)],
    connection: Annotated[AsyncConnection, Depends(get_connection)],
    file_name: Annotated[str, Query(alias="fileName", min_length=1, max_length=500)],
    document_role: Annotated[
        Literal["general", "primary", "additional"],
        Query(alias="documentRole"),
    ] = "general",
    media_kind: Annotated[
        Literal["file", "voice"],
        Query(alias="mediaKind"),
    ] = "file",
    media_duration_ms: Annotated[
        int | None,
        Query(alias="mediaDurationMs", ge=500, le=600_000),
    ] = None,
    media_codec: Annotated[
        Literal["opus"] | None,
        Query(alias="mediaCodec"),
    ] = None,
) -> AttachmentResponse:
    attachment_module = {
        "message": "messenger",
        "task": "tasks",
        "approval_request": "payment_requests",
        "absence": "absences",
    }[owner_type]
    await ensure_module_action(connection, current_user, attachment_module, "edit")
    safe_name = _safe_file_name(file_name)
    try:
        await validate_attachment_owner(
            connection,
            current_user,
            owner_type,
            owner_id,
            write=True,
        )
    except WorkspaceRepositoryError as error:
        raise _translate(error) from error

    settings = request.app.state.settings
    if media_kind == "voice":
        if owner_type != "message" or document_role != "general":
            raise HTTPException(
                status_code=422,
                detail="Голосовая запись доступна только в сообщении",
            )
        if media_duration_ms is None or media_codec != "opus":
            raise HTTPException(
                status_code=422,
                detail="Не указаны параметры голосовой записи Opus",  # noqa: RUF001
            )
        voice_duration_ms = media_duration_ms
        if media_duration_ms > settings.voice_message_max_duration_ms:
            raise HTTPException(status_code=413, detail="Голосовое сообщение длиннее 10 минут")
        limit = settings.voice_message_max_bytes
    else:
        if media_duration_ms is not None or media_codec is not None:
            raise HTTPException(
                status_code=422,
                detail="Медиапараметры допустимы только для голоса",
            )
        limit = settings.attachment_max_bytes
    content = bytearray()
    async for chunk in request.stream():
        content.extend(chunk)
        if len(content) > limit:
            raise HTTPException(
                status_code=413,
                detail="Attachment is larger than the allowed limit",
            )
    if not content:
        raise HTTPException(status_code=422, detail="Attachment must not be empty")

    content_type = request.headers.get("content-type", "application/octet-stream")[:160]
    if media_kind == "voice":
        base_content_type = content_type.split(";", 1)[0].strip().lower()
        if base_content_type != "audio/webm":
            raise HTTPException(status_code=415, detail="Голос отправляется только как WebM/Opus")
        if bytes(content[:4]) != b"\x1a\x45\xdf\xa3" or b"OpusHead" not in content[:65536]:
            raise HTTPException(
                status_code=422,
                detail="Файл не является корректной записью WebM/Opus",
            )
        duration_limit = max(64 * 1024, voice_duration_ms * 8)
        if len(content) > duration_limit:
            raise HTTPException(status_code=413, detail="Запись имеет слишком высокий битрейт")
    storage_key = f"{owner_type}/{owner_id}/{uuid4()}"
    storage = _object_storage(request)
    try:
        await storage.put(storage_key, bytes(content), content_type)
        result = await create_attachment(
            connection,
            current_user,
            owner_type,
            owner_id,
            file_name=safe_name,
            content_type=content_type,
            byte_size=len(content),
            sha256=hashlib.sha256(content).hexdigest(),
            storage_key=storage_key,
            document_role=document_role,
            media_kind=media_kind,
            media_duration_ms=media_duration_ms,
            media_codec=media_codec,
        )
    except WorkspaceRepositoryError as error:
        await storage.delete(storage_key)
        raise _translate(error) from error
    except ObjectStorageError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error
    await _event_bus(request).publish({"type": "attachment.created", "entityId": result.id})
    return result


@router.get("/attachments/{attachment_id}")
async def download_attachment(
    attachment_id: UUID,
    request: Request,
    current_user: Annotated[AuthenticatedUser, Depends(require_user)],
    connection: Annotated[AsyncConnection, Depends(get_connection)],
) -> Response:
    try:
        metadata, storage_key = await get_attachment(
            connection,
            current_user,
            attachment_id,
        )
        attachment_module = {
            "message": "messenger",
            "task": "tasks",
            "approval_request": "payment_requests",
            "absence": "absences",
        }[metadata.owner_type]
        await ensure_module_action(connection, current_user, attachment_module, "view")
        content = await _object_storage(request).get(storage_key)
    except WorkspaceRepositoryError as error:
        raise _translate(error) from error
    except ObjectStorageError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error
    return Response(
        content=content,
        media_type=metadata.content_type,
        headers={
            "Content-Disposition": f"attachment; filename*=UTF-8''{quote(metadata.file_name)}",
            "Content-Length": str(len(content)),
        },
    )


@router.websocket("/events")
async def workspace_events(websocket: WebSocket) -> None:
    await websocket.accept()
    user_id: UUID | None = None
    event_bus: WorkspaceEventBus = websocket.app.state.event_bus
    try:
        authentication = await asyncio.wait_for(websocket.receive_json(), timeout=10)
        if authentication.get("type") != "authenticate":
            await websocket.close(code=4401, reason="Authentication required")
            return
        token = authentication.get("token")
        if not isinstance(token, str):
            await websocket.close(code=4401, reason="Authentication required")
            return
        engine: AsyncEngine = websocket.app.state.database_engine
        async with engine.connect() as connection:
            try:
                user = await authenticate_access_token(
                    connection,
                    token,
                    websocket.app.state.settings,
                )
            except InvalidTokenError:
                await websocket.close(code=4401, reason="Invalid token")
                return
        if user.client_kind == "web" and not is_allowed_web_origin(
            websocket.headers.get("origin"),
            websocket.headers.get("host"),
            websocket.app.state.settings,
        ):
            await websocket.close(code=4403, reason="Trusted web origin required")
            return
        user_id = user.id
        await event_bus.connect(user_id, websocket)
        await websocket.send_json({"type": "authenticated", "userId": str(user_id)})
        while True:
            message = await websocket.receive_json()
            if message.get("type") == "ping":
                await websocket.send_json({"type": "pong"})
    except (TimeoutError, WebSocketDisconnect):
        pass
    finally:
        if user_id is not None:
            event_bus.disconnect(user_id, websocket)
