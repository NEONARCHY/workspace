from datetime import UTC, datetime
from typing import Any
from uuid import UUID, uuid4

from sqlalchemy import delete, func, insert, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.engine import RowMapping
from sqlalchemy.ext.asyncio import AsyncConnection

from .access_control import MODULE_KEYS, normalize_permissions
from .administration_schemas import EmployeeStatusUpdateRequest
from .auth import AuthenticatedUser
from .catalog import MODULE_CATALOG
from .directory_schemas import (
    DepartmentCreateRequest,
    DepartmentResponse,
    DepartmentUpdateRequest,
    DirectoryBootstrapResponse,
    DirectoryEmployeeResponse,
    EmployeeAccessUpdateRequest,
    ModuleAccessDescriptorResponse,
    ModuleAccessRuleResponse,
    ModuleAccessRuleUpdateRequest,
    PositionCreateRequest,
    PositionResponse,
    PositionUpdateRequest,
    RoleDescriptorResponse,
)
from .tables import (
    audit_events,
    auth_invitations,
    auth_sessions,
    departments,
    module_access_rules,
    positions,
    users,
)
from .workspace_schemas import ModulePermissionSet


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
        (
            await connection.execute(
                select(
                    positions,
                    func.count(users.c.id).label("assigned_users_count"),
                )
                .outerjoin(users, users.c.position_id == positions.c.id)
                .where(positions.c.id == position_id)
                .group_by(positions.c.id)
            )
        )
        .mappings()
        .first()
    )
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


async def _department_response(
    connection: AsyncConnection,
    department_id: UUID,
) -> DepartmentResponse:
    row = (
        (
            await connection.execute(
                select(
                    departments,
                    func.count(users.c.id).label("assigned_users_count"),
                )
                .outerjoin(users, users.c.department_id == departments.c.id)
                .where(departments.c.id == department_id)
                .group_by(departments.c.id)
            )
        )
        .mappings()
        .first()
    )
    if row is None:
        raise DirectoryServiceError(404, "Department was not found")
    return DepartmentResponse(
        id=str(row["id"]),
        code=row["code"],
        name=row["name"],
        parent_id=str(row["parent_id"]) if row["parent_id"] else None,
        assigned_users_count=row["assigned_users_count"],
    )


def _module_access_rule(row: Any) -> ModuleAccessRuleResponse:
    return ModuleAccessRuleResponse(
        id=str(row["id"]),
        subject_type=row["subject_type"],
        subject_key=row["subject_key"],
        module_key=row["module_key"],
        permissions=ModulePermissionSet.model_validate(
            normalize_permissions(row["permissions"] or {})
        ),
    )


async def load_directory(
    connection: AsyncConnection,
    actor: AuthenticatedUser | None = None,
) -> DirectoryBootstrapResponse:
    department_rows = (
        (
            await connection.execute(
                select(
                    departments,
                    func.count(users.c.id).label("assigned_users_count"),
                )
                .outerjoin(users, users.c.department_id == departments.c.id)
                .group_by(departments.c.id)
                .order_by(departments.c.name)
            )
        )
        .mappings()
        .all()
    )
    position_rows = (
        (
            await connection.execute(
                select(
                    positions,
                    func.count(users.c.id).label("assigned_users_count"),
                )
                .outerjoin(users, users.c.position_id == positions.c.id)
                .group_by(positions.c.id)
                .order_by(positions.c.is_active.desc(), positions.c.sort_order, positions.c.name)
            )
        )
        .mappings()
        .all()
    )
    employee_rows = (
        (
            await connection.execute(
                select(
                    users.c.id,
                    users.c.username,
                    users.c.full_name,
                    users.c.role,
                    users.c.department_id,
                    users.c.position_id,
                    users.c.direct_manager_user_id,
                    func.coalesce(positions.c.name, users.c.job_title).label("job_title"),
                    users.c.status,
                )
                .outerjoin(positions, positions.c.id == users.c.position_id)
                .order_by(users.c.full_name)
            )
        )
        .mappings()
        .all()
    )
    access_rule_rows: list[RowMapping] = []
    if actor is None or actor.role in {"admin", "superadmin"}:
        access_rule_rows = list(
            (
                await connection.execute(
                    select(module_access_rules).order_by(
                        module_access_rules.c.subject_type,
                        module_access_rules.c.subject_key,
                        module_access_rules.c.module_key,
                    )
                )
            )
            .mappings()
            .all()
        )
    return DirectoryBootstrapResponse(
        roles=ROLE_DESCRIPTORS,
        departments=[
            DepartmentResponse(
                id=str(row["id"]),
                code=row["code"],
                name=row["name"],
                parent_id=str(row["parent_id"]) if row["parent_id"] else None,
                assigned_users_count=row["assigned_users_count"],
            )
            for row in department_rows
        ],
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
                department_id=(str(row["department_id"]) if row["department_id"] else None),
                position_id=str(row["position_id"]) if row["position_id"] else None,
                job_title=row["job_title"],
                status=row["status"],
                direct_manager_user_id=(
                    str(row["direct_manager_user_id"]) if row["direct_manager_user_id"] else None
                ),
            )
            for row in employee_rows
        ],
        modules=[
            ModuleAccessDescriptorResponse(
                key=module.key,
                label=module.label.ru,
                status=module.status,
            )
            for module in MODULE_CATALOG
        ],
        access_rules=[_module_access_rule(row) for row in access_rule_rows],
    )


