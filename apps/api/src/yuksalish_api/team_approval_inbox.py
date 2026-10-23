"""Read-only, personal first-deputy queues. Approval routes remain unchanged."""

from datetime import date
from typing import Literal

from fastapi import HTTPException
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncConnection

from .access_control import ensure_module_action, module_permissions_for_user
from .auth import AuthenticatedUser
from .leave_service import _reviewers
from .repository import (
    _trip_allowed_actions,
    _trip_deputy_user_id,
    _trip_directory_deputy_id,
    _trip_row_deputy_id,
)
from .tables import leave_requests, trip_requests, users
from .workspace_schemas import ApiModel

ApprovalInboxKind = Literal["trips", "leaves"]


class TeamApprovalItem(ApiModel):
    id: str
    title: str
    requester_name: str
    starts_on: date
    ends_on: date | None


class TeamApprovalInbox(ApiModel):
    enabled: bool
    items: list[TeamApprovalItem]


async def team_approval_inbox(
    connection: AsyncConnection, user: AuthenticatedUser, kind: ApprovalInboxKind
) -> TeamApprovalInbox:
    if user.role not in {"manager", "admin", "superadmin"}:
        raise HTTPException(403, "Обзор команды доступен руководителям")
    await ensure_module_action(connection, user, "team_overview", "view")
    permissions = await module_permissions_for_user(connection, user)
    module = "trip_approvals" if kind == "trips" else "leave_approvals"
    access = permissions.get(module, {})
    if not access.get("view") or not access.get("approve"):
        return TeamApprovalInbox(enabled=False, items=[])
    directory_id = await _trip_directory_deputy_id(connection)
    if kind == "leaves":
        if user.id != directory_id:
            return TeamApprovalInbox(enabled=False, items=[])
        # Use the same HR/deputy configuration validation as the decision endpoint.
        _, deputy_id = await _reviewers(connection)
        if user.id != deputy_id:
            return TeamApprovalInbox(enabled=False, items=[])
        rows = (await connection.execute(
            select(
                leave_requests.c.id, users.c.full_name,
                leave_requests.c.starts_on, leave_requests.c.ends_on,
            ).join(users, users.c.id == leave_requests.c.requester_user_id)
            .where(leave_requests.c.status == "pending_deputy")
            .order_by(leave_requests.c.starts_on, leave_requests.c.created_at, leave_requests.c.id)
        )).mappings().all()
        return TeamApprovalInbox(enabled=True, items=[TeamApprovalItem(
            id=str(row["id"]), title="Заявление на отпуск",
            requester_name=row["full_name"], starts_on=row["starts_on"], ends_on=row["ends_on"],
        ) for row in rows])

    configured_id = await _trip_deputy_user_id(connection)
    # Version 3 pins the approver at submission. A later route edit must not steal
    # existing decisions; unpinned legacy records use the original directory role.
    rows = (await connection.execute(
        select(
            trip_requests.c.id, trip_requests.c.destination, trip_requests.c.requester_user_id,
            trip_requests.c.start_date, trip_requests.c.end_date,
            trip_requests.c.stage, trip_requests.c.status, trip_requests.c.workflow_version,
            trip_requests.c.deputy_approver_user_id, trip_requests.c.order_pdf_key,
            users.c.full_name,
        ).join(users, users.c.id == trip_requests.c.requester_user_id)
        .where(
            trip_requests.c.deleted_at.is_(None), trip_requests.c.status == "running",
            trip_requests.c.stage == "deputy_approval", trip_requests.c.workflow_version == 3,
            or_(
                trip_requests.c.deputy_approver_user_id == user.id,
                trip_requests.c.deputy_approver_user_id.is_(None) & (directory_id == user.id),
            ),
        ).order_by(trip_requests.c.start_date, trip_requests.c.created_at, trip_requests.c.id)
    )).mappings().all()
    items = [TeamApprovalItem(
        id=str(row["id"]), title=row["destination"], requester_name=row["full_name"],
        starts_on=row["start_date"], ends_on=row["end_date"],
    ) for row in rows if "approve" in _trip_allowed_actions(
        row, user, deputy_user_id=_trip_row_deputy_id(row, configured_id, directory_id),
    )]
    return TeamApprovalInbox(
        enabled=user.id in {configured_id, directory_id} or bool(items), items=items,
    )
