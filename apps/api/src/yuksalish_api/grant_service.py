"""Permission-checked, revision-locked grant preparation and review."""

import hashlib
import json
from collections.abc import Mapping
from datetime import UTC, datetime
from uuid import UUID, uuid4

from sqlalchemy import func, insert, or_, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.engine import RowMapping
from sqlalchemy.ext.asyncio import AsyncConnection

from .access_control import ModuleAction, ensure_module_action, module_permissions_for_user
from .auth import AuthenticatedUser, load_authenticated_user
from .errors import WorkspaceRepositoryError
from .grant_schemas import (
    GrantAction,
    GrantChecklistItem,
    GrantCreate,
    GrantDetail,
    GrantEdit,
    GrantEvent,
    GrantFields,
    GrantReviewersWrite,
    GrantSettings,
    GrantSettingsWrite,
    GrantStatus,
    GrantSummary,
)
from .grant_tables import grant_events, grant_requests, grant_settings
from .repository import _active_user_id, _attachment, _sync_context_chat, _upsert_notification
from .tables import attachments, audit_events, hr_settings, users, workspace_notifications

WORKING = {"in_progress", "needs_revision"}
LAUNCH_STAGES = {"launch_review", "launch_revision", "launch_rejected"}
TERMINAL = {"completed", "launch_rejected"}
REVIEW_ACTIONS = {"approve", "return", "approve_launch", "return_launch", "reject_launch"}
REVIEW_ACTORS = {
    "author_review": "author_user_id",
    "leader_review": "leader_user_id",
    "chair_review": "chair_user_id",
}
NEXT_STATUS: dict[str, GrantStatus] = {
    "author_review": "leader_review",
    "leader_review": "chair_review",
    "chair_review": "completed",
}


def participants(row: RowMapping) -> set[UUID]:
    return {
        row["initiator_user_id"],
        *([row["author_user_id"]] if row["author_user_id"] else []),
        row["assignee_id"],
        row["leader_user_id"],
        row["chair_user_id"],
        *(UUID(item) for item in row["co_assignee_ids"]),
    }


def allowed_actions(row: RowMapping, user: AuthenticatedUser) -> list[str]:
    """Administrative visibility never substitutes for a named reviewer."""
    actions: list[str] = []
    if user.id not in participants(row):
        return actions
    if row["status"] not in TERMINAL:
        actions.append("comment")
    if row["status"] in {"launch_review", "launch_revision"}:
        if user.id == row["initiator_user_id"]:
            actions.extend(["edit", "upload"])
            if row["status"] == "launch_revision":
                actions.append("submit_launch")
        if row["status"] == "launch_review" and user.id == row["chair_user_id"]:
            actions.extend(["approve_launch", "return_launch", "reject_launch"])
    if row["status"] in WORKING:
        if user.id == row["author_user_id"]:
            actions.extend(["edit", "upload"])
        if user.id == row["assignee_id"] or str(user.id) in row["co_assignee_ids"]:
            actions.extend(["submit", "check"])
            if "upload" not in actions:
                actions.append("upload")
        elif user.id == row["author_user_id"]:
            actions.append("check")
    actor_field = REVIEW_ACTORS.get(row["status"])
    if actor_field and user.id == row[actor_field]:
        actions.extend(["approve", "return"])
    return actions


async def access_grant(
    connection: AsyncConnection,
    user: AuthenticatedUser,
    grant_id: UUID,
    *,
    lock: bool = False,
) -> RowMapping:
    await ensure_module_action(connection, user, "grants", "view")
    statement = select(grant_requests).where(grant_requests.c.id == grant_id)
    row = await connection.execute(statement.with_for_update() if lock else statement)
    record = row.mappings().first()
    if record is None or (
        user.role not in {"admin", "superadmin"} and user.id not in participants(record)
    ):
        raise WorkspaceRepositoryError(404, "Заявка на грант недоступна")
    return record


