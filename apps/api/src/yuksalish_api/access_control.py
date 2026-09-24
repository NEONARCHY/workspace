from __future__ import annotations

from collections.abc import Mapping
from typing import Literal, Protocol
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncConnection

from .catalog import MODULE_CATALOG
from .tables import ai_referent_reviewers, departments, module_access_rules

ModuleAction = Literal["view", "create", "edit", "approve", "admin"]
MODULE_ACTIONS: tuple[ModuleAction, ...] = ("view", "create", "edit", "approve", "admin")
MODULE_KEYS = tuple(module.key for module in MODULE_CATALOG)


class AccessUser(Protocol):
    @property
    def id(self) -> UUID: ...

    @property
    def role(self) -> str: ...

    @property
    def department_id(self) -> UUID | None: ...

    @property
    def position_id(self) -> UUID | None: ...


def default_permissions(role: str) -> dict[ModuleAction, bool]:
    if role in {"superadmin", "admin"}:
        return {action: True for action in MODULE_ACTIONS}
    return {
        "view": True,
        "create": True,
        "edit": True,
        "approve": True,
        "admin": False,
    }


def normalize_permissions(value: Mapping[str, object]) -> dict[ModuleAction, bool]:
    normalized = {action: bool(value.get(action, False)) for action in MODULE_ACTIONS}
    if normalized["admin"]:
        return {action: True for action in MODULE_ACTIONS}
    if any(normalized[action] for action in ("create", "edit", "approve")):
        normalized["view"] = True
    if not normalized["view"]:
        return {action: False for action in MODULE_ACTIONS}
    return normalized


async def _department_ancestry(
    connection: AsyncConnection,
    department_id: UUID | None,
) -> list[str]:
    if department_id is None:
        return []
    rows = (await connection.execute(select(departments.c.id, departments.c.parent_id))).all()
    parents = {row.id: row.parent_id for row in rows}
    lineage: list[str] = []
    current: UUID | None = department_id
    visited: set[UUID] = set()
    while current is not None and current not in visited:
        visited.add(current)
        lineage.append(str(current))
        current = parents.get(current)
    lineage.reverse()
    return lineage


async def module_permissions_for_user(
    connection: AsyncConnection,
    user: AccessUser,
) -> dict[str, dict[ModuleAction, bool]]:
    if user.role in {"admin", "superadmin"}:
        return {module_key: default_permissions(user.role) for module_key in MODULE_KEYS}
    department_keys = await _department_ancestry(connection, user.department_id)
    position_subjects = (
        [("position", str(user.position_id))] if user.position_id is not None else []
    )
    subject_pairs = [
        ("role", user.role),
        *(("department", key) for key in department_keys),
        *position_subjects,
        ("user", str(user.id)),
    ]
    rows = (
        (
            await connection.execute(
                select(module_access_rules).where(
                    module_access_rules.c.subject_type.in_({item[0] for item in subject_pairs}),
                    module_access_rules.c.subject_key.in_({item[1] for item in subject_pairs}),
                )
            )
        )
        .mappings()
        .all()
    )
    by_subject = {
        (row["subject_type"], row["subject_key"], row["module_key"]): row["permissions"]
        for row in rows
    }
    result = {module_key: default_permissions(user.role) for module_key in MODULE_KEYS}
    if user.role not in {"admin", "superadmin"}:
        result["team_overview"] = {action: False for action in MODULE_ACTIONS}
        result["ai_referent"] = {
            "view": True,
            "create": True,
            "edit": True,
            "approve": user.role == "manager",
            "admin": False,
        }
        assigned = await connection.scalar(select(ai_referent_reviewers.c.key).where(
            ai_referent_reviewers.c.user_id == user.id,
            ai_referent_reviewers.c.enabled.is_(True),
        ).limit(1))
        if assigned is not None:
            result["ai_referent"]["approve"] = True
    ordered_subjects = [
        ("role", user.role),
        *(("department", key) for key in department_keys),
        *position_subjects,
        ("user", str(user.id)),
    ]
    for subject_type, subject_key in ordered_subjects:
        for module_key in MODULE_KEYS:
            rule = by_subject.get((subject_type, subject_key, module_key))
            if isinstance(rule, Mapping):
                result[module_key] = normalize_permissions(rule)
    if user.role not in {"admin", "superadmin"}:
        result["telegram_access"] = {action: False for action in MODULE_ACTIONS}
    return result


def request_module_action(path: str, method: str) -> tuple[str, ModuleAction] | None:
    normalized = path.removeprefix("/api/v1")
    upper_method = method.upper()
    if normalized in {"/auth/invitations", "/auth/password-resets"}:
        return "employees", "admin"
    if normalized.startswith("/auth/users/") and normalized.endswith("/password"):
        return "employees", "admin"
    if normalized in {"/workspace/bootstrap", "/directory"}:
        return ("employees", "view") if normalized == "/directory" else None
    if normalized.startswith("/directory/"):
        return "employees", "admin"
    if normalized.startswith("/administration/chats") or normalized.startswith(
        "/administration/chat-inspections"
    ):
        return "messenger", "admin"
    if normalized.startswith("/telegram-access"):
        return "telegram_access", "admin"
    prefixes = (
        (("/messenger/", "/chats/", "/messages/"), "messenger"),
        (("/tasks",), "tasks"),
        (("/approval-templates",), "payment_requests"),
        (("/approval-requests",), "payment_requests"),
        (("/ai-referent",), "ai_referent"),
        (("/projects",), "projects"),
        (("/trip-requests",), "trip_approvals"),
        (("/absence-requests",), "absences"),
        (("/zoom-meetings",), "zoom_meetings"),
        (("/members",), "members"),
        (("/hr",), "hr"),
        (("/feed",), "feed"),
        (("/calendar",), "calendar"),
        (("/efficiency",), "team_overview"),
    )
    module_key = next(
        (
            key
            for candidates, key in prefixes
            if any(
                normalized == candidate or normalized.startswith(candidate)
                for candidate in candidates
            )
        ),
        None,
    )
    if module_key is None:
        return None
    if normalized.startswith("/approval-templates"):
        return module_key, "admin"
    if normalized.endswith("/actions"):
        return module_key, "view"
    if normalized == "/ai-referent/telegram-link":
        return module_key, "view"
    if module_key == "tasks" and normalized.endswith(
        ("/accept-result", "/return-for-revision")
    ):
        return module_key, "approve"
    if upper_method == "GET":
        return module_key, "view"
    collection_paths = {
        "/tasks",
        "/approval-requests",
        "/ai-referent/letters",
        "/projects",
        "/trip-requests",
        "/absence-requests",
        "/zoom-meetings",
        "/feed/posts",
        "/calendar/events",
        "/messenger/chats",
        "/hr/registers/generate",
    }
    if upper_method == "POST" and normalized in collection_paths:
        return module_key, "create"
    return module_key, "edit"


async def ensure_request_module_access(
    connection: AsyncConnection,
    user: AccessUser,
    path: str,
    method: str,
) -> None:
    required = request_module_action(path, method)
    if required is None or user.role == "superadmin":
        return
    module_key, action = required
    await ensure_module_action(connection, user, module_key, action)


async def ensure_module_action(
    connection: AsyncConnection,
    user: AccessUser,
    module_key: str,
    action: ModuleAction,
) -> None:
    if user.role == "superadmin":
        return
    permissions = await module_permissions_for_user(connection, user)
    if not permissions.get(module_key, {}).get(action, False):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Module permission required: {module_key}.{action}",
        )
