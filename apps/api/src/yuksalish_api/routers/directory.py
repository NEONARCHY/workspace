from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy.ext.asyncio import AsyncConnection

from yuksalish_api.administration_schemas import EmployeeStatusUpdateRequest
from yuksalish_api.auth import AuthenticatedUser, require_user
from yuksalish_api.database import get_connection
from yuksalish_api.directory_schemas import (
    DepartmentCreateRequest,
    DepartmentResponse,
    DepartmentUpdateRequest,
    DirectoryBootstrapResponse,
    DirectoryEmployeeResponse,
    EmployeeAccessUpdateRequest,
    ModuleAccessRuleResponse,
    ModuleAccessRuleUpdateRequest,
    PositionCreateRequest,
    PositionResponse,
    PositionUpdateRequest,
)
from yuksalish_api.directory_service import (
    DirectoryServiceError,
    create_department,
    create_position,
    delete_module_access_rule,
    delete_position,
    load_directory,
    set_module_access_rule,
    update_department,
    update_employee_access,
    update_employee_status,
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
    return await load_directory(connection, current_user)


@router.post("/departments", response_model=DepartmentResponse, status_code=201)
async def post_department(
    payload: DepartmentCreateRequest,
    request: Request,
    current_user: Annotated[AuthenticatedUser, Depends(require_user)],
    connection: Annotated[AsyncConnection, Depends(get_connection)],
) -> DepartmentResponse:
    try:
        result = await create_department(connection, current_user, payload)
    except DirectoryServiceError as error:
        raise _translate(error) from error
    await request.app.state.event_bus.publish(
        {"type": "directory.department_created", "entityId": result.id}
    )
    return result


@router.patch("/departments/{department_id}", response_model=DepartmentResponse)
async def patch_department(
    department_id: UUID,
    payload: DepartmentUpdateRequest,
    request: Request,
    current_user: Annotated[AuthenticatedUser, Depends(require_user)],
    connection: Annotated[AsyncConnection, Depends(get_connection)],
) -> DepartmentResponse:
    try:
        result = await update_department(connection, current_user, department_id, payload)
    except DirectoryServiceError as error:
        raise _translate(error) from error
    await request.app.state.event_bus.publish(
        {"type": "directory.department_updated", "entityId": result.id}
    )
    return result


@router.put(
    "/access-rules/{subject_type}/{subject_key}/{module_key}",
    response_model=ModuleAccessRuleResponse,
)
async def put_access_rule(
    subject_type: str,
    subject_key: str,
    module_key: str,
    payload: ModuleAccessRuleUpdateRequest,
    request: Request,
    current_user: Annotated[AuthenticatedUser, Depends(require_user)],
    connection: Annotated[AsyncConnection, Depends(get_connection)],
) -> ModuleAccessRuleResponse:
    try:
        result = await set_module_access_rule(
            connection,
            current_user,
            subject_type,
            subject_key,
            module_key,
            payload,
        )
    except DirectoryServiceError as error:
        raise _translate(error) from error
    await request.app.state.event_bus.publish(
        {"type": "directory.access_updated", "entityId": result.id}
    )
    return result


@router.delete(
    "/access-rules/{subject_type}/{subject_key}/{module_key}",
    status_code=204,
)
async def delete_access_rule(
    subject_type: str,
    subject_key: str,
    module_key: str,
    request: Request,
    current_user: Annotated[AuthenticatedUser, Depends(require_user)],
    connection: Annotated[AsyncConnection, Depends(get_connection)],
) -> None:
    try:
        await delete_module_access_rule(
            connection,
            current_user,
            subject_type,
            subject_key,
            module_key,
        )
    except DirectoryServiceError as error:
        raise _translate(error) from error
    await request.app.state.event_bus.publish(
        {
            "type": "directory.access_updated",
            "entityId": f"{subject_type}:{subject_key}:{module_key}",
        }
    )


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


@router.delete("/positions/{position_id}", status_code=204)
async def remove_position(
    position_id: UUID,
    request: Request,
    current_user: Annotated[AuthenticatedUser, Depends(require_user)],
    connection: Annotated[AsyncConnection, Depends(get_connection)],
) -> Response:
    try:
        await delete_position(connection, current_user, position_id)
    except DirectoryServiceError as error:
        raise _translate(error) from error
    await request.app.state.event_bus.publish(
        {"type": "directory.position_deleted", "entityId": str(position_id)}
    )
    return Response(status_code=204)


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


@router.patch("/employees/{employee_id}/status", response_model=DirectoryEmployeeResponse)
async def patch_employee_status(
    employee_id: UUID,
    payload: EmployeeStatusUpdateRequest,
    request: Request,
    current_user: Annotated[AuthenticatedUser, Depends(require_user)],
    connection: Annotated[AsyncConnection, Depends(get_connection)],
) -> DirectoryEmployeeResponse:
    try:
        result = await update_employee_status(connection, current_user, employee_id, payload)
    except DirectoryServiceError as error:
        raise _translate(error) from error
    event_bus: WorkspaceEventBus = request.app.state.event_bus
    await event_bus.publish(
        {
            "type": "directory.employee_status_updated",
            "entityId": result.id,
            "status": result.status,
        }
    )
    return result
