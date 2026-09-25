"""Standalone project and project-funding endpoints."""

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncConnection

from yuksalish_api.access_control import ensure_module_action
from yuksalish_api.auth import AuthenticatedUser, require_user
from yuksalish_api.database import get_connection
from yuksalish_api.project_hub_schemas import (
    ProjectFundingAction,
    ProjectFundingResponse,
    ProjectFundingWrite,
    ProjectHubOverview,
    ProjectHubResponse,
    ProjectHubWrite,
    ProjectWorkItemResponse,
    ProjectWorkItemWrite,
    ProjectWorkStatusWrite,
    ProjectWorkstreamResponse,
    ProjectWorkstreamWrite,
)
from yuksalish_api.project_hub_service import (
    create_funding_request,
    decide_funding_request,
    load_funding_requests,
    load_hub,
    publish_event,
    save_item,
    save_project,
    save_workstream,
    set_item_status,
)
from yuksalish_api.repository import WorkspaceRepositoryError

router = APIRouter(prefix="/project-hub", tags=["project-hub"])
User = Annotated[AuthenticatedUser, Depends(require_user)]
Connection = Annotated[AsyncConnection, Depends(get_connection)]


def _error(error: WorkspaceRepositoryError) -> HTTPException:
    return HTTPException(error.status_code, error.detail)


@router.get("", response_model=ProjectHubOverview)
async def get_hub(user: User, connection: Connection) -> ProjectHubOverview:
    await ensure_module_action(connection, user, "project_hub", "view")
    return await load_hub(connection, user)


@router.get("/requests", response_model=list[ProjectFundingResponse])
async def get_requests(user: User, connection: Connection) -> list[ProjectFundingResponse]:
    await ensure_module_action(connection, user, "project_funding", "view")
    return await load_funding_requests(connection, user)


@router.post("/projects", response_model=ProjectHubResponse, status_code=201)
async def post_project(
    payload: ProjectHubWrite, user: User, connection: Connection
) -> ProjectHubResponse:
    await ensure_module_action(connection, user, "project_hub", "create")
    try:
        return await save_project(connection, user, payload)
    except WorkspaceRepositoryError as error:
        raise _error(error) from error


@router.put("/projects/{project_id}", response_model=ProjectHubResponse)
async def put_project(
    project_id: UUID,
    payload: ProjectHubWrite,
    user: User,
    connection: Connection,
) -> ProjectHubResponse:
    await ensure_module_action(connection, user, "project_hub", "edit")
    try:
        return await save_project(connection, user, payload, project_id)
    except WorkspaceRepositoryError as error:
        raise _error(error) from error


@router.post(
    "/projects/{project_id}/items", response_model=ProjectWorkItemResponse, status_code=201
)
async def post_item(
    project_id: UUID,
    payload: ProjectWorkItemWrite,
    user: User,
    connection: Connection,
) -> ProjectWorkItemResponse:
    await ensure_module_action(connection, user, "project_hub", "create")
    try:
        return await save_item(connection, user, project_id, payload)
    except WorkspaceRepositoryError as error:
        raise _error(error) from error


@router.post(
    "/projects/{project_id}/workstreams",
    response_model=ProjectWorkstreamResponse,
    status_code=201,
)
async def post_workstream(
    project_id: UUID, payload: ProjectWorkstreamWrite, user: User, connection: Connection
) -> ProjectWorkstreamResponse:
    await ensure_module_action(connection, user, "project_hub", "create")
    try:
        return await save_workstream(connection, user, project_id, payload)
    except WorkspaceRepositoryError as error:
        raise _error(error) from error


@router.put(
    "/projects/{project_id}/workstreams/{workstream_id}",
    response_model=ProjectWorkstreamResponse,
)
async def put_workstream(
    project_id: UUID,
    workstream_id: UUID,
    payload: ProjectWorkstreamWrite,
    user: User,
    connection: Connection,
) -> ProjectWorkstreamResponse:
    await ensure_module_action(connection, user, "project_hub", "edit")
    try:
        return await save_workstream(connection, user, project_id, payload, workstream_id)
    except WorkspaceRepositoryError as error:
        raise _error(error) from error


@router.put("/projects/{project_id}/items/{item_id}", response_model=ProjectWorkItemResponse)
async def put_item(
    project_id: UUID,
    item_id: UUID,
    payload: ProjectWorkItemWrite,
    user: User,
    connection: Connection,
) -> ProjectWorkItemResponse:
    await ensure_module_action(connection, user, "project_hub", "edit")
    try:
        return await save_item(connection, user, project_id, payload, item_id)
    except WorkspaceRepositoryError as error:
        raise _error(error) from error


@router.patch(
    "/projects/{project_id}/items/{item_id}/status", response_model=ProjectWorkItemResponse
)
async def patch_item_status(
    project_id: UUID,
    item_id: UUID,
    payload: ProjectWorkStatusWrite,
    user: User,
    connection: Connection,
) -> ProjectWorkItemResponse:
    await ensure_module_action(connection, user, "project_hub", "edit")
    try:
        return await set_item_status(connection, user, project_id, item_id, payload)
    except WorkspaceRepositoryError as error:
        raise _error(error) from error


@router.post(
    "/projects/{project_id}/items/{item_id}/publish", response_model=ProjectWorkItemResponse
)
async def post_publish_event(
    project_id: UUID,
    item_id: UUID,
    user: User,
    connection: Connection,
) -> ProjectWorkItemResponse:
    await ensure_module_action(connection, user, "project_hub", "edit")
    await ensure_module_action(connection, user, "calendar", "create")
    try:
        return await publish_event(connection, user, project_id, item_id)
    except WorkspaceRepositoryError as error:
        raise _error(error) from error


@router.post(
    "/projects/{project_id}/requests", response_model=ProjectFundingResponse, status_code=201
)
async def post_request(
    project_id: UUID,
    payload: ProjectFundingWrite,
    user: User,
    connection: Connection,
) -> ProjectFundingResponse:
    await ensure_module_action(connection, user, "project_funding", "create")
    try:
        return await create_funding_request(connection, user, project_id, payload)
    except WorkspaceRepositoryError as error:
        raise _error(error) from error


@router.post("/requests/{request_id}/decision", response_model=ProjectFundingResponse)
async def post_decision(
    request_id: UUID,
    payload: ProjectFundingAction,
    user: User,
    connection: Connection,
) -> ProjectFundingResponse:
    await ensure_module_action(connection, user, "project_funding", "approve")
    try:
        return await decide_funding_request(connection, user, request_id, payload)
    except WorkspaceRepositoryError as error:
        raise _error(error) from error
