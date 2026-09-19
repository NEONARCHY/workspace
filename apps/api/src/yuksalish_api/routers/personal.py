from typing import Annotated, cast
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncConnection

from yuksalish_api import personal_preferences as service
from yuksalish_api.auth import AuthenticatedUser, require_user
from yuksalish_api.database import get_connection
from yuksalish_api.errors import WorkspaceRepositoryError
from yuksalish_api.events import WorkspaceEventBus
from yuksalish_api.workspace_schemas import (
    InterfaceLocaleUpdate,
    NavigationOrder,
    PersonalChatAction,
    PersonalPreferencesResponse,
    PinnedChatOrder,
)

router = APIRouter(prefix="/personal-preferences", tags=["personal preferences"])
User = Annotated[AuthenticatedUser, Depends(require_user)]
Connection = Annotated[AsyncConnection, Depends(get_connection)]


async def changed(connection: AsyncConnection, request: Request, user: AuthenticatedUser) -> None:
    await connection.commit()
    await cast(WorkspaceEventBus, request.app.state.event_bus).publish(
        {"type": "personal.preferences", "userId": str(user.id)},
        recipient_id=user.id,
    )


@router.get("", response_model=PersonalPreferencesResponse)
async def get_preferences(user: User, connection: Connection) -> PersonalPreferencesResponse:
    return await service.get_preferences(connection, user)


@router.patch("/chats/{chat_id}", response_model=PersonalPreferencesResponse)
async def change_chat(
    chat_id: UUID,
    payload: PersonalChatAction,
    user: User,
    connection: Connection,
    request: Request,
) -> PersonalPreferencesResponse:
    try:
        result = await service.change_chat(connection, user, str(chat_id), payload.action)
    except WorkspaceRepositoryError as error:
        raise HTTPException(error.status_code, error.detail) from error
    await changed(connection, request, user)
    return result


@router.put("/pinned-chats", response_model=PersonalPreferencesResponse)
async def reorder_pins(
    payload: PinnedChatOrder,
    user: User,
    connection: Connection,
    request: Request,
) -> PersonalPreferencesResponse:
    try:
        result = await service.reorder_pins(connection, user, payload)
    except WorkspaceRepositoryError as error:
        raise HTTPException(error.status_code, error.detail) from error
    await changed(connection, request, user)
    return result


@router.put("/navigation", response_model=PersonalPreferencesResponse)
async def reorder_navigation(
    payload: NavigationOrder,
    user: User,
    connection: Connection,
    request: Request,
) -> PersonalPreferencesResponse:
    try:
        result = await service.reorder_navigation(connection, user, payload)
    except WorkspaceRepositoryError as error:
        raise HTTPException(error.status_code, error.detail) from error
    await changed(connection, request, user)
    return result


@router.put("/locale", response_model=PersonalPreferencesResponse)
async def change_locale(
    payload: InterfaceLocaleUpdate,
    user: User,
    connection: Connection,
    request: Request,
) -> PersonalPreferencesResponse:
    try:
        result = await service.change_locale(connection, user, payload)
    except WorkspaceRepositoryError as error:
        raise HTTPException(error.status_code, error.detail) from error
    await changed(connection, request, user)
    return result
