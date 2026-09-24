from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncConnection

from yuksalish_api.auth import AuthenticatedUser, require_user
from yuksalish_api.database import get_connection
from yuksalish_api.recognition_schemas import (
    EmployeeRecognitionProfileResponse,
    EmployeeRewardCreate,
    EmployeeRewardResponse,
    RecognitionSettingsResponse,
    RecognitionSettingsWrite,
)
from yuksalish_api.recognition_service import (
    RecognitionError,
    issue_reward,
    load_profile,
    load_settings,
    save_settings,
)

router = APIRouter(prefix="/recognition", tags=["employee recognition"])


def _error(error: RecognitionError) -> HTTPException:
    return HTTPException(error.status_code, error.detail)


@router.get(
    "/profiles/{user_id}",
    response_model=EmployeeRecognitionProfileResponse,
)
async def get_profile(
    user_id: UUID,
    current_user: Annotated[AuthenticatedUser, Depends(require_user)],
    connection: Annotated[AsyncConnection, Depends(get_connection)],
) -> EmployeeRecognitionProfileResponse:
    try:
        return await load_profile(connection, current_user, user_id)
    except RecognitionError as error:
        raise _error(error) from error


@router.get("/settings", response_model=RecognitionSettingsResponse)
async def get_settings(
    current_user: Annotated[AuthenticatedUser, Depends(require_user)],
    connection: Annotated[AsyncConnection, Depends(get_connection)],
) -> RecognitionSettingsResponse:
    try:
        return await load_settings(connection, current_user)
    except RecognitionError as error:
        raise _error(error) from error


@router.patch("/settings", response_model=RecognitionSettingsResponse)
async def patch_settings(
    payload: RecognitionSettingsWrite,
    current_user: Annotated[AuthenticatedUser, Depends(require_user)],
    connection: Annotated[AsyncConnection, Depends(get_connection)],
) -> RecognitionSettingsResponse:
    try:
        return await save_settings(connection, current_user, payload)
    except RecognitionError as error:
        raise _error(error) from error


@router.post(
    "/profiles/{user_id}/rewards",
    response_model=EmployeeRewardResponse,
    status_code=201,
)
async def post_reward(
    user_id: UUID,
    payload: EmployeeRewardCreate,
    current_user: Annotated[AuthenticatedUser, Depends(require_user)],
    connection: Annotated[AsyncConnection, Depends(get_connection)],
) -> EmployeeRewardResponse:
    try:
        return await issue_reward(connection, current_user, user_id, payload)
    except RecognitionError as error:
        raise _error(error) from error
