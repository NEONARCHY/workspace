from typing import Annotated, cast
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy.ext.asyncio import AsyncConnection

from yuksalish_api import messenger_service as service
from yuksalish_api.auth import AuthenticatedUser, require_user
from yuksalish_api.database import get_connection
from yuksalish_api.errors import WorkspaceRepositoryError
from yuksalish_api.events import WorkspaceEventBus
from yuksalish_api.workspace_schemas import (
    AddChatMembersRequest,
    ChatMessageResponse,
    ChatSummaryResponse,
    CreateChatRequest,
    DeleteMessageRequest,
    EditMessageRequest,
    MessageReactionRequest,
    PinMessageRequest,
    SetChatMemberRequest,
    TransferChatOwnerRequest,
    UpdateChatRequest,
)

router = APIRouter(tags=["messenger"])
User = Annotated[AuthenticatedUser, Depends(require_user)]
Connection = Annotated[AsyncConnection, Depends(get_connection)]


async def changed(connection: AsyncConnection, request: Request) -> None:
    # A client refreshing on the event must observe the committed membership/content.
    await connection.commit()
    await cast(WorkspaceEventBus, request.app.state.event_bus).publish(
        {"type": "messenger.changed"}
    )


@router.post("/chats", response_model=ChatSummaryResponse, status_code=201)
async def create_chat(
    payload: CreateChatRequest, user: User, connection: Connection, request: Request
) -> ChatSummaryResponse:
    try:
        result = await service.create_chat(connection, user, payload)
    except WorkspaceRepositoryError as error:
        raise HTTPException(error.status_code, error.detail) from error
    await changed(connection, request)
    return result


@router.patch("/chats/{chat_id}", response_model=ChatSummaryResponse)
async def update_chat(
    chat_id: UUID, payload: UpdateChatRequest, user: User, connection: Connection, request: Request
) -> ChatSummaryResponse:
    try:
        result = await service.update_chat(connection, user, chat_id, payload)
    except WorkspaceRepositoryError as error:
        raise HTTPException(error.status_code, error.detail) from error
    await changed(connection, request)
    return result


@router.delete("/chats/{chat_id}", status_code=204)
async def delete_chat(
    chat_id: UUID, user: User, connection: Connection, request: Request
) -> Response:
    try:
        await service.delete_chat(connection, user, chat_id)
    except WorkspaceRepositoryError as error:
        raise HTTPException(error.status_code, error.detail) from error
    await changed(connection, request)
    return Response(status_code=204)


@router.post("/chats/{chat_id}/members", response_model=ChatSummaryResponse)
async def add_members(
    chat_id: UUID,
    payload: AddChatMembersRequest,
    user: User,
    connection: Connection,
    request: Request,
) -> ChatSummaryResponse:
    try:
        result = await service.add_chat_members(connection, user, chat_id, payload)
    except WorkspaceRepositoryError as error:
        raise HTTPException(error.status_code, error.detail) from error
    await changed(connection, request)
    return result


@router.put("/chats/{chat_id}/members/{member_id}", response_model=ChatSummaryResponse)
async def set_member(
    chat_id: UUID,
    member_id: UUID,
    payload: SetChatMemberRequest,
    user: User,
    connection: Connection,
    request: Request,
) -> ChatSummaryResponse:
    try:
        result = await service.set_chat_member(connection, user, chat_id, member_id, payload)
    except WorkspaceRepositoryError as error:
        raise HTTPException(error.status_code, error.detail) from error
    await changed(connection, request)
    return result


@router.delete("/chats/{chat_id}/members/{member_id}", status_code=204)
async def remove_member(
    chat_id: UUID, member_id: UUID, user: User, connection: Connection, request: Request
) -> Response:
    try:
        await service.remove_chat_member(connection, user, chat_id, member_id)
    except WorkspaceRepositoryError as error:
        raise HTTPException(error.status_code, error.detail) from error
    await changed(connection, request)
    return Response(status_code=204)


@router.post("/chats/{chat_id}/owner", response_model=ChatSummaryResponse)
async def transfer_owner(
    chat_id: UUID,
    payload: TransferChatOwnerRequest,
    user: User,
    connection: Connection,
    request: Request,
) -> ChatSummaryResponse:
    try:
        result = await service.transfer_chat_owner(connection, user, chat_id, payload)
    except WorkspaceRepositoryError as error:
        raise HTTPException(error.status_code, error.detail) from error
    await changed(connection, request)
    return result


@router.patch("/messages/{message_id}", response_model=ChatMessageResponse)
async def edit_message(
    message_id: UUID,
    payload: EditMessageRequest,
    user: User,
    connection: Connection,
    request: Request,
) -> ChatMessageResponse:
    try:
        result = await service.change_message(connection, user, message_id, payload)
    except WorkspaceRepositoryError as error:
        raise HTTPException(error.status_code, error.detail) from error
    await changed(connection, request)
    return result


@router.delete("/messages/{message_id}", response_model=ChatMessageResponse)
async def delete_message(
    message_id: UUID,
    payload: DeleteMessageRequest,
    user: User,
    connection: Connection,
    request: Request,
) -> ChatMessageResponse:
    try:
        result = await service.change_message(connection, user, message_id, payload)
    except WorkspaceRepositoryError as error:
        raise HTTPException(error.status_code, error.detail) from error
    await changed(connection, request)
    return result


@router.post("/messages/{message_id}/reactions", response_model=ChatMessageResponse)
async def toggle_message_reaction(
    message_id: UUID,
    payload: MessageReactionRequest,
    user: User,
    connection: Connection,
    request: Request,
) -> ChatMessageResponse:
    try:
        result = await service.toggle_message_reaction(connection, user, message_id, payload)
    except WorkspaceRepositoryError as error:
        raise HTTPException(error.status_code, error.detail) from error
    await changed(connection, request)
    return result


@router.put("/messages/{message_id}/pin", response_model=ChatMessageResponse)
async def set_message_pin(
    message_id: UUID,
    payload: PinMessageRequest,
    user: User,
    connection: Connection,
    request: Request,
) -> ChatMessageResponse:
    try:
        result = await service.set_message_pin(connection, user, message_id, payload)
    except WorkspaceRepositoryError as error:
        raise HTTPException(error.status_code, error.detail) from error
    await changed(connection, request)
    return result