async def _actions(
    connection: AsyncConnection,
    row: RowMapping,
    user: AuthenticatedUser,
    rights: Mapping[ModuleAction, bool] | None = None,
) -> list[str]:
    if rights is None:
        rights = (await module_permissions_for_user(connection, user))["grants"]
    return [
        action
        for action in allowed_actions(row, user)
        if rights["approve" if action in REVIEW_ACTIONS else "edit"]
    ]


async def _summary(
    connection: AsyncConnection,
    row: RowMapping,
    user: AuthenticatedUser,
    rights: Mapping[ModuleAction, bool] | None = None,
) -> GrantSummary:
    return GrantSummary(
        id=str(row["id"]),
        title=row["title"],
        description=row["description"],
        author_user_id=str(row["author_user_id"]) if row["author_user_id"] else None,
        initiator_user_id=str(row["initiator_user_id"]),
        workflow_version=row["workflow_version"],
        launch_approved_at=row["launch_approved_at"],
        launch_approved_by_user_id=(
            str(row["launch_approved_by_user_id"]) if row["launch_approved_by_user_id"] else None
        ),
        assignee_id=str(row["assignee_id"]),
        co_assignee_ids=row["co_assignee_ids"],
        leader_user_id=str(row["leader_user_id"]),
        chair_user_id=str(row["chair_user_id"]),
        due_at=row["due_at"],
        status=row["status"],
        revision=row["revision"],
        checklist=row["checklist"],
        result_text=row["result_text"],
        chat_id=str(row["chat_id"]),
        created_at=row["created_at"],
        updated_at=row["updated_at"],
        allowed_actions=await _actions(connection, row, user, rights),
    )


async def list_grants(
    connection: AsyncConnection,
    user: AuthenticatedUser,
) -> list[GrantSummary]:
    await ensure_module_action(connection, user, "grants", "view")
    statement = select(grant_requests).order_by(grant_requests.c.updated_at.desc())
    if user.role not in {"admin", "superadmin"}:
        statement = statement.where(
            or_(
                grant_requests.c.author_user_id == user.id,
                grant_requests.c.initiator_user_id == user.id,
                grant_requests.c.assignee_id == user.id,
                grant_requests.c.leader_user_id == user.id,
                grant_requests.c.chair_user_id == user.id,
                grant_requests.c.co_assignee_ids.contains([str(user.id)]),
            )
        )
    rows = (await connection.execute(statement)).mappings().all()
    rights = (await module_permissions_for_user(connection, user))["grants"]
    return [await _summary(connection, row, user, rights) for row in rows]


async def _validate_reviewer(connection: AsyncConnection, user_id: UUID) -> None:
    reviewer = await load_authenticated_user(connection, user_id)
    if reviewer is None:
        raise WorkspaceRepositoryError(422, "Назначенный согласующий не активен")
    rights = (await module_permissions_for_user(connection, reviewer))["grants"]
    if not rights["view"] or not rights["approve"]:
        raise WorkspaceRepositoryError(
            409, "Назначенному согласующему нужен доступ к проверке грантов"
        )


async def get_grant(
    connection: AsyncConnection,
    user: AuthenticatedUser,
    grant_id: UUID,
) -> GrantDetail:
    row = await access_grant(connection, user, grant_id)
    history = (
        (
            await connection.execute(
                select(grant_events)
                .where(
                    grant_events.c.grant_id == grant_id,
                )
                .order_by(grant_events.c.created_at, grant_events.c.id)
            )
        )
        .mappings()
        .all()
    )
    files = (
        (
            await connection.execute(
                select(attachments)
                .where(
                    attachments.c.owner_type == "grant",
                    attachments.c.owner_id == grant_id,
                )
                .order_by(attachments.c.created_at)
            )
        )
        .mappings()
        .all()
    )
    return GrantDetail(
        **(await _summary(connection, row, user)).model_dump(),
        events=[
            GrantEvent(
                id=str(event["id"]),
                actor_user_id=str(event["actor_user_id"]),
                action=event["action"],
                text=event["text"],
                from_status=event["from_status"],
                to_status=event["to_status"],
                created_at=event["created_at"],
            )
            for event in history
        ],
        attachments=[_attachment(file) for file in files],
    )