async def create_department(
    connection: AsyncConnection,
    actor: AuthenticatedUser,
    payload: DepartmentCreateRequest,
) -> DepartmentResponse:
    _require_admin(actor)
    duplicate = await connection.scalar(
        select(departments.c.id).where(func.lower(departments.c.code) == payload.code.lower())
    )
    if duplicate is not None:
        raise DirectoryServiceError(409, "Department code already exists")
    if payload.parent_id is not None:
        parent_exists = await connection.scalar(
            select(departments.c.id).where(departments.c.id == payload.parent_id)
        )
        if parent_exists is None:
            raise DirectoryServiceError(422, "Parent department does not exist")
    department_id = uuid4()
    await connection.execute(
        insert(departments).values(
            id=department_id,
            code=payload.code,
            name=payload.name,
            parent_id=payload.parent_id,
            created_at=datetime.now(UTC),
        )
    )
    await _audit(
        connection,
        actor,
        "department.created",
        "department",
        department_id,
        {
            "code": payload.code,
            "name": payload.name,
            "parentId": str(payload.parent_id) if payload.parent_id else None,
        },
    )
    return await _department_response(connection, department_id)


async def update_department(
    connection: AsyncConnection,
    actor: AuthenticatedUser,
    department_id: UUID,
    payload: DepartmentUpdateRequest,
) -> DepartmentResponse:
    _require_admin(actor)
    existing = (
        (
            await connection.execute(
                select(departments).where(departments.c.id == department_id).with_for_update()
            )
        )
        .mappings()
        .first()
    )
    if existing is None:
        raise DirectoryServiceError(404, "Department was not found")
    values: dict[str, Any] = {}
    if payload.code is not None and payload.code.lower() != existing["code"].lower():
        duplicate = await connection.scalar(
            select(departments.c.id).where(
                func.lower(departments.c.code) == payload.code.lower(),
                departments.c.id != department_id,
            )
        )
        if duplicate is not None:
            raise DirectoryServiceError(409, "Department code already exists")
        values["code"] = payload.code
    if payload.name is not None:
        values["name"] = payload.name
    if "parent_id" in payload.model_fields_set:
        parent_id = payload.parent_id
        current = parent_id
        visited: set[UUID] = set()
        while current is not None:
            if current == department_id:
                raise DirectoryServiceError(409, "Department hierarchy cannot contain a cycle")
            if current in visited:
                raise DirectoryServiceError(409, "Department hierarchy already contains a cycle")
            visited.add(current)
            parent = (
                await connection.execute(
                    select(departments.c.parent_id).where(departments.c.id == current)
                )
            ).scalar_one_or_none()
            if parent is None:
                exists = await connection.scalar(
                    select(departments.c.id).where(departments.c.id == current)
                )
                if exists is None:
                    raise DirectoryServiceError(422, "Parent department does not exist")
            current = parent
        values["parent_id"] = parent_id
    if values:
        await connection.execute(
            update(departments).where(departments.c.id == department_id).values(**values)
        )
    await _audit(
        connection,
        actor,
        "department.updated",
        "department",
        department_id,
        {
            "before": {
                "code": existing["code"],
                "name": existing["name"],
                "parentId": (str(existing["parent_id"]) if existing["parent_id"] else None),
            },
            "after": {
                "code": values.get("code", existing["code"]),
                "name": values.get("name", existing["name"]),
                "parentId": (
                    str(values.get("parent_id", existing["parent_id"]))
                    if values.get("parent_id", existing["parent_id"])
                    else None
                ),
            },
        },
    )
    return await _department_response(connection, department_id)


async def _validate_access_subject(
    connection: AsyncConnection,
    subject_type: str,
    subject_key: str,
) -> None:
    if subject_type == "role":
        if subject_key not in {"admin", "manager", "employee"}:
            raise DirectoryServiceError(422, "Role cannot be configured")
        return
    try:
        subject_id = UUID(subject_key)
    except ValueError as error:
        raise DirectoryServiceError(422, "Access subject is invalid") from error
    table = departments if subject_type == "department" else users
    if await connection.scalar(select(table.c.id).where(table.c.id == subject_id)) is None:
        raise DirectoryServiceError(404, "Access subject was not found")


