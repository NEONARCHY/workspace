"""Incoming documents stored in Workspace, independent of the legacy EDO server."""

import asyncio
from typing import Annotated, cast
from urllib.parse import quote
from uuid import UUID
from zipfile import BadZipFile

from defusedxml.common import DefusedXmlException
from defusedxml.ElementTree import ParseError
from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from sqlalchemy.ext.asyncio import AsyncConnection

from ..auth import AuthenticatedUser, require_user
from ..database import get_connection
from ..file_preview import preview_office
from ..incoming_document_schemas import (
    IncomingDocumentAssign,
    IncomingDocumentDetail,
    IncomingDocumentPage,
)
from ..incoming_document_service import (
    DocumentFilter,
    assign_document,
    get_document,
    list_documents,
    read_document_file,
)
from ..object_storage import ObjectStorage, ObjectStorageError
from ..office_pdf_preview import render_word_pdf

router = APIRouter(prefix="/incoming-documents", tags=["incoming-documents"])
User = Annotated[AuthenticatedUser, Depends(require_user)]
Connection = Annotated[AsyncConnection, Depends(get_connection)]
_preview_slots = asyncio.Semaphore(2)


def _storage(request: Request) -> ObjectStorage:
    return cast(ObjectStorage, request.app.state.object_storage)


@router.get("", response_model=IncomingDocumentPage)
async def registry(
    user: User, connection: Connection, response: Response,
    q: Annotated[str, Query(max_length=160)] = "",
    category: DocumentFilter = "all",
    offset: Annotated[int, Query(ge=0, le=1_000_000)] = 0,
    limit: Annotated[int, Query(ge=1, le=100)] = 30,
) -> IncomingDocumentPage:
    response.headers["Cache-Control"] = "private, no-store"
    return await list_documents(connection, user, query=q, category=category,
                                offset=offset, limit=limit)


@router.get("/{source_id}", response_model=IncomingDocumentDetail)
async def detail(
    source_id: UUID, user: User, connection: Connection, response: Response,
) -> IncomingDocumentDetail:
    response.headers["Cache-Control"] = "private, no-store"
    return await get_document(connection, user, source_id)


@router.post("/{source_id}/execution", response_model=IncomingDocumentDetail)
async def assign(
    source_id: UUID, payload: IncomingDocumentAssign, request: Request,
    user: User, connection: Connection, response: Response,
) -> IncomingDocumentDetail:
    response.headers["Cache-Control"] = "private, no-store"
    result = await assign_document(connection, user, _storage(request), source_id, payload)
    if result.document.execution:
        await request.app.state.event_bus.publish({
            "type": "task.created", "entityId": str(result.document.execution.task_id),
        })
    return result


@router.get("/{source_id}/files/{file_id}")
async def download(
    source_id: UUID, file_id: UUID, request: Request, user: User, connection: Connection,
) -> Response:
    try:
        row, content = await read_document_file(
            connection, user, _storage(request), source_id, file_id,
        )
    except ObjectStorageError as error:
        raise HTTPException(503, "Хранилище документов временно недоступно.") from error
    return Response(content, media_type=row["content_type"], headers={
        "Content-Disposition": "attachment; filename*=UTF-8''"
        + quote(str(row["relative_path"]).split("/")[-1]),
        "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
    })


@router.get("/{source_id}/files/{file_id}/preview", response_model=None)
async def preview(
    source_id: UUID, file_id: UUID, request: Request, user: User, connection: Connection,
    sheet: Annotated[int, Query(ge=0, le=1000)] = 0,
    offset: Annotated[int, Query(ge=0, le=100_000)] = 0,
) -> object:
    try:
        async with _preview_slots:
            row, content = await read_document_file(
                connection, user, _storage(request), source_id, file_id,
                max_bytes=25 * 1024 * 1024,
            )
            name = str(row["relative_path"])
            if name.lower().endswith((".doc", ".docx")):
                return await render_word_pdf(request.app.state.settings, name, content)
            return await asyncio.to_thread(preview_office, name, content, sheet, offset)
    except ObjectStorageError as error:
        raise HTTPException(503, "Хранилище документов временно недоступно.") from error
    except (ValueError, BadZipFile, ParseError, DefusedXmlException, KeyError) as error:
        raise HTTPException(422, "Документ недоступен для просмотра. Скачайте оригинал.") from error
