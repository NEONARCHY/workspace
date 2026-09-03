from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncConnection

from yuksalish_api.auth import AuthenticatedUser, require_user
from yuksalish_api.database import get_connection
from yuksalish_api.directory_schemas import (
    DirectoryBootstrapResponse,
    DirectoryEmployeeResponse,
    EmployeeAccessUpdateRequest,
    PositionCreateRequest,
    PositionResponse,
    PositionUpdateRequest,
)
from yuksalish_api.directory_service import (
    DirectoryServiceError,
    create_position,
    load_directory,
    update_employee_access,
    update_position,
)
from yuksalish_api.events import WorkspaceEventBus

router = APIRouter(prefix="/directory", tags=["directory"])


def _translate(error: DirectoryServiceError) -> HTTPException:
    return HTTPException(status_code=error.status_code, detail=error.detail)


@router.get("", response_model=DirectoryBootstrapResponse)
async def directory_bootstrap(
    current_user: Annotated[AuthenticatedUser, Depends(require_user)],
    connection: Annotated[AsyncConnection, Depends(get_connection)],
) -> DirectoryBootstrapResponse:
    del current_user
    return await load_directory(connection)


@router.post("/positions", response_model=PositionResponse, status_code=201)
async def post_position(
    payload: PositionCreateRequest,
    request: Request,
    current_user: Annotated[AuthenticatedUser, Depends(require_user)],
    connection: Annotated[AsyncConnection, Depends(get_connection)],
) -> PositionResponse:
    try:
        result = await create_position(connection, current_user, payload)
    except DirectoryServiceError as error:
        raise _translate(error) from error
    await request.app.state.event_bus.publish(
        {"type": "directory.position_created", "entityId": result.id}
    )
    return result


@router.patch("/positions/{position_id}", response_model=PositionResponse)
async def patch_position(
    position_id: UUID,
    payload: PositionUpdateRequest,
    request: Request,
    current_user: Annotated[AuthenticatedUser, Depends(require_user)],
    connection: Annotated[AsyncConnection, Depends(get_connection)],
) -> PositionResponse:
    try:
        result = await update_position(connection, current_user, position_id, payload)
    except DirectoryServiceError as error:
        raise _translate(error) from error
    event_bus: WorkspaceEventBus = request.app.state.event_bus
    await event_bus.publish({"type": "directory.position_updated", "entityId": result.id})
    return result


@router.patch("/employees/{employee_id}", response_model=DirectoryEmployeeResponse)
async def patch_employee(
    employee_id: UUID,
    payload: EmployeeAccessUpdateRequest,
    request: Request,
    current_user: Annotated[AuthenticatedUser, Depends(require_user)],
    connection: Annotated[AsyncConnection, Depends(get_connection)],
) -> DirectoryEmployeeResponse:
    try:
        result = await update_employee_access(connection, current_user, employee_id, payload)
    except DirectoryServiceError as error:
        raise _translate(error) from error
    event_bus: WorkspaceEventBus = request.app.state.event_bus
    await event_bus.publish({"type": "directory.employee_updated", "entityId": result.id})
    return result
