"""Object-level HR privacy. Public profiles and directory payloads stay unchanged."""

import asyncio
import re
from dataclasses import dataclass
from datetime import UTC, datetime
from uuid import UUID, uuid4

from sqlalchemy import ColumnElement, delete, func, or_, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncConnection

from .access_control import module_permissions_for_user
from .auth import AuthenticatedUser
from .dossier_documents import render_dossier_docx
from .dossier_import import parse_dossier
from .dossier_schemas import (
    DossierAccessRule,
    DossierAccessSettings,
    DossierAccessWrite,
    DossierContext,
    DossierDetail,
    DossierFields,
    DossierHistory,
    DossierImportPreview,
    DossierPermissions,
    DossierSummary,
    DossierWrite,
    PhotoCard,
)
from .dossier_tables import (
    dossier_access_rules,
    dossier_access_settings,
    dossier_history,
    dossiers,
)
from .errors import WorkspaceRepositoryError
from .object_storage import ObjectStorage
from .position_policy import is_executive_leader
from .tables import audit_events, departments, hr_settings, users


def is_photo_roster_leader(title: str | None) -> bool:
    """Only the chairman and actual deputies, never assistants or generic managers."""
    normalized = " ".join((title or "").translate(str.maketrans(
        "\u2018\u2019\u02bb\u02bc`", "'''''",
    )).casefold().split())
    return is_executive_leader(title) or bool(re.fullmatch(
        r"rais(?:ning)? (?:birinchi )?o'rinbosari(?:\s*[\u2013\u2014-]\s*ijrochi direktor)?",
        normalized,
    ))


@dataclass(frozen=True)
class DossierPolicy:
    actor_id: UUID
    full_view: bool
    full_edit: bool
    photo_all: bool
    manage_access: bool
    rules: tuple[DossierAccessRule, ...]

    def allowed(self, target_id: UUID, department_id: UUID | None, action: str) -> bool:
        if action != "photo_roster" and target_id == self.actor_id:
            return True
        if {"view": self.full_view, "edit": self.full_edit,
            "photo_roster": self.photo_all}[action]:
            return True
        return any(getattr(rule, action) and (
            rule.scope == "all" or (rule.scope == "employee" and rule.scope_id == target_id)
            or (rule.scope == "department" and rule.scope_id == department_id)
        ) for rule in self.rules)

    def condition(self, action: str) -> ColumnElement[bool]:
        if {"view": self.full_view, "edit": self.full_edit,
            "photo_roster": self.photo_all}[action]:
            return users.c.id.is_not(None)
        clauses = [] if action == "photo_roster" else [users.c.id == self.actor_id]
        for rule in self.rules:
            if not getattr(rule, action):
                continue
            if rule.scope == "all":
                return users.c.id.is_not(None)
            clauses.append((users.c.id if rule.scope == "employee" else users.c.department_id)
                           == rule.scope_id)
        return or_(False, *clauses)


async def policy(connection: AsyncConnection, actor: AuthenticatedUser) -> DossierPolicy:
    admin = actor.role in {"admin", "superadmin"}
    settings = (await connection.execute(select(hr_settings))).mappings().first()
    hr = bool(settings and settings["hr_user_id"] == actor.id)
    permissions = (await module_permissions_for_user(connection, actor))["hr"] if hr else {}
    rules = (await connection.execute(select(dossier_access_rules).where(
        dossier_access_rules.c.grantee_user_id == actor.id,
    ))).mappings()
    leader = is_photo_roster_leader(actor.job_title) or bool(
        settings and settings["chair_user_id"] == actor.id
    )
    return DossierPolicy(
        actor.id, admin or (hr and permissions.get("view", False)),
        admin or (hr and permissions.get("edit", False)),
        admin or (hr and permissions.get("view", False)) or leader, admin,
        tuple(DossierAccessRule.model_validate({key: row[key] for key in
              DossierAccessRule.model_fields}) for row in rules),
    )


async def context(connection: AsyncConnection, actor: AuthenticatedUser) -> DossierContext:
    access = await policy(connection, actor)
    return DossierContext(can_manage_access=access.manage_access,
                          can_view_photo_roster=access.photo_all or any(
                              r.photo_roster for r in access.rules))


async def _audit(
    connection: AsyncConnection, actor: AuthenticatedUser, target: UUID | None,
    action: str, details: dict[str, object],
) -> None:
    await connection.execute(audit_events.insert().values(
        id=uuid4(), actor_user_id=actor.id, action=f"dossier.{action}",
        target_type="personnel_dossier", target_id=target or actor.id, details=details,
        created_at=datetime.now(UTC),
    ))


async def _target(
    connection: AsyncConnection, actor: AuthenticatedUser, target_id: UUID, action: str,
) -> DossierPermissions:
    access = await policy(connection, actor)
    row = (await connection.execute(select(users.c.id, users.c.department_id).where(
        users.c.id == target_id, users.c.status == "active",
    ))).first()
    if not row or not access.allowed(target_id, row.department_id, action):
        raise WorkspaceRepositoryError(403, "Нет доступа к объективке этого сотрудника")
    return DossierPermissions(can_view=access.allowed(target_id, row.department_id, "view"),
                              can_edit=access.allowed(target_id, row.department_id, "edit"))


