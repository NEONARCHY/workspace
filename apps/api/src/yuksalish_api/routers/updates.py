from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException, Request, Response
from fastapi.responses import FileResponse
from sqlalchemy.ext.asyncio import AsyncConnection

from yuksalish_api.auth import AuthenticatedUser, require_user
from yuksalish_api.database import get_connection
from yuksalish_api.errors import WorkspaceRepositoryError
from yuksalish_api.update_schemas import (
    DesktopReleaseResponse,
    DesktopUpdatePolicyResponse,
    MandatoryUpdateRequest,
)
from yuksalish_api.update_service import (
    latest_manifest,
    policy_snapshot,
    publish_release,
    release_path,
    set_mandatory,
    stage_release,
    staged_releases,
)

router = APIRouter(prefix="/updates", tags=["desktop updates"])
User = Annotated[AuthenticatedUser, Depends(require_user)]
Connection = Annotated[AsyncConnection, Depends(get_connection)]


def _translate(error: WorkspaceRepositoryError) -> HTTPException:
    return HTTPException(status_code=error.status_code, detail=error.detail)


@router.get("/policy", response_model=DesktopUpdatePolicyResponse)
async def get_policy(_user: User, connection: Connection) -> DesktopUpdatePolicyResponse:
    return await policy_snapshot(connection)


@router.get("/releases", response_model=list[DesktopReleaseResponse])
async def get_releases(user: User, connection: Connection) -> list[DesktopReleaseResponse]:
    try:
        return await staged_releases(connection, user)
    except WorkspaceRepositoryError as error:
        raise _translate(error) from error


@router.post("/releases", response_model=DesktopReleaseResponse, status_code=201)
async def upload_release(
    request: Request,
    user: User,
    connection: Connection,
    version: Annotated[str, Header(alias="X-Release-Version")],
) -> DesktopReleaseResponse:
    try:
        return await stage_release(connection, user, request, request.app.state.settings, version)
    except WorkspaceRepositoryError as error:
        raise _translate(error) from error


@router.post("/releases/{version}/publish", response_model=DesktopUpdatePolicyResponse)
async def publish_desktop_release(
    version: str, request: Request, user: User, connection: Connection,
) -> DesktopUpdatePolicyResponse:
    try:
        result = await publish_release(connection, user, request.app.state.settings, version)
    except WorkspaceRepositoryError as error:
        raise _translate(error) from error
    await request.app.state.event_bus.publish(
        {"type": "desktop_update.published", "version": version}
    )
    return result


@router.put("/mandatory", response_model=DesktopUpdatePolicyResponse)
async def change_mandatory_update(
    payload: MandatoryUpdateRequest, request: Request, user: User, connection: Connection,
) -> DesktopUpdatePolicyResponse:
    try:
        result = await set_mandatory(
            connection, user, request.app.state.settings, payload.mandatory,
        )
    except WorkspaceRepositoryError as error:
        raise _translate(error) from error
    await request.app.state.event_bus.publish({
        "type": "desktop_update.policy_changed", "mandatory": result.mandatory,
        "minimumVersion": result.minimum_version,
    })
    return result


@router.get("/feed/latest.yml")
async def update_feed(_user: User, connection: Connection) -> Response:
    try:
        return Response(
            content=latest_manifest(await policy_snapshot(connection)),
            media_type="application/x-yaml",
        )
    except WorkspaceRepositoryError as error:
        raise _translate(error) from error


@router.get("/feed/{file_name}")
async def download_release(
    file_name: str, request: Request, _user: User, connection: Connection,
) -> FileResponse:
    policy = await policy_snapshot(connection)
    release = policy.release
    if release is None or file_name != release.file_name:
        raise HTTPException(status_code=404, detail="Файл обновления не найден")
    path = release_path(request.app.state.settings, release.version)
    if not path.is_file():
        raise HTTPException(status_code=503, detail="Файл обновления временно недоступен")
    return FileResponse(path, media_type="application/octet-stream", filename=release.file_name)
