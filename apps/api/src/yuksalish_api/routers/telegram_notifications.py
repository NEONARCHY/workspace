"""A dedicated delivery-only bridge; never accepts task/payment mutations."""

import hmac
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException, Request, Response
from sqlalchemy.ext.asyncio import AsyncConnection

from ..auth import AuthenticatedUser, require_user
from ..database import get_connection
from ..errors import WorkspaceRepositoryError
from ..settings import Settings
from ..telegram_notification_schemas import (
    ClaimMode,
    DeliveryAck,
    DeliveryClaim,
    DeliveryLease,
    PreparedDelivery,
    WorkspaceNoticeTarget,
)
from ..telegram_notification_service import acknowledge, claim, open_notice, prepare

router = APIRouter(prefix="/telegram-notifications", tags=["Workspace Telegram notifications"])
Connection = Annotated[AsyncConnection, Depends(get_connection)]
User = Annotated[AuthenticatedUser, Depends(require_user)]


def bridge(request: Request, authorization: Annotated[str | None, Header()] = None) -> None:
    settings: Settings = request.app.state.settings
    expected = settings.telegram_notifications_bridge_token.get_secret_value()
    scheme, _, supplied = (authorization or "").partition(" ")
    if (
        len(expected) < 32
        or scheme.lower() != "bearer"
        or not hmac.compare_digest(expected.encode(), supplied.encode())
    ):
        raise HTTPException(401, "Notification bridge is not authenticated")


def enabled(request: Request) -> None:
    if request.app.state.settings.telegram_notifications_mode == "off":
        raise HTTPException(403, "Workspace Telegram delivery is disabled")


@router.post(
    "/bridge/claim",
    dependencies=[Depends(bridge), Depends(enabled)],
    response_model=list[DeliveryClaim],
)
async def claim_deliveries(
    payload: ClaimMode, c: Connection, request: Request, response: Response
) -> list[DeliveryClaim]:
    if payload.mode != request.app.state.settings.telegram_notifications_mode:
        raise HTTPException(409, "Sender mode does not match the notification bridge")
    result = await claim(c)
    await c.commit()
    response.headers["Cache-Control"] = "no-store"
    return result


@router.post(
    "/bridge/{identifier}/prepare",
    dependencies=[Depends(bridge), Depends(enabled)],
    response_model=PreparedDelivery | None,
)
async def prepare_delivery(
    identifier: UUID, payload: DeliveryLease, c: Connection, request: Request, response: Response
) -> PreparedDelivery | None:
    try:
        result = await prepare(c, identifier, payload.lease_token, request.app.state.settings)
    except WorkspaceRepositoryError as error:
        raise HTTPException(error.status_code, error.detail) from error
    await c.commit()
    response.headers["Cache-Control"] = "no-store"
    return result


@router.post("/bridge/{identifier}/ack", dependencies=[Depends(bridge)], status_code=204)
async def ack_delivery(identifier: UUID, payload: DeliveryAck, c: Connection) -> Response:
    try:
        await acknowledge(c, identifier, payload)
    except WorkspaceRepositoryError as error:
        raise HTTPException(error.status_code, error.detail) from error
    await c.commit()
    return Response(status_code=204, headers={"Cache-Control": "no-store"})


@router.get("/open/{identifier}", response_model=WorkspaceNoticeTarget)
async def resolve_notice(
    identifier: UUID, user: User, c: Connection, response: Response
) -> WorkspaceNoticeTarget:
    response.headers["Cache-Control"] = "private, no-store"
    try:
        return await open_notice(c, user, identifier)
    except WorkspaceRepositoryError as error:
        raise HTTPException(
            error.status_code, error.detail, headers={"Cache-Control": "private, no-store"}
        ) from error
