from typing import Literal
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncConnection

from .auth import AuthenticatedUser
from .errors import WorkspaceRepositoryError
from .position_policy import is_calendar_audience_leader
from .tables import departments, users


def can_invite_calendar_audience(user: AuthenticatedUser) -> bool:
    return user.role in {"admin", "superadmin"} or is_calendar_audience_leader(user.job_title)


async def calendar_audience_ids(
    connection: AsyncConnection,
    user: AuthenticatedUser,
    scope: Literal["central", "regional", "all"],
) -> list[UUID]:
    """Expand an explicit audience command from current active staff, never client IDs."""
    if not can_invite_calendar_audience(user):
        raise WorkspaceRepositoryError(
            403, "Массовое приглашение доступно руководству и администраторам"
        )
    active = (await connection.execute(
        select(users.c.id, users.c.department_id)
        .where(users.c.status == "active").order_by(users.c.id).with_for_update()
    )).mappings().all()
    if scope == "all":
        return [row["id"] for row in active]
    department_rows = (await connection.execute(
        select(departments.c.id, departments.c.parent_id, departments.c.scope)
    )).mappings().all()
    by_id = {row["id"]: row for row in department_rows}
    resolved: dict[UUID, str] = {}

    def department_scope(department_id: UUID | None) -> str:
        visited: set[UUID] = set()
        current = department_id
        result = "central"
        while current is not None and current in by_id and current not in visited:
            if current in resolved:
                result = resolved[current]
                break
            visited.add(current)
            row = by_id[current]
            if row["scope"] == "regional":
                result = "regional"
                break
            current = row["parent_id"]
        for key in visited:
            resolved[key] = result
        return result

    return [row["id"] for row in active if department_scope(row["department_id"]) == scope]
