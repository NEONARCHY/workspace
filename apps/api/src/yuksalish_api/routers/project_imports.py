"""Authenticated private project document import and source downloads."""

from typing import Annotated, cast
from urllib.parse import quote
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncConnection

from yuksalish_api.access_control import ensure_module_action
from yuksalish_api.auth import AuthenticatedUser, require_user
from yuksalish_api.database import get_connection
from yuksalish_api.object_storage import ObjectStorage, ObjectStorageError
from yuksalish_api.project_hub_service import _require_project
from yuksalish_api.project_import_documents import MAX_FILE_BYTES
from yuksalish_api.project_import_schemas import (
    ImportAnalyze,
    ImportPublish,
    ImportResponse,
    ImportReview,
)
from yuksalish_api.project_import_service import (
    add_document,
    create_import,
    documents,
    list_imports,
    publish_import,
    queue_analysis,
    require_editor,
    require_import,
    response,
    save_review,
)
from yuksalish_api.repository import WorkspaceRepositoryError
from yuksalish_api.routers.messenger import changed
from yuksalish_api.tables import project_document_imports

router = APIRouter(prefix="/project-imports", tags=["project-imports"])
User = Annotated[AuthenticatedUser, Depends(require_user)]
Connection = Annotated[AsyncConnection, Depends(get_connection)]


@router.get("", response_model=list[ImportResponse])
async def get_imports(
    user: User, connection: Connection,
    project_id: Annotated[UUID | None, Query(alias="projectId")] = None,
) -> list[ImportResponse]:
    try:
        if project_id:
            await ensure_module_action(connection, user, "project_hub", "view")
            await _require_project(connection, user, project_id)
            rows = (await connection.execute(select(project_document_imports).where(
                project_document_imports.c.project_id == project_id,
            ))).mappings().all()
            # require_import also checks module permission for every result.
            return [response(await require_import(connection, user, row["id"])) for row in rows]
        return await list_imports(connection, user)
    except WorkspaceRepositoryError as error:
        raise HTTPException(error.status_code, error.detail) from error


@router.post("", response_model=ImportResponse, status_code=201)
async def post_import(user: User, connection: Connection) -> ImportResponse:
    try:
        return await create_import(connection, user)
    except WorkspaceRepositoryError as error:
        raise HTTPException(error.status_code, error.detail) from error


@router.get("/{import_id}", response_model=ImportResponse)
async def get_import(import_id: UUID, user: User, connection: Connection) -> ImportResponse:
    try:
        return response(await require_import(connection, user, import_id))
    except WorkspaceRepositoryError as error:
        raise HTTPException(error.status_code, error.detail) from error


@router.put("/{import_id}/documents", response_model=ImportResponse)
async def put_document(
    import_id: UUID, user: User, connection: Connection, request: Request,
    file_name: str = Query(alias="fileName", min_length=1, max_length=240),
    expected_revision: int = Query(alias="expectedRevision", ge=1),
) -> ImportResponse:
    if any(ord(char) < 32 or char in "/\\" for char in file_name):
        raise HTTPException(422, "Use a plain document filename")
    try:
        # Authorize before reading or parsing a potentially large body.
        await require_editor(connection, user, import_id, expected_revision)
        body = bytearray()
        async for chunk in request.stream():
            if len(body) + len(chunk) > MAX_FILE_BYTES:
                raise HTTPException(413, "Document exceeds 25 MiB")
            body.extend(chunk)
        return await add_document(
            connection, user, import_id, expected_revision, file_name, bytes(body),
            cast(ObjectStorage, request.app.state.object_storage),
        )
    except WorkspaceRepositoryError as error:
        raise HTTPException(error.status_code, error.detail) from error
    except ObjectStorageError as error:
        raise HTTPException(503, "Document storage is unavailable") from error


@router.post("/{import_id}/analyze", response_model=ImportResponse)
async def post_analysis(
    import_id: UUID, payload: ImportAnalyze, user: User, connection: Connection, request: Request,
) -> ImportResponse:
    if not request.app.state.settings.gemini_api_key.get_secret_value():
        raise HTTPException(503, "Project analysis is not configured by the administrator")
    try:
        return await queue_analysis(connection, user, import_id, payload.expected_revision)
    except WorkspaceRepositoryError as error:
        raise HTTPException(error.status_code, error.detail) from error


@router.put("/{import_id}/review", response_model=ImportResponse)
async def put_review(
    import_id: UUID, payload: ImportReview, user: User, connection: Connection,
) -> ImportResponse:
    try:
        return await save_review(connection, user, import_id, payload)
    except WorkspaceRepositoryError as error:
        raise HTTPException(error.status_code, error.detail) from error


@router.post("/{import_id}/publish", response_model=ImportResponse)
async def post_publish(
    import_id: UUID, payload: ImportPublish, user: User, connection: Connection, request: Request,
) -> ImportResponse:
    try:
        result = await publish_import(connection, user, import_id, payload)
        await changed(connection, request)
        return result
    except WorkspaceRepositoryError as error:
        raise HTTPException(error.status_code, error.detail) from error


@router.get("/{import_id}/documents/{document_id}")
async def get_document(
    import_id: UUID, document_id: UUID, user: User, connection: Connection, request: Request,
) -> Response:
    try:
        row = await require_import(connection, user, import_id)
        document = next((value for value in documents(row) if value.id == str(document_id)), None)
        if document is None:
            raise HTTPException(404, "Document was not found")
        storage = cast(ObjectStorage, request.app.state.object_storage)
        content = await storage.get(document.storage_key)
        return Response(content, media_type=document.mime_type, headers={
            "Content-Disposition": f"attachment; filename*=UTF-8''{quote(document.name, safe='')}",
            "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
        })
    except WorkspaceRepositoryError as error:
        raise HTTPException(error.status_code, error.detail) from error
    except ObjectStorageError as error:
        raise HTTPException(503, "Document storage is unavailable") from error
