"""Workspace-facing incoming letters; EDO remains the source of truth."""

import asyncio
from contextlib import aclosing
from typing import Annotated
from uuid import UUID
from zipfile import BadZipFile

from defusedxml.common import DefusedXmlException
from defusedxml.ElementTree import ParseError
from fastapi import APIRouter, Depends, Header, HTTPException, Path, Query, Request, Response
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncConnection

from ..access_control import ensure_module_action
from ..auth import AuthenticatedUser, require_user
from ..database import get_connection
from ..edo_access import read_access, resolve_read_scope, save_access
from ..edo_employee_schemas import EmployeeSyncStatus
from ..edo_employee_sync import employee_sync_status, retry_employee_sync
from ..edo_schemas import (
    EdoAccessConfiguration,
    EdoAccessRule,
    EdoAccessUpdate,
    EdoAssignWrite,
    EdoCompleteWrite,
    EdoIncomingDetail,
    EdoIncomingPage,
    EdoListStatus,
)
from ..edo_scope import EdoReadScope
from ..edo_service import (
    EdoBridgeError,
    add_assignment,
    complete_letter,
    get_letter,
    list_letters,
    stream_attachment,
)
from ..file_preview import OfficePreview, preview_office
from ..tables import users

router = APIRouter(prefix="/incoming-letters", tags=["incoming-letters"])
User = Annotated[AuthenticatedUser, Depends(require_user)]
Connection = Annotated[AsyncConnection, Depends(get_connection)]
LetterId = Annotated[int, Path(gt=0)]
_preview_slots = asyncio.Semaphore(2)
MAX_PREVIEW_BYTES = 25 * 1024 * 1024


def _error(error: EdoBridgeError) -> HTTPException:
    return HTTPException(error.status_code, error.message)


@router.get("/access", response_model=EdoAccessConfiguration)
async def get_access(
    user: User, connection: Connection, response: Response,
) -> EdoAccessConfiguration:
    response.headers["Cache-Control"] = "no-store, private"
    return await read_access(connection, user)


@router.put("/access/{user_id}", response_model=EdoAccessRule)
async def put_access(
    user_id: UUID, payload: EdoAccessUpdate, user: User, connection: Connection,
) -> EdoAccessRule:
    return await save_access(connection, user, user_id, payload)


@router.get("/employee-sync", response_model=EmployeeSyncStatus)
async def get_employee_sync(
    request: Request,
    user: User,
    connection: Connection,
    response: Response,
) -> EmployeeSyncStatus:
    response.headers["Cache-Control"] = "no-store, private"
    return await employee_sync_status(connection, user, request.app.state.settings)


@router.post("/employee-sync/{user_id}/retry", status_code=204)
async def retry_employee(
    user_id: UUID,
    user: User,
    connection: Connection,
) -> None:
    await retry_employee_sync(connection, user, user_id)


@router.get("", response_model=EdoIncomingPage)
async def incoming_list(
    request: Request,
    response: Response,
    user: User,
    connection: Connection,
    page: Annotated[int, Query(ge=1, le=10000)] = 1,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    q: Annotated[str, Query(max_length=100)] = "",
    status: EdoListStatus | None = None,
    personal: bool = False,
) -> EdoIncomingPage:
    await ensure_module_action(connection, user, "incoming_letters", "view")
    response.headers["Cache-Control"] = "no-store, private"
    scope = EdoReadScope() if personal else await resolve_read_scope(connection, user)
    try:
        return await list_letters(
            request.app.state.settings, user.id, page=page, limit=limit,
            query=q.strip(), status=status, read_scope=scope,
        )
    except EdoBridgeError as error:
        raise _error(error) from error


@router.get("/{letter_id}", response_model=EdoIncomingDetail)
async def incoming_detail(
    letter_id: LetterId, request: Request, response: Response, user: User, connection: Connection
) -> EdoIncomingDetail:
    await ensure_module_action(connection, user, "incoming_letters", "view")
    response.headers["Cache-Control"] = "no-store, private"
    scope = await resolve_read_scope(connection, user)
    try:
        return await get_letter(request.app.state.settings, user.id, letter_id, read_scope=scope)
    except EdoBridgeError as error:
        raise _error(error) from error


