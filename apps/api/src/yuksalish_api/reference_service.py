"""Persistent reference records with optimistic revisions and an audit trail."""

from datetime import UTC, datetime
from pathlib import PurePath
from uuid import UUID, uuid4

from sqlalchemy import insert, select, update
from sqlalchemy.ext.asyncio import AsyncConnection

from .auth import AuthenticatedUser
from .errors import WorkspaceRepositoryError
from .object_storage import ObjectStorage
from .project_import_documents import document_type
from .reference_schemas import (
    ExpertFields,
    ExpertResponse,
    ExpertWrite,
    PartnerFields,
    PartnerResponse,
    PartnerWrite,
    ProfileResponse,
    ProfileWrite,
    ReferenceChange,
    ReferenceDirectoryResponse,
    TemplateFields,
    TemplateResponse,
    TemplateVersionResponse,
    TemplateWrite,
)
from .tables import (
    audit_events,
    reference_experts,
    reference_partners,
    reference_profile,
    reference_template_versions,
    reference_templates,
)


def _now() -> datetime:
    return datetime.now(UTC)


async def _audit(
    connection: AsyncConnection, user: AuthenticatedUser, action: str,
    target_type: str, target_id: UUID, details: dict[str, object] | None = None,
) -> None:
    await connection.execute(insert(audit_events).values(
        id=uuid4(), actor_user_id=user.id, action=action,
        target_type=target_type, target_id=target_id,
        details=details or {}, created_at=_now(),
    ))


async def load_directory(
    connection: AsyncConnection, *, include_drafts: bool = False,
) -> ReferenceDirectoryResponse:
    profile_row = (await connection.execute(
        select(reference_profile).where(reference_profile.c.id == 1)
    )).mappings().first()
    partners = (await connection.execute(
        select(reference_partners).order_by(reference_partners.c.name)
    )).mappings().all()
    experts = (await connection.execute(
        select(reference_experts).order_by(reference_experts.c.name)
    )).mappings().all()
    templates = (await connection.execute(
        select(reference_templates).order_by(reference_templates.c.title)
    )).mappings().all()
    versions = (await connection.execute(
        select(reference_template_versions).order_by(
            reference_template_versions.c.template_id,
            reference_template_versions.c.version.desc(),
        )
    )).mappings().all()
    by_template: dict[UUID, list[TemplateVersionResponse]] = {}
    for version in versions:
        by_template.setdefault(version["template_id"], []).append(
            TemplateVersionResponse.model_validate(version)
        )
    visible_templates = [
        row for row in templates if include_drafts or by_template.get(row["id"])
    ]
    visible_template_ids = {row["id"] for row in visible_templates}
    changes = (await connection.execute(select(audit_events).where(
        audit_events.c.target_type.in_((
            "reference_profile", "reference_partner", "reference_expert", "reference_template",
        )),
    ).order_by(audit_events.c.created_at.desc()).limit(40))).mappings().all()
    return ReferenceDirectoryResponse(
        profile=ProfileResponse.model_validate(profile_row) if profile_row else ProfileResponse(),
        partners=[PartnerResponse.model_validate({**row, "tin": row["tin"] or ""})
                  for row in partners],
        experts=[ExpertResponse.model_validate(row) for row in experts],
        templates=[TemplateResponse.model_validate({
            **row, "versions": by_template.get(row["id"], []),
        }) for row in visible_templates],
        changes=[ReferenceChange.model_validate(row) for row in changes
                 if row["target_type"] != "reference_template"
                 or row["target_id"] in visible_template_ids],
    )


async def save_profile(
    connection: AsyncConnection, user: AuthenticatedUser, value: ProfileWrite,
) -> ProfileResponse:
    row = (await connection.execute(
        select(reference_profile).where(reference_profile.c.id == 1).with_for_update()
    )).mappings().first()
    current_revision = row["revision"] if row else 0
    if current_revision != value.expected_revision:
        raise WorkspaceRepositoryError(409, "Реквизиты изменились. Обновите страницу и повторите.")
    fields = value.model_dump(exclude={"expected_revision"})
    if row:
        await connection.execute(
            update(reference_profile).where(reference_profile.c.id == 1).values(
                **fields, revision=current_revision + 1,
                updated_by_user_id=user.id, updated_at=_now(),
            )
        )
    else:
        await connection.execute(insert(reference_profile).values(
            id=1, **fields, revision=1, updated_by_user_id=user.id, updated_at=_now(),
        ))
    await _audit(connection, user, "reference.profile.updated", "reference_profile", UUID(int=1),
                 {"revision": current_revision + 1})
    result = (await connection.execute(
        select(reference_profile).where(reference_profile.c.id == 1)
    )).mappings().one()
    return ProfileResponse.model_validate(result)


