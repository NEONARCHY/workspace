from datetime import UTC, date, datetime, time, timedelta
from typing import Annotated
from uuid import UUID
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.ext.asyncio import AsyncConnection, AsyncEngine

from yuksalish_api.auth import AuthenticatedUser, require_user
from yuksalish_api.database import get_connection
from yuksalish_api.settings import Settings
from yuksalish_api.zoom_client import ZoomClient
from yuksalish_api.zoom_schemas import (
    CreateZoomMeetingRequest,
    UpdateZoomMeetingRequest,
    ZoomAvailabilityResponse,
    ZoomMeetingResponse,
    ZoomMeetingsResponse,
)
from yuksalish_api.zoom_service import (
    ZoomServiceError,
    cancel_zoom_meeting,
    create_zoom_meeting,
    load_zoom_availability,
    load_zoom_meetings,
    update_zoom_meeting,
)

router = APIRouter(prefix="/zoom-meetings", tags=["zoom"])


def _settings(request: Request) -> Settings:
    settings: Settings = request.app.state.settings
    return settings


def _engine(request: Request) -> AsyncEngine:
    engine: AsyncEngine = request.app.state.database_engine
    return engine


def _client(request: Request) -> ZoomClient:
    client: ZoomClient = request.app.state.zoom_client
    return client


def _translate(error: ZoomServiceError) -> HTTPException:
    return HTTPException(status_code=error.status_code, detail=error.detail)


@router.get("", response_model=ZoomMeetingsResponse)
async def get_zoom_meetings(
    request: Request,
    current_user: Annotated[AuthenticatedUser, Depends(require_user)],
    connection: Annotated[AsyncConnection, Depends(get_connection)],
) -> ZoomMeetingsResponse:
    return await load_zoom_meetings(connection, current_user, _settings(request))


@router.get("/availability", response_model=ZoomAvailabilityResponse)
async def get_zoom_availability(
    request: Request,
    current_user: Annotated[AuthenticatedUser, Depends(require_user)],
    connection: Annotated[AsyncConnection, Depends(get_connection)],
    day: Annotated[date, Query(description="Местная дата организации")],
) -> ZoomAvailabilityResponse:
    _ = current_user
    settings = _settings(request)
    zone = ZoneInfo(settings.zoom_timezone)
    day_start = datetime.combine(day, time.min, tzinfo=zone).astimezone(UTC)
    day_end = day_start + timedelta(days=1)
    return await load_zoom_availability(
        connection, settings, _client(request), day_start, day_end
    )


@router.post("", response_model=ZoomMeetingResponse, status_code=201)
async def post_zoom_meeting(
    request: Request,
    current_user: Annotated[AuthenticatedUser, Depends(require_user)],
    payload: CreateZoomMeetingRequest,
) -> ZoomMeetingResponse:
    try:
        result = await create_zoom_meeting(
            _engine(request), current_user, _settings(request), _client(request), payload
        )
    except ZoomServiceError as error:
        raise _translate(error) from error
    await request.app.state.event_bus.publish({"type": "zoom.created", "entityId": result.id})
    return result


@router.patch("/{meeting_id}", response_model=ZoomMeetingResponse)
async def patch_zoom_meeting(
    request: Request,
    current_user: Annotated[AuthenticatedUser, Depends(require_user)],
    meeting_id: UUID,
    payload: UpdateZoomMeetingRequest,
) -> ZoomMeetingResponse:
    try:
        result = await update_zoom_meeting(
            _engine(request),
            current_user,
            _settings(request),
            _client(request),
            meeting_id,
            payload,
        )
    except ZoomServiceError as error:
        raise _translate(error) from error
    await request.app.state.event_bus.publish({"type": "zoom.updated", "entityId": result.id})
    return result


@router.post("/{meeting_id}/cancel", response_model=ZoomMeetingResponse)
async def post_zoom_meeting_cancel(
    request: Request,
    current_user: Annotated[AuthenticatedUser, Depends(require_user)],
    meeting_id: UUID,
) -> ZoomMeetingResponse:
    try:
        result = await cancel_zoom_meeting(
            _engine(request), current_user, _settings(request), _client(request), meeting_id
        )
    except ZoomServiceError as error:
        raise _translate(error) from error
    await request.app.state.event_bus.publish({"type": "zoom.updated", "entityId": result.id})
    return result
