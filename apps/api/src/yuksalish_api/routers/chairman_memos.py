"""Authenticated, private memorandum endpoints; all decisions are checked in the service."""

from collections.abc import Callable, Coroutine
from typing import Annotated, Any, cast
from uuid import UUID

from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    HTTPException,
    Query,
    Request,
    Response,
    UploadFile,
)
from fastapi.exceptions import RequestValidationError
from fastapi.routing import APIRoute
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncConnection

from ..auth import AuthenticatedUser, require_user
from ..chairman_memo_schemas import (
    MemoContext,
    MemoCreate,
    MemoDecision,
    MemoDetail,
    MemoRegistry,
    MemoRevision,
    MemoUpdate,
)
from ..chairman_memo_service import (
    PRIVATE,
    context,
    create,
    detail,
    registry,
    row,
    save,
    transition,
)
from ..chairman_memo_tables import memoranda
from ..database import get_connection
from ..errors import WorkspaceRepositoryError
from ..events import WorkspaceEventBus
from ..memo_processing_service import MAX_ORDER_BYTES, attach_order
from ..settings import Settings


class PrivateMemoRoute(APIRoute):
    def get_route_handler(self) -> Callable[[Request], Coroutine[Any, Any, Response]]:
        handler = super().get_route_handler()

        async def guarded(request: Request) -> Response:
            try:
                response = await handler(request)
                response.headers.update(PRIVATE)
                return response
            except WorkspaceRepositoryError as error:
                raise HTTPException(error.status_code, error.detail, headers=PRIVATE) from error
            except RequestValidationError as error:
                raise HTTPException(422, "Проверьте поля билдирги", headers=PRIVATE) from error
            except HTTPException as error:
                error.headers = {**(error.headers or {}), **PRIVATE}
                raise

        return guarded


router = APIRouter(
    prefix="/chairman-memos", tags=["chairman memoranda"], route_class=PrivateMemoRoute
)
User = Annotated[AuthenticatedUser, Depends(require_user)]
Connection = Annotated[AsyncConnection, Depends(get_connection)]


def additional_requesters(request: Request) -> frozenset[UUID]:
    settings = cast(Settings, request.app.state.settings)
    return frozenset(settings.chairman_memo_requester_ids)


Requesters = Annotated[frozenset[UUID], Depends(additional_requesters)]


async def committed(c: AsyncConnection, request: Request, memo_id: UUID) -> None:
    record = (
        await c.execute(
            select(
                memoranda.c.requester_user_id,
                memoranda.c.chair_user_id,
                memoranda.c.status,
                memoranda.c.hr_user_id,
                memoranda.c.accountant_user_id,
            ).where(memoranda.c.id == memo_id)
        )
    ).one()
    await c.commit()
    bus = cast(WorkspaceEventBus, request.app.state.event_bus)
    recipients = {record.requester_user_id}
    if record.status != "draft":
        recipients.add(record.chair_user_id)
    if record.hr_user_id:
        recipients.add(record.hr_user_id)
    if record.accountant_user_id and record.status in {"accountant_pending", "completed"}:
        recipients.add(record.accountant_user_id)
    for recipient in recipients:
        await bus.publish({"type": "notification.created"}, recipient_id=recipient)


@router.get("/context", response_model=MemoContext)
async def get_context(user: User, connection: Connection, requesters: Requesters) -> MemoContext:
    return await context(connection, user, requesters)


@router.get("", response_model=MemoRegistry)
async def get_registry(
    user: User, connection: Connection, offset: Annotated[int, Query(ge=0, le=100000)] = 0
) -> MemoRegistry:
    return await registry(connection, user, offset)


@router.get("/{memo_id}", response_model=MemoDetail)
async def get_memo(
    memo_id: UUID,
    user: User,
    connection: Connection,
    requesters: Requesters,
) -> MemoDetail:
    return await detail(connection, user, memo_id, requesters)


@router.get("/{memo_id}/pdf")
async def get_pdf(memo_id: UUID, user: User, connection: Connection) -> Response:
    record = await row(connection, user, memo_id)
    if record["pdf_content"] is None:
        raise HTTPException(409, "Для этой билдирги ещё не подготовлен PDF", headers=PRIVATE)
    return Response(
        bytes(record["pdf_content"]),
        media_type="application/pdf",
        headers={
            **PRIVATE,
            "Content-Disposition": f'inline; filename="bildirgi-{memo_id}.pdf"',
        },
    )


