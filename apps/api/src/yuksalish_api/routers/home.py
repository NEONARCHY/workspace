from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncConnection

from ..auth import AuthenticatedUser, require_user
from ..database import get_connection
from ..home_service import PersonalReactionSummary, personal_reactions

router = APIRouter(prefix="/home", tags=["personal home"])


@router.get("/reactions", response_model=PersonalReactionSummary)
async def get_personal_reactions(
    user: Annotated[AuthenticatedUser, Depends(require_user)],
    connection: Annotated[AsyncConnection, Depends(get_connection)],
) -> PersonalReactionSummary:
    return await personal_reactions(connection, user)
