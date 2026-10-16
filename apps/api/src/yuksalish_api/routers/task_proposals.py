from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncConnection

from ..auth import AuthenticatedUser, require_user
from ..database import get_connection
from ..events import WorkspaceEventBus
from ..repository import WorkspaceRepositoryError
from ..task_proposal_schemas import TaskProposalDecision, TaskProposalResponse, TaskProposalWrite
from ..task_proposal_service import decide_proposal, list_proposals, propose_task

router = APIRouter(prefix="/task-proposals", tags=["tasks"])
User = Annotated[AuthenticatedUser, Depends(require_user)]
Connection = Annotated[AsyncConnection, Depends(get_connection)]


async def _publish(request: Request, result: TaskProposalResponse) -> None:
    bus: WorkspaceEventBus = request.app.state.event_bus
    for recipient in {result.creator_user_id, result.author_user_id}:
        await bus.publish(
            {"type": "task.updated", "entityId": result.id}, recipient_id=UUID(recipient),
        )
    if result.task_id:
        await bus.publish({"type": "task.created", "entityId": result.task_id})


@router.get("", response_model=list[TaskProposalResponse])
async def get_proposals(user: User, connection: Connection) -> list[TaskProposalResponse]:
    return await list_proposals(connection, user)


@router.post("", response_model=TaskProposalResponse, status_code=201)
async def post_proposal(
    payload: TaskProposalWrite, user: User, connection: Connection, request: Request,
) -> TaskProposalResponse:
    try:
        result = await propose_task(connection, user, payload)
    except WorkspaceRepositoryError as error:
        raise HTTPException(error.status_code, error.detail) from error
    await connection.commit()
    await _publish(request, result)
    return result


@router.post("/{proposal_id}/decision", response_model=TaskProposalResponse)
async def post_decision(
    proposal_id: UUID, payload: TaskProposalDecision, user: User,
    connection: Connection, request: Request,
) -> TaskProposalResponse:
    try:
        result = await decide_proposal(connection, user, proposal_id, payload)
    except WorkspaceRepositoryError as error:
        raise HTTPException(error.status_code, error.detail) from error
    await connection.commit()
    await _publish(request, result)
    return result
