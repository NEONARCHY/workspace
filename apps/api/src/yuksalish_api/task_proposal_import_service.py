"""Admin import creates private pending proposals, never tasks or delegated consent."""

import hashlib
import json
from datetime import UTC, datetime
from uuid import UUID, uuid5

from sqlalchemy import and_, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.engine import RowMapping
from sqlalchemy.ext.asyncio import AsyncConnection

from .access_control import ensure_module_action, module_permissions_for_user
from .auth import AuthenticatedUser, load_authenticated_user
from .position_policy import is_executive_leader
from .repository import WorkspaceRepositoryError, _upsert_notification
from .tables import hr_settings, task_proposals
from .tables import task_proposal_import_batches as batches
from .task_proposal_schemas import (
    TaskProposalImportContext,
    TaskProposalImportResult,
    TaskProposalImportWrite,
)
from .task_proposal_service import _audit, _response, _validate


async def _admin(connection: AsyncConnection, user: AuthenticatedUser) -> None:
    await ensure_module_action(connection, user, "tasks", "create")
    if user.role not in {"admin", "superadmin"}:
        raise WorkspaceRepositoryError(403, "Импорт заявок доступен только администраторам")


async def _chair(connection: AsyncConnection) -> AuthenticatedUser:
    identifier = await connection.scalar(
        select(hr_settings.c.chair_user_id).where(hr_settings.c.id == 1),
    )
    person = await load_authenticated_user(connection, identifier) if identifier else None
    if person is None or not is_executive_leader(person.job_title):
        raise WorkspaceRepositoryError(409, "Настройте действующего председателя в разделе HR")
    await ensure_module_action(connection, person, "tasks", "create")
    return person


async def import_context(
    connection: AsyncConnection,
    user: AuthenticatedUser,
) -> TaskProposalImportContext:
    await ensure_module_action(connection, user, "tasks", "view")
    permissions = await module_permissions_for_user(connection, user)
    if user.role not in {"admin", "superadmin"} or not permissions["tasks"]["create"]:
        return TaskProposalImportContext(can_import=False)
    try:
        chair = await _chair(connection)
    except WorkspaceRepositoryError as error:
        return TaskProposalImportContext(can_import=False, configuration_error=str(error))
    if chair.id == user.id:
        return TaskProposalImportContext(
            can_import=False,
            configuration_error=("Для подачи председателю используйте "
                                 "отдельный аккаунт администратора"),
        )
    return TaskProposalImportContext(
        can_import=True,
        chair_user_id=str(chair.id),
        chair_name=chair.full_name,
    )


async def import_result(
    connection: AsyncConnection,
    user: AuthenticatedUser,
    batch_id: UUID,
) -> TaskProposalImportResult:
    await ensure_module_action(connection, user, "tasks", "view")
    batch = (
        (
            await connection.execute(
                select(batches).where(
                    batches.c.id == batch_id,
                )
            )
        )
        .mappings()
        .first()
    )
    if batch is None or user.id not in {batch["creator_user_id"], batch["author_user_id"]}:
        raise WorkspaceRepositoryError(404, "Пакет заявок не найден")
    rows = (
        (
            await connection.execute(
                select(task_proposals)
                .where(
                    task_proposals.c.import_batch_id == batch_id,
                )
                .order_by(task_proposals.c.created_at, task_proposals.c.import_source_key)
            )
        )
        .mappings()
        .all()
    )
    return TaskProposalImportResult(
        batch_id=str(batch_id),
        proposals=[_response(row) for row in rows],
        reused=True,
    )


async def validate_import_decision(
    connection: AsyncConnection,
    user: AuthenticatedUser,
    row: RowMapping,
) -> None:
    batch = (
        (
            await connection.execute(
                select(batches).where(
                    batches.c.id == row["import_batch_id"],
                )
            )
        )
        .mappings()
        .first()
    )
    if (
        batch is None
        or batch["creator_user_id"] != row["creator_user_id"]
        or batch["author_user_id"] != user.id
    ):
        raise WorkspaceRepositoryError(409, "Нарушена связь заявки и пакета импорта")
    chair = await _chair(connection)
    if chair.id != user.id:
        raise WorkspaceRepositoryError(
            409, "Председатель изменился: отзовите пакет и подайте заново"
        )


async def import_proposals(
    connection: AsyncConnection,
    user: AuthenticatedUser,
    payload: TaskProposalImportWrite,
) -> TaskProposalImportResult:
    await _admin(connection, user)
    chair = await _chair(connection)
    if payload.author_user_id != chair.id or chair.id == user.id:
        raise WorkspaceRepositoryError(
            422, "Выберите назначенного председателя, отличного от отправителя"
        )
    digest = hashlib.sha256(
        json.dumps(
            {
                "author": str(chair.id),
                "items": [item.model_dump(mode="json") for item in payload.items],
            },
            sort_keys=True,
            ensure_ascii=False,
            separators=(",", ":"),
        ).encode()
    ).hexdigest()
    async with connection.begin_nested():
        # PK serialises retries; content uniqueness also protects close/reupload with a new UUID.
        inserted = await connection.scalar(
            pg_insert(batches)
            .values(
                id=payload.request_id,
                creator_user_id=user.id,
                author_user_id=chair.id,
                content_hash=digest,
                source_name=payload.source_name,
                created_at=datetime.now(UTC),
            )
            .on_conflict_do_nothing()
            .returning(batches.c.id)
        )
        if inserted is None:
            existing = (
                (
                    await connection.execute(
                        select(batches)
                        .where(
                            batches.c.id == payload.request_id,
                        )
                        .with_for_update()
                    )
                )
                .mappings()
                .first()
            )
            if existing is None:
                existing = (
                    (
                        await connection.execute(
                            select(batches)
                            .where(
                                and_(
                                    batches.c.creator_user_id == user.id,
                                    batches.c.content_hash == digest,
                                )
                            )
                            .with_for_update()
                        )
                    )
                    .mappings()
                    .first()
                )
            if (
                existing is None
                or existing["creator_user_id"] != user.id
                or existing["author_user_id"] != chair.id
                or existing["content_hash"] != digest
            ):
                raise WorkspaceRepositoryError(
                    409, "Этот номер пакета уже использован для другого содержимого"
                )
            return await import_result(connection, user, existing["id"])
        for item in payload.items:
            if item.task.cycle or item.task.dependencies:
                raise WorkspaceRepositoryError(
                    422, "Импортируйте самостоятельные задачи без повторений и зависимостей"
                )
            await _validate(connection, user, item.task, allow_other_assignee=True,
                            allow_unassigned_pending=True)
        for item in payload.items:
            now = datetime.now(UTC)
            identifier = uuid5(payload.request_id, item.source_key)
            await connection.execute(
                pg_insert(task_proposals).values(
                    id=identifier,
                    creator_user_id=user.id,
                    author_user_id=chair.id,
                    status="pending",
                    payload=item.task.model_dump(mode="json", by_alias=True),
                    task_id=None,
                    reason="",
                    created_at=now,
                    decided_at=None,
                    import_batch_id=payload.request_id,
                    import_source_key=item.source_key,
                )
            )
            await _upsert_notification(
                connection,
                user_id=chair.id,
                event_key=f"task-proposal:{identifier}",
                kind="task",
                priority="normal",
                title="Импорт: запрос на постановку задачи",
                body=f"{user.full_name}: {item.task.title}",
                section="tasks",
                entity_id=identifier,
                requires_action=True,
                occurred_at=now,
            )
            await _audit(connection, user, identifier, "imported")
        result = await import_result(connection, user, payload.request_id)
        return result.model_copy(update={"reused": False})
