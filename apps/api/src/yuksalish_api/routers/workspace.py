import asyncio
from typing import Annotated, cast
from uuid import UUID

from fastapi import (
    APIRouter,
    Depends,
    HTTPException,
    Request,
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
from yuksalish_api.repository import (
    WorkspaceRepositoryError,
    act_on_request,
    change_task_status,
    create_approval_request,
    create_task,
    load_workspace,
    save_workflow,
    send_message,
)
from yuksalish_api.workspace_schemas import (
    ApprovalActionRequest,
    ApprovalRequestResponse,
    ChangeTaskStatusRequest,
    ChatMessageResponse,
    CreateApprovalRequest,
    CreateTaskRequest,
    SaveWorkflowRequest,
    SendMessageRequest,
    TaskResponse,
    WorkflowResponse,
    WorkspaceBootstrapResponse,
)

router = APIRouter(tags=["workspace"])


def _translate(error: WorkspaceRepositoryError) -> HTTPException:
    return HTTPException(status_code=error.status_code, detail=error.detail)


def _event_bus(request: Request) -> WorkspaceEventBus:
    return cast(WorkspaceEventBus, request.app.state.event_bus)


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
