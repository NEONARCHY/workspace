"""A versioned configuration shared by Workspace, robot GUI and running bot."""

from datetime import UTC, datetime
from uuid import NAMESPACE_URL, uuid4, uuid5

from fastapi import HTTPException
from sqlalchemy import insert, or_, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncConnection

from .access_control import module_permissions_for_user
from .ai_referent_configuration_schemas import (
    ReviewerBindingResponse,
    ReviewerConfigurationResponse,
    ReviewerConfigurationUpdate,
    ReviewerRuntimeAcknowledgement,
    ReviewerRuntimeResponse,
)
from .ai_referent_shared_service import notify_letter
from .auth import AuthenticatedUser
from .tables import (
    ai_referent_agents,
    ai_referent_configuration,
    ai_referent_events,
    ai_referent_letters,
    ai_referent_reviewers,
    ai_referent_telegram_links,
    audit_events,
    users,
)

_REASSIGNABLE_STATUSES = (
    "draft",
    "needs_revision",
    "pending_review",
    "approved",
    "queued",
    "sending",
    "failed",
    "awaiting_final_send",
    "referent_review_pending",
)
_CONFIGURATION_AUDIT_ID = uuid5(NAMESPACE_URL, "urn:workspace:ai-referent:configuration:1")


def require_configuration_admin(user: AuthenticatedUser) -> None:
    if user.role not in {"admin", "superadmin"}:
        raise HTTPException(403, "Настройка согласующих доступна только администратору.")


async def read_configuration(connection: AsyncConnection) -> ReviewerConfigurationResponse:
    config = (
        (await connection.execute(select(ai_referent_configuration).with_for_update(read=True)))
        .mappings()
        .one()
    )
    bindings = (
        (
            await connection.execute(
                select(
                    ai_referent_reviewers,
                    users.c.username,
                    users.c.full_name,
                    users.c.status.label("account_status"),
                    users.c.role,
                    users.c.position_id,
                    users.c.department_id,
                )
                .select_from(
                    ai_referent_reviewers.outerjoin(
                        users, users.c.id == ai_referent_reviewers.c.user_id
                    )
                )
                .order_by(ai_referent_reviewers.c.key)
            )
        )
        .mappings()
        .all()
    )
    runtimes = (
        (
            await connection.execute(
                select(ai_referent_agents)
                .where(ai_referent_agents.c.configuration_revision.is_not(None))
                .order_by(ai_referent_agents.c.agent_id)
            )
        )
        .mappings()
        .all()
    )
    allowed = set()
    for row in bindings:
        if not row["enabled"] or row["account_status"] != "active":
            continue
        permissions = await module_permissions_for_user(
            connection,
            AuthenticatedUser(
                id=row["user_id"],
                username=row["username"],
                full_name=row["full_name"],
                role=row["role"],
                position_id=row["position_id"],
                department_id=row["department_id"],
                job_title=None,
            ),
        )
        if permissions["ai_referent"]["approve"]:
            allowed.add(row["key"])
    return ReviewerConfigurationResponse(
        revision=config["revision"],
        updated_at=config["updated_at"],
        reviewers=[
            ReviewerBindingResponse(
                key=row["key"],
                label=row["label"],
                suggested_username=row["suggested_username"],
                user_id=str(row["user_id"]) if row["user_id"] else None,
                username=row["username"] or "",
                full_name=row["full_name"] or "",
                telegram_id=row["telegram_id"],
                enabled=row["enabled"],
                account_active=row["account_status"] == "active",
                can_approve=row["key"] in allowed,
            )
            for row in bindings
        ],
        runtimes=[
            ReviewerRuntimeResponse(
                agent_id=row["agent_id"],
                agent_name=row["display_name"],
                applied_revision=row["configuration_revision"],
                applied_at=row["configuration_applied_at"],
                last_seen_at=row["last_seen_at"],
                error=row["configuration_error"],
            )
            for row in runtimes
        ],
    )


