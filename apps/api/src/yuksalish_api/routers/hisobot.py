"""Employee Hisobot UI API and authenticated bot-to-server bridge."""

import hmac
from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request
from sqlalchemy.ext.asyncio import AsyncConnection

from ..auth import AuthenticatedUser, require_user
from ..database import get_connection
from ..hisobot_schemas import (
    BridgeReportBatch,
    BridgeReportExemption,
    BridgeRosterMember,
    BridgeVacationSnapshot,
    HisobotProfile,
    HisobotReport,
    HisobotReportInput,
)
from ..hisobot_service import (
    bridge_reports,
    bridge_roster,
    history,
    import_reports,
    management_history,
    profile,
    replace_vacations,
    report_exemptions,
    submit_report,
)

router = APIRouter(prefix="/hisobot", tags=["hisobot"])


def require_bridge(request: Request, authorization: Annotated[str | None, Header()] = None) -> None:
    configured = request.app.state.settings.hisobot_bridge_token.get_secret_value()
    if not configured or len(configured) < 32 or not authorization:
        raise HTTPException(401, "Hisobot bridge is not configured or authenticated")
    scheme, _, supplied = authorization.partition(" ")
    if scheme.lower() != "bearer" or not hmac.compare_digest(supplied, configured):
        raise HTTPException(401, "Invalid Hisobot bridge credential")


@router.get("/me", response_model=HisobotProfile)
async def get_me(
    user: Annotated[AuthenticatedUser, Depends(require_user)],
    connection: Annotated[AsyncConnection, Depends(get_connection)],
) -> HisobotProfile:
    return await profile(connection, user)


@router.put("/me/report", response_model=HisobotReport)
async def put_my_report(
    payload: HisobotReportInput,
    user: Annotated[AuthenticatedUser, Depends(require_user)],
    connection: Annotated[AsyncConnection, Depends(get_connection)],
    request: Request,
) -> HisobotReport:
    report = await submit_report(connection, user, payload)
    await request.app.state.event_bus.publish({"type": "hisobot.report.updated"})
    return report


@router.get("/me/history", response_model=list[HisobotReport])
async def get_my_history(
    user: Annotated[AuthenticatedUser, Depends(require_user)],
    connection: Annotated[AsyncConnection, Depends(get_connection)],
    before_date: date | None = None,
) -> list[HisobotReport]:
    return await history(connection, user, before_date=before_date)


@router.get("/reports", response_model=list[HisobotReport])
async def get_reports(
    user: Annotated[AuthenticatedUser, Depends(require_user)],
    connection: Annotated[AsyncConnection, Depends(get_connection)],
    start_date: date,
    end_date: date,
) -> list[HisobotReport]:
    return await management_history(connection, user, start_date, end_date)


@router.get("/bridge/roster", response_model=list[BridgeRosterMember],
            dependencies=[Depends(require_bridge)])
async def get_bridge_roster(
    connection: Annotated[AsyncConnection, Depends(get_connection)],
) -> list[BridgeRosterMember]:
    return await bridge_roster(connection)


@router.put("/bridge/reports", response_model=list[HisobotReport],
            dependencies=[Depends(require_bridge)])
async def put_bridge_reports(
    payload: BridgeReportBatch,
    connection: Annotated[AsyncConnection, Depends(get_connection)],
    request: Request,
) -> list[HisobotReport]:
    reports = await import_reports(connection, payload.reports)
    if reports:
        await request.app.state.event_bus.publish({"type": "hisobot.report.updated"})
    return reports


@router.get("/bridge/reports", response_model=list[HisobotReport],
            dependencies=[Depends(require_bridge)])
async def get_bridge_reports(
    connection: Annotated[AsyncConnection, Depends(get_connection)],
    start_date: Annotated[date, Query()],
    end_date: Annotated[date, Query()],
) -> list[HisobotReport]:
    return await bridge_reports(connection, start_date, end_date)


@router.put("/bridge/vacations", dependencies=[Depends(require_bridge)])
async def put_bridge_vacations(
    payload: BridgeVacationSnapshot,
    connection: Annotated[AsyncConnection, Depends(get_connection)],
) -> dict[str, int]:
    await replace_vacations(connection, payload)
    return {"count": len(payload.vacations)}


@router.get("/bridge/report-exemptions", response_model=list[BridgeReportExemption],
            dependencies=[Depends(require_bridge)])
async def get_report_exemptions(
    connection: Annotated[AsyncConnection, Depends(get_connection)],
    start_date: Annotated[date, Query()],
    end_date: Annotated[date, Query()],
) -> list[BridgeReportExemption]:
    return await report_exemptions(connection, start_date, end_date)
