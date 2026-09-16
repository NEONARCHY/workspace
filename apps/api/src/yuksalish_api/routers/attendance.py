from __future__ import annotations

import hashlib
import hmac
from datetime import UTC, date, datetime
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.ext.asyncio import AsyncConnection

from yuksalish_api.access_control import ensure_module_action
from yuksalish_api.attendance_schemas import (
    AttendanceActionRequest,
    AttendanceCorrectionActionRequest,
    AttendanceCorrectionCreateRequest,
    AttendanceCorrectionResponse,
    AttendanceDayResponse,
    AttendanceProfileResponse,
    AttendanceProfileUpdateRequest,
    SmartOfficeAttendanceEventRequest,
    SmartOfficeAttendanceEventResponse,
    SmartOfficeSnapshotResponse,
    WorkScheduleExceptionResponse,
    WorkScheduleExceptionWriteRequest,
    WorkSchedulePeriodResponse,
    WorkSchedulePeriodWriteRequest,
)
from yuksalish_api.attendance_service import (
    AttendanceError,
    act_on_correction,
    create_correction,
    create_schedule_period,
    load_attendance,
    record_smartoffice_arrival,
    record_user_action,
    save_profile,
    save_schedule_exception,
    smartoffice_snapshot,
)
from yuksalish_api.auth import AuthenticatedUser, require_user
from yuksalish_api.database import get_connection

router = APIRouter(tags=["attendance"])


def _translate(error: AttendanceError) -> HTTPException:
    return HTTPException(status_code=error.status_code, detail=error.detail)


async def _require_smartoffice(request: Request) -> None:
    key = request.app.state.settings.smartoffice_integration_key.get_secret_value()
    if not key:
        raise HTTPException(status_code=503, detail="Smart Office integration is not configured")
    timestamp = request.headers.get("X-SmartOffice-Timestamp", "")
    signature = request.headers.get("X-SmartOffice-Signature", "")
    try:
        sent_at = datetime.fromtimestamp(int(timestamp), UTC)
    except ValueError as error:
        raise HTTPException(status_code=401, detail="Invalid Smart Office timestamp") from error
    if abs((datetime.now(UTC) - sent_at).total_seconds()) > 300:
        raise HTTPException(status_code=401, detail="Expired Smart Office signature")
    body = await request.body()
    query = f"?{request.url.query}" if request.url.query else ""
    route_path = request.url.path.removeprefix(request.app.state.settings.api_prefix)
    signing_input = f"{request.method}\n{route_path}{query}\n".encode() + body
    expected = hmac.new(
        key.encode("utf-8"), timestamp.encode("ascii") + b"." + signing_input, hashlib.sha256
    ).hexdigest()
    if not hmac.compare_digest(signature, expected):
        raise HTTPException(status_code=401, detail="Invalid Smart Office signature")


@router.get("/attendance/me", response_model=AttendanceDayResponse)
async def get_attendance_today(
    current_user: Annotated[AuthenticatedUser, Depends(require_user)],
    connection: Annotated[AsyncConnection, Depends(get_connection)],
) -> AttendanceDayResponse:
    days, _, _, _, _ = await load_attendance(connection, current_user, False)
    today = datetime.now(UTC).date()
    for item in days:
        if item.user_id == str(current_user.id) and item.work_date == today:
            return item
    raise HTTPException(status_code=404, detail="Attendance day is not created yet")


@router.post("/attendance/actions", response_model=AttendanceDayResponse)
async def post_attendance_action(
    payload: AttendanceActionRequest,
    current_user: Annotated[AuthenticatedUser, Depends(require_user)],
    connection: Annotated[AsyncConnection, Depends(get_connection)],
) -> AttendanceDayResponse:
    await ensure_module_action(connection, current_user, "attendance", "create")
    try:
        return await record_user_action(connection, current_user, payload)
    except AttendanceError as error:
        raise _translate(error) from error


