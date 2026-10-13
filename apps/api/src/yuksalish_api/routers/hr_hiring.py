"""Private hiring endpoints with bounded uploads and non-cacheable documents."""

import hashlib
from collections.abc import Callable, Coroutine
from typing import Annotated, Any, Literal, cast
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.routing import APIRoute
from sqlalchemy.ext.asyncio import AsyncConnection

from yuksalish_api.auth import AuthenticatedUser, require_user
from yuksalish_api.database import get_connection
from yuksalish_api.errors import WorkspaceRepositoryError
from yuksalish_api.hr_hiring_pdf import MAX_BYTES
from yuksalish_api.hr_hiring_schemas import (
    HiringAction,
    HiringDetail,
    HiringRegistry,
    HiringWrite,
    IdentityRecognition,
)
from yuksalish_api.hr_hiring_service import (
    act_case,
    detail,
    read_document,
    registry,
    require_case,
    require_hr,
    route,
    save_case,
    save_signature,
    upload_document,
)
from yuksalish_api.hr_identity import MAX_ID_BYTES, recognise_identity
from yuksalish_api.object_storage import ObjectStorage, ObjectStorageError

PRIVATE = {"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"}


class PrivateRoute(APIRoute):
    def get_route_handler(self) -> Callable[[Request], Coroutine[Any, Any, Response]]:
        handler = super().get_route_handler()

        async def guarded(request: Request) -> Response:
            try:
                response = await handler(request)
                response.headers.update(PRIVATE)
                return response
            except RequestValidationError as error:
                # Default FastAPI errors echo submitted values, including passport and PINFL.
                raise HTTPException(
                    422, "Проверьте обязательные поля, даты и условия договора", headers=PRIVATE
                ) from error
            except WorkspaceRepositoryError as error:
                raise HTTPException(error.status_code, error.detail, headers=PRIVATE) from error
            except ValueError as error:
                raise HTTPException(
                    422, "Проверьте документ, формат и место подписи", headers=PRIVATE
                ) from error
            except ObjectStorageError as error:
                raise HTTPException(
                    503, "Хранилище документов временно недоступно", headers=PRIVATE
                ) from error

        return guarded


router = APIRouter(prefix="/hr/hiring", tags=["hr-hiring"], route_class=PrivateRoute)
User = Annotated[AuthenticatedUser, Depends(require_user)]
Connection = Annotated[AsyncConnection, Depends(get_connection)]


def storage(request: Request) -> ObjectStorage:
    return cast(ObjectStorage, request.app.state.object_storage)


async def bounded_body(request: Request, limit: int) -> bytes:
    value = bytearray()
    async for chunk in request.stream():
        if len(value) + len(chunk) > limit:
            raise HTTPException(413, "Файл превышает допустимый размер", headers=PRIVATE)
        value.extend(chunk)
    return bytes(value)


@router.get("", response_model=HiringRegistry)
async def get_registry(
    user: User, connection: Connection, offset: int = Query(default=0, ge=0)
) -> HiringRegistry:
    return await registry(connection, user, offset)


@router.put("/signature", status_code=204)
async def put_signature(user: User, connection: Connection, request: Request) -> Response:
    settings = await route(connection)
    if user.id != settings["chair_user_id"]:
        raise HTTPException(403, "Только председатель может настроить свою подпись")
    await save_signature(
        connection, user, storage(request), await bounded_body(request, 1024 * 1024)
    )
    return Response(status_code=204)


@router.post("/identity-card/recognize", response_model=IdentityRecognition)
async def recognise_card(
    user: User,
    connection: Connection,
    request: Request,
    rotation: int = Query(default=0),
) -> IdentityRecognition:
    await require_hr(connection, user)
    if rotation not in (0, 90, 180, 270):
        raise HTTPException(
            422, "Поворот фото должен быть 0, 90, 180 или 270 градусов", headers=PRIVATE
        )
    return await recognise_identity(
        await bounded_body(request, MAX_ID_BYTES),
        request.app.state.settings.hr_identity_ocr_executable,
        rotation,
    )


@router.get("/{case_id}", response_model=HiringDetail)
async def get_case(case_id: UUID, user: User, connection: Connection) -> HiringDetail:
    row, settings = await require_case(connection, user, case_id)
    return detail(row, user, settings)


@router.put("/{case_id}", response_model=HiringDetail)
async def put_case(
    case_id: UUID, payload: HiringWrite, user: User, connection: Connection
) -> HiringDetail:
    return await save_case(connection, user, case_id, payload)


@router.put("/{case_id}/documents/{kind}", response_model=HiringDetail)
async def put_document(
    case_id: UUID,
    kind: Literal["application", "employee-scan"],
    user: User,
    connection: Connection,
    request: Request,
    expected_revision: int = Query(alias="expectedRevision", ge=1),
) -> HiringDetail:
    await require_hr(connection, user)
    await require_case(connection, user, case_id)
    content = await bounded_body(request, MAX_BYTES)
    return await upload_document(
        connection,
        user,
        storage(request),
        case_id,
        expected_revision,
        kind,
        content,
        hashlib.sha256(content).hexdigest(),
    )


@router.post("/{case_id}/actions", response_model=HiringDetail)
async def post_action(
    case_id: UUID, payload: HiringAction, user: User, connection: Connection, request: Request
) -> HiringDetail:
    return await act_case(connection, user, storage(request), case_id, payload)


@router.get("/{case_id}/documents/{kind}")
async def get_document(
    case_id: UUID,
    kind: Literal[
        "contract", "order", "application", "application-placement", "employee-scan", "packet"
    ],
    user: User,
    connection: Connection,
    request: Request,
) -> Response:
    content, mime = await read_document(connection, user, storage(request), case_id, kind)
    extension = "zip" if kind == "packet" else "pdf"
    return Response(
        content,
        media_type=mime,
        headers={
            **PRIVATE,
            "Content-Disposition": f'attachment; filename="{kind}.{extension}"',
        },
    )
