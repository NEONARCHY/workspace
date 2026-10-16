"""Private endpoints for leave applications, review, signatures and PDFs."""

from collections.abc import Callable, Coroutine
from typing import Annotated, Any, Literal, cast
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.routing import APIRoute
from sqlalchemy.ext.asyncio import AsyncConnection

from yuksalish_api.access_control import ensure_module_action
from yuksalish_api.auth import AuthenticatedUser, require_user
from yuksalish_api.database import get_connection
from yuksalish_api.leave_service import (
    LeaveError,
    create_leave,
    leave_context,
    read_leave_document,
    review_deputy,
    review_hr,
    revise_leave,
    save_deputy_signature,
    visible_leaves,
    withdraw_leave,
)
from yuksalish_api.object_storage import ObjectStorage, ObjectStorageError
from yuksalish_api.workspace_schemas import (
    LeaveContextResponse,
    LeaveDeputyDecisionRequest,
    LeaveHrDecisionRequest,
    LeaveRequestResponse,
    LeaveWriteRequest,
)

_PRIVATE = {"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"}


class LeavePrivateRoute(APIRoute):
    def get_route_handler(self) -> Callable[[Request], Coroutine[Any, Any, Response]]:
        handler = super().get_route_handler()

        async def guarded(request: Request) -> Response:
            try:
                response = await handler(request)
                response.headers.update(_PRIVATE)
                return response
            except RequestValidationError as error:
                raise HTTPException(
                    422,
                    "Проверьте обязательные поля и даты",
                    headers=_PRIVATE,
                ) from error
            except LeaveError as error:
                raise HTTPException(
                    error.status_code,
                    error.detail,
                    headers=_PRIVATE,
                ) from error
            except ObjectStorageError as error:
                raise HTTPException(
                    503,
                    "Хранилище документов временно недоступно",
                    headers=_PRIVATE,
                ) from error

        return guarded


router = APIRouter(prefix="/leave-requests", tags=["leave"], route_class=LeavePrivateRoute)
User = Annotated[AuthenticatedUser, Depends(require_user)]
Connection = Annotated[AsyncConnection, Depends(get_connection)]


def _storage(request: Request) -> ObjectStorage:
    return cast(ObjectStorage, request.app.state.object_storage)


@router.get("", response_model=list[LeaveRequestResponse])
async def get_leaves(user: User, connection: Connection) -> list[LeaveRequestResponse]:
    await ensure_module_action(connection, user, "leave_approvals", "view")
    return await visible_leaves(connection, user)


@router.get("/context", response_model=LeaveContextResponse)
async def get_leave_context(user: User, connection: Connection) -> LeaveContextResponse:
    await ensure_module_action(connection, user, "leave_approvals", "view")
    return await leave_context(connection, user)


@router.put("/signature", response_model=LeaveContextResponse)
async def put_deputy_signature(
    user: User,
    connection: Connection,
    request: Request,
) -> LeaveContextResponse:
    await ensure_module_action(connection, user, "leave_approvals", "view")
    content = bytearray()
    async for chunk in request.stream():
        if len(content) + len(chunk) > 1024 * 1024:
            raise HTTPException(413, "Подпись должна быть не больше 1 МиБ")
        content.extend(chunk)
    return await save_deputy_signature(connection, user, _storage(request), bytes(content))


@router.post("", response_model=LeaveRequestResponse, status_code=201)
async def post_leave(
    payload: LeaveWriteRequest,
    request: Request,
    user: User,
    connection: Connection,
) -> LeaveRequestResponse:
    await ensure_module_action(connection, user, "leave_approvals", "create")
    return await create_leave(connection, user, _storage(request), payload)


@router.patch("/{request_id}", response_model=LeaveRequestResponse)
async def patch_leave(
    request_id: UUID,
    payload: LeaveWriteRequest,
    request: Request,
    user: User,
    connection: Connection,
) -> LeaveRequestResponse:
    await ensure_module_action(connection, user, "leave_approvals", "edit")
    return await revise_leave(connection, user, _storage(request), request_id, payload)


@router.post("/{request_id}/hr-review", response_model=LeaveRequestResponse)
async def post_hr_review(
    request_id: UUID,
    payload: LeaveHrDecisionRequest,
    user: User,
    connection: Connection,
) -> LeaveRequestResponse:
    await ensure_module_action(connection, user, "leave_approvals", "approve")
    return await review_hr(connection, user, request_id, payload)


@router.post("/{request_id}/deputy-decision", response_model=LeaveRequestResponse)
async def post_deputy_decision(
    request_id: UUID,
    payload: LeaveDeputyDecisionRequest,
    request: Request,
    user: User,
    connection: Connection,
) -> LeaveRequestResponse:
    await ensure_module_action(connection, user, "leave_approvals", "approve")
    return await review_deputy(connection, user, _storage(request), request_id, payload)


@router.post("/{request_id}/withdraw", response_model=LeaveRequestResponse)
async def post_leave_withdraw(
    request_id: UUID,
    user: User,
    connection: Connection,
) -> LeaveRequestResponse:
    await ensure_module_action(connection, user, "leave_approvals", "edit")
    return await withdraw_leave(connection, user, request_id)


@router.get("/{request_id}/documents/{kind}")
async def get_leave_document(
    request_id: UUID,
    kind: Literal["application", "order-preview", "order"],
    request: Request,
    user: User,
    connection: Connection,
) -> Response:
    await ensure_module_action(connection, user, "leave_approvals", "view")
    content = await read_leave_document(connection, user, _storage(request), request_id, kind)
    return Response(
        content=content,
        media_type="application/pdf",
        headers={
            **_PRIVATE,
            "Content-Disposition": f'inline; filename="leave-{kind}.pdf"',
        },
    )