async def _check_partner_duplicate(
    connection: AsyncConnection, value: PartnerFields, skip_id: UUID | None = None,
) -> None:
    rows = (await connection.execute(select(
        reference_partners.c.id, reference_partners.c.name, reference_partners.c.tin,
    ).where(reference_partners.c.archived.is_(False)))).all()
    for row in rows:
        if row.id == skip_id:
            continue
        if value.tin and row.tin == value.tin:
            raise WorkspaceRepositoryError(409, "Этот ИНН уже закреплён за другой организацией.")
        if row.name.casefold().strip() == value.name.casefold().strip():
            raise WorkspaceRepositoryError(
                409, "Это название уже закреплено за другой организацией."
            )


async def create_partner(
    connection: AsyncConnection, user: AuthenticatedUser, value: PartnerFields,
) -> PartnerResponse:
    await _check_partner_duplicate(connection, value)
    partner_id = uuid4()
    await connection.execute(insert(reference_partners).values(
        id=partner_id, **value.model_dump(exclude={"tin"}), tin=value.tin or None,
        archived=False, revision=1, created_at=_now(), updated_at=_now(),
        updated_by_user_id=user.id,
    ))
    await _audit(connection, user, "reference.partner.created", "reference_partner", partner_id)
    row = (await connection.execute(select(reference_partners).where(
        reference_partners.c.id == partner_id,
    ))).mappings().one()
    return PartnerResponse.model_validate({**row, "tin": row["tin"] or ""})


async def save_partner(
    connection: AsyncConnection, user: AuthenticatedUser, partner_id: UUID, value: PartnerWrite,
) -> PartnerResponse:
    row = (await connection.execute(select(reference_partners).where(
        reference_partners.c.id == partner_id,
    ).with_for_update())).mappings().first()
    if not row:
        raise WorkspaceRepositoryError(404, "Организация не найдена")
    if row["revision"] != value.expected_revision:
        raise WorkspaceRepositoryError(409, "Организация изменилась. Обновите список.")
    if not value.archived:
        await _check_partner_duplicate(connection, value, partner_id)
    await connection.execute(update(reference_partners).where(
        reference_partners.c.id == partner_id,
    ).values(**value.model_dump(exclude={"expected_revision", "tin"}),
             tin=value.tin or None, revision=row["revision"] + 1,
             updated_at=_now(), updated_by_user_id=user.id))
    await _audit(connection, user, "reference.partner.updated", "reference_partner", partner_id,
                 {"archived": value.archived, "revision": row["revision"] + 1})
    changed = (await connection.execute(select(reference_partners).where(
        reference_partners.c.id == partner_id,
    ))).mappings().one()
    return PartnerResponse.model_validate({**changed, "tin": changed["tin"] or ""})


async def _check_expert_partner(connection: AsyncConnection, partner_id: UUID | None) -> None:
    if partner_id is None:
        return
    found = await connection.scalar(select(reference_partners.c.id).where(
        reference_partners.c.id == partner_id,
        reference_partners.c.archived.is_(False),
    ))
    if found is None:
        raise WorkspaceRepositoryError(422, "Выберите действующую организацию")


async def create_expert(
    connection: AsyncConnection, user: AuthenticatedUser, value: ExpertFields,
) -> ExpertResponse:
    await _check_expert_partner(connection, value.partner_id)
    expert_id = uuid4()
    await connection.execute(insert(reference_experts).values(
        id=expert_id, **value.model_dump(), archived=False, revision=1,
        created_at=_now(), updated_at=_now(), updated_by_user_id=user.id,
    ))
    await _audit(connection, user, "reference.expert.created", "reference_expert", expert_id)
    row = (await connection.execute(select(reference_experts).where(
        reference_experts.c.id == expert_id,
    ))).mappings().one()
    return ExpertResponse.model_validate(row)


async def save_expert(
    connection: AsyncConnection, user: AuthenticatedUser, expert_id: UUID, value: ExpertWrite,
) -> ExpertResponse:
    row = (await connection.execute(select(reference_experts).where(
        reference_experts.c.id == expert_id,
    ).with_for_update())).mappings().first()
    if not row:
        raise WorkspaceRepositoryError(404, "Эксперт не найден")
    if row["revision"] != value.expected_revision:
        raise WorkspaceRepositoryError(409, "Карточка эксперта изменилась. Обновите список.")
    await _check_expert_partner(connection, value.partner_id)
    await connection.execute(update(reference_experts).where(
        reference_experts.c.id == expert_id,
    ).values(**value.model_dump(exclude={"expected_revision"}),
             revision=row["revision"] + 1, updated_at=_now(), updated_by_user_id=user.id))
    await _audit(connection, user, "reference.expert.updated", "reference_expert", expert_id,
                 {"archived": value.archived, "revision": row["revision"] + 1})
    changed = (await connection.execute(select(reference_experts).where(
        reference_experts.c.id == expert_id,
    ))).mappings().one()
    return ExpertResponse.model_validate(changed)


