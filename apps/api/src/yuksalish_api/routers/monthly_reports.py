"""Authenticated monthly report upload/download and payroll authorization."""

from datetime import date
from pathlib import Path
from typing import Annotated, cast
from urllib.parse import quote
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncConnection
from starlette.datastructures import UploadFile

from ..access_control import ensure_module_action
from ..auth import AuthenticatedUser, require_user
from ..database import get_connection
from ..errors import WorkspaceRepositoryError
from ..grant_files_service import GrantInitialFile
from ..monthly_report_schemas import (
    CalendarDayWrite,
    MonthlyCycle,
    MonthlyOverview,
    MonthlyReport,
    MonthlySubmission,
    PayrollAuthorization,
)
from ..monthly_report_service import (
    MODULE,
    authorize,
    file_metadata,
    overview,
    save_calendar,
    submit,
)
from ..monthly_report_tables import calendar_days
from ..object_storage import ObjectStorage, ObjectStorageError

router = APIRouter(prefix="/monthly-reports", tags=["monthly-reports"])
User = Annotated[AuthenticatedUser, Depends(require_user)]
Connection = Annotated[AsyncConnection, Depends(get_connection)]


@router.get("", response_model=MonthlyOverview)
async def get_overview(user: User, connection: Connection, response: Response) -> MonthlyOverview:
    response.headers["Cache-Control"] = "no-store"
    result = await overview(connection, user)
    # First access can materialize the month. A following upload must see that roster.
    await connection.commit()
    return result


@router.get("/template")
async def get_template(user: User, connection: Connection) -> Response:
    await ensure_module_action(connection, user, MODULE, "view")
    content = Path(__file__).resolve().parents[1] / "hr_assets" / "monthly-report-template.docx"
    return Response(
        content.read_bytes(),
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        headers={
            "Content-Disposition": 'attachment; filename="oylik-hisobot.docx"',
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
        },
    )


@router.post("/submit", response_model=MonthlyReport, status_code=201)
async def submit_report(request: Request, user: User, connection: Connection) -> MonthlyReport:
    await ensure_module_action(connection, user, MODULE, "create")
    length = request.headers.get("content-length")
    if length is None or request.headers.get("transfer-encoding"):
        raise HTTPException(411, "Для загрузки требуется известный размер запроса")
    try:
        size = int(length)
    except ValueError as error:
        raise HTTPException(400, "Некорректный размер запроса") from error
    if not 0 <= size <= 51 * 1024 * 1024:
        raise HTTPException(413, "Общий размер файлов — до 50 МБ")
    async with request.form(max_files=5, max_fields=1, max_part_size=32 * 1024) as form:
        raw = form.get("payload")
        uploads = form.getlist("files")
        if (
            not isinstance(raw, str)
            or not uploads
            or any(not isinstance(f, UploadFile) for f in uploads)
            or any(key not in {"payload", "files"} for key in form)
        ):
            raise HTTPException(422, "Выберите отчётный месяц и прикрепите файл")
        try:
            payload = MonthlySubmission.model_validate_json(raw)
        except ValidationError as error:
            raise HTTPException(422, "Проверьте месяц и комментарий отчёта") from error
        files: list[GrantInitialFile] = []
        total = 0
        for raw_file in uploads:
            upload = cast(UploadFile, raw_file)
            content = await upload.read(25 * 1024 * 1024 + 1)
            total += len(content)
            if len(content) > 25 * 1024 * 1024 or total > 50 * 1024 * 1024:
                raise HTTPException(413, "Файл — до 25 МБ, все файлы — до 50 МБ")
            files.append(
                GrantInitialFile(
                    upload.filename or "",
                    upload.content_type or "application/octet-stream",
                    content,
                )
            )
        try:
            result = await submit(
                connection,
                user,
                payload,
                files,
                cast(ObjectStorage, request.app.state.object_storage),
            )
        except ObjectStorageError as error:
            raise HTTPException(503, "Ошибка сохранения файла. Повторите отправку") from error
        except WorkspaceRepositoryError as error:
            raise HTTPException(error.status_code, error.detail) from error
    await request.app.state.event_bus.publish({"type": "monthly-reports.updated"})
    return result


@router.post("/{month}/authorize", response_model=MonthlyCycle)
async def authorize_payroll(
    month: date, payload: PayrollAuthorization, request: Request, user: User, connection: Connection
) -> MonthlyCycle:
    result = await authorize(connection, user, month, payload.comment)
    await connection.commit()
    await request.app.state.event_bus.publish({"type": "monthly-reports.updated"})
    return result


@router.get("/{report_id}/files/{file_id}")
async def download_report(
    report_id: UUID, file_id: UUID, request: Request, user: User, connection: Connection
) -> Response:
    item = await file_metadata(connection, user, report_id, file_id)
    try:
        content = await cast(ObjectStorage, request.app.state.object_storage).get(item["key"])
    except ObjectStorageError as error:
        raise HTTPException(503, "Ошибка чтения файла. Повторите загрузку") from error
    return Response(
        content,
        media_type="application/octet-stream",
        headers={
            "Content-Disposition": "attachment; filename*=UTF-8''" + quote(item["name"], safe=""),
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
        },
    )


@router.get("/calendar/days", response_model=list[CalendarDayWrite])
async def get_calendar(user: User, connection: Connection) -> list[CalendarDayWrite]:
    await ensure_module_action(connection, user, MODULE, "view")
    return [
        CalendarDayWrite.model_validate(dict(r))
        for r in (
            await connection.execute(select(calendar_days).order_by(calendar_days.c.day))
        ).mappings()
    ]


@router.put("/calendar/days", status_code=204)
async def put_calendar(payload: CalendarDayWrite, user: User, connection: Connection) -> None:
    await save_calendar(connection, user, payload)
    await connection.commit()
