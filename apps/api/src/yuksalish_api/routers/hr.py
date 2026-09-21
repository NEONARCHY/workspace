from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncConnection

from yuksalish_api.auth import AuthenticatedUser, require_user
from yuksalish_api.database import get_connection
from yuksalish_api.hr_schemas import (
    HrHistoryResponse,
    HrOverviewResponse,
    HrProfileCreate,
    HrProfileImport,
    HrProfileImportResponse,
    HrProfileResponse,
    HrProfileWrite,
    HrRegisterAction,
    HrRegisterResponse,
    HrSettingsResponse,
    HrSettingsWrite,
    HrTerminationWrite,
    HrWorkbookPreviewResponse,
)
from yuksalish_api.hr_service import (
    HrError,
    act_register,
    create_profile,
    generate_register,
    history,
    import_profiles,
    load_overview,
    preview_workbook,
    save_profile,
    save_settings,
    terminate_profile,
)

router = APIRouter(prefix="/hr", tags=["hr"])


def _error(error: HrError) -> HTTPException:
    return HTTPException(error.status_code, error.detail)


@router.get("", response_model=HrOverviewResponse)
async def get_hr(
    current_user: Annotated[AuthenticatedUser, Depends(require_user)],
    connection: Annotated[AsyncConnection, Depends(get_connection)],
) -> HrOverviewResponse:
    try:
        return await load_overview(connection, current_user)
    except HrError as error:
        raise _error(error) from error


@router.put("/settings", response_model=HrSettingsResponse)
async def put_settings(
    payload: HrSettingsWrite,
    current_user: Annotated[AuthenticatedUser, Depends(require_user)],
    connection: Annotated[AsyncConnection, Depends(get_connection)],
) -> HrSettingsResponse:
    try:
        return await save_settings(connection, current_user, payload)
    except HrError as error:
        raise _error(error) from error


@router.put("/profiles/{user_id}", response_model=HrProfileResponse)
async def put_profile(
    user_id: UUID,
    payload: HrProfileWrite,
    current_user: Annotated[AuthenticatedUser, Depends(require_user)],
    connection: Annotated[AsyncConnection, Depends(get_connection)],
) -> HrProfileResponse:
    try:
        return await save_profile(connection, current_user, user_id, payload)
    except HrError as error:
        raise _error(error) from error


@router.post("/profiles", response_model=HrProfileResponse)
async def post_profile(
    payload: HrProfileCreate,
    current_user: Annotated[AuthenticatedUser, Depends(require_user)],
    connection: Annotated[AsyncConnection, Depends(get_connection)],
) -> HrProfileResponse:
    try:
        return await create_profile(connection, current_user, payload)
    except HrError as error:
        raise _error(error) from error


@router.post("/profiles/import", response_model=HrProfileImportResponse)
async def post_profile_import(
    payload: HrProfileImport,
    current_user: Annotated[AuthenticatedUser, Depends(require_user)],
    connection: Annotated[AsyncConnection, Depends(get_connection)],
) -> HrProfileImportResponse:
    try:
        return await import_profiles(connection, current_user, payload)
    except HrError as error:
        raise _error(error) from error


@router.post("/profiles/import/preview", response_model=HrWorkbookPreviewResponse)
async def post_profile_import_preview(
    filename: Annotated[str, Query(min_length=1, max_length=255)],
    content: Annotated[
        bytes,
        Body(media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
    ],
    current_user: Annotated[AuthenticatedUser, Depends(require_user)],
    connection: Annotated[AsyncConnection, Depends(get_connection)],
) -> HrWorkbookPreviewResponse:
    try:
        return await preview_workbook(connection, current_user, filename, content)
    except HrError as error:
        raise _error(error) from error


@router.post("/profiles/{profile_id}/terminate", response_model=HrProfileResponse)
async def post_termination(
    profile_id: UUID,
    payload: HrTerminationWrite,
    current_user: Annotated[AuthenticatedUser, Depends(require_user)],
    connection: Annotated[AsyncConnection, Depends(get_connection)],
) -> HrProfileResponse:
    try:
        return await terminate_profile(connection, current_user, profile_id, payload)
    except HrError as error:
        raise _error(error) from error


@router.get("/profiles/{profile_id}/history", response_model=list[HrHistoryResponse])
async def get_history(
    profile_id: UUID,
    current_user: Annotated[AuthenticatedUser, Depends(require_user)],
    connection: Annotated[AsyncConnection, Depends(get_connection)],
) -> list[HrHistoryResponse]:
    try:
        return await history(connection, current_user, profile_id)
    except HrError as error:
        raise _error(error) from error


@router.post("/registers/generate", response_model=HrRegisterResponse)
async def post_generate(
    period: Annotated[str, Query(pattern=r"^\d{4}-(0[1-9]|1[0-2])$")],
    current_user: Annotated[AuthenticatedUser, Depends(require_user)],
    connection: Annotated[AsyncConnection, Depends(get_connection)],
) -> HrRegisterResponse:
    try:
        return await generate_register(connection, current_user, period)
    except HrError as error:
        raise _error(error) from error


@router.post("/registers/{register_id}/actions", response_model=HrRegisterResponse)
async def post_action(
    register_id: UUID,
    payload: HrRegisterAction,
    current_user: Annotated[AuthenticatedUser, Depends(require_user)],
    connection: Annotated[AsyncConnection, Depends(get_connection)],
) -> HrRegisterResponse:
    try:
        return await act_register(connection, current_user, register_id, payload)
    except HrError as error:
        raise _error(error) from error