@router.get("/{letter_id}/attachments/{attachment_id}")
async def incoming_attachment(
    letter_id: LetterId,
    attachment_id: str,
    request: Request,
    user: User,
    connection: Connection,
) -> StreamingResponse:
    await ensure_module_action(connection, user, "incoming_letters", "view")
    scope = await resolve_read_scope(connection, user)
    try:
        chunks = await stream_attachment(
            request.app.state.settings, user.id, letter_id, attachment_id, read_scope=scope
        )
    except EdoBridgeError as error:
        raise _error(error) from error
    return StreamingResponse(
        chunks,
        media_type="application/octet-stream",
        headers={"Cache-Control": "no-store, private", "X-Content-Type-Options": "nosniff"},
    )


@router.get("/{letter_id}/attachments/{attachment_id}/preview", response_model=OfficePreview)
async def incoming_office_preview(
    letter_id: LetterId,
    attachment_id: str,
    request: Request,
    response: Response,
    user: User,
    connection: Connection,
    sheet: Annotated[int, Query(ge=0, le=1000)] = 0,
    offset: Annotated[int, Query(ge=0, le=150000)] = 0,
) -> OfficePreview:
    await ensure_module_action(connection, user, "incoming_letters", "view")
    scope = await resolve_read_scope(connection, user)
    response.headers["Cache-Control"] = "no-store, private"
    try:
        async with _preview_slots:
            detail = await get_letter(
                request.app.state.settings, user.id, letter_id, read_scope=scope,
            )
            metadata = next(
                (item for item in detail.data.attachments if item.id == attachment_id), None,
            )
            if metadata is None:
                raise HTTPException(404, "Файл не найден.")
            if metadata.size > MAX_PREVIEW_BYTES:
                raise HTTPException(422, "Документ превышает 25 МБ. Скачайте оригинал.")
            stream = await stream_attachment(
                request.app.state.settings, user.id, letter_id, attachment_id, read_scope=scope,
            )
            content = bytearray()
            # Close the upstream stream even after limits or malformed content.
            async with aclosing(stream):
                async for chunk in stream:
                    if len(content) + len(chunk) > MAX_PREVIEW_BYTES:
                        raise HTTPException(422, "Документ превышает 25 МБ. Скачайте оригинал.")
                    content.extend(chunk)
            return await asyncio.to_thread(
                preview_office, metadata.name, bytes(content), sheet, offset,
            )
    except EdoBridgeError as error:
        raise _error(error) from error
    except (ValueError, BadZipFile, ParseError, DefusedXmlException, KeyError) as error:
        raise HTTPException(422, "Документ недоступен для просмотра. Скачайте оригинал.") from error


@router.post("/{letter_id}/assignments", response_model=EdoIncomingDetail)
async def incoming_assign(
    letter_id: LetterId,
    payload: EdoAssignWrite,
    request: Request,
    user: User,
    connection: Connection,
    idempotency_key: Annotated[str, Header(alias="Idempotency-Key")],
) -> EdoIncomingDetail:
    await ensure_module_action(connection, user, "incoming_letters", "edit")
    active_target = await connection.scalar(select(users.c.id).where(
        users.c.id == payload.employee_id, users.c.status == "active"
    ))
    if active_target is None:
        raise HTTPException(422, "Выберите действующего сотрудника Workspace.")
    try:
        return await add_assignment(
            request.app.state.settings, user.id, letter_id,
            target_employee_id=str(payload.employee_id),
            expected_version=payload.expected_version,
            key=idempotency_key,
        )
    except EdoBridgeError as error:
        raise _error(error) from error


@router.post("/{letter_id}/complete", response_model=EdoIncomingDetail)
async def incoming_complete(
    letter_id: LetterId,
    payload: EdoCompleteWrite,
    request: Request,
    user: User,
    connection: Connection,
    idempotency_key: Annotated[str, Header(alias="Idempotency-Key")],
) -> EdoIncomingDetail:
    await ensure_module_action(connection, user, "incoming_letters", "edit")
    try:
        return await complete_letter(
            request.app.state.settings, user.id, letter_id,
            body=payload.model_dump(exclude_unset=True), key=idempotency_key,
        )
    except EdoBridgeError as error:
        raise _error(error) from error
