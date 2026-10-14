"""Private trip brief upload, drawn signature, and immutable document downloads."""

from typing import Annotated, Literal, cast
from urllib.parse import quote
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from sqlalchemy.ext.asyncio import AsyncConnection

from yuksalish_api.access_control import ensure_module_action
from yuksalish_api.auth import AuthenticatedUser, require_user
from yuksalish_api.database import get_connection
from yuksalish_api.errors import WorkspaceRepositoryError
from yuksalish_api.events import WorkspaceEventBus
from yuksalish_api.object_storage import ObjectStorage, ObjectStorageError
from yuksalish_api.repository import get_trip_request
from yuksalish_api.trip_document_service import (
    MAX_ATTACHMENT_BYTES,
    MAX_SIGNATURE_BYTES,
    put_attachment,
    put_employee_signature,
    read_document,
    remove_attachment,
)
from yuksalish_api.workspace_schemas import TripRequestResponse

router = APIRouter(prefix="/trip-requests", tags=["trip-documents"])
User = Annotated[AuthenticatedUser, Depends(require_user)]
Connection = Annotated[AsyncConnection, Depends(get_connection)]
PRIVATE = {"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"}


def _storage(request: Request) -> ObjectStorage:
    return cast(ObjectStorage, request.app.state.object_storage)


async def _body(request: Request, limit: int) -> bytes:
    content = bytearray()
    async for chunk in request.stream():
        if len(content) + len(chunk) > limit:
            raise HTTPException(413, "Файл превышает допустимый размер", headers=PRIVATE)
        content.extend(chunk)
    return bytes(content)


def _failure(error: WorkspaceRepositoryError | ObjectStorageError) -> HTTPException:
    if isinstance(error, ObjectStorageError):
        return HTTPException(503, "Хранилище документов недоступно", headers=PRIVATE)
    return HTTPException(error.status_code, error.detail, headers=PRIVATE)


async def _publish(request: Request, request_id: UUID) -> None:
    bus = cast(WorkspaceEventBus, request.app.state.event_bus)
    await bus.publish({"type": "trip.updated", "entityId": str(request_id)})


@router.put("/{request_id}/brief-attachment", response_model=TripRequestResponse)
async def upload_brief_attachment(
    request_id: UUID,
    request: Request,
    user: User,
    connection: Connection,
    file_name: str = Query(alias="fileName", min_length=1, max_length=240),
) -> TripRequestResponse:
    await ensure_module_action(connection, user, "trip_approvals", "edit")
    content = await _body(request, MAX_ATTACHMENT_BYTES)
    try:
        await put_attachment(connection, user, _storage(request), request_id, file_name, content)
        result = await get_trip_request(connection, user, request_id)
    except (WorkspaceRepositoryError, ObjectStorageError) as error:
        raise _failure(error) from error
    await _publish(request, request_id)
    return result


@router.delete("/{request_id}/brief-attachment", response_model=TripRequestResponse)
async def delete_brief_attachment(
    request_id: UUID, request: Request, user: User, connection: Connection,
) -> TripRequestResponse:
    await ensure_module_action(connection, user, "trip_approvals", "edit")
    try:
        await remove_attachment(connection, user, request_id)
        result = await get_trip_request(connection, user, request_id)
    except WorkspaceRepositoryError as error:
        raise _failure(error) from error
    await _publish(request, request_id)
    return result


@router.put("/{request_id}/signature", response_model=TripRequestResponse)
async def upload_employee_signature(
    request_id: UUID, request: Request, user: User, connection: Connection,
) -> TripRequestResponse:
    await ensure_module_action(connection, user, "trip_approvals", "edit")
    content = await _body(request, MAX_SIGNATURE_BYTES)
    try:
        await put_employee_signature(connection, user, _storage(request), request_id, content)
        result = await get_trip_request(connection, user, request_id)
    except (WorkspaceRepositoryError, ObjectStorageError) as error:
        raise _failure(error) from error
    await _publish(request, request_id)
    return result


@router.get("/{request_id}/documents/{kind}")
async def download_trip_document(
    request_id: UUID,
    kind: Literal["attachment", "brief", "order", "order-preview"],
    request: Request,
    user: User,
    connection: Connection,
) -> Response:
    await ensure_module_action(connection, user, "trip_approvals", "view")
    try:
        content, media_type, file_name = await read_document(
            connection, user, _storage(request), request_id, kind,
        )
    except (WorkspaceRepositoryError, ObjectStorageError) as error:
        raise _failure(error) from error
    return Response(content, media_type=media_type, headers={
        **PRIVATE,
        "Content-Disposition": f"attachment; filename*=UTF-8''{quote(file_name)}",
    })
