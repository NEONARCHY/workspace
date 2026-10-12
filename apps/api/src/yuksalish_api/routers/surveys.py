"""Authenticated private survey imports, saved settings and protected originals."""

from typing import Annotated, Literal, cast
from urllib.parse import quote, unquote
from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request, Response
from sqlalchemy.ext.asyncio import AsyncConnection
from starlette.concurrency import run_in_threadpool

from yuksalish_api.access_control import ensure_module_action
from yuksalish_api.auth import AuthenticatedUser, require_user
from yuksalish_api.database import get_connection
from yuksalish_api.errors import WorkspaceRepositoryError
from yuksalish_api.object_storage import ObjectStorage, ObjectStorageError
from yuksalish_api.survey_documents import MAX_FILE_BYTES
from yuksalish_api.survey_export import export_xlsx
from yuksalish_api.survey_schemas import SurveyAnalysis, SurveyDetail, SurveyExport, SurveyUpdate
from yuksalish_api.survey_service import (
    analysis_response,
    create_analysis,
    list_analyses,
    read_workbook,
    require_analysis,
    save_analysis,
)

router = APIRouter(prefix="/survey-analyses", tags=["survey-analytics"])
User = Annotated[AuthenticatedUser, Depends(require_user)]
Connection = Annotated[AsyncConnection, Depends(get_connection)]
PRIVATE_HEADERS = {"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"}


def storage(request: Request) -> ObjectStorage:
    return cast(ObjectStorage, request.app.state.object_storage)


@router.get("", response_model=list[SurveyAnalysis])
async def get_analyses(
    user: User, connection: Connection, response: Response,
) -> list[SurveyAnalysis]:
    response.headers.update(PRIVATE_HEADERS)
    try:
        return await list_analyses(connection, user)
    except WorkspaceRepositoryError as error:
        raise HTTPException(error.status_code, error.detail) from error


@router.post("", response_model=SurveyDetail, status_code=201)
async def post_analysis(
    user: User, connection: Connection, request: Request, response: Response,
    request_id: Annotated[UUID, Query(alias="requestId")],
    encoded_filename: Annotated[str, Header(alias="X-Survey-Filename", min_length=1,
                                          max_length=4000)],
    encoding: Literal["utf-8-sig", "cp1251"] = "utf-8-sig",
    delimiter: Literal[",", ";", "\t"] = ",",
) -> SurveyDetail:
    response.headers.update(PRIVATE_HEADERS)
    try:
        file_name = unquote(encoded_filename, encoding="utf-8", errors="strict")
    except UnicodeError as error:
        raise HTTPException(422, "Некорректное имя файла.") from error
    if not file_name.strip() or len(file_name) > 240 or any(
        ord(char) < 32 or char in "/\\" for char in file_name
    ):
        raise HTTPException(422, "Укажите обычное имя файла без пути.")
    try:
        await ensure_module_action(connection, user, "survey_analytics", "view")
        await ensure_module_action(connection, user, "survey_analytics", "create")
        content = bytearray()
        async for chunk in request.stream():
            if len(content) + len(chunk) > MAX_FILE_BYTES:
                raise HTTPException(413, "Файл превышает 10 МиБ.")
            content.extend(chunk)
        return await create_analysis(connection, user, storage(request), request_id, file_name,
                                     bytes(content), encoding, delimiter)
    except WorkspaceRepositoryError as error:
        raise HTTPException(error.status_code, error.detail) from error
    except ObjectStorageError as error:
        raise HTTPException(503, "Хранилище опросов временно недоступно.") from error


@router.get("/{analysis_id}", response_model=SurveyDetail)
async def get_analysis(
    analysis_id: UUID, user: User, connection: Connection, request: Request, response: Response,
) -> SurveyDetail:
    response.headers.update(PRIVATE_HEADERS)
    try:
        row = await require_analysis(connection, user, analysis_id)
        return SurveyDetail(analysis=analysis_response(row),
                            workbook=await read_workbook(row, storage(request)))
    except WorkspaceRepositoryError as error:
        raise HTTPException(error.status_code, error.detail) from error
    except ObjectStorageError as error:
        raise HTTPException(503, "Хранилище опросов временно недоступно.") from error


@router.put("/{analysis_id}", response_model=SurveyAnalysis)
async def put_analysis(
    analysis_id: UUID, payload: SurveyUpdate, user: User, connection: Connection,
    request: Request, response: Response,
) -> SurveyAnalysis:
    response.headers.update(PRIVATE_HEADERS)
    try:
        return await save_analysis(connection, user, analysis_id, payload, storage(request))
    except WorkspaceRepositoryError as error:
        raise HTTPException(error.status_code, error.detail) from error
    except ObjectStorageError as error:
        raise HTTPException(503, "Хранилище опросов временно недоступно.") from error


@router.get("/{analysis_id}/original")
async def get_original(
    analysis_id: UUID, user: User, connection: Connection, request: Request,
) -> Response:
    try:
        row = await require_analysis(connection, user, analysis_id)
        return Response(await storage(request).get(row["original_key"]),
                        media_type="application/octet-stream", headers={
                            **PRIVATE_HEADERS,
                            "Content-Disposition": f"attachment; filename*=UTF-8''"
                                                   f"{quote(row['file_name'], safe='')}",
                        })
    except WorkspaceRepositoryError as error:
        raise HTTPException(error.status_code, error.detail) from error
    except ObjectStorageError as error:
        raise HTTPException(503, "Хранилище опросов временно недоступно.") from error


@router.post("/{analysis_id}/export")
async def post_export(
    analysis_id: UUID, payload: SurveyExport, user: User, connection: Connection, request: Request,
) -> Response:
    try:
        row = await require_analysis(connection, user, analysis_id)
        content = await run_in_threadpool(
            export_xlsx, await read_workbook(row, storage(request)), payload,
        )
        return Response(content, media_type=(
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        ), headers={**PRIVATE_HEADERS, "Content-Disposition": 'attachment; filename="survey.xlsx"'})
    except WorkspaceRepositoryError as error:
        raise HTTPException(error.status_code, error.detail) from error
    except ObjectStorageError as error:
        raise HTTPException(503, "Хранилище опросов временно недоступно.") from error
