from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncConnection

from yuksalish_api.access_control import ensure_module_action, module_permissions_for_user
from yuksalish_api.auth import AuthenticatedUser, require_user
from yuksalish_api.database import get_connection
from yuksalish_api.workday_schemas import (
    WorkdayMeResponse,
    WorkdayScheduleResponse,
    WorkdayScheduleWrite,
    WorkdayTeamResponse,
)
from yuksalish_api.workday_service import (
    WorkdayError,
    finish_workday,
    load_me,
    load_team,
    save_schedule,
    start_workday,
)

router = APIRouter(prefix="/workday", tags=["workday"])


def _error(error: WorkdayError) -> HTTPException:
    return HTTPException(error.status_code, error.detail)


@router.get("/me", response_model=WorkdayMeResponse)
async def get_my_workday(
    current_user: Annotated[AuthenticatedUser, Depends(require_user)],
    connection: Annotated[AsyncConnection, Depends(get_connection)],
) -> WorkdayMeResponse:
    return await load_me(connection, current_user)


@router.post("/start", response_model=WorkdayMeResponse)
async def post_workday_start(
    current_user: Annotated[AuthenticatedUser, Depends(require_user)],
    connection: Annotated[AsyncConnection, Depends(get_connection)],
) -> WorkdayMeResponse:
    try:
        return await start_workday(connection, current_user)
    except WorkdayError as error:
        raise _error(error) from error


@router.post("/finish", response_model=WorkdayMeResponse)
async def post_workday_finish(
    current_user: Annotated[AuthenticatedUser, Depends(require_user)],
    connection: Annotated[AsyncConnection, Depends(get_connection)],
) -> WorkdayMeResponse:
    try:
        return await finish_workday(connection, current_user)
    except WorkdayError as error:
        raise _error(error) from error


@router.get("/team", response_model=WorkdayTeamResponse)
async def get_team_workday(
    current_user: Annotated[AuthenticatedUser, Depends(require_user)],
    connection: Annotated[AsyncConnection, Depends(get_connection)],
) -> WorkdayTeamResponse:
    await ensure_module_action(connection, current_user, "team_overview", "view")
    permissions = await module_permissions_for_user(connection, current_user)
    try:
        return await load_team(
            connection,
            current_user,
            can_edit_schedules=permissions["team_overview"]["edit"],
        )
    except WorkdayError as error:
        raise _error(error) from error


@router.put("/schedules/{user_id}", response_model=WorkdayScheduleResponse)
async def put_workday_schedule(
    user_id: UUID,
    payload: WorkdayScheduleWrite,
    current_user: Annotated[AuthenticatedUser, Depends(require_user)],
    connection: Annotated[AsyncConnection, Depends(get_connection)],
) -> WorkdayScheduleResponse:
    await ensure_module_action(connection, current_user, "team_overview", "edit")
    try:
        return await save_schedule(connection, current_user, user_id, payload)
    except WorkdayError as error:
        raise _error(error) from error
