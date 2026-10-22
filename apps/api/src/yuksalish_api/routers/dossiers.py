"""Personal HR area is authenticated independently of permission to browse HR payroll."""

from collections.abc import Awaitable
from typing import Annotated, TypeVar, cast
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from sqlalchemy.ext.asyncio import AsyncConnection

from .. import dossier_service as service
from ..auth import AuthenticatedUser, require_user
from ..database import get_connection
from ..dossier_documents import CONTENT_TYPE
from ..dossier_import import MAX_IMPORT_BYTES
from ..dossier_schemas import (
    DossierAccessSettings,
    DossierAccessWrite,
    DossierContext,
    DossierDetail,
    DossierHistory,
    DossierImportPreview,
    DossierPermissions,
    DossierSummary,
    DossierWrite,
    PhotoCard,
)
from ..errors import WorkspaceRepositoryError
from ..object_storage import ObjectStorage, ObjectStorageError
from ..office_pdf_preview import PRIVATE, render_word_pdf


def private_response(response: Response) -> None:
    response.headers["Cache-Control"] = "no-store"
    response.headers["Pragma"] = "no-cache"


router = APIRouter(prefix="/personnel-dossiers", tags=["hr-dossiers"],
                   dependencies=[Depends(private_response)])
User = Annotated[AuthenticatedUser, Depends(require_user)]
Connection = Annotated[AsyncConnection, Depends(get_connection)]
Result = TypeVar("Result")


async def _call(operation: Awaitable[Result]) -> Result:
    try:
        return await operation
    except WorkspaceRepositoryError as error:
        raise HTTPException(error.status_code, error.detail,
                            headers={"Cache-Control": "no-store"}) from error


@router.get("/context", response_model=DossierContext)
async def context(user: User, connection: Connection) -> DossierContext:
    return await _call(service.context(connection, user))


@router.get("", response_model=list[DossierSummary])
async def listing(user: User, connection: Connection) -> list[DossierSummary]:
    return await _call(service.listing(connection, user))


@router.get("/photos", response_model=list[PhotoCard])
async def photos(user: User, connection: Connection) -> list[PhotoCard]:
    return await _call(service.photos(connection, user))


@router.get("/access", response_model=DossierAccessSettings)
async def access(user: User, connection: Connection) -> DossierAccessSettings:
    return await _call(service.get_access(connection, user))


@router.put("/access", response_model=DossierAccessSettings)
async def save_access(
    payload: DossierAccessWrite, user: User, connection: Connection,
) -> DossierAccessSettings:
    return await _call(service.save_access(connection, user, payload))


@router.get("/{user_id}/permissions", response_model=DossierPermissions)
async def permissions(user_id: UUID, user: User, connection: Connection) -> DossierPermissions:
    return await _call(service.permissions(connection, user, user_id))


@router.get("/{user_id}/history", response_model=list[DossierHistory])
async def history(user_id: UUID, user: User, connection: Connection) -> list[DossierHistory]:
    return await _call(service.history(connection, user, user_id))


@router.get("/{user_id}/word")
async def export_word(
    user_id: UUID, revision: Annotated[int, Query(ge=1)], request: Request,
    user: User, connection: Connection,
) -> Response:
    try:
        content = await _call(service.export_word(
            connection, user, user_id, revision,
            cast(ObjectStorage, request.app.state.object_storage),
        ))
    except ObjectStorageError as error:
        raise HTTPException(503, "Фото профиля не загружено. Повторите скачивание.",
                            headers={"Cache-Control": "no-store"}) from error
    return Response(content, media_type=CONTENT_TYPE, headers={
        "Cache-Control": "private, no-store", "Pragma": "no-cache",
        "X-Content-Type-Options": "nosniff",
        "Content-Disposition": 'attachment; filename="personnel-dossier.docx"',
    })


@router.get("/{user_id}/pdf")
async def export_pdf(
    user_id: UUID, revision: Annotated[int, Query(ge=1)], request: Request,
    user: User, connection: Connection,
) -> Response:
    try:
        content = await _call(service.document_source(
            connection, user, user_id, revision,
            cast(ObjectStorage, request.app.state.object_storage),
        ))
    except ObjectStorageError as error:
        raise HTTPException(503, "Фото профиля не загружено. Повторите скачивание.",
                            headers=PRIVATE) from error
    response = await render_word_pdf(request.app.state.settings, "personnel-dossier.docx", content)
    await _call(service.record_export(connection, user, user_id, revision, "pdf"))
    response.headers["Content-Disposition"] = 'attachment; filename="personnel-dossier.pdf"'
    return response


@router.post("/{user_id}/import-preview", response_model=DossierImportPreview)
async def import_preview(
    user_id: UUID, request: Request, user: User, connection: Connection,
) -> DossierImportPreview:
    await _call(service.ensure_import_access(connection, user, user_id))
    content = bytearray()
    async for chunk in request.stream():
        if len(content) + len(chunk) > MAX_IMPORT_BYTES:
            raise HTTPException(413, "Выберите DOCX размером до 5 МБ", headers=PRIVATE)
        content.extend(chunk)
    return await _call(service.import_preview(connection, user, user_id, bytes(content)))


@router.get("/{user_id}", response_model=DossierDetail)
async def detail(user_id: UUID, user: User, connection: Connection) -> DossierDetail:
    return await _call(service.detail(connection, user, user_id))


@router.put("/{user_id}", response_model=DossierDetail)
async def save(
    user_id: UUID, payload: DossierWrite, user: User, connection: Connection,
) -> DossierDetail:
    return await _call(service.save(connection, user, user_id, payload))