async def get_settings(
    connection: AsyncConnection,
    user: AuthenticatedUser,
) -> GrantSettings:
    await ensure_module_action(connection, user, "grants", "view")
    settings = (
        (
            await connection.execute(
                select(grant_settings).where(
                    grant_settings.c.id == 1,
                )
            )
        )
        .mappings()
        .first()
    )
    if settings:
        return GrantSettings(
            leader_user_id=str(settings["leader_user_id"]),
            chair_user_id=str(settings["chair_user_id"]),
            revision=settings["revision"],
        )
    # Only the explicitly named employee can be proposed; ambiguity needs admin selection.
    candidates = (
        (
            await connection.execute(
                select(users.c.id).where(
                    users.c.status == "active",
                    or_(
                        users.c.full_name.ilike("%Ражабов%Умид%"),
                        users.c.full_name.ilike("%Умид%Ражабов%"),
                        users.c.full_name.ilike("%Rajabov%Umid%"),
                        users.c.full_name.ilike("%Umid%Rajabov%"),
                    ),
                )
            )
        )
        .scalars()
        .all()
    )
    chair = await connection.scalar(
        select(users.c.id)
        .join(
            hr_settings,
            hr_settings.c.chair_user_id == users.c.id,
        )
        .where(hr_settings.c.id == 1, users.c.status == "active")
    )
    return GrantSettings(
        leader_user_id=str(candidates[0]) if len(candidates) == 1 else None,
        chair_user_id=str(chair) if chair else None,
        revision=0,
    )


async def save_settings(
    connection: AsyncConnection,
    user: AuthenticatedUser,
    payload: GrantSettingsWrite,
) -> GrantSettings:
    await ensure_module_action(connection, user, "grants", "admin")
    if user.role not in {"admin", "superadmin"}:
        raise WorkspaceRepositoryError(403, "Маршрут грантов настраивает администратор")
    for person_id in (payload.leader_user_id, payload.chair_user_id):
        await _validate_reviewer(connection, person_id)
    if payload.leader_user_id == payload.chair_user_id:
        raise WorkspaceRepositoryError(422, "Руководитель и председатель должны различаться")
    now = datetime.now(UTC)
    await connection.execute(
        pg_insert(grant_settings)
        .values(
            id=1,
            leader_user_id=payload.leader_user_id,
            chair_user_id=payload.chair_user_id,
            revision=0,
            updated_by_user_id=user.id,
            updated_at=now,
        )
        .on_conflict_do_nothing()
    )
    old = (
        (
            await connection.execute(
                select(grant_settings)
                .where(
                    grant_settings.c.id == 1,
                )
                .with_for_update()
            )
        )
        .mappings()
        .one()
    )
    if old["revision"] != payload.expected_revision:
        raise WorkspaceRepositoryError(409, "Маршрут уже изменён. Обновите раздел")
    await connection.execute(
        update(grant_settings)
        .where(grant_settings.c.id == 1)
        .values(
            leader_user_id=payload.leader_user_id,
            chair_user_id=payload.chair_user_id,
            revision=old["revision"] + 1,
            updated_by_user_id=user.id,
            updated_at=now,
        )
    )
    await connection.execute(
        insert(audit_events).values(
            id=uuid4(),
            actor_user_id=user.id,
            action="grant.settings.updated",
            target_type="grant",
            target_id=payload.leader_user_id,
            details={
                "leaderUserId": str(payload.leader_user_id),
                "chairUserId": str(payload.chair_user_id),
                "previousLeaderUserId": str(old["leader_user_id"]),
                "previousChairUserId": str(old["chair_user_id"]),
            },
            created_at=now,
        )
    )
    return await get_settings(connection, user)


