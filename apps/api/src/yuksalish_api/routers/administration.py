from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy.ext.asyncio import AsyncConnection

from yuksalish_api import administration_service as service
from yuksalish_api.administration_schemas import (
    AdministrativeChatInspectionCreateRequest,
    AdministrativeChatInspectionResponse,
    AdministrativeChatResponse,
)
from yuksalish_api.auth import AuthenticatedUser, require_user
from yuksalish_api.database import get_connection
from yuksalish_api.errors import WorkspaceRepositoryError

router = APIRouter(prefix="/administration", tags=["administration"])
User = Annotated[AuthenticatedUser, Depends(require_user)]
Connection = Annotated[AsyncConnection, Depends(get_connection)]


def _translate(error: WorkspaceRepositoryError) -> HTTPException:
    return HTTPException(status_code=error.status_code, detail=error.detail)


@router.get("/chats", response_model=list[AdministrativeChatResponse])
async def administrative_chats(
    user: User,
    connection: Connection,
    q: Annotated[str | None, Query(max_length=160)] = None,
) -> list[AdministrativeChatResponse]:
    try:
        return await service.list_administrative_chats(connection, user, q)
    except WorkspaceRepositoryError as error:
        raise _translate(error) from error


@router.post(
    "/chat-inspections",
    response_model=AdministrativeChatInspectionResponse,
    status_code=201,
)
async def start_chat_inspection(
    payload: AdministrativeChatInspectionCreateRequest,
    user: User,
    connection: Connection,
) -> AdministrativeChatInspectionResponse:
    try:
        return await service.create_chat_inspection(connection, user, payload)
    except WorkspaceRepositoryError as error:
        raise _translate(error) from error


@router.get(
    "/chat-inspections/{inspection_id}",
    response_model=AdministrativeChatInspectionResponse,
)
async def chat_inspection(
    inspection_id: UUID,
    user: User,
    connection: Connection,
) -> AdministrativeChatInspectionResponse:
    try:
        return await service.get_chat_inspection(connection, user, inspection_id)
    except WorkspaceRepositoryError as error:
        raise _translate(error) from error


@router.delete("/chat-inspections/{inspection_id}", status_code=204)
async def end_chat_inspection(
    inspection_id: UUID,
    user: User,
    connection: Connection,
) -> Response:
    try:
        await service.revoke_chat_inspection(connection, user, inspection_id)
    except WorkspaceRepositoryError as error:
        raise _translate(error) from error
    return Response(status_code=204)
