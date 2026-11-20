from dataclasses import replace
from datetime import UTC, datetime
from uuid import uuid4

from sqlalchemy import insert, update
from sqlalchemy.ext.asyncio import AsyncConnection

from .auth import AuthenticatedUser
from .auth_service import AuthServiceError
from .tables import audit_events, auth_sessions


async def set_admin_mode(
    connection: AsyncConnection, actor: AuthenticatedUser, enabled: bool,
) -> AuthenticatedUser:
    # Only the authenticated account's real role can restore privileges. A
    # position/module permission can never promote an employee to administrator.
    account_role = actor.account_role or actor.role
    if account_role not in {"admin", "superadmin"}:
        raise AuthServiceError(403, "Режим администратора доступен только администраторам.")
    if actor.session_id is None:
        raise AuthServiceError(409, "Для переключения режима используйте вход по паролю.")
    changed = await connection.execute(update(auth_sessions).where(
        auth_sessions.c.id == actor.session_id,
        auth_sessions.c.user_id == actor.id,
        auth_sessions.c.revoked_at.is_(None),
        auth_sessions.c.expires_at > datetime.now(UTC),
    ).values(admin_mode_enabled=enabled).returning(auth_sessions.c.id))
    if changed.scalar_one_or_none() is None:
        raise AuthServiceError(401, "Сессия завершена. Войдите снова.")
    if actor.admin_mode_enabled != enabled:
        await connection.execute(insert(audit_events).values(
            id=uuid4(), actor_user_id=actor.id, action="auth.admin_mode_changed",
            target_type="auth_session", target_id=actor.session_id,
            details={"enabled": enabled}, created_at=datetime.now(UTC),
        ))
    return replace(actor, role=account_role if enabled else "employee",
                   account_role=account_role, admin_mode_enabled=enabled)