async def _validate_fields(connection: AsyncConnection, payload: GrantFields) -> None:
    if len(payload.title.strip()) < 3:
        raise WorkspaceRepositoryError(422, "Введите название гранта от 3 символов")
    if payload.due_at <= datetime.now(UTC):
        raise WorkspaceRepositoryError(422, "Укажите будущий срок")
    people = [payload.assignee_id, *payload.co_assignee_ids]
    if len(people) != len(set(people)):
        raise WorkspaceRepositoryError(422, "Ответственный и соисполнители не должны повторяться")
    for person_id in people:
        await _active_user_id(connection, str(person_id))


async def _event(
    connection: AsyncConnection,
    row: RowMapping,
    user: AuthenticatedUser,
    action: str,
    text: str,
    to_status: str,
) -> None:
    now = datetime.now(UTC)
    event_id = uuid4()
    await connection.execute(
        insert(grant_events).values(
            id=event_id,
            grant_id=row["id"],
            actor_user_id=user.id,
            action=action,
            text=text,
            from_status=row["status"],
            to_status=to_status,
            created_at=now,
        )
    )
    await connection.execute(
        insert(audit_events).values(
            id=uuid4(),
            actor_user_id=user.id,
            action=f"grant.{action}",
            target_type="grant",
            target_id=row["id"],
            details={
                "eventId": str(event_id),
                "fromStatus": row["status"],
                "toStatus": to_status,
                "revision": row["revision"],
            },
            created_at=now,
        )
    )


async def _notify(connection: AsyncConnection, row: RowMapping) -> None:
    now = datetime.now(UTC)
    # Every stage owns its attention item. Old actions are resolved in the same transaction.
    await connection.execute(
        update(workspace_notifications)
        .where(
            workspace_notifications.c.section == "grants",
            workspace_notifications.c.entity_id == row["id"],
            workspace_notifications.c.resolved_at.is_(None),
        )
        .values(resolved_at=now, requires_action=False)
    )
    actor_field = (
        "chair_user_id" if row["status"] == "launch_review" else REVIEW_ACTORS.get(row["status"])
    )
    next_actors = (
        {row[actor_field]}
        if actor_field
        else (
            {row["assignee_id"], *(UUID(item) for item in row["co_assignee_ids"])}
            if row["status"] in WORKING
            else {row["initiator_user_id"]} if row["status"] == "launch_revision" else set()
        )
    )
    for person_id in participants(row):
        await _upsert_notification(
            connection,
            user_id=person_id,
            event_key=f"grant:{row['id']}:{row['revision']}",
            kind="approval",
            priority="normal",
            title={
                "completed": "Грант завершён",
                "launch_review": "Запрос на запуск гранта",
                "launch_revision": "Уточните заявку на запуск гранта",
                "launch_rejected": "Запуск гранта отклонён",
            }.get(row["status"], "Заявка на грант"),
            body=row["title"],
            section="grants",
            entity_id=row["id"],
            requires_action=person_id in next_actors,
            occurred_at=now,
        )


async def _sync_chat(connection: AsyncConnection, row: RowMapping) -> UUID:
    return await _sync_context_chat(
        connection,
        context_type="grant",
        context_id=row["id"],
        title=row["title"],
        description=row["description"],
        owner_user_id=row["author_user_id"] or row["initiator_user_id"],
        member_user_ids=list(participants(row)),
    )


async def lock_grant_creation(connection: AsyncConnection, request_id: UUID) -> None:
    # Serialize all create variants before checking the idempotency fingerprint.
    await connection.execute(select(func.pg_advisory_xact_lock(request_id.int % (1 << 63))))