async def create_template(
    connection: AsyncConnection, user: AuthenticatedUser, value: TemplateFields,
) -> TemplateResponse:
    template_id = uuid4()
    await connection.execute(insert(reference_templates).values(
        id=template_id, **value.model_dump(), archived=False, revision=1,
        created_at=_now(), updated_at=_now(), updated_by_user_id=user.id,
    ))
    await _audit(connection, user, "reference.template.created", "reference_template", template_id)
    row = (await connection.execute(select(reference_templates).where(
        reference_templates.c.id == template_id,
    ))).mappings().one()
    return TemplateResponse.model_validate(row)


async def save_template(
    connection: AsyncConnection, user: AuthenticatedUser, template_id: UUID,
    value: TemplateWrite,
) -> TemplateResponse:
    row = (await connection.execute(select(reference_templates).where(
        reference_templates.c.id == template_id,
    ).with_for_update())).mappings().first()
    if not row:
        raise WorkspaceRepositoryError(404, "Шаблон не найден")
    if row["revision"] != value.expected_revision:
        raise WorkspaceRepositoryError(409, "Шаблон изменился. Обновите список.")
    await connection.execute(update(reference_templates).where(
        reference_templates.c.id == template_id,
    ).values(**value.model_dump(exclude={"expected_revision"}),
             revision=row["revision"] + 1, updated_at=_now(), updated_by_user_id=user.id))
    await _audit(connection, user, "reference.template.updated", "reference_template", template_id,
                 {"archived": value.archived, "revision": row["revision"] + 1})
    changed = (await connection.execute(select(reference_templates).where(
        reference_templates.c.id == template_id,
    ))).mappings().one()
    return TemplateResponse.model_validate(changed)


async def get_template_version(
    connection: AsyncConnection, template_id: UUID, version_id: UUID | None = None,
) -> dict[str, object]:
    template = await connection.scalar(select(reference_templates.c.id).where(
        reference_templates.c.id == template_id,
    ))
    if template is None:
        raise WorkspaceRepositoryError(404, "Шаблон не найден")
    query = select(reference_template_versions).where(
        reference_template_versions.c.template_id == template_id,
    )
    if version_id:
        query = query.where(reference_template_versions.c.id == version_id)
    else:
        query = query.order_by(reference_template_versions.c.version.desc())
    row = (await connection.execute(query.limit(1))).mappings().first()
    if row is None:
        raise WorkspaceRepositoryError(404, "Файл шаблона ещё не загружен")
    return dict(row)


async def upload_template_version(
    connection: AsyncConnection, user: AuthenticatedUser, storage: ObjectStorage,
    template_id: UUID, expected_revision: int, file_name: str, content: bytes,
) -> TemplateVersionResponse:
    if PurePath(file_name).suffix.lower() not in {".pdf", ".docx", ".xlsx"}:
        raise ValueError("Поддерживаются PDF, DOCX и XLSX")
    content_type = document_type(file_name, content)
    row = (await connection.execute(select(reference_templates).where(
        reference_templates.c.id == template_id,
    ).with_for_update())).mappings().first()
    if row is None or row["archived"]:
        raise WorkspaceRepositoryError(404, "Действующий шаблон не найден")
    if row["revision"] != expected_revision:
        raise WorkspaceRepositoryError(409, "Шаблон изменился. Обновите список.")
    current = (await connection.execute(select(reference_template_versions.c.version).where(
        reference_template_versions.c.template_id == template_id,
    ).order_by(reference_template_versions.c.version.desc()).limit(1))).scalar_one_or_none()
    version = (current or 0) + 1
    file_id = uuid4()
    key = f"reference/templates/{template_id}/{file_id}"
    await storage.put(key, content, content_type)
    created_at = _now()
    await connection.execute(insert(reference_template_versions).values(
        id=file_id, template_id=template_id, version=version, file_name=file_name,
        content_type=content_type, storage_key=key, byte_size=len(content),
        uploaded_by_user_id=user.id, created_at=created_at,
    ))
    await connection.execute(update(reference_templates).where(
        reference_templates.c.id == template_id,
    ).values(revision=row["revision"] + 1, updated_at=created_at,
             updated_by_user_id=user.id))
    await _audit(connection, user, "reference.template.file_uploaded", "reference_template",
                 template_id, {"version": version, "file_name": file_name})
    return TemplateVersionResponse(
        id=file_id, version=version, file_name=file_name, content_type=content_type,
        byte_size=len(content), created_at=created_at,
    )
