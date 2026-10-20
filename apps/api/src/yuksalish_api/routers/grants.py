from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncConnection

from .. import grant_service
from ..auth import AuthenticatedUser, require_user
from ..database import get_connection
from ..errors import WorkspaceRepositoryError
from ..events import WorkspaceEventBus
from ..grant_schemas import (
    GrantAction,
    GrantCreate,
    GrantDetail,
    GrantEdit,
    GrantReviewersWrite,
    GrantSettings,
    GrantSettingsWrite,
    GrantSummary,
)

router = APIRouter(prefix="/grants", tags=["grants"])
User = Annotated[AuthenticatedUser, Depends(require_user)]
Connection = Annotated[AsyncConnection, Depends(get_connection)]


async def _publish(request: Request, result: GrantDetail) -> None:
    bus: WorkspaceEventBus = request.app.state.event_bus
    for recipient in {
        result.author_user_id,
        result.assignee_id,
        result.leader_user_id,
        result.chair_user_id,
        *result.co_assignee_ids,
    }:
        await bus.publish(
            {"type": "grant.updated", "entityId": result.id},
            recipient_id=UUID(recipient),
        )


@router.get("", response_model=list[GrantSummary])
async def list_grants(user: User, connection: Connection) -> list[GrantSummary]:
    return await grant_service.list_grants(connection, user)


@router.get("/settings", response_model=GrantSettings)
async def settings(user: User, connection: Connection) -> GrantSettings:
    return await grant_service.get_settings(connection, user)


@router.put("/settings", response_model=GrantSettings)
async def save_settings(
    payload: GrantSettingsWrite,
    user: User,
    connection: Connection,
) -> GrantSettings:
    try:
        result = await grant_service.save_settings(connection, user, payload)
    except WorkspaceRepositoryError as error:
        raise HTTPException(error.status_code, error.detail) from error
    await connection.commit()
    return result


@router.post("", response_model=GrantDetail, status_code=201)
async def create(
    payload: GrantCreate,
    user: User,
    connection: Connection,
    request: Request,
) -> GrantDetail:
    try:
        result = await grant_service.create_grant(connection, user, payload)
    except WorkspaceRepositoryError as error:
        raise HTTPException(error.status_code, error.detail) from error
    await connection.commit()
    await _publish(request, result)
    return result


@router.get("/{grant_id}", response_model=GrantDetail)
async def detail(grant_id: UUID, user: User, connection: Connection) -> GrantDetail:
    try:
        return await grant_service.get_grant(connection, user, grant_id)
    except WorkspaceRepositoryError as error:
        raise HTTPException(error.status_code, error.detail) from error


@router.put("/{grant_id}", response_model=GrantDetail)
async def edit(
    grant_id: UUID,
    payload: GrantEdit,
    user: User,
    connection: Connection,
    request: Request,
) -> GrantDetail:
    try:
        result = await grant_service.edit_grant(connection, user, grant_id, payload)
    except WorkspaceRepositoryError as error:
        raise HTTPException(error.status_code, error.detail) from error
    await connection.commit()
    await _publish(request, result)
    return result


@router.post("/{grant_id}/actions", response_model=GrantDetail)
async def action(
    grant_id: UUID,
    payload: GrantAction,
    user: User,
    connection: Connection,
    request: Request,
) -> GrantDetail:
    try:
        result = await grant_service.act_on_grant(connection, user, grant_id, payload)
    except WorkspaceRepositoryError as error:
        raise HTTPException(error.status_code, error.detail) from error
    await connection.commit()
    await _publish(request, result)
    return result


@router.put("/{grant_id}/reviewers", response_model=GrantDetail)
async def reviewers(
    grant_id: UUID,
    payload: GrantReviewersWrite,
    user: User,
    connection: Connection,
    request: Request,
) -> GrantDetail:
    try:
        result = await grant_service.change_reviewers(connection, user, grant_id, payload)
    except WorkspaceRepositoryError as error:
        raise HTTPException(error.status_code, error.detail) from error
    await connection.commit()
    await _publish(request, result)
    return result