async def create_grant(
    connection: AsyncConnection,
    user: AuthenticatedUser,
    payload: GrantCreate,
    *,
    initial_files_digest: str | None = None,
) -> GrantDetail:
    await ensure_module_action(connection, user, "grants", "create")
    await lock_grant_creation(connection, payload.request_id)
    fingerprint_data = payload.model_dump(mode="json")
    if initial_files_digest is not None:
        fingerprint_data["initial_files_digest"] = initial_files_digest
    fingerprint = hashlib.sha256(
        json.dumps(
            fingerprint_data,
            sort_keys=True,
            ensure_ascii=False,
        ).encode()
    ).hexdigest()
    existing = (
        (
            await connection.execute(
                select(grant_requests).where(
                    grant_requests.c.id == payload.request_id,
                )
            )
        )
        .mappings()
        .first()
    )
    if existing:
        if existing["initiator_user_id"] != user.id or existing["creation_hash"] != fingerprint:
            raise WorkspaceRepositoryError(409, "Номер отправки уже использован другой заявкой")
        return await get_grant(connection, user, payload.request_id)
    await _validate_fields(connection, payload)
    settings = await get_settings(connection, user)
    if not settings.leader_user_id or not settings.chair_user_id:
        raise WorkspaceRepositoryError(
            409,
            "Администратор должен назначить руководителя и председателя",
        )
    for person_id in (settings.leader_user_id, settings.chair_user_id):
        await _validate_reviewer(connection, UUID(person_id))
    if settings.leader_user_id == settings.chair_user_id:
        raise WorkspaceRepositoryError(409, "Назначьте разных руководителя и председателя")
    now = datetime.now(UTC)
    inserted = await connection.scalar(
        pg_insert(grant_requests)
        .values(
            id=payload.request_id,
            creation_hash=fingerprint,
            title=payload.title,
            description=payload.description,
            initiator_user_id=user.id,
            author_user_id=None,
            workflow_version=2,
            assignee_id=payload.assignee_id,
            co_assignee_ids=[str(item) for item in payload.co_assignee_ids],
            leader_user_id=UUID(settings.leader_user_id),
            chair_user_id=UUID(settings.chair_user_id),
            due_at=payload.due_at,
            status="launch_review",
            revision=1,
            result_text="",
            chat_id=None,
            checklist=[
                GrantChecklistItem(id=str(uuid4()), title=title, completed=False).model_dump(
                    mode="json"
                )
                for title in payload.checklist
            ],
            created_at=now,
            updated_at=now,
        )
        .on_conflict_do_nothing()
        .returning(grant_requests.c.id)
    )
    if inserted is None:
        return await create_grant(
            connection, user, payload, initial_files_digest=initial_files_digest
        )
    row = await access_grant(connection, user, payload.request_id, lock=True)
    chat_id = await _sync_chat(connection, row)
    await connection.execute(
        update(grant_requests)
        .where(
            grant_requests.c.id == payload.request_id,
        )
        .values(chat_id=chat_id)
    )
    await _event(connection, row, user, "created", "", "launch_review")
    await _notify(connection, row)
    return await get_grant(connection, user, payload.request_id)


def _check_revision(row: RowMapping, expected: int) -> None:
    if row["revision"] != expected:
        raise WorkspaceRepositoryError(
            409,
            "Заявка уже изменена. Обновите карточку перед действием",
        )