@router.post(
    "/attendance/corrections", response_model=AttendanceCorrectionResponse, status_code=201
)
async def post_attendance_correction(
    payload: AttendanceCorrectionCreateRequest,
    current_user: Annotated[AuthenticatedUser, Depends(require_user)],
    connection: Annotated[AsyncConnection, Depends(get_connection)],
) -> AttendanceCorrectionResponse:
    try:
        return await create_correction(connection, current_user, payload)
    except AttendanceError as error:
        raise _translate(error) from error


@router.post(
    "/attendance/corrections/{correction_id}/actions", response_model=AttendanceCorrectionResponse
)
async def post_attendance_correction_action(
    correction_id: UUID,
    payload: AttendanceCorrectionActionRequest,
    current_user: Annotated[AuthenticatedUser, Depends(require_user)],
    connection: Annotated[AsyncConnection, Depends(get_connection)],
) -> AttendanceCorrectionResponse:
    await ensure_module_action(
        connection, current_user, "attendance", "approve" if payload.action != "cancel" else "edit"
    )
    try:
        return await act_on_correction(connection, current_user, correction_id, payload)
    except AttendanceError as error:
        raise _translate(error) from error


@router.put("/attendance/profiles/{user_id}", response_model=AttendanceProfileResponse)
async def put_attendance_profile(
    user_id: UUID,
    payload: AttendanceProfileUpdateRequest,
    current_user: Annotated[AuthenticatedUser, Depends(require_user)],
    connection: Annotated[AsyncConnection, Depends(get_connection)],
) -> AttendanceProfileResponse:
    await ensure_module_action(connection, current_user, "attendance", "admin")
    try:
        return await save_profile(connection, current_user, user_id, payload)
    except AttendanceError as error:
        raise _translate(error) from error


@router.post("/attendance/schedules", response_model=WorkSchedulePeriodResponse, status_code=201)
async def post_attendance_schedule(
    payload: WorkSchedulePeriodWriteRequest,
    current_user: Annotated[AuthenticatedUser, Depends(require_user)],
    connection: Annotated[AsyncConnection, Depends(get_connection)],
) -> WorkSchedulePeriodResponse:
    await ensure_module_action(connection, current_user, "attendance", "admin")
    try:
        return await create_schedule_period(connection, current_user, payload)
    except AttendanceError as error:
        raise _translate(error) from error


@router.put("/attendance/schedule-exceptions", response_model=WorkScheduleExceptionResponse)
async def put_attendance_schedule_exception(
    payload: WorkScheduleExceptionWriteRequest,
    current_user: Annotated[AuthenticatedUser, Depends(require_user)],
    connection: Annotated[AsyncConnection, Depends(get_connection)],
) -> WorkScheduleExceptionResponse:
    await ensure_module_action(connection, current_user, "attendance", "admin")
    try:
        return await save_schedule_exception(connection, current_user, payload)
    except AttendanceError as error:
        raise _translate(error) from error


@router.post(
    "/integrations/smart-office/attendance-events",
    response_model=SmartOfficeAttendanceEventResponse,
    dependencies=[Depends(_require_smartoffice)],
)
async def post_smartoffice_attendance_event(
    payload: SmartOfficeAttendanceEventRequest,
    connection: Annotated[AsyncConnection, Depends(get_connection)],
) -> SmartOfficeAttendanceEventResponse:
    try:
        return await record_smartoffice_arrival(connection, payload)
    except AttendanceError as error:
        raise _translate(error) from error


@router.get(
    "/integrations/smart-office/snapshot",
    response_model=SmartOfficeSnapshotResponse,
    dependencies=[Depends(_require_smartoffice)],
)
async def get_smartoffice_snapshot(
    connection: Annotated[AsyncConnection, Depends(get_connection)],
    work_date: Annotated[date | None, Query()] = None,
) -> SmartOfficeSnapshotResponse:
    return await smartoffice_snapshot(connection, work_date or datetime.now(UTC).date())
