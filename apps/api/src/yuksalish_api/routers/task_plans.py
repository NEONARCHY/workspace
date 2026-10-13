"""Plan records and task links within the existing Tasks module."""

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncConnection

from yuksalish_api.auth import AuthenticatedUser, require_user
from yuksalish_api.database import get_connection
from yuksalish_api.repository import WorkspaceRepositoryError
from yuksalish_api.task_plan_schemas import TaskPlanResponse, TaskPlanWrite
from yuksalish_api.task_plan_service import change_link, create_plan, list_plans, update_plan

router = APIRouter(prefix="/task-plans", tags=["task-plans"])
User = Annotated[AuthenticatedUser, Depends(require_user)]
Connection = Annotated[AsyncConnection, Depends(get_connection)]


@router.get("", response_model=list[TaskPlanResponse])
async def get_plans(user: User, connection: Connection) -> list[TaskPlanResponse]:
    return await list_plans(connection, user)


@router.post("", response_model=TaskPlanResponse, status_code=201)
async def post_plan(
    payload: TaskPlanWrite, user: User, connection: Connection,
) -> TaskPlanResponse:
    return await create_plan(connection, user, payload)


@router.put("/{plan_id}", response_model=TaskPlanResponse)
async def put_plan(
    plan_id: UUID, payload: TaskPlanWrite, user: User, connection: Connection,
) -> TaskPlanResponse:
    try:
        return await update_plan(connection, user, plan_id, payload)
    except WorkspaceRepositoryError as error:
        raise HTTPException(error.status_code, error.detail) from error


@router.put("/{plan_id}/tasks/{task_id}", status_code=204)
async def put_plan_task(
    plan_id: UUID, task_id: UUID, user: User, connection: Connection,
) -> None:
    try:
        await change_link(connection, user, plan_id, task_id, linked=True)
    except WorkspaceRepositoryError as error:
        raise HTTPException(error.status_code, error.detail) from error


@router.delete("/{plan_id}/tasks/{task_id}", status_code=204)
async def delete_plan_task(
    plan_id: UUID, task_id: UUID, user: User, connection: Connection,
) -> None:
    try:
        await change_link(connection, user, plan_id, task_id, linked=False)
    except WorkspaceRepositoryError as error:
        raise HTTPException(error.status_code, error.detail) from error
