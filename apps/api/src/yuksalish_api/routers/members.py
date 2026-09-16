from typing import Annotated

from fastapi import APIRouter, Depends, Request
from sqlalchemy.ext.asyncio import AsyncConnection

from yuksalish_api.auth import AuthenticatedUser, require_user
from yuksalish_api.database import get_connection
from yuksalish_api.members_schemas import MembersRegistryResponse
from yuksalish_api.members_service import load_members_registry

router = APIRouter(prefix="/members", tags=["members"])


@router.get("", response_model=MembersRegistryResponse)
async def get_members_registry(
    request: Request,
    current_user: Annotated[AuthenticatedUser, Depends(require_user)],
    connection: Annotated[AsyncConnection, Depends(get_connection)],
) -> MembersRegistryResponse:
    # Authentication plus the access middleware protect this endpoint. Keep explicit
    # dependencies here so a future refactor cannot accidentally make it public.
    _ = current_user, connection
    return await load_members_registry(request.app.state.settings)
