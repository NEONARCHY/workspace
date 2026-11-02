from typing import Annotated
from uuid import UUID
from zipfile import BadZipFile

from defusedxml.common import DefusedXmlException
from fastapi import APIRouter, Depends, HTTPException, Request, UploadFile
from openpyxl.utils.exceptions import InvalidFileException  # type: ignore[import-untyped]
from sqlalchemy.ext.asyncio import AsyncConnection
from starlette.concurrency import run_in_threadpool

from ..auth import AuthenticatedUser, require_user
from ..database import get_connection
from ..events import WorkspaceEventBus
from ..repository import WorkspaceRepositoryError
from ..task_proposal_import import MAX_IMPORT_BYTES, preview_proposal_workbook
from ..task_proposal_import_service import (
    _admin,
    import_context,
    import_proposals,
    import_result,
)
from ..task_proposal_schemas import (
    TaskProposalDecision,
    TaskProposalImportContext,
    TaskProposalImportPreview,
    TaskProposalImportResult,
    TaskProposalImportWrite,
    TaskProposalResponse,
    TaskProposalWrite,
)
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


@router.get("/import/context", response_model=TaskProposalImportContext)
async def get_import_context(user: User, connection: Connection) -> TaskProposalImportContext:
    return await import_context(connection, user)


@router.post("/import/preview", response_model=TaskProposalImportPreview)
async def preview_import(
    file: UploadFile, user: User, connection: Connection,
) -> TaskProposalImportPreview:
    try:
        await _admin(connection, user)
        content = await file.read(MAX_IMPORT_BYTES + 1)
        return await run_in_threadpool(preview_proposal_workbook, file.filename or "", content)
    except WorkspaceRepositoryError as error:
        raise HTTPException(error.status_code, error.detail) from error
    except ValueError as error:
        raise HTTPException(422, str(error)) from error
    except (BadZipFile, InvalidFileException, KeyError, SyntaxError, OSError,
            DefusedXmlException) as error:
        raise HTTPException(422, "Ошибка чтения XLSX: проверьте файл") from error
    finally:
        await file.close()


@router.post("/import/confirm", response_model=TaskProposalImportResult, status_code=201)
async def confirm_import(
    payload: TaskProposalImportWrite, user: User, connection: Connection, request: Request,
) -> TaskProposalImportResult:
    try:
        result = await import_proposals(connection, user, payload)
    except WorkspaceRepositoryError as error:
        raise HTTPException(error.status_code, error.detail) from error
    await connection.commit()
    if not result.reused and result.proposals:
        first = result.proposals[0]
        bus: WorkspaceEventBus = request.app.state.event_bus
        for recipient in {first.creator_user_id, first.author_user_id}:
            await bus.publish({"type": "task.updated", "entityId": result.batch_id},
                              recipient_id=UUID(recipient))
    return result


@router.get("/import/{batch_id}", response_model=TaskProposalImportResult)
async def get_import_result(
    batch_id: UUID, user: User, connection: Connection,
) -> TaskProposalImportResult:
    try:
        return await import_result(connection, user, batch_id)
    except WorkspaceRepositoryError as error:
        raise HTTPException(error.status_code, error.detail) from error


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