async def permissions(
    connection: AsyncConnection, actor: AuthenticatedUser, target_id: UUID,
) -> DossierPermissions:
    try:
        return await _target(connection, actor, target_id, "view")
    except WorkspaceRepositoryError as error:
        if error.status_code != 403:
            raise
        return DossierPermissions(can_view=False, can_edit=False)


async def listing(
    connection: AsyncConnection, actor: AuthenticatedUser,
) -> list[DossierSummary]:
    access = await policy(connection, actor)
    rows = (await connection.execute(select(
        users.c.id, users.c.full_name, users.c.job_title, users.c.department_id,
        dossiers.c.status, dossiers.c.updated_at,
    ).select_from(users.outerjoin(dossiers, dossiers.c.user_id == users.c.id)).where(
        users.c.status == "active", access.condition("view"),
    ).order_by(users.c.full_name))).mappings()
    return [DossierSummary(user_id=r["id"], full_name=r["full_name"], job_title=r["job_title"],
                           department_id=r["department_id"], status=r["status"] or "empty",
                           updated_at=r["updated_at"]) for r in rows]


async def detail(
    connection: AsyncConnection, actor: AuthenticatedUser, target_id: UUID,
) -> DossierDetail:
    rights = await _target(connection, actor, target_id, "view")
    row = (await connection.execute(select(
        users.c.full_name, users.c.job_title, dossiers.c.data, dossiers.c.status,
        dossiers.c.revision, dossiers.c.updated_at,
    ).select_from(users.outerjoin(dossiers, dossiers.c.user_id == users.c.id)).where(
        users.c.id == target_id,
    ))).mappings().one()
    await _audit(connection, actor, target_id, "viewed", {})
    return DossierDetail(user_id=target_id, full_name=row["full_name"], job_title=row["job_title"],
                         revision=row["revision"] or 0, status=row["status"] or "empty",
                         fields=DossierFields.model_validate(row["data"] or {}),
                         updated_at=row["updated_at"], permissions=rights)


async def save(
    connection: AsyncConnection, actor: AuthenticatedUser, target_id: UUID, payload: DossierWrite,
) -> DossierDetail:
    await _target(connection, actor, target_id, "edit")
    # Serialize first saves as well as updates; revision is still checked after acquiring the lock.
    await connection.execute(select(func.pg_advisory_xact_lock(target_id.int % (2**63))))
    row = (await connection.execute(select(dossiers).where(
        dossiers.c.user_id == target_id,
    ))).mappings().first()
    revision = row["revision"] if row else 0
    if payload.revision != revision:
        raise WorkspaceRepositoryError(
            409, "Объективка уже изменена. Обновите её перед сохранением",
        )
    data = payload.fields.model_dump(mode="json", by_alias=True)
    old = dict(row["data"]) if row else {}
    changed = sorted(key for key, value in data.items() if old.get(key) != value)
    if not row or row["status"] != payload.status:
        changed.append("status")
    now = datetime.now(UTC)
    statement = pg_insert(dossiers).values(user_id=target_id, revision=revision + 1,
                                         status=payload.status, data=data, updated_at=now)
    await connection.execute(statement.on_conflict_do_update(
        index_elements=[dossiers.c.user_id], set_={"revision": revision + 1,
        "status": payload.status, "data": data, "updated_at": now},
    ))
    await connection.execute(dossier_history.insert().values(
        id=uuid4(), user_id=target_id, actor_user_id=actor.id, revision=revision + 1,
        changed_fields=changed, created_at=now,
    ))
    await _audit(connection, actor, target_id, "saved", {"revision": revision + 1,
                                                       "changedFields": changed})
    return await detail(connection, actor, target_id)


async def history(
    connection: AsyncConnection, actor: AuthenticatedUser, target_id: UUID,
) -> list[DossierHistory]:
    await _target(connection, actor, target_id, "view")
    rows = (await connection.execute(select(
        dossier_history.c.revision, users.c.full_name, dossier_history.c.changed_fields,
        dossier_history.c.created_at,
    ).join(users, users.c.id == dossier_history.c.actor_user_id).where(
        dossier_history.c.user_id == target_id,
    ).order_by(dossier_history.c.revision.desc()).limit(100))).mappings()
    return [DossierHistory(revision=r["revision"], actor_name=r["full_name"],
                           changed_fields=r["changed_fields"], created_at=r["created_at"])
            for r in rows]


async def document_source(
    connection: AsyncConnection, actor: AuthenticatedUser, target_id: UUID,
    revision: int, storage: ObjectStorage,
) -> bytes:
    record = await detail(connection, actor, target_id)
    if record.revision == 0 or record.revision != revision:
        raise WorkspaceRepositoryError(409, "Сохраните и обновите объективку перед скачиванием")
    key = await connection.scalar(select(users.c.avatar_storage_key).where(users.c.id == target_id))
    photo = await storage.get(key) if key else None
    try:
        content = await asyncio.to_thread(render_dossier_docx, record, photo)
    except ValueError as error:
        raise WorkspaceRepositoryError(422, str(error)) from error
    return content


