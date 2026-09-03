from datetime import UTC, datetime
from typing import Any
from uuid import UUID, uuid4

from sqlalchemy import func, insert, select, update
from sqlalchemy.ext.asyncio import AsyncConnection

from .auth import AuthenticatedUser
from .directory_schemas import (
    DirectoryBootstrapResponse,
    DirectoryEmployeeResponse,
    EmployeeAccessUpdateRequest,
    PositionCreateRequest,
    PositionResponse,
    PositionUpdateRequest,
    RoleDescriptorResponse,
)
from .tables import audit_events, positions, users


class DirectoryServiceError(ValueError):
    def __init__(self, status_code: int, detail: str) -> None:
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


ROLE_DESCRIPTORS = [
    RoleDescriptorResponse(
        key="employee",
        label="Сотрудник",
        description="Работает со своими задачами, чатами и заявками.",  # noqa: RUF001
    ),
    RoleDescriptorResponse(
        key="manager",
        label="Руководитель",
        description="Управляет задачами команды и принимает решения по заявкам.",
    ),
    RoleDescriptorResponse(
        key="admin",
        label="Администратор",
        description="Управляет сотрудниками, должностями и доступом к Workspace.",
    ),
]


def _require_admin(user: AuthenticatedUser) -> None:
    if user.role not in {"admin", "superadmin"}:
        raise DirectoryServiceError(403, "Administrator role required")


async def _audit(
    connection: AsyncConnection,
    actor: AuthenticatedUser,
    action: str,
    target_type: str,
    target_id: UUID,
    details: dict[str, Any],
) -> None:
    await connection.execute(
        insert(audit_events).values(
            id=uuid4(),
            actor_user_id=actor.id,
            action=action,
            target_type=target_type,
            target_id=target_id,
            details=details,
            created_at=datetime.now(UTC),
        )
    )


async def _position_response(
    connection: AsyncConnection,
    position_id: UUID,
) -> PositionResponse:
    row = (
        await connection.execute(
            select(
                positions,
                func.count(users.c.id).label("assigned_users_count"),
            )
            .outerjoin(users, users.c.position_id == positions.c.id)
            .where(positions.c.id == position_id)
            .group_by(positions.c.id)
        )
    ).mappings().first()
    if row is None:
        raise DirectoryServiceError(404, "Position was not found")
    return PositionResponse(
        id=str(row["id"]),
        name=row["name"],
        is_active=row["is_active"],
        sort_order=row["sort_order"],
        source=row["source"],
        assigned_users_count=row["assigned_users_count"],
    )


async def load_directory(connection: AsyncConnection) -> DirectoryBootstrapResponse:
    position_rows = (
        await connection.execute(
            select(
                positions,
                func.count(users.c.id).label("assigned_users_count"),
            )
            .outerjoin(users, users.c.position_id == positions.c.id)
            .group_by(positions.c.id)
            .order_by(positions.c.is_active.desc(), positions.c.sort_order, positions.c.name)
        )
    ).mappings().all()
    employee_rows = (
        await connection.execute(
            select(
                users.c.id,
                users.c.username,
                users.c.full_name,
                users.c.role,
                users.c.position_id,
                func.coalesce(positions.c.name, users.c.job_title).label("job_title"),
                users.c.status,
            )
            .outerjoin(positions, positions.c.id == users.c.position_id)
            .order_by(users.c.full_name)
        )
    ).mappings().all()
    return DirectoryBootstrapResponse(
        roles=ROLE_DESCRIPTORS,
        positions=[
            PositionResponse(
                id=str(row["id"]),
                name=row["name"],
                is_active=row["is_active"],
                sort_order=row["sort_order"],
                source=row["source"],
                assigned_users_count=row["assigned_users_count"],
            )
            for row in position_rows
        ],
        employees=[
            DirectoryEmployeeResponse(
                id=str(row["id"]),
                username=row["username"],
                name=row["full_name"],
                role=row["role"],
                position_id=str(row["position_id"]) if row["position_id"] else None,
                job_title=row["job_title"],
                status=row["status"],
            )
            for row in employee_rows
        ],
    )


