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

from yuksalish_api.auth import (
    AuthenticatedUser,
    InvalidTokenError,
    authenticate_access_token,
    require_user,
)
from yuksalish_api.database import get_connection
from yuksalish_api.events import WorkspaceEventBus
from yuksalish_api.object_storage import ObjectStorage, ObjectStorageError
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
    get_attachment,
    load_workspace,
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
    validate_attachment_owner,
)
from yuksalish_api.workspace_schemas import (
    ApprovalActionRequest,
    ApprovalRequestResponse,
    AttachmentOwnerType,
    AttachmentResponse,
    ChangeProjectStageRequest,
    ChangeTaskStatusRequest,
    ChatMessageResponse,
    CreateApprovalRequest,
    CreateChecklistItemRequest,
    CreateProjectRequest,
    CreateTaskCommentRequest,
    CreateTaskRequest,
    CreateTripRequest,
    ProjectResponse,
    SaveWorkflowRequest,
    SendMessageRequest,
    TaskCycleRequest,
    TaskDependencyRequest,
    TaskParticipantRequest,
    TaskResponse,
    TripActionRequest,
    TripRequestResponse,
    UpdateApprovalRequest,
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
    await _event_bus(request).publish({"type": "message.created", "entityId": result.id})
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


@router.post("/approval-requests/{request_id}/actions", response_model=ApprovalRequestResponse)
async def post_approval_action(
    request_id: UUID,
    payload: ApprovalActionRequest,
    request: Request,
    current_user: Annotated[AuthenticatedUser, Depends(require_user)],
    connection: Annotated[AsyncConnection, Depends(get_connection)],
) -> ApprovalRequestResponse:
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
) -> AttachmentResponse:
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

    limit = request.app.state.settings.attachment_max_bytes
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
