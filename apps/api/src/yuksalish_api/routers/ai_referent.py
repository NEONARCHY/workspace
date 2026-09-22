import hashlib
import secrets
from datetime import UTC, datetime
from io import BytesIO
from typing import Annotated, cast
from urllib.parse import quote
from uuid import UUID
from zipfile import BadZipFile, ZipFile

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request, Response
from sqlalchemy.ext.asyncio import AsyncConnection

from yuksalish_api.ai_referent_incoming_service import (
    latest_journal,
    load_incoming_letters,
    save_journal_metadata,
    sync_incoming_letters,
)
from yuksalish_api.ai_referent_schemas import (
    AIReferentActionRequest,
    AIReferentIncomingRegistryResponse,
    AIReferentIncomingSyncRequest,
    AIReferentIncomingSyncResponse,
    AIReferentJournalResponse,
    AIReferentLetterResponse,
    AIReferentRegistryResponse,
    AIReferentStatus,
    CreateAIReferentLetterRequest,
    UpdateAIReferentLetterRequest,
)
from yuksalish_api.ai_referent_service import (
    AIReferentServiceError,
    act_on_letter,
    create_letter,
    load_letter,
    load_letters,
    update_letter,
)
from yuksalish_api.auth import AuthenticatedUser, require_user
from yuksalish_api.database import get_connection
from yuksalish_api.object_storage import ObjectStorage, ObjectStorageError

router = APIRouter(prefix="/ai-referent", tags=["ai-referent"])


def _translate(error: AIReferentServiceError) -> HTTPException:
    return HTTPException(status_code=error.status_code, detail=error.detail)


def _storage(request: Request) -> ObjectStorage:
    return cast(ObjectStorage, request.app.state.object_storage)


async def require_agent_token(
    request: Request,
    supplied: Annotated[str | None, Header(alias="X-AI-Referent-Agent-Token")] = None,
) -> None:
    expected = request.app.state.settings.ai_referent_agent_token.get_secret_value()
    if not expected:
        raise HTTPException(status_code=503, detail="Синхронизация AI Referent не настроена.")
    if not supplied or not secrets.compare_digest(expected, supplied):
        raise HTTPException(status_code=401, detail="Недействительный ключ агента.")


@router.post(
    "/agent/incoming:sync",
    response_model=AIReferentIncomingSyncResponse,
    dependencies=[Depends(require_agent_token)],
)
async def post_incoming_sync(
    payload: AIReferentIncomingSyncRequest,
    connection: Annotated[AsyncConnection, Depends(get_connection)],
) -> AIReferentIncomingSyncResponse:
    return await sync_incoming_letters(connection, payload)


@router.put(
    "/agent/journal",
    response_model=AIReferentJournalResponse,
    dependencies=[Depends(require_agent_token)],
)
async def put_incoming_journal(
    request: Request,
    connection: Annotated[AsyncConnection, Depends(get_connection)],
    agent_id: Annotated[
        str,
        Query(alias="agentId", min_length=1, max_length=128, pattern=r"^[A-Za-z0-9_.-]+$"),
    ],
    agent_name: Annotated[
        str, Query(alias="agentName", min_length=1, max_length=200)
    ],
    file_name: Annotated[
        str, Query(alias="fileName", min_length=1, max_length=255)
    ] = "register.xlsx",
    updated_at: Annotated[datetime | None, Query(alias="updatedAt")] = None,
) -> AIReferentJournalResponse:
    clean_agent_name = agent_name.strip()
    clean_file_name = file_name.strip()
    if not clean_agent_name or not clean_file_name:
        raise HTTPException(status_code=422, detail="Имя агента и файла обязательны.")
    if not clean_file_name.lower().endswith(".xlsx"):
        raise HTTPException(status_code=415, detail="Ожидается Excel-журнал XLSX.")
    limit = request.app.state.settings.ai_referent_journal_max_bytes
    content = bytearray()
    async for chunk in request.stream():
        content.extend(chunk)
        if len(content) > limit:
            raise HTTPException(status_code=413, detail="Excel-журнал превышает допустимый размер.")
    try:
        with ZipFile(BytesIO(content)) as workbook:
            names = set(workbook.namelist())
    except BadZipFile as error:
        raise HTTPException(
            status_code=422,
            detail="Файл не является корректным XLSX-журналом.",
        ) from error
    if "[Content_Types].xml" not in names or "xl/workbook.xml" not in names:
        raise HTTPException(status_code=422, detail="Файл не является корректным XLSX-журналом.")
    stored_at = updated_at or datetime.now(UTC)
    if stored_at.tzinfo is None:
        stored_at = stored_at.replace(tzinfo=UTC)
    digest = hashlib.sha256(content).hexdigest()
    content_type = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    storage_key = f"ai-referent/journals/{agent_id}/register.xlsx"
    storage = _storage(request)
    try:
        await storage.put(storage_key, bytes(content), content_type)
        await save_journal_metadata(
            connection,
            agent_id=agent_id,
            agent_name=clean_agent_name,
            storage_key=storage_key,
            file_name=clean_file_name,
            content_type=content_type,
            byte_size=len(content),
            sha256=digest,
            updated_at=stored_at,
        )
    except ObjectStorageError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error
    return AIReferentJournalResponse(
        available=True,
        file_name=clean_file_name,
        byte_size=len(content),
        sha256=digest,
        updated_at=stored_at,
        agent_name=clean_agent_name,
    )


