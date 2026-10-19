"""Authenticated organization reference directory."""

from typing import Annotated, cast
from urllib.parse import quote
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncConnection

from yuksalish_api.access_control import ensure_module_action, module_permissions_for_user
from yuksalish_api.auth import AuthenticatedUser, require_user
from yuksalish_api.database import get_connection
from yuksalish_api.errors import WorkspaceRepositoryError
from yuksalish_api.file_preview import OfficePreview, preview_office
from yuksalish_api.object_storage import ObjectStorage, ObjectStorageError
from yuksalish_api.project_import_documents import MAX_FILE_BYTES
from yuksalish_api.reference_schemas import (
    ExpertFields,
    ExpertResponse,
    ExpertWrite,
    PartnerFields,
    PartnerResponse,
    PartnerWrite,
    ProfileResponse,
    ProfileWrite,
    ReferenceDirectoryResponse,
    TemplateFields,
    TemplateResponse,
    TemplateVersionResponse,
    TemplateWrite,
)
from yuksalish_api.reference_service import (
    create_expert,
    create_partner,
    create_template,
    get_template_version,
    load_directory,
    save_expert,
    save_partner,
    save_profile,
    save_template,
    upload_template_version,
)

router = APIRouter(prefix="/reference", tags=["reference directory"])
User = Annotated[AuthenticatedUser, Depends(require_user)]
Connection = Annotated[AsyncConnection, Depends(get_connection)]


def _http(error: WorkspaceRepositoryError) -> HTTPException:
    return HTTPException(error.status_code, error.detail)


@router.get("", response_model=ReferenceDirectoryResponse)
async def get_reference(user: User, connection: Connection) -> ReferenceDirectoryResponse:
    await ensure_module_action(connection, user, "reference", "view")
    permissions = await module_permissions_for_user(connection, user)
    return await load_directory(
        connection, include_drafts=permissions["reference"]["edit"],
    )


@router.put("/profile", response_model=ProfileResponse)
async def put_profile(
    payload: ProfileWrite, user: User, connection: Connection,
) -> ProfileResponse:
    await ensure_module_action(connection, user, "reference", "edit")
    try:
        return await save_profile(connection, user, payload)
    except WorkspaceRepositoryError as error:
        raise _http(error) from error


@router.post("/partners", response_model=PartnerResponse, status_code=201)
async def post_partner(
    payload: PartnerFields, user: User, connection: Connection,
) -> PartnerResponse:
    await ensure_module_action(connection, user, "reference", "create")
    try:
        return await create_partner(connection, user, payload)
    except WorkspaceRepositoryError as error:
        raise _http(error) from error
    except IntegrityError as error:
        raise HTTPException(409, "Такая организация уже есть в справочнике") from error


@router.put("/partners/{partner_id}", response_model=PartnerResponse)
async def put_partner(
    partner_id: UUID, payload: PartnerWrite, user: User, connection: Connection,
) -> PartnerResponse:
    await ensure_module_action(connection, user, "reference", "edit")
    try:
        return await save_partner(connection, user, partner_id, payload)
    except WorkspaceRepositoryError as error:
        raise _http(error) from error
    except IntegrityError as error:
        raise HTTPException(409, "Такая организация уже есть в справочнике") from error


@router.post("/experts", response_model=ExpertResponse, status_code=201)
async def post_expert(
    payload: ExpertFields, user: User, connection: Connection,
) -> ExpertResponse:
    await ensure_module_action(connection, user, "reference", "create")
    try:
        return await create_expert(connection, user, payload)
    except WorkspaceRepositoryError as error:
        raise _http(error) from error


@router.put("/experts/{expert_id}", response_model=ExpertResponse)
async def put_expert(
    expert_id: UUID, payload: ExpertWrite, user: User, connection: Connection,
) -> ExpertResponse:
    await ensure_module_action(connection, user, "reference", "edit")
    try:
        return await save_expert(connection, user, expert_id, payload)
    except WorkspaceRepositoryError as error:
        raise _http(error) from error