async def edit_grant(
    connection: AsyncConnection,
    user: AuthenticatedUser,
    grant_id: UUID,
    payload: GrantEdit,
) -> GrantDetail:
    await ensure_module_action(connection, user, "grants", "edit")
    row = await access_grant(connection, user, grant_id, lock=True)
    _check_revision(row, payload.expected_revision)
    if "edit" not in allowed_actions(row, user):
        raise WorkspaceRepositoryError(403, "Редактирование недоступно на этом этапе заявки")
    await _validate_fields(connection, payload)
    old_items = {item["title"]: item for item in row["checklist"]}
    checklist = [
        old_items.get(title)
        or GrantChecklistItem(
            id=str(uuid4()),
            title=title,
            completed=False,
        ).model_dump(mode="json")
        for title in payload.checklist
    ]
    await connection.execute(
        update(grant_requests)
        .where(grant_requests.c.id == grant_id)
        .values(
            title=payload.title,
            description=payload.description,
            assignee_id=payload.assignee_id,
            co_assignee_ids=[str(item) for item in payload.co_assignee_ids],
            due_at=payload.due_at,
            checklist=checklist,
            revision=row["revision"] + 1,
            updated_at=datetime.now(UTC),
        )
    )
    await _event(connection, row, user, "edited", "", row["status"])
    updated = await access_grant(connection, user, grant_id)
    await _sync_chat(connection, updated)
    await _notify(connection, updated)
    return await get_grant(connection, user, grant_id)


async def act_on_grant(
    connection: AsyncConnection,
    user: AuthenticatedUser,
    grant_id: UUID,
    payload: GrantAction,
) -> GrantDetail:
    await ensure_module_action(
        connection,
        user,
        "grants",
        "approve" if payload.action in REVIEW_ACTIONS else "edit",
    )
    row = await access_grant(connection, user, grant_id, lock=True)
    _check_revision(row, payload.expected_revision)
    if payload.action not in allowed_actions(row, user):
        raise WorkspaceRepositoryError(
            403,
            "Это действие доступно только назначенному участнику этапа",
        )
    text = payload.text.strip()
    to_status = row["status"]
    values: dict[str, object] = {"revision": row["revision"] + 1, "updated_at": datetime.now(UTC)}
    if (
        payload.action in {"return", "comment", "submit", "return_launch", "reject_launch"}
        and not text
    ):
        raise WorkspaceRepositoryError(422, "Введите результат, комментарий или причину доработки")
    if payload.action == "approve_launch":
        await _validate_fields(connection, GrantFields(
            title=row["title"], description=row["description"], assignee_id=row["assignee_id"],
            co_assignee_ids=row["co_assignee_ids"], due_at=row["due_at"],
            checklist=[item["title"] for item in row["checklist"]],
        ))
        await _validate_reviewer(connection, row["leader_user_id"])
        to_status = "in_progress"
        values["author_user_id"] = user.id
        values["launch_approved_at"] = datetime.now(UTC)
        values["launch_approved_by_user_id"] = user.id
    elif payload.action == "return_launch":
        to_status = "launch_revision"
    elif payload.action == "reject_launch":
        to_status = "launch_rejected"
    elif payload.action == "submit_launch":
        await _validate_reviewer(connection, row["chair_user_id"])
        to_status = "launch_review"
    elif payload.action == "submit":
        to_status = "leader_review" if row["workflow_version"] == 2 else "author_review"
        await _validate_reviewer(connection, row[REVIEW_ACTORS[to_status]])
        if any(not item["completed"] for item in row["checklist"]):
            raise WorkspaceRepositoryError(409, "Сначала выполните все пункты чек-листа")
        values["result_text"] = text
    elif payload.action == "approve":
        to_status = NEXT_STATUS[row["status"]]
        next_field = REVIEW_ACTORS.get(to_status)
        if next_field:
            await _validate_reviewer(connection, row[next_field])
    elif payload.action == "return":
        to_status = "needs_revision"
    elif payload.action == "check":
        if payload.item_id is None or payload.completed is None:
            raise WorkspaceRepositoryError(422, "Укажите пункт чек-листа и отметку выполнения")
        items = [GrantChecklistItem.model_validate(item) for item in row["checklist"]]
        if not any(item.id == str(payload.item_id) for item in items):
            raise WorkspaceRepositoryError(404, "Пункт чек-листа не найден")
        values["checklist"] = [
            item.model_copy(
                update={
                    "completed": payload.completed,
                    "completed_by_user_id": str(user.id) if payload.completed else None,
                    "completed_at": datetime.now(UTC) if payload.completed else None,
                }
            ).model_dump(mode="json")
            if item.id == str(payload.item_id)
            else item.model_dump(mode="json")
            for item in items
        ]
        text = next(item.title for item in items if item.id == str(payload.item_id))
    values["status"] = to_status
    await connection.execute(
        update(grant_requests)
        .where(grant_requests.c.id == grant_id)
        .values(
            **values,
        )
    )
    await _event(connection, row, user, payload.action, text, to_status)
    if payload.action == "approve_launch":
        await _sync_chat(connection, await access_grant(connection, user, grant_id))
    if payload.action in {"submit", "approve", "return", "submit_launch", *REVIEW_ACTIONS}:
        await _notify(connection, await access_grant(connection, user, grant_id))
    return await get_grant(connection, user, grant_id)