@router.post("", response_model=MemoDetail)
async def post_memo(
    value: MemoCreate,
    request: Request,
    user: User,
    connection: Connection,
    requesters: Requesters,
) -> MemoDetail:
    result = await create(connection, user, value, requesters)
    await committed(connection, request, UUID(result.id))
    return result


@router.put("/{memo_id}", response_model=MemoDetail)
async def put_memo(
    memo_id: UUID,
    value: MemoUpdate,
    request: Request,
    user: User,
    connection: Connection,
    requesters: Requesters,
) -> MemoDetail:
    result = await save(connection, user, memo_id, value, requesters)
    await committed(connection, request, memo_id)
    return result


@router.post("/{memo_id}/submit", response_model=MemoDetail)
async def submit_memo(
    memo_id: UUID,
    value: MemoRevision,
    request: Request,
    user: User,
    connection: Connection,
    requesters: Requesters,
) -> MemoDetail:
    result = await transition(connection, user, memo_id, value, "submit", requesters)
    await committed(connection, request, memo_id)
    return result


@router.post("/{memo_id}/decision", response_model=MemoDetail)
async def decide_memo(
    memo_id: UUID,
    value: MemoDecision,
    request: Request,
    user: User,
    connection: Connection,
    requesters: Requesters,
) -> MemoDetail:
    result = await transition(connection, user, memo_id, value, "decide", requesters)
    await committed(connection, request, memo_id)
    return result


@router.post("/{memo_id}/withdraw", response_model=MemoDetail)
async def withdraw_memo(
    memo_id: UUID,
    value: MemoRevision,
    request: Request,
    user: User,
    connection: Connection,
    requesters: Requesters,
) -> MemoDetail:
    result = await transition(connection, user, memo_id, value, "withdraw", requesters)
    await committed(connection, request, memo_id)
    return result


@router.post("/{memo_id}/start-processing", response_model=MemoDetail)
async def start_processing(
    memo_id: UUID,
    value: MemoRevision,
    request: Request,
    user: User,
    connection: Connection,
    requesters: Requesters,
) -> MemoDetail:
    result = await transition(connection, user, memo_id, value, "start_processing", requesters)
    await committed(connection, request, memo_id)
    return result


@router.post("/{memo_id}/hr-complete", response_model=MemoDetail)
async def hr_complete(
    memo_id: UUID,
    value: MemoRevision,
    request: Request,
    user: User,
    connection: Connection,
    requesters: Requesters,
) -> MemoDetail:
    result = await transition(connection, user, memo_id, value, "hr_complete", requesters)
    await committed(connection, request, memo_id)
    return result


@router.post("/{memo_id}/complete", response_model=MemoDetail)
async def complete_memo(
    memo_id: UUID,
    value: MemoRevision,
    request: Request,
    user: User,
    connection: Connection,
    requesters: Requesters,
) -> MemoDetail:
    result = await transition(connection, user, memo_id, value, "complete", requesters)
    await committed(connection, request, memo_id)
    return result


@router.post("/{memo_id}/order", response_model=MemoDetail)
async def upload_order(
    memo_id: UUID,
    request: Request,
    user: User,
    connection: Connection,
    requesters: Requesters,
    expected_revision: Annotated[int, Form(ge=1)],
    file: Annotated[UploadFile, File()],
) -> MemoDetail:
    try:
        content = await file.read(MAX_ORDER_BYTES + 1)
    finally:
        await file.close()
    result = await attach_order(
        connection,
        user,
        memo_id,
        MemoRevision(expected_revision=expected_revision),
        file.filename or "",
        content,
        requesters,
    )
    await committed(connection, request, memo_id)
    return result


@router.get("/{memo_id}/order")
async def order_pdf(memo_id: UUID, user: User, connection: Connection) -> Response:
    record = await row(connection, user, memo_id)
    if not record["order_content"]:
        raise HTTPException(404, "Приказ пока не прикреплён", headers=PRIVATE)
    return Response(
        bytes(record["order_content"]),
        media_type="application/pdf",
        headers={**PRIVATE, "Content-Disposition": f'inline; filename="order-{memo_id}.pdf"'},
    )
