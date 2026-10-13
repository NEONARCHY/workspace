"""Plan records and task links within the existing Tasks module."""

from typing import Annotated
from uuid import UUID
from zipfile import BadZipFile

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pypdf.errors import PdfReadError
from sqlalchemy.ext.asyncio import AsyncConnection

from yuksalish_api.access_control import ensure_module_action
from yuksalish_api.auth import AuthenticatedUser, require_user
from yuksalish_api.database import get_connection
from yuksalish_api.repository import WorkspaceRepositoryError
from yuksalish_api.task_plan_import import MAX_PLAN_BYTES, preview_plan_document
from yuksalish_api.task_plan_schemas import (
    TaskPlanImportConfirm,
    TaskPlanImportPreview,
    TaskPlanResponse,
    TaskPlanWrite,
)
from yuksalish_api.task_plan_service import (
    change_link,
    confirm_import,
    create_plan,
    list_plans,
    update_plan,
)

router = APIRouter(prefix="/task-plans", tags=["task-plans"])
User = Annotated[AuthenticatedUser, Depends(require_user)]
Connection = Annotated[AsyncConnection, Depends(get_connection)]


@router.get("", response_model=list[TaskPlanResponse])
async def get_plans(user: User, connection: Connection) -> list[TaskPlanResponse]:
    return await list_plans(connection, user)


@router.post("", response_model=TaskPlanResponse, status_code=201)
async def post_plan(
    payload: TaskPlanWrite, user: User, connection: Connection,
) -> TaskPlanResponse:
    return await create_plan(connection, user, payload)


@router.post("/import/preview", response_model=TaskPlanImportPreview)
async def post_import_preview(
    request: Request, user: User, connection: Connection,
    file_name: str = Query(alias="fileName", min_length=1, max_length=240),
) -> TaskPlanImportPreview:
    await ensure_module_action(connection, user, "tasks", "create")
    if any(ord(char) < 32 or char in "/\\" for char in file_name):
        raise HTTPException(422, "Укажите только имя файла")
    content = bytearray()
    async for chunk in request.stream():
        if len(content) + len(chunk) > MAX_PLAN_BYTES:
            raise HTTPException(413, "План не должен превышать 10 МБ")
        content.extend(chunk)
    try:
        return preview_plan_document(file_name, bytes(content))
    except (ValueError, UnicodeError, KeyError, BadZipFile, PdfReadError) as error:
        raise HTTPException(422, str(error) or "Cannot read the document") from error


@router.post("/import/confirm", response_model=TaskPlanResponse, status_code=201)
async def post_import_confirm(
    payload: TaskPlanImportConfirm, user: User, connection: Connection,
) -> TaskPlanResponse:
    try:
        return await confirm_import(connection, user, payload)
    except WorkspaceRepositoryError as error:
        raise HTTPException(error.status_code, error.detail) from error


@router.put("/{plan_id}", response_model=TaskPlanResponse)
async def put_plan(
    plan_id: UUID, payload: TaskPlanWrite, user: User, connection: Connection,
) -> TaskPlanResponse:
    try:
        return await update_plan(connection, user, plan_id, payload)
    except WorkspaceRepositoryError as error:
        raise HTTPException(error.status_code, error.detail) from error


@router.put("/{plan_id}/tasks/{task_id}", status_code=204)
async def put_plan_task(
    plan_id: UUID, task_id: UUID, user: User, connection: Connection,
) -> None:
    try:
        await change_link(connection, user, plan_id, task_id, linked=True)
    except WorkspaceRepositoryError as error:
        raise HTTPException(error.status_code, error.detail) from error


@router.delete("/{plan_id}/tasks/{task_id}", status_code=204)
async def delete_plan_task(
    plan_id: UUID, task_id: UUID, user: User, connection: Connection,
) -> None:
    try:
        await change_link(connection, user, plan_id, task_id, linked=False)
    except WorkspaceRepositoryError as error:
        raise HTTPException(error.status_code, error.detail) from error