async def create_position(
    connection: AsyncConnection,
    actor: AuthenticatedUser,
    payload: PositionCreateRequest,
) -> PositionResponse:
    _require_admin(actor)
    duplicate = await connection.scalar(
        select(positions.c.id).where(func.lower(positions.c.name) == payload.name.lower())
    )
    if duplicate is not None:
        raise DirectoryServiceError(409, "Position name already exists")
    position_id = uuid4()
    now = datetime.now(UTC)
    await connection.execute(
        insert(positions).values(
            id=position_id,
            name=payload.name,
            is_active=True,
            sort_order=payload.sort_order,
            source="workspace",
            aliases=[],
            created_at=now,
            updated_at=now,
        )
    )
    await _audit(
        connection,
        actor,
        "position.created",
        "position",
        position_id,
        {"name": payload.name, "sortOrder": payload.sort_order},
    )
    return await _position_response(connection, position_id)


async def update_position(
    connection: AsyncConnection,
    actor: AuthenticatedUser,
    position_id: UUID,
    payload: PositionUpdateRequest,
) -> PositionResponse:
    _require_admin(actor)
    existing = (
        await connection.execute(
            select(positions).where(positions.c.id == position_id).with_for_update()
        )
    ).mappings().first()
    if existing is None:
        raise DirectoryServiceError(404, "Position was not found")
    values: dict[str, Any] = {"updated_at": datetime.now(UTC)}
    if payload.name is not None and payload.name != existing["name"]:
        duplicate = await connection.scalar(
            select(positions.c.id).where(
                func.lower(positions.c.name) == payload.name.lower(),
                positions.c.id != position_id,
            )
        )
        if duplicate is not None:
            raise DirectoryServiceError(409, "Position name already exists")
        values["name"] = payload.name
    if payload.is_active is not None:
        values["is_active"] = payload.is_active
    if payload.sort_order is not None:
        values["sort_order"] = payload.sort_order
    await connection.execute(
        update(positions).where(positions.c.id == position_id).values(**values)
    )
    if "name" in values:
        await connection.execute(
            update(users)
            .where(users.c.position_id == position_id)
            .values(job_title=values["name"], updated_at=values["updated_at"])
        )
    await _audit(
        connection,
        actor,
        "position.updated",
        "position",
        position_id,
        {
            "before": {
                "name": existing["name"],
                "isActive": existing["is_active"],
                "sortOrder": existing["sort_order"],
            },
            "after": {
                "name": values.get("name", existing["name"]),
                "isActive": values.get("is_active", existing["is_active"]),
                "sortOrder": values.get("sort_order", existing["sort_order"]),
            },
        },
    )
    return await _position_response(connection, position_id)


async def update_employee_access(
    connection: AsyncConnection,
    actor: AuthenticatedUser,
    employee_id: UUID,
    payload: EmployeeAccessUpdateRequest,
) -> DirectoryEmployeeResponse:
    _require_admin(actor)
    employee = (
        await connection.execute(
            select(users).where(users.c.id == employee_id).with_for_update()
        )
    ).mappings().first()
    if employee is None:
        raise DirectoryServiceError(404, "Employee was not found")
    if employee["role"] == "superadmin" and actor.role != "superadmin":
        raise DirectoryServiceError(403, "Only a superadmin can edit a superadmin")
    if employee_id == actor.id and payload.role != actor.role:
        raise DirectoryServiceError(409, "You cannot change your own role")

    position_name = None
    if payload.position_id is not None:
        position = (
            await connection.execute(
                select(positions.c.name).where(
                    positions.c.id == payload.position_id,
                    positions.c.is_active.is_(True),
                )
            )
        ).mappings().first()
        if position is None:
            raise DirectoryServiceError(422, "Position is not active or does not exist")
        position_name = position["name"]
    now = datetime.now(UTC)
    await connection.execute(
        update(users)
        .where(users.c.id == employee_id)
        .values(
            role=payload.role,
            position_id=payload.position_id,
            job_title=position_name,
            updated_at=now,
        )
    )
    await _audit(
        connection,
        actor,
        "employee.access_updated",
        "user",
        employee_id,
        {
            "before": {
                "role": employee["role"],
                "positionId": str(employee["position_id"]) if employee["position_id"] else None,
            },
            "after": {
                "role": payload.role,
                "positionId": str(payload.position_id) if payload.position_id else None,
            },
        },
    )
    return DirectoryEmployeeResponse(
        id=str(employee_id),
        username=employee["username"],
        name=employee["full_name"],
        role=payload.role,
        position_id=str(payload.position_id) if payload.position_id else None,
        job_title=position_name,
        status=employee["status"],
    )