@router.post("/templates", response_model=TemplateResponse, status_code=201)
async def post_template(
    payload: TemplateFields, user: User, connection: Connection,
) -> TemplateResponse:
    await ensure_module_action(connection, user, "reference", "create")
    try:
        return await create_template(connection, user, payload)
    except WorkspaceRepositoryError as error:
        raise _http(error) from error


@router.put("/templates/{template_id}", response_model=TemplateResponse)
async def put_template(
    template_id: UUID, payload: TemplateWrite, user: User, connection: Connection,
) -> TemplateResponse:
    await ensure_module_action(connection, user, "reference", "edit")
    try:
        return await save_template(connection, user, template_id, payload)
    except WorkspaceRepositoryError as error:
        raise _http(error) from error


@router.put("/templates/{template_id}/file", response_model=TemplateVersionResponse)
async def put_template_file(
    template_id: UUID, request: Request, user: User, connection: Connection,
    file_name: str = Query(alias="fileName", min_length=1, max_length=240),
    expected_revision: int = Query(alias="expectedRevision", ge=1),
) -> TemplateVersionResponse:
    await ensure_module_action(connection, user, "reference", "edit")
    if any(ord(char) < 32 or char in "/\\" for char in file_name):
        raise HTTPException(422, "Используйте обычное имя файла")
    body = bytearray()
    async for chunk in request.stream():
        if len(body) + len(chunk) > MAX_FILE_BYTES:
            raise HTTPException(413, "Размер шаблона превышает 25 МиБ")
        body.extend(chunk)
    try:
        return await upload_template_version(
            connection, user, cast(ObjectStorage, request.app.state.object_storage),
            template_id, expected_revision, file_name, bytes(body),
        )
    except WorkspaceRepositoryError as error:
        raise _http(error) from error
    except ValueError as error:
        raise HTTPException(422, str(error)) from error
    except ObjectStorageError as error:
        raise HTTPException(503, "Хранилище файлов недоступно") from error


@router.get("/templates/{template_id}/file")
async def get_template_file(
    template_id: UUID, request: Request, user: User, connection: Connection,
    version_id: Annotated[UUID | None, Query(alias="versionId")] = None,
) -> Response:
    await ensure_module_action(connection, user, "reference", "view")
    try:
        version = await get_template_version(connection, template_id, version_id)
        content = await cast(ObjectStorage, request.app.state.object_storage).get(
            str(version["storage_key"])
        )
        return Response(content, media_type=str(version["content_type"]), headers={
            "Content-Disposition": "attachment; filename*=UTF-8''"
            + quote(str(version["file_name"]), safe=""),
            "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
        })
    except WorkspaceRepositoryError as error:
        raise _http(error) from error
    except ObjectStorageError as error:
        raise HTTPException(503, "Хранилище файлов недоступно") from error


@router.get("/templates/{template_id}/preview", response_model=OfficePreview)
async def get_template_preview(
    template_id: UUID, request: Request, user: User, connection: Connection,
    version_id: Annotated[UUID | None, Query(alias="versionId")] = None,
    sheet: int = Query(default=0, ge=0), offset: int = Query(default=0, ge=0),
) -> OfficePreview:
    await ensure_module_action(connection, user, "reference", "view")
    try:
        version = await get_template_version(connection, template_id, version_id)
        content = await cast(ObjectStorage, request.app.state.object_storage).get(
            str(version["storage_key"])
        )
        return preview_office(str(version["file_name"]), content, sheet, offset)
    except WorkspaceRepositoryError as error:
        raise _http(error) from error
    except (ValueError, KeyError) as error:
        raise HTTPException(422, "Предпросмотр этого файла недоступен") from error
    except ObjectStorageError as error:
        raise HTTPException(503, "Хранилище файлов недоступно") from error