async def set_module_access_rule(
    connection: AsyncConnection,
    actor: AuthenticatedUser,
    subject_type: str,
    subject_key: str,
    module_key: str,
    payload: ModuleAccessRuleUpdateRequest,
) -> ModuleAccessRuleResponse:
    _require_admin(actor)
    if subject_type not in {"role", "department", "user"}:
        raise DirectoryServiceError(422, "Access subject type is invalid")
    if module_key not in MODULE_KEYS:
        raise DirectoryServiceError(422, "Module is invalid")
    await _validate_access_subject(connection, subject_type, subject_key)
    now = datetime.now(UTC)
    values = {
        "permissions": normalize_permissions(payload.permissions.model_dump()),
        "created_by_user_id": actor.id,
        "updated_at": now,
    }
    row = (
        (
            await connection.execute(
                pg_insert(module_access_rules)
                .values(
                    id=uuid4(),
                    subject_type=subject_type,
                    subject_key=subject_key,
                    module_key=module_key,
                    created_at=now,
                    **values,
                )
                .on_conflict_do_update(
                    constraint="uq_core_module_access_rule_subject_module",
                    set_=values,
                )
                .returning(module_access_rules)
            )
        )
        .mappings()
        .one()
    )
    await _audit(
        connection,
        actor,
        "module_access_rule.updated",
        "module_access_rule",
        row["id"],
        {
            "subjectType": subject_type,
            "subjectKey": subject_key,
            "moduleKey": module_key,
            "permissions": values["permissions"],
        },
    )
    return _module_access_rule(row)


async def delete_module_access_rule(
    connection: AsyncConnection,
    actor: AuthenticatedUser,
    subject_type: str,
    subject_key: str,
    module_key: str,
) -> None:
    _require_admin(actor)
    existing = (
        (
            await connection.execute(
                select(module_access_rules).where(
                    module_access_rules.c.subject_type == subject_type,
                    module_access_rules.c.subject_key == subject_key,
                    module_access_rules.c.module_key == module_key,
                )
            )
        )
        .mappings()
        .first()
    )
    if existing is None:
        return
    await connection.execute(
        delete(module_access_rules).where(module_access_rules.c.id == existing["id"])
    )
    await _audit(
        connection,
        actor,
        "module_access_rule.deleted",
        "module_access_rule",
        existing["id"],
        {"subjectType": subject_type, "subjectKey": subject_key, "moduleKey": module_key},
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
        (
            await connection.execute(
                select(positions).where(positions.c.id == position_id).with_for_update()
            )
        )
        .mappings()
        .first()
    )
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


async def delete_position(
    connection: AsyncConnection,
    actor: AuthenticatedUser,
    position_id: UUID,
) -> int:
    """Remove a position and clear its assignment from every employee."""
    _require_admin(actor)
    existing = (
        (
            await connection.execute(
                select(positions).where(positions.c.id == position_id).with_for_update()
            )
        )
        .mappings()
        .first()
    )
    if existing is None:
        raise DirectoryServiceError(404, "Position was not found")

    now = datetime.now(UTC)
    detached = await connection.execute(
        update(users)
        .where(users.c.position_id == position_id)
        .values(position_id=None, job_title=None, updated_at=now)
    )
    detached_count = detached.rowcount or 0
    await connection.execute(delete(positions).where(positions.c.id == position_id))
    await _audit(
        connection,
        actor,
        "position.deleted",
        "position",
        position_id,
        {"name": existing["name"], "detachedUsersCount": detached_count},
    )
    return detached_count


