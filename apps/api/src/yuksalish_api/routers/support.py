from typing import Annotated, cast
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy.ext.asyncio import AsyncConnection

from yuksalish_api.auth import AuthenticatedUser, require_user
from yuksalish_api.database import get_connection
from yuksalish_api.events import WorkspaceEventBus
from yuksalish_api.support_schemas import (
    SupportAdminAction,
    SupportRegistryResponse,
    SupportRequestCreate,
    SupportRequestResponse,
)
from yuksalish_api.support_service import (
    SupportServiceError,
    act_on_support_request,
    create_support_request,
    load_support_registry,
    mark_support_responses_read,
)

router = APIRouter(prefix="/support-requests", tags=["support requests"])


def _event_bus(request: Request) -> WorkspaceEventBus:
    return cast(WorkspaceEventBus, request.app.state.event_bus)


def _error(error: SupportServiceError) -> HTTPException:
    return HTTPException(error.status_code, error.detail)


@router.get("", response_model=SupportRegistryResponse)
async def get_support_requests(
    current_user: Annotated[AuthenticatedUser, Depends(require_user)],
    connection: Annotated[AsyncConnection, Depends(get_connection)],
) -> SupportRegistryResponse:
    return await load_support_registry(connection, current_user)


@router.post("", response_model=SupportRequestResponse, status_code=201)
async def post_support_request(
    payload: SupportRequestCreate,
    request: Request,
    current_user: Annotated[AuthenticatedUser, Depends(require_user)],
    connection: Annotated[AsyncConnection, Depends(get_connection)],
) -> SupportRequestResponse:
    result, recipient_ids = await create_support_request(connection, current_user, payload)
    await connection.commit()
    for recipient_id in recipient_ids:
        await _event_bus(request).publish(
            {"type": "support.request.created", "entityId": result.id},
            recipient_id=recipient_id,
        )
    return result


@router.post("/{request_id}/actions", response_model=SupportRequestResponse)
async def post_support_action(
    request_id: UUID,
    payload: SupportAdminAction,
    request: Request,
    current_user: Annotated[AuthenticatedUser, Depends(require_user)],
    connection: Annotated[AsyncConnection, Depends(get_connection)],
) -> SupportRequestResponse:
    try:
        result = await act_on_support_request(connection, current_user, request_id, payload)
    except SupportServiceError as error:
        raise _error(error) from error
    await connection.commit()
    await _event_bus(request).publish({"type": "support.request.updated", "entityId": result.id})
    return result


@router.post("/responses/read", status_code=204)
async def post_support_responses_read(
    request: Request,
    current_user: Annotated[AuthenticatedUser, Depends(require_user)],
    connection: Annotated[AsyncConnection, Depends(get_connection)],
) -> Response:
    await mark_support_responses_read(connection, current_user)
    await connection.commit()
    await _event_bus(request).publish(
        {"type": "support.responses.read", "userId": str(current_user.id)},
        recipient_id=current_user.id,
    )
    return Response(status_code=204)