async def record_attachment(
    connection: AsyncConnection,
    user: AuthenticatedUser,
    grant_id: UUID,
    file_name: str,
) -> None:
    row = await access_grant(connection, user, grant_id, lock=True)
    await connection.execute(
        update(grant_requests)
        .where(grant_requests.c.id == grant_id)
        .values(
            revision=row["revision"] + 1,
            updated_at=datetime.now(UTC),
        )
    )
    await _event(connection, row, user, "file_uploaded", file_name, row["status"])


async def change_reviewers(
    connection: AsyncConnection,
    user: AuthenticatedUser,
    grant_id: UUID,
    payload: GrantReviewersWrite,
) -> GrantDetail:
    await ensure_module_action(connection, user, "grants", "admin")
    if user.role not in {"admin", "superadmin"}:
        raise WorkspaceRepositoryError(403, "Согласующих меняет администратор")
    row = await access_grant(connection, user, grant_id, lock=True)
    _check_revision(row, payload.expected_revision)
    if row["status"] in TERMINAL:
        raise WorkspaceRepositoryError(409, "Завершённую заявку изменять нельзя")
    if len(payload.reason.strip()) < 3 or payload.leader_user_id == payload.chair_user_id:
        raise WorkspaceRepositoryError(422, "Укажите причину и разных согласующих")
    for person_id in (payload.leader_user_id, payload.chair_user_id):
        await _validate_reviewer(connection, person_id)
    new_status = row["status"] if row["status"] in WORKING | LAUNCH_STAGES else (
        "leader_review" if row["workflow_version"] == 2 else "author_review"
    )
    # A launch decision belongs to its named chairman, not to an administrative role.
    owner_values = (
        {"author_user_id": payload.chair_user_id}
        if row["workflow_version"] == 2 and row["launch_approved_at"] else {}
    )
    await connection.execute(
        update(grant_requests)
        .where(grant_requests.c.id == grant_id)
        .values(
            leader_user_id=payload.leader_user_id,
            chair_user_id=payload.chair_user_id,
            status=new_status,
            revision=row["revision"] + 1,
            updated_at=datetime.now(UTC),
            **owner_values,
        )
    )
    names: dict[UUID, str] = {
        person.id: person.full_name
        for person in (
            await connection.execute(
                select(users.c.id, users.c.full_name).where(
                    users.c.id.in_(
                        {
                            row["leader_user_id"],
                            row["chair_user_id"],
                            payload.leader_user_id,
                            payload.chair_user_id,
                        }
                    ),
                )
            )
        ).all()
    }
    reason = (
        f"{payload.reason.strip()}\n"
        f"Руководитель: {names[row['leader_user_id']]} → {names[payload.leader_user_id]}\n"
        f"Председатель: {names[row['chair_user_id']]} → {names[payload.chair_user_id]}"
    )
    await _event(connection, row, user, "reviewers_changed", reason, new_status)
    updated = await access_grant(connection, user, grant_id)
    await _sync_chat(connection, updated)
    await _notify(connection, updated)
    return await get_grant(connection, user, grant_id)
