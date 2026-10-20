"""Personal Gmail routes: every object is owner-only, including for administrators."""

from collections.abc import AsyncIterator
from typing import Annotated
from urllib.parse import quote
from uuid import UUID

from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, Response, UploadFile
from fastapi.responses import PlainTextResponse
from fastapi.security import HTTPAuthorizationCredentials
from sqlalchemy.ext.asyncio import AsyncConnection, AsyncEngine

from .. import mail_connection_service as connections
from .. import mail_delivery, mail_service, mail_task_service
from ..auth import AuthenticatedUser, bearer, require_user
from ..errors import WorkspaceRepositoryError
from ..gmail_client import GmailClient
from ..mail_schemas import (
    MailAddProviderFile,
    MailAddSignedFile,
    MailConnect,
    MailConnection,
    MailConnectStatus,
    MailDraft,
    MailDraftSummary,
    MailDraftWrite,
    MailPage,
    MailSearch,
    MailSend,
    MailSignedFile,
    MailTaskExport,
    MailThread,
)
from ..object_storage import ObjectStorageError
from ..settings import Settings
from ..workspace_schemas import TaskResponse

router = APIRouter(prefix="/mail", tags=["personal-mail"])


async def mail_connection(request: Request) -> AsyncIterator[AsyncConnection]:
    # OAuth and send claims deliberately commit before external calls. A plain
    # connection supports multiple explicit transactions without an engine.begin context.
    engine: AsyncEngine = request.app.state.database_engine
    async with engine.connect() as connection:
        try:
            yield connection
            await connection.commit()
        except WorkspaceRepositoryError as error:
            await connection.rollback()
            raise HTTPException(error.status_code, error.detail) from error
        except ObjectStorageError as error:
            await connection.rollback()
            raise HTTPException(503, "Хранилище файлов временно недоступно") from error


Connection = Annotated[AsyncConnection, Depends(mail_connection)]


async def mail_user(
    request: Request,
    connection: Connection,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)],
) -> AuthenticatedUser:
    # Reuse ALL authentication/CSRF/module checks on the SAME database connection.
    return await require_user(request, credentials, connection)


User = Annotated[AuthenticatedUser, Depends(mail_user)]


def settings(request: Request) -> Settings:
    value: Settings = request.app.state.settings
    return value


def client(request: Request) -> GmailClient:
    value: GmailClient = request.app.state.gmail_client
    return value


def download(name: str, content: bytes) -> Response:
    return Response(
        content,
        media_type="application/octet-stream",
        headers={
            "Content-Disposition": f"attachment; filename*=UTF-8''{quote(name, safe='')}",
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
        },
    )


@router.get("/connection", response_model=MailConnection)
async def info(request: Request, user: User, connection: Connection) -> MailConnection:
    return await connections.connection_info(connection, user, settings(request))


@router.post("/connect", response_model=MailConnect)
async def connect(request: Request, user: User, connection: Connection) -> MailConnect:
    result = await connections.start_oauth(connection, user, settings(request), client(request))
    await connection.commit()
    return result


@router.get("/connect/{request_id}", response_model=MailConnectStatus)
async def connect_status(request_id: UUID, user: User, connection: Connection) -> MailConnectStatus:
    return await connections.oauth_status(connection, user, request_id)


@router.get("/oauth/callback", response_class=PlainTextResponse)
async def callback(request: Request, connection: Connection) -> PlainTextResponse:
    # The security middleware removes query secrets from scope BEFORE any dependency runs.
    params = request.state.mail_oauth_query
    try:
        await connections.complete_oauth(
            connection,
            settings(request),
            client(request),
            state=params.get("state", ""),
            code=params.get("code", ""),
            denied=bool(params.get("error")),
        )
        message, status = "Gmail подключён. Вернитесь в окно Yuksalish Workspace.", 200
    except (WorkspaceRepositoryError, HTTPException) as error:
        message, status = str(error.detail), error.status_code
    return PlainTextResponse(
        message,
        status_code=status,
        headers={
            "Cache-Control": "no-store",
            "Referrer-Policy": "no-referrer",
            "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
        },
    )


@router.post("/connect/{request_id}/cancel", status_code=204)
async def cancel_connect(request_id: UUID, user: User, connection: Connection) -> Response:
    await connections.cancel_oauth(connection, user, request_id)
    await connection.commit()
    return Response(status_code=204)


@router.post("/disconnect")
async def disconnect(request: Request, user: User, connection: Connection) -> dict[str, bool]:
    revoked = await connections.disconnect(connection, user, settings(request), client(request))
    return {"disconnected": True, "googleRevoked": revoked}


@router.post("/messages/search", response_model=MailPage)
async def messages(
    payload: MailSearch,
    request: Request,
    user: User,
    connection: Connection,
) -> MailPage:
    _, token = await connections.access_token(connection, user, settings(request), client(request))
    prefix = {
        "inbox": "in:inbox",
        "sent": "in:sent",
        "starred": "is:starred",
        "all": "-in:spam -in:trash",
    }[payload.folder]
    return await client(request).list_messages(
        token, f"{prefix} {payload.query}".strip(), payload.page
    )


@router.get("/threads/{thread_id}", response_model=MailThread)
async def thread(
    thread_id: str, request: Request, user: User, connection: Connection
) -> MailThread:
    _, token = await connections.access_token(connection, user, settings(request), client(request))
    return await client(request).thread(token, thread_id)