async def update_employee_access(
    connection: AsyncConnection,
    actor: AuthenticatedUser,
    employee_id: UUID,
    payload: EmployeeAccessUpdateRequest,
) -> DirectoryEmployeeResponse:
    _require_admin(actor)
    employee = (
        (await connection.execute(select(users).where(users.c.id == employee_id).with_for_update()))
        .mappings()
        .first()
    )
    if employee is None:
        raise DirectoryServiceError(404, "Employee was not found")
    if employee["role"] == "superadmin" and actor.role != "superadmin":
        raise DirectoryServiceError(403, "Only a superadmin can edit a superadmin")
    if employee_id == actor.id and payload.role != actor.role:
        raise DirectoryServiceError(409, "You cannot change your own role")
    if payload.direct_manager_user_id == employee_id:
        raise DirectoryServiceError(422, "Employee cannot be their own direct manager")
    if payload.direct_manager_user_id is not None:
        manager = (
            (
                await connection.execute(
                    select(users.c.id, users.c.status).where(
                        users.c.id == payload.direct_manager_user_id
                    )
                )
            )
            .mappings()
            .first()
        )
        if manager is None or manager["status"] != "active":
            raise DirectoryServiceError(422, "Direct manager must be an active employee")

    position_name = None
    if payload.position_id is not None:
        position = (
            (
                await connection.execute(
                    select(positions.c.name).where(
                        positions.c.id == payload.position_id,
                        positions.c.is_active.is_(True),
                    )
                )
            )
            .mappings()
            .first()
        )
        if position is None:
            raise DirectoryServiceError(422, "Position is not active or does not exist")
        position_name = position["name"]
    if payload.department_id is not None:
        department_exists = await connection.scalar(
            select(departments.c.id).where(departments.c.id == payload.department_id)
        )
        if department_exists is None:
            raise DirectoryServiceError(422, "Department does not exist")
    now = datetime.now(UTC)
    await connection.execute(
        update(users)
        .where(users.c.id == employee_id)
        .values(
            role=payload.role,
            department_id=payload.department_id,
            position_id=payload.position_id,
            job_title=position_name,
            direct_manager_user_id=payload.direct_manager_user_id,
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
                "departmentId": (
                    str(employee["department_id"]) if employee["department_id"] else None
                ),
                "positionId": str(employee["position_id"]) if employee["position_id"] else None,
            },
            "after": {
                "role": payload.role,
                "departmentId": (str(payload.department_id) if payload.department_id else None),
                "positionId": str(payload.position_id) if payload.position_id else None,
                "directManagerUserId": str(payload.direct_manager_user_id)
                if payload.direct_manager_user_id
                else None,
            },
        },
    )
    return DirectoryEmployeeResponse(
        id=str(employee_id),
        username=employee["username"],
        name=employee["full_name"],
        role=payload.role,
        department_id=str(payload.department_id) if payload.department_id else None,
        position_id=str(payload.position_id) if payload.position_id else None,
        job_title=position_name,
        status=employee["status"],
        direct_manager_user_id=(
            str(payload.direct_manager_user_id) if payload.direct_manager_user_id else None
        ),
    )


async def update_employee_status(
    connection: AsyncConnection,
    actor: AuthenticatedUser,
    employee_id: UUID,
    payload: EmployeeStatusUpdateRequest,
) -> DirectoryEmployeeResponse:
    _require_admin(actor)
    employee = (
        (await connection.execute(select(users).where(users.c.id == employee_id).with_for_update()))
        .mappings()
        .first()
    )
    if employee is None:
        raise DirectoryServiceError(404, "Employee was not found")
    if employee_id == actor.id:
        raise DirectoryServiceError(409, "You cannot change your own account status")
    if employee["role"] == "superadmin" and actor.role != "superadmin":
        raise DirectoryServiceError(403, "Only a superadmin can manage a superadmin")
    if employee["role"] == "admin" and actor.role != "superadmin":
        raise DirectoryServiceError(403, "Only a superadmin can manage an administrator")
    if employee["role"] == "superadmin" and payload.status != "active":
        active_superadmins = int(
            await connection.scalar(
                select(func.count(users.c.id)).where(
                    users.c.role == "superadmin",
                    users.c.status == "active",
                )
            )
            or 0
        )
        if active_superadmins <= 1:
            raise DirectoryServiceError(409, "The last active superadmin cannot be disabled")
    if payload.status == "active" and not employee["password_hash"]:
        raise DirectoryServiceError(
            409,
            "An account without an activated password cannot be restored; send a new invitation",
        )
    if employee["status"] == payload.status:
        raise DirectoryServiceError(409, "Employee already has this status")

    now = datetime.now(UTC)
    await connection.execute(
        update(users)
        .where(users.c.id == employee_id)
        .values(
            status=payload.status,
            failed_login_count=0,
            locked_until=None,
            updated_at=now,
        )
    )
    if payload.status != "active":
        await connection.execute(
            update(auth_sessions)
            .where(
                auth_sessions.c.user_id == employee_id,
                auth_sessions.c.revoked_at.is_(None),
            )
            .values(revoked_at=now)
        )
        await connection.execute(
            update(auth_invitations)
            .where(
                auth_invitations.c.user_id == employee_id,
                auth_invitations.c.accepted_at.is_(None),
                auth_invitations.c.revoked_at.is_(None),
            )
            .values(revoked_at=now)
        )
    await _audit(
        connection,
        actor,
        "employee.status_updated",
        "user",
        employee_id,
        {
            "before": employee["status"],
            "after": payload.status,
            "reason": payload.reason,
            "sessionsRevoked": payload.status != "active",
        },
    )
    return DirectoryEmployeeResponse(
        id=str(employee_id),
        username=employee["username"],
        name=employee["full_name"],
        role=employee["role"],
        department_id=str(employee["department_id"]) if employee["department_id"] else None,
        position_id=str(employee["position_id"]) if employee["position_id"] else None,
        job_title=employee["job_title"],
        status=payload.status,
    )
