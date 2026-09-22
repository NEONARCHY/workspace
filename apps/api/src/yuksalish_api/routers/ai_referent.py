from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.ext.asyncio import AsyncConnection

from yuksalish_api.ai_referent_schemas import (
    AIReferentActionRequest,
    AIReferentLetterResponse,
    AIReferentRegistryResponse,
    AIReferentStatus,
    CreateAIReferentLetterRequest,
    UpdateAIReferentLetterRequest,
)
from yuksalish_api.ai_referent_service import (
    AIReferentServiceError,
    act_on_letter,
    create_letter,
    load_letter,
    load_letters,
    update_letter,
)
from yuksalish_api.auth import AuthenticatedUser, require_user
from yuksalish_api.database import get_connection

router = APIRouter(prefix="/ai-referent", tags=["ai-referent"])


def _translate(error: AIReferentServiceError) -> HTTPException:
    return HTTPException(status_code=error.status_code, detail=error.detail)


@router.get("/letters", response_model=AIReferentRegistryResponse)
async def get_letters(
    current_user: Annotated[AuthenticatedUser, Depends(require_user)],
    connection: Annotated[AsyncConnection, Depends(get_connection)],
    query: Annotated[str, Query(max_length=200)] = "",
    status: AIReferentStatus | None = None,
) -> AIReferentRegistryResponse:
    return await load_letters(connection, current_user, query=query, status=status)


@router.get("/letters/{letter_id}", response_model=AIReferentLetterResponse)
async def get_letter(
    letter_id: UUID,
    current_user: Annotated[AuthenticatedUser, Depends(require_user)],
    connection: Annotated[AsyncConnection, Depends(get_connection)],
) -> AIReferentLetterResponse:
    try:
        return await load_letter(connection, current_user, letter_id)
    except AIReferentServiceError as error:
        raise _translate(error) from error


@router.post("/letters", response_model=AIReferentLetterResponse, status_code=201)
async def post_letter(
    request: Request,
    payload: CreateAIReferentLetterRequest,
    current_user: Annotated[AuthenticatedUser, Depends(require_user)],
    connection: Annotated[AsyncConnection, Depends(get_connection)],
) -> AIReferentLetterResponse:
    try:
        result = await create_letter(connection, current_user, payload)
    except AIReferentServiceError as error:
        raise _translate(error) from error
    await request.app.state.event_bus.publish(
        {"type": "ai_referent.created", "entityId": result.id}
    )
    return result


@router.patch("/letters/{letter_id}", response_model=AIReferentLetterResponse)
async def patch_letter(
    request: Request,
    letter_id: UUID,
    payload: UpdateAIReferentLetterRequest,
    current_user: Annotated[AuthenticatedUser, Depends(require_user)],
    connection: Annotated[AsyncConnection, Depends(get_connection)],
) -> AIReferentLetterResponse:
    try:
        result = await update_letter(connection, current_user, letter_id, payload)
    except AIReferentServiceError as error:
        raise _translate(error) from error
    await request.app.state.event_bus.publish(
        {"type": "ai_referent.updated", "entityId": result.id}
    )
    return result

@router.post("/letters/{letter_id}/actions", response_model=AIReferentLetterResponse)
async def post_letter_action(
    request: Request,
    letter_id: UUID,
    payload: AIReferentActionRequest,
    current_user: Annotated[AuthenticatedUser, Depends(require_user)],
    connection: Annotated[AsyncConnection, Depends(get_connection)],
) -> AIReferentLetterResponse:
    try:
        result = await act_on_letter(connection, current_user, letter_id, payload)
    except AIReferentServiceError as error:
        raise _translate(error) from error
    await request.app.state.event_bus.publish(
        {"type": "ai_referent.updated", "entityId": result.id}
    )
    return result
