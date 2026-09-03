import asyncio
import hashlib
from pathlib import PurePosixPath
from typing import Annotated, cast
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
    change_task_status,
    create_approval_request,
    create_attachment,
    create_task,
    get_attachment,
    load_workspace,
    save_workflow,
    send_message,
    update_approval_request,
    validate_attachment_owner,
)
from yuksalish_api.workspace_schemas import (
    ApprovalActionRequest,
    ApprovalRequestResponse,
    AttachmentOwnerType,
    AttachmentResponse,
    ChangeTaskStatusRequest,
    ChatMessageResponse,
    CreateApprovalRequest,
    CreateTaskRequest,
    SaveWorkflowRequest,
    SendMessageRequest,
    TaskResponse,
    UpdateApprovalRequest,
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