@router.get("/messages/{message_id}/files/{attachment_id}")
async def provider_file(
    message_id: str,
    attachment_id: str,
    request: Request,
    user: User,
    connection: Connection,
) -> Response:
    _, token = await connections.access_token(connection, user, settings(request), client(request))
    message = await client(request).message(token, message_id)
    file = next((item for item in message.attachments if item.id == attachment_id), None)
    if file is None:
        raise HTTPException(404, "Вложение этого письма не найдено")
    return download(
        file.file_name, await client(request).attachment(token, message_id, attachment_id)
    )


@router.get("/drafts", response_model=list[MailDraftSummary])
async def drafts(request: Request, user: User, connection: Connection) -> list[MailDraftSummary]:
    return await mail_service.list_drafts(connection, user, settings(request))


@router.get("/drafts/{draft_id}", response_model=MailDraft)
async def draft(draft_id: UUID, request: Request, user: User, connection: Connection) -> MailDraft:
    return await mail_service.get_draft(connection, user, settings(request), draft_id)


@router.post("/drafts", response_model=MailDraft)
async def save(
    payload: MailDraftWrite, request: Request, user: User, connection: Connection
) -> MailDraft:
    result = await mail_service.save_draft(
        connection, user, settings(request), client(request), payload
    )
    await connection.commit()
    return result


@router.post("/drafts/{draft_id}/files", response_model=MailDraft)
async def upload(
    draft_id: UUID,
    request: Request,
    user: User,
    connection: Connection,
    file: Annotated[UploadFile, File()],
    expected_revision: int = Query(ge=1),
) -> MailDraft:
    content = await file.read(mail_service.MAX_MAIL_BYTES + 1)
    result = await mail_service.add_file(
        connection,
        user,
        settings(request),
        draft_id,
        expected_revision,
        file.filename or "attachment",
        file.content_type or "application/octet-stream",
        content,
    )
    await connection.commit()
    return result


@router.delete("/drafts/{draft_id}/files/{file_id}", response_model=MailDraft)
async def remove_file(
    draft_id: UUID,
    file_id: UUID,
    request: Request,
    user: User,
    connection: Connection,
    expected_revision: int = Query(ge=1),
) -> MailDraft:
    result = await mail_service.remove_file(
        connection, user, settings(request), draft_id, file_id, expected_revision
    )
    await connection.commit()
    return result


@router.get("/files/{file_id}")
async def private_file(
    file_id: UUID, request: Request, user: User, connection: Connection
) -> Response:
    name, content = await mail_service.read_file(connection, user, settings(request), file_id)
    return download(name, content)


@router.post("/drafts/{draft_id}/provider-files", response_model=MailDraft)
async def copy_provider_file(
    draft_id: UUID,
    payload: MailAddProviderFile,
    request: Request,
    user: User,
    connection: Connection,
) -> MailDraft:
    await mail_service.draft_row(
        connection, user, draft_id, editable=True, expected=payload.expected_revision
    )
    _, token = await connections.access_token(connection, user, settings(request), client(request))
    message = await client(request).message(token, payload.message_id)
    file = next((item for item in message.attachments if item.id == payload.attachment_id), None)
    if file is None:
        raise HTTPException(404, "Вложение этого письма не найдено")
    content = await client(request).attachment(token, message.id, file.id)
    result = await mail_service.add_file(
        connection,
        user,
        settings(request),
        draft_id,
        payload.expected_revision,
        file.file_name,
        file.content_type,
        content,
    )
    await connection.commit()
    return result


@router.get("/signed-files", response_model=list[MailSignedFile])
async def signed_files(user: User, connection: Connection) -> list[MailSignedFile]:
    return await mail_service.signed_files(connection, user)


@router.post("/drafts/{draft_id}/signed-files", response_model=MailDraft)
async def attach_signed(
    draft_id: UUID,
    payload: MailAddSignedFile,
    request: Request,
    user: User,
    connection: Connection,
) -> MailDraft:
    result = await mail_service.add_signed_file(
        connection,
        user,
        settings(request),
        request.app.state.object_storage,
        draft_id,
        payload.file_id,
        payload.expected_revision,
    )
    await connection.commit()
    return result


@router.post("/drafts/{draft_id}/send", response_model=MailDraft)
async def send(
    draft_id: UUID, payload: MailSend, request: Request, user: User, connection: Connection
) -> MailDraft:
    result = await mail_delivery.queue_send(connection, user, settings(request), draft_id, payload)
    await connection.commit()
    return result


@router.post("/drafts/{draft_id}/reconcile", response_model=MailDraft)
async def reconcile(
    draft_id: UUID, request: Request, user: User, connection: Connection
) -> MailDraft:
    result = await mail_delivery.reconcile_send(
        connection, user, settings(request), client(request), draft_id
    )
    await connection.commit()
    return result


@router.post("/tasks", response_model=TaskResponse)
async def export_task(
    payload: MailTaskExport, request: Request, user: User, connection: Connection
) -> TaskResponse:
    result = await mail_task_service.export_task(
        connection,
        user,
        settings(request),
        client(request),
        request.app.state.object_storage,
        payload,
    )
    await request.app.state.event_bus.publish({"type": "task.created", "entityId": result.id})
    return result