async def save_configuration(
    connection: AsyncConnection,
    current_user: AuthenticatedUser,
    payload: ReviewerConfigurationUpdate,
) -> ReviewerConfigurationResponse:
    require_configuration_admin(current_user)
    config = (
        (
            await connection.execute(
                select(ai_referent_configuration)
                .where(ai_referent_configuration.c.id == 1)
                .with_for_update()
            )
        )
        .mappings()
        .one()
    )
    if config["revision"] != payload.expected_revision:
        raise HTTPException(409, "Настройки уже изменены. Обновите их перед сохранением.")
    before = await read_configuration(connection)
    accounts = {}
    for item in payload.reviewers:
        if not item.username:
            continue
        account = (
            (
                await connection.execute(
                    select(users).where(
                        users.c.username == item.username, users.c.status == "active"
                    )
                )
            )
            .mappings()
            .one_or_none()
        )
        if account is None:
            raise HTTPException(422, f"Активный аккаунт @{item.username} не найден.")
        if item.telegram_id:
            linked = await connection.scalar(
                select(ai_referent_telegram_links.c.user_id).where(
                    ai_referent_telegram_links.c.telegram_id == item.telegram_id,
                    ai_referent_telegram_links.c.user_id != account["id"],
                )
            )
            if linked is not None:
                raise HTTPException(409, "Telegram уже привязан к другому аккаунту Workspace.")
        accounts[item.key] = account
    # Clear unique fields first: swapping two assignments is one atomic operation.
    await connection.execute(
        update(ai_referent_reviewers).values(user_id=None, telegram_id=None, enabled=False)
    )
    now = datetime.now(UTC)
    for item in payload.reviewers:
        account = accounts.get(item.key)
        new_user_id = account["id"] if account else None
        await connection.execute(
            update(ai_referent_reviewers)
            .where(ai_referent_reviewers.c.key == item.key)
            .values(user_id=new_user_id, telegram_id=item.telegram_id, enabled=item.enabled)
        )
        if new_user_id is not None:
            # Adopt an existing account assignment without guessing which person replaced whom.
            await connection.execute(
                update(ai_referent_letters)
                .where(
                    ai_referent_letters.c.reviewer_key.is_(None),
                    ai_referent_letters.c.reviewer_user_id == new_user_id,
                    ai_referent_letters.c.status.in_(_REASSIGNABLE_STATUSES),
                )
                .values(reviewer_key=item.key)
            )
        # Existing decisions remain audit records. Only open requests follow the slot.
        open_letters = (
            (
                await connection.execute(
                    select(ai_referent_letters)
                    .where(
                        or_(
                            ai_referent_letters.c.reviewer_key == item.key,
                            ai_referent_letters.c.final_reviewer_key == item.key,
                            ai_referent_letters.c.initial_reviewer_key == item.key,
                        ),
                        ai_referent_letters.c.status.in_(_REASSIGNABLE_STATUSES),
                    )
                    .with_for_update()
                )
            )
            .mappings()
            .all()
        )
        for letter in open_letters:
            assigned_user = new_user_id if item.enabled else None
            changes = {}
            if (
                letter.get("reviewer_key") == item.key
                and letter["reviewer_user_id"] != assigned_user
            ):
                changes["reviewer_user_id"] = assigned_user
            if (
                letter.get("final_reviewer_key") == item.key
                and letter.get("final_reviewer_user_id") != assigned_user
            ):
                changes["final_reviewer_user_id"] = assigned_user
            if (
                letter.get("initial_reviewer_key") == item.key
                and letter.get("initial_reviewer_user_id") != assigned_user
            ):
                changes["initial_reviewer_user_id"] = assigned_user
            if not changes:
                continue
            await connection.execute(
                update(ai_referent_letters)
                .where(ai_referent_letters.c.id == letter["id"])
                .values(
                    **changes,
                    revision=letter["revision"] + 1,
                    updated_at=now,
                )
            )
            await connection.execute(
                insert(ai_referent_events).values(
                    id=uuid4(),
                    letter_id=letter["id"],
                    actor_user_id=current_user.id,
                    event_type="reviewer.reassigned",
                    from_status=letter["status"],
                    to_status=letter["status"],
                    comment="Обновлён ответственный согласующий",
                    metadata={"key": item.key, "configurationRevision": config["revision"] + 1},
                    created_at=now,
                )
            )
            updated = (
                (
                    await connection.execute(
                        select(ai_referent_letters).where(
                            ai_referent_letters.c.id == letter["id"],
                        )
                    )
                )
                .mappings()
                .one()
            )
            await notify_letter(connection, updated, "Обновлён согласующий письма")
    await connection.execute(
        update(ai_referent_configuration)
        .where(ai_referent_configuration.c.id == 1)
        .values(revision=config["revision"] + 1, updated_at=now, updated_by_user_id=current_user.id)
    )
    await connection.execute(
        insert(audit_events).values(
            id=uuid4(),
            actor_user_id=current_user.id,
            action="ai_referent.reviewers_updated",
            target_type="ai_referent_configuration",
            target_id=_CONFIGURATION_AUDIT_ID,
            details={
                "before": [item.model_dump(mode="json") for item in before.reviewers],
                "after": [item.model_dump(mode="json") for item in payload.reviewers],
                "revision": config["revision"] + 1,
            },
            created_at=now,
        )
    )
    return await read_configuration(connection)


async def acknowledge_configuration(
    connection: AsyncConnection,
    payload: ReviewerRuntimeAcknowledgement,
) -> None:
    revision = await connection.scalar(select(ai_referent_configuration.c.revision))
    if payload.revision > int(revision or 0):
        raise HTTPException(409, "Указана неизвестная версия настроек.")
    now = datetime.now(UTC)
    values = {
        "display_name": payload.agent_name,
        "last_seen_at": now,
        "configuration_revision": payload.revision,
        "configuration_applied_at": now if not payload.error else None,
        "configuration_error": payload.error,
        "updated_at": now,
    }
    await connection.execute(
        pg_insert(ai_referent_agents)
        .values(
            agent_id=payload.agent_id,
            created_at=now,
            **values,
        )
        .on_conflict_do_update(
            index_elements=[ai_referent_agents.c.agent_id],
            set_=values,
            where=(
                ai_referent_agents.c.configuration_revision.is_(None)
                | (ai_referent_agents.c.configuration_revision <= payload.revision)
            ),
        )
    )
