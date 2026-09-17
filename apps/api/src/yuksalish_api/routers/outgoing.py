from typing import Annotated

from fastapi import APIRouter, Depends, Request
from sqlalchemy.ext.asyncio import AsyncConnection

from yuksalish_api.auth import AuthenticatedUser, require_user
from yuksalish_api.database import get_connection
from yuksalish_api.outgoing_schemas import OutgoingLettersRegistryResponse
from yuksalish_api.settings import Settings

router = APIRouter(prefix="/outgoing-letters", tags=["outgoing-letters"])


@router.get("", response_model=OutgoingLettersRegistryResponse)
async def get_outgoing_letters(
    request: Request,
    current_user: Annotated[AuthenticatedUser, Depends(require_user)],
    connection: Annotated[AsyncConnection, Depends(get_connection)],
) -> OutgoingLettersRegistryResponse:
    # Authentication plus the access middleware protect this endpoint. Keep the
    # dependencies explicit so a later refactor cannot make it public by accident.
    _ = current_user, connection
    settings: Settings = request.app.state.settings
    return OutgoingLettersRegistryResponse(configured=settings.exat_configured)
