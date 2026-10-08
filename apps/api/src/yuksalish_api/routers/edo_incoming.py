"""Workspace-facing incoming letters; EDO remains the source of truth."""

from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException, Path, Query, Request
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncConnection

from ..access_control import ensure_module_action
from ..auth import AuthenticatedUser, require_user
from ..database import get_connection
from ..edo_schemas import (
    EdoAssignWrite,
    EdoCompleteWrite,
    EdoIncomingDetail,
    EdoIncomingPage,
    EdoListStatus,
)
from ..edo_service import (
    EdoBridgeError,
    add_assignment,
    complete_letter,
    get_letter,
    list_letters,
    stream_attachment,
)
from ..tables import users

router = APIRouter(prefix="/incoming-letters", tags=["incoming-letters"])
User = Annotated[AuthenticatedUser, Depends(require_user)]
Connection = Annotated[AsyncConnection, Depends(get_connection)]
LetterId = Annotated[int, Path(gt=0)]


def _error(error: EdoBridgeError) -> HTTPException:
    return HTTPException(error.status_code, error.message)


@router.get("", response_model=EdoIncomingPage)
async def incoming_list(
    request: Request,
    user: User,
    connection: Connection,
    page: Annotated[int, Query(ge=1, le=10000)] = 1,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    q: Annotated[str, Query(max_length=100)] = "",
    status: EdoListStatus | None = None,
) -> EdoIncomingPage:
    await ensure_module_action(connection, user, "incoming_letters", "view")
    try:
        return await list_letters(
            request.app.state.settings, user.id, page=page, limit=limit,
            query=q.strip(), status=status,
        )
    except EdoBridgeError as error:
        raise _error(error) from error


@router.get("/{letter_id}", response_model=EdoIncomingDetail)
async def incoming_detail(
    letter_id: LetterId, request: Request, user: User, connection: Connection
) -> EdoIncomingDetail:
    await ensure_module_action(connection, user, "incoming_letters", "view")
    try:
        return await get_letter(request.app.state.settings, user.id, letter_id)
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
    try:
        chunks = await stream_attachment(
            request.app.state.settings, user.id, letter_id, attachment_id
        )
    except EdoBridgeError as error:
        raise _error(error) from error
    return StreamingResponse(
        chunks,
        media_type="application/octet-stream",
        headers={"Cache-Control": "no-store, private", "X-Content-Type-Options": "nosniff"},
    )


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
