"""Export server-verified Telegram actors to the designated offline-capable bot."""

import hashlib
import json
from datetime import UTC, datetime
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.engine import RowMapping
from sqlalchemy.ext.asyncio import AsyncConnection

from .access_control import MODULE_ACTIONS, module_permissions_for_user
from .ai_referent_configuration_service import read_configuration
from .ai_referent_schemas import OfflineRightsSnapshot, OfflineTelegramActor
from .ai_referent_shared_service import telegram_actor
from .tables import (
    ai_referent_authority,
    ai_referent_configuration,
    ai_referent_offline_rights_snapshots,
    telegram_bot_grants,
    telegram_identities,
)


def _stored_snapshot(
    row: RowMapping, *, agent_id: str, epoch: UUID
) -> OfflineRightsSnapshot:
    if row["agent_id"] != agent_id or row["epoch"] != epoch:
        raise HTTPException(409, "Копия прав относится к другому роботу или эпохе.")
    canonical = json.dumps(
        row["actors"], ensure_ascii=False, sort_keys=True, separators=(",", ":")
    ).encode("utf-8")
    if hashlib.sha256(canonical).hexdigest() != row["content_sha256"]:
        raise HTTPException(500, "Контрольная сумма сохранённых прав не совпала.")
    return OfflineRightsSnapshot(
        snapshot_id=row["id"], epoch=epoch, verified_at=row["verified_at"],
        reviewer_revision=row["reviewer_revision"], actors=row["actors"],
        content_sha256=row["content_sha256"],
    )


async def export_offline_rights(
    connection: AsyncConnection, *, agent_id: str, epoch: UUID,
    snapshot_id: UUID, enabled: bool
) -> OfflineRightsSnapshot:
    if not enabled:
        raise HTTPException(409, "Автономный режим AI Referent пока не включён на сервере.")
    assigned = await connection.scalar(
        select(ai_referent_configuration.c.execution_agent_id).with_for_update(read=True)
    )
    if assigned != agent_id:
        raise HTTPException(403, "Этот компьютер не назначен агентом отправки.")
    existing = (
        await connection.execute(
            select(ai_referent_offline_rights_snapshots)
            .where(ai_referent_offline_rights_snapshots.c.id == snapshot_id)
            .with_for_update()
        )
    ).mappings().first()
    if existing is not None:
        return _stored_snapshot(existing, agent_id=agent_id, epoch=epoch)
    authority = (
        await connection.execute(select(ai_referent_authority).with_for_update(read=True))
    ).mappings().first()
    now = datetime.now(UTC)
    if (
        authority is None or authority["agent_id"] != agent_id
        or authority["epoch"] != epoch or authority["mode"] != "online"
        or authority["lease_until"] <= now
    ):
        raise HTTPException(409, "Нет действующей аренды для выгрузки прав.")
    configuration = await read_configuration(connection)
    candidates = (
        await connection.execute(
            select(telegram_identities.c.telegram_id)
            .join(
                telegram_bot_grants,
                telegram_bot_grants.c.user_id == telegram_identities.c.user_id,
            )
            .where(
                telegram_identities.c.telegram_id.is_not(None),
                telegram_identities.c.verified_at.is_not(None),
                telegram_bot_grants.c.bot_key == "ai_referent",
            )
            .distinct()
            .order_by(telegram_identities.c.telegram_id)
        )
    ).scalars().all()
    actors: list[OfflineTelegramActor] = []
    for candidate in candidates:
        telegram_id = str(candidate)
        try:
            actor = await telegram_actor(connection, telegram_id)
        except HTTPException as error:
            if error.status_code == 403:
                continue  # Revoked grant, inactive account, or missing module view right.
            raise
        reviewer_keys = sorted(
            str(reviewer.key) for reviewer in configuration.reviewers
            if reviewer.can_approve and reviewer.user_id == str(actor.id)
        )
        allowed = (await module_permissions_for_user(connection, actor))["ai_referent"]
        actors.append(OfflineTelegramActor(
            telegram_id=telegram_id,
            user_id=actor.id,
            full_name=actor.full_name,
            role=actor.role,
            reviewer_keys=reviewer_keys,
            module_actions=[action for action in MODULE_ACTIONS if allowed[action]],
        ))
    canonical = json.dumps(
        [actor.model_dump(mode="json", by_alias=True) for actor in actors],
        ensure_ascii=False, sort_keys=True, separators=(",", ":"),
    ).encode("utf-8")
    await connection.execute(
        pg_insert(ai_referent_offline_rights_snapshots)
        .values(
            id=snapshot_id, agent_id=agent_id, epoch=epoch,
            reviewer_revision=configuration.revision,
            actors=[actor.model_dump(mode="json", by_alias=True) for actor in actors],
            content_sha256=hashlib.sha256(canonical).hexdigest(), verified_at=now,
        )
        .on_conflict_do_nothing(index_elements=[ai_referent_offline_rights_snapshots.c.id])
    )
    saved = (
        await connection.execute(
            select(ai_referent_offline_rights_snapshots)
            .where(ai_referent_offline_rights_snapshots.c.id == snapshot_id)
            .with_for_update()
        )
    ).mappings().one()
    return _stored_snapshot(saved, agent_id=agent_id, epoch=epoch)