async def record_export(
    connection: AsyncConnection, actor: AuthenticatedUser, target_id: UUID,
    revision: int, kind: str,
) -> None:
    await _target(connection, actor, target_id, "view")
    await _audit(connection, actor, target_id, f"{kind}_exported", {"revision": revision})


async def export_word(
    connection: AsyncConnection, actor: AuthenticatedUser, target_id: UUID,
    revision: int, storage: ObjectStorage,
) -> bytes:
    content = await document_source(connection, actor, target_id, revision, storage)
    await record_export(connection, actor, target_id, revision, "word")
    return content


async def ensure_import_access(
    connection: AsyncConnection, actor: AuthenticatedUser, target_id: UUID,
) -> None:
    await _target(connection, actor, target_id, "edit")


async def import_preview(
    connection: AsyncConnection, actor: AuthenticatedUser, target_id: UUID, content: bytes,
) -> DossierImportPreview:
    await ensure_import_access(connection, actor, target_id)
    try:
        result = await asyncio.to_thread(parse_dossier, content)
    except ValueError as error:
        raise WorkspaceRepositoryError(422, str(error)) from error
    await _audit(connection, actor, target_id, "import_previewed",
                 {"fieldCount": len(result.detected_fields)})
    return result


async def photos(connection: AsyncConnection, actor: AuthenticatedUser) -> list[PhotoCard]:
    access = await policy(connection, actor)
    if not access.photo_all and not any(r.photo_roster for r in access.rules):
        raise WorkspaceRepositoryError(403, "Нет доступа к реестру фотокарточек")
    # Project only the permitted subset: no birthplace, employment, notes or full questionnaire.
    rows = (await connection.execute(select(
        users.c.id, users.c.full_name, users.c.job_title, users.c.department_id,
        dossiers.c.data["birthDate"].astext.label("birth_date"),
        dossiers.c.data["education"].label("education"),
    ).select_from(users.outerjoin(dossiers, dossiers.c.user_id == users.c.id)).where(
        users.c.status == "active", access.condition("photo_roster"),
    ).order_by(users.c.full_name))).mappings()
    result = [PhotoCard(user_id=r["id"], full_name=r["full_name"], job_title=r["job_title"],
                        department_id=r["department_id"],
                        birth_year=int(r["birth_date"][:4]) if r["birth_date"] else None,
                        universities=[item["institution"] for item in r["education"] or []])
              for r in rows]
    await _audit(connection, actor, None, "photo_roster_viewed", {"count": len(result)})
    return result


def _require_admin(actor: AuthenticatedUser) -> None:
    if actor.role not in {"admin", "superadmin"}:
        raise WorkspaceRepositoryError(403, "Только администратор настраивает доступ к объективкам")


async def get_access(
    connection: AsyncConnection, actor: AuthenticatedUser,
) -> DossierAccessSettings:
    _require_admin(actor)
    revision = await connection.scalar(select(dossier_access_settings.c.revision))
    rows = (await connection.execute(select(dossier_access_rules))).mappings()
    return DossierAccessSettings(revision=revision or 0, rules=[
        DossierAccessRule.model_validate({key: row[key] for key in DossierAccessRule.model_fields})
        for row in rows
    ])


async def save_access(
    connection: AsyncConnection, actor: AuthenticatedUser, payload: DossierAccessWrite,
) -> DossierAccessSettings:
    _require_admin(actor)
    revision = await connection.scalar(select(dossier_access_settings.c.revision).where(
        dossier_access_settings.c.id == 1,
    ).with_for_update())
    if revision != payload.revision:
        raise WorkspaceRepositoryError(409, "Правила уже изменились. Обновите список")
    for rule in payload.rules:
        valid_grantee = await connection.scalar(select(users.c.id).where(
            users.c.id == rule.grantee_user_id, users.c.status == "active",
        ))
        target = users if rule.scope == "employee" else departments
        valid_scope = rule.scope == "all" or await connection.scalar(select(target.c.id).where(
            target.c.id == rule.scope_id,
            *([users.c.status == "active"] if rule.scope == "employee" else []),
        )) is not None
        if not valid_grantee or not valid_scope:
            raise WorkspaceRepositoryError(422, "Проверьте сотрудника и область доступа")
    await connection.execute(delete(dossier_access_rules))
    if payload.rules:
        await connection.execute(dossier_access_rules.insert(), [
            {"id": uuid4(), **rule.model_dump()} for rule in payload.rules
        ])
    await connection.execute(dossier_access_settings.update().where(
        dossier_access_settings.c.id == 1,
    ).values(revision=payload.revision + 1))
    await _audit(connection, actor, None, "access_updated", {
        "revision": payload.revision + 1, "ruleCount": len(payload.rules), "reason": payload.reason,
    })
    return await get_access(connection, actor)
