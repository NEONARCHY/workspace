from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy.ext.asyncio import AsyncConnection

from ..auth import AuthenticatedUser, require_user
from ..database import get_connection
from ..home_service import PersonalReactionSummary, personal_reactions
from ..leave_service import LeaveError
from ..team_approval_inbox import ApprovalInboxKind, TeamApprovalInbox, team_approval_inbox

router = APIRouter(prefix="/home", tags=["personal home"])


@router.get("/approval-inbox/{kind}", response_model=TeamApprovalInbox)
async def get_team_approval_inbox(
    kind: ApprovalInboxKind,
    response: Response,
    user: Annotated[AuthenticatedUser, Depends(require_user)],
    connection: Annotated[AsyncConnection, Depends(get_connection)],
) -> TeamApprovalInbox:
    response.headers["Cache-Control"] = "private, no-store"
    try:
        return await team_approval_inbox(connection, user, kind)
    except LeaveError as error:
        raise HTTPException(
            error.status_code, error.detail, headers={"Cache-Control": "private, no-store"},
        ) from error


@router.get("/reactions", response_model=PersonalReactionSummary)
async def get_personal_reactions(
    user: Annotated[AuthenticatedUser, Depends(require_user)],
    connection: Annotated[AsyncConnection, Depends(get_connection)],
) -> PersonalReactionSummary:
    return await personal_reactions(connection, user)
