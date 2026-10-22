from typing import Annotated, cast
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import ValidationError
from sqlalchemy.ext.asyncio import AsyncConnection
from starlette.datastructures import UploadFile

from .. import grant_service
from ..access_control import ensure_module_action
from ..auth import AuthenticatedUser, require_user
from ..database import get_connection
from ..errors import WorkspaceRepositoryError
from ..events import WorkspaceEventBus
from ..grant_files_service import (
    MAX_INITIAL_FILE_BYTES,
    MAX_INITIAL_FILES,
    MAX_INITIAL_TOTAL_BYTES,
    GrantInitialFile,
    create_with_files,
)
from ..grant_schemas import (
    GrantAction,
    GrantCreate,
    GrantDetail,
    GrantEdit,
    GrantReviewersWrite,
    GrantSettings,
    GrantSettingsWrite,
    GrantSummary,
)
from ..object_storage import ObjectStorage, ObjectStorageError

router = APIRouter(prefix="/grants", tags=["grants"])
User = Annotated[AuthenticatedUser, Depends(require_user)]
Connection = Annotated[AsyncConnection, Depends(get_connection)]


async def _publish(request: Request, result: GrantDetail) -> None:
    bus: WorkspaceEventBus = request.app.state.event_bus
    for recipient in {
        result.initiator_user_id,
        result.author_user_id,
        result.assignee_id,
        result.leader_user_id,
        result.chair_user_id,
        *result.co_assignee_ids,
    }:
        if recipient is None:
            continue
        await bus.publish(
            {"type": "grant.updated", "entityId": result.id},
            recipient_id=UUID(recipient),
        )


@router.get("", response_model=list[GrantSummary])
async def list_grants(user: User, connection: Connection) -> list[GrantSummary]:
    return await grant_service.list_grants(connection, user)


@router.get("/settings", response_model=GrantSettings)
async def settings(user: User, connection: Connection) -> GrantSettings:
    return await grant_service.get_settings(connection, user)


@router.put("/settings", response_model=GrantSettings)
async def save_settings(
    payload: GrantSettingsWrite,
    user: User,
    connection: Connection,
) -> GrantSettings:
    try:
        result = await grant_service.save_settings(connection, user, payload)
    except WorkspaceRepositoryError as error:
        raise HTTPException(error.status_code, error.detail) from error
    await connection.commit()
    return result


@router.post("", response_model=GrantDetail, status_code=201)
async def create(
    payload: GrantCreate,
    user: User,
    connection: Connection,
    request: Request,
) -> GrantDetail:
    try:
        result = await grant_service.create_grant(connection, user, payload)
    except WorkspaceRepositoryError as error:
        raise HTTPException(error.status_code, error.detail) from error
    await connection.commit()
    await _publish(request, result)
    return result


@router.post("/with-files", response_model=GrantDetail, status_code=201)
async def create_with_source_files(
    request: Request, user: User, connection: Connection,
) -> GrantDetail:
    await ensure_module_action(connection, user, "grants", "create")
    # Browser FormData has a known length. Refuse unbounded/chunked bodies before parsing
    # so a multipart request cannot exhaust the server's temporary-file space.
    length_header = request.headers.get("content-length")
    if length_header is None or request.headers.get("transfer-encoding"):
        raise HTTPException(411, "Для отправки файлов требуется известный размер запроса")
    try:
        length = int(length_header)
    except ValueError as error:
        raise HTTPException(400, "Некорректный размер запроса") from error
    if length < 0 or length > MAX_INITIAL_TOTAL_BYTES + 1024 * 1024:
        raise HTTPException(413, "Общий размер файлов должен быть не больше 100 МБ")
    async with request.form(
        max_files=MAX_INITIAL_FILES, max_fields=1, max_part_size=512 * 1024,
    ) as form:
        raw_payload = form.get("payload")
        raw_files = form.getlist("files")
        if not isinstance(raw_payload, str) or not raw_files or any(
            not isinstance(item, UploadFile) for item in raw_files
        ) or any(key not in {"payload", "files"} for key in form):
            raise HTTPException(422, "Передайте описание заявки и выбранные файлы")
        try:
            payload = GrantCreate.model_validate_json(raw_payload)
        except ValidationError as error:
            raise HTTPException(422, "Проверьте поля заявки на грант") from error
        limit = min(request.app.state.settings.attachment_max_bytes, MAX_INITIAL_FILE_BYTES)
        files = []
        total = 0
        for raw_file in raw_files:
            upload = cast(UploadFile, raw_file)
            content = await upload.read(limit + 1)
            total += len(content)
            if len(content) > limit or total > MAX_INITIAL_TOTAL_BYTES:
                raise HTTPException(413, "Превышен допустимый размер файлов")
            files.append(GrantInitialFile(
                upload.filename or "", upload.content_type or "application/octet-stream", content,
            ))
        try:
            result = await create_with_files(
                connection, user, payload, cast(ObjectStorage, request.app.state.object_storage),
                files, max_file_bytes=limit,
            )
        except WorkspaceRepositoryError as error:
            raise HTTPException(error.status_code, error.detail) from error
        except ObjectStorageError as error:
            raise HTTPException(
                503, "Ошибка сохранения файлов. Повторите отправку заявки."
            ) from error
    await connection.commit()
    await _publish(request, result)
    return result


@router.get("/{grant_id}", response_model=GrantDetail)
async def detail(grant_id: UUID, user: User, connection: Connection) -> GrantDetail:
    try:
        return await grant_service.get_grant(connection, user, grant_id)
    except WorkspaceRepositoryError as error:
        raise HTTPException(error.status_code, error.detail) from error


@router.put("/{grant_id}", response_model=GrantDetail)
async def edit(
    grant_id: UUID,
    payload: GrantEdit,
    user: User,
    connection: Connection,
    request: Request,
) -> GrantDetail:
    try:
        result = await grant_service.edit_grant(connection, user, grant_id, payload)
    except WorkspaceRepositoryError as error:
        raise HTTPException(error.status_code, error.detail) from error
    await connection.commit()
    await _publish(request, result)
    return result


@router.post("/{grant_id}/actions", response_model=GrantDetail)
async def action(
    grant_id: UUID,
    payload: GrantAction,
    user: User,
    connection: Connection,
    request: Request,
) -> GrantDetail:
    try:
        result = await grant_service.act_on_grant(connection, user, grant_id, payload)
    except WorkspaceRepositoryError as error:
        raise HTTPException(error.status_code, error.detail) from error
    await connection.commit()
    await _publish(request, result)
    return result


@router.put("/{grant_id}/reviewers", response_model=GrantDetail)
async def reviewers(
    grant_id: UUID,
    payload: GrantReviewersWrite,
    user: User,
    connection: Connection,
    request: Request,
) -> GrantDetail:
    try:
        result = await grant_service.change_reviewers(connection, user, grant_id, payload)
    except WorkspaceRepositoryError as error:
        raise HTTPException(error.status_code, error.detail) from error
    await connection.commit()
    await _publish(request, result)
    return result