@router.get("/incoming", response_model=AIReferentIncomingRegistryResponse)
async def get_incoming_letters(
    current_user: Annotated[AuthenticatedUser, Depends(require_user)],
    connection: Annotated[AsyncConnection, Depends(get_connection)],
    query: Annotated[str, Query(max_length=200)] = "",
    status: Annotated[str | None, Query(max_length=64)] = None,
) -> AIReferentIncomingRegistryResponse:
    return await load_incoming_letters(connection, current_user, query=query, status=status)


@router.get("/journal/latest")
async def get_latest_journal(
    request: Request,
    current_user: Annotated[AuthenticatedUser, Depends(require_user)],
    connection: Annotated[AsyncConnection, Depends(get_connection)],
) -> Response:
    try:
        metadata = await latest_journal(connection, current_user)
        content = await _storage(request).get(metadata["journal_storage_key"])
    except LookupError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except ObjectStorageError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error
    file_name = metadata["journal_file_name"] or "register.xlsx"
    return Response(
        content=content,
        media_type=metadata["journal_content_type"] or "application/octet-stream",
        headers={
            "Content-Disposition": f"attachment; filename*=UTF-8''{quote(file_name)}",
            "X-Content-Type-Options": "nosniff",
        },
    )


@router.get("/letters", response_model=AIReferentRegistryResponse)
async def get_letters(
    current_user: Annotated[AuthenticatedUser, Depends(require_user)],
    connection: Annotated[AsyncConnection, Depends(get_connection)],
    query: Annotated[str, Query(max_length=200)] = "",
    status: AIReferentStatus | None = None,
) -> AIReferentRegistryResponse:
    return await load_letters(connection, current_user, query=query, status=status)


@router.get("/letters/{letter_id}", response_model=AIReferentLetterResponse)
async def get_letter(
    letter_id: UUID,
    current_user: Annotated[AuthenticatedUser, Depends(require_user)],
    connection: Annotated[AsyncConnection, Depends(get_connection)],
) -> AIReferentLetterResponse:
    try:
        return await load_letter(connection, current_user, letter_id)
    except AIReferentServiceError as error:
        raise _translate(error) from error


@router.post("/letters", response_model=AIReferentLetterResponse, status_code=201)
async def post_letter(
    request: Request,
    payload: CreateAIReferentLetterRequest,
    current_user: Annotated[AuthenticatedUser, Depends(require_user)],
    connection: Annotated[AsyncConnection, Depends(get_connection)],
) -> AIReferentLetterResponse:
    try:
        result = await create_letter(connection, current_user, payload)
    except AIReferentServiceError as error:
        raise _translate(error) from error
    await request.app.state.event_bus.publish(
        {"type": "ai_referent.created", "entityId": result.id}
    )
    return result


@router.patch("/letters/{letter_id}", response_model=AIReferentLetterResponse)
async def patch_letter(
    request: Request,
    letter_id: UUID,
    payload: UpdateAIReferentLetterRequest,
    current_user: Annotated[AuthenticatedUser, Depends(require_user)],
    connection: Annotated[AsyncConnection, Depends(get_connection)],
) -> AIReferentLetterResponse:
    try:
        result = await update_letter(connection, current_user, letter_id, payload)
    except AIReferentServiceError as error:
        raise _translate(error) from error
    await request.app.state.event_bus.publish(
        {"type": "ai_referent.updated", "entityId": result.id}
    )
    return result

@router.post("/letters/{letter_id}/actions", response_model=AIReferentLetterResponse)
async def post_letter_action(
    request: Request,
    letter_id: UUID,
    payload: AIReferentActionRequest,
    current_user: Annotated[AuthenticatedUser, Depends(require_user)],
    connection: Annotated[AsyncConnection, Depends(get_connection)],
) -> AIReferentLetterResponse:
    try:
        result = await act_on_letter(connection, current_user, letter_id, payload)
    except AIReferentServiceError as error:
        raise _translate(error) from error
    await request.app.state.event_bus.publish(
        {"type": "ai_referent.updated", "entityId": result.id}
    )
    return result
