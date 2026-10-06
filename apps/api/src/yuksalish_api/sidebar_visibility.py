from datetime import UTC, datetime
from uuid import UUID, uuid4

from sqlalchemy import insert, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncConnection

from .auth import AuthenticatedUser
from .errors import WorkspaceRepositoryError
from .tables import audit_events, sidebar_visibility, users
from .workspace_schemas import (
    NavigationKey,
    SidebarVisibilityResponse,
    SidebarVisibilityUpdate,
)


async def hidden_keys_for_user(
    connection: AsyncConnection, user_id: UUID,
) -> list[NavigationKey]:
    keys = await connection.scalar(
        select(sidebar_visibility.c.hidden_keys).where(sidebar_visibility.c.user_id == user_id)
    )
    return SidebarVisibilityResponse(user_id=str(user_id), hidden_keys=keys or []).hidden_keys


async def _require_target(
    connection: AsyncConnection, actor: AuthenticatedUser, user_id: UUID,
) -> None:
    if actor.role not in {"admin", "superadmin"}:
        raise WorkspaceRepositoryError(403, "Настраивать меню может только администратор")
    role = await connection.scalar(select(users.c.role).where(users.c.id == user_id))
    if role is None:
        raise WorkspaceRepositoryError(404, "Сотрудник не найден")
    if role == "superadmin" and actor.role != "superadmin":
        raise WorkspaceRepositoryError(
            403, "Меню суперадминистратора настраивает суперадминистратор",
        )


async def get_visibility(
    connection: AsyncConnection, actor: AuthenticatedUser, user_id: UUID,
) -> SidebarVisibilityResponse:
    await _require_target(connection, actor, user_id)
    row = (await connection.execute(
        select(sidebar_visibility).where(sidebar_visibility.c.user_id == user_id)
    )).mappings().first()
    return SidebarVisibilityResponse(
        user_id=str(user_id), hidden_keys=row["hidden_keys"] if row else [],
        revision=row["revision"] if row else 0,
    )


async def set_visibility(
    connection: AsyncConnection, actor: AuthenticatedUser, user_id: UUID,
    payload: SidebarVisibilityUpdate,
) -> SidebarVisibilityResponse:
    await _require_target(connection, actor, user_id)
    await connection.execute(pg_insert(sidebar_visibility).values(user_id=user_id)
                             .on_conflict_do_nothing(index_elements=[sidebar_visibility.c.user_id]))
    row = (await connection.execute(select(sidebar_visibility)
                                   .where(sidebar_visibility.c.user_id == user_id)
                                   .with_for_update())).mappings().one()
    if row["revision"] != payload.revision:
        raise WorkspaceRepositoryError(409, "Меню уже изменено. Обновите настройки и повторите.")
    revision = payload.revision + 1
    await connection.execute(update(sidebar_visibility)
                             .where(sidebar_visibility.c.user_id == user_id)
                             .values(hidden_keys=payload.hidden_keys, revision=revision,
                                     updated_by_user_id=actor.id, updated_at=datetime.now(UTC)))
    await connection.execute(insert(audit_events).values(
        id=uuid4(), actor_user_id=actor.id, action="employee.sidebar_updated",
        target_type="user", target_id=user_id,
        details={"before": row["hidden_keys"], "after": payload.hidden_keys},
        created_at=datetime.now(UTC),
    ))
    return SidebarVisibilityResponse(
        user_id=str(user_id), hidden_keys=payload.hidden_keys, revision=revision,
    )
