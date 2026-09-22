# Russian user-facing strings intentionally use Cyrillic characters.
"""Incoming correspondence registry synchronized by the referent workstation agent."""

from __future__ import annotations

import hashlib
import json
from datetime import UTC, datetime
from uuid import uuid4

from sqlalchemy import func, or_, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.engine import RowMapping
from sqlalchemy.ext.asyncio import AsyncConnection

from .access_control import ensure_module_action
from .ai_referent_schemas import (
    AIReferentIncomingLetterResponse,
    AIReferentIncomingRegistryResponse,
    AIReferentIncomingSyncItem,
    AIReferentIncomingSyncRequest,
    AIReferentIncomingSyncResponse,
    AIReferentJournalResponse,
)
from .auth import AuthenticatedUser
from .tables import ai_referent_agents, ai_referent_incoming_letters, users

_REGISTERED_STATUSES = frozenset({"platform_submitted", "submitted", "completed"})
_ATTENTION_STATUSES = frozenset({"failed", "completed_with_errors", "needs_review"})


def _payload_hash(item: AIReferentIncomingSyncItem) -> str:
    payload = json.dumps(
        item.model_dump(mode="json"),
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


def _values(
    agent_id: str,
    item: AIReferentIncomingSyncItem,
    payload_sha256: str,
    now: datetime,
) -> dict[str, object]:
    return {
        "agent_id": agent_id,
        "external_id": item.external_id,
        "sequence_number": item.sequence_number,
        "platform_incoming_number": item.platform_incoming_number,
        "sender_letter_number": item.sender_letter_number,
        "platform_incoming_date": item.platform_incoming_date,
        "platform_outgoing_date": item.platform_outgoing_date,
        "received_at": item.received_at,
        "processed_at": item.processed_at,
        "registered_at": item.registered_at,
        "sender_organization": item.sender_organization,
        "sender_person": item.sender_person,
        "subject": item.subject,
        "responsible_external_id": item.responsible_external_id,
        "responsible_display_name": item.responsible_display_name,
        "urgency": item.urgency,
        "has_attachments": item.has_attachments,
        "attachments_count": item.attachments_count,
        "main_document_filename": item.main_document_filename,
        "platform_record_id": item.platform_record_id,
        "status": item.status,
        "fallback_used": item.fallback_used,
        "error_message": item.error_message,
        "source": item.source,
        "payload_sha256": payload_sha256,
        "updated_at": now,
    }


async def sync_incoming_letters(
    connection: AsyncConnection,
    payload: AIReferentIncomingSyncRequest,
) -> AIReferentIncomingSyncResponse:
    """Idempotently upsert one bounded batch without deleting absent robot records."""
    now = datetime.now(UTC)
    await connection.execute(
        pg_insert(ai_referent_agents)
        .values(
            agent_id=payload.agent_id,
            display_name=payload.agent_name,
            last_seen_at=now,
            journal_storage_key=None,
            journal_file_name=None,
            journal_content_type=None,
            journal_byte_size=None,
            journal_sha256=None,
            journal_updated_at=None,
            created_at=now,
            updated_at=now,
        )
        .on_conflict_do_update(
            index_elements=[ai_referent_agents.c.agent_id],
            set_={
                "display_name": payload.agent_name,
                "last_seen_at": now,
                "updated_at": now,
            },
        )
    )

    external_ids = [item.external_id for item in payload.letters]
    existing = {}
    if external_ids:
        rows = (
            await connection.execute(
                select(
                    ai_referent_incoming_letters.c.external_id,
                    ai_referent_incoming_letters.c.payload_sha256,
                ).where(
                    ai_referent_incoming_letters.c.agent_id == payload.agent_id,
                    ai_referent_incoming_letters.c.external_id.in_(external_ids),
                )
            )
        ).mappings().all()
        existing = {str(row["external_id"]): str(row["payload_sha256"]) for row in rows}

    created_count = 0
    updated_count = 0
    unchanged_count = 0
    for item in payload.letters:
        payload_sha256 = _payload_hash(item)
        previous_hash = existing.get(item.external_id)
        if previous_hash == payload_sha256:
            unchanged_count += 1
            continue
        values = _values(payload.agent_id, item, payload_sha256, now)
        statement = pg_insert(ai_referent_incoming_letters).values(
            id=uuid4(),
            responsible_user_id=None,
            revision=1,
            created_at=now,
            **values,
        )
        update_values = {
            key: value
            for key, value in values.items()
            if key not in {"agent_id", "external_id"}
        }
        update_values["revision"] = ai_referent_incoming_letters.c.revision + 1
        await connection.execute(
            statement.on_conflict_do_update(
                constraint="uq_ai_incoming_agent_external",
                set_=update_values,
            )
        )
        if previous_hash is None:
            created_count += 1
        else:
            updated_count += 1
        existing[item.external_id] = payload_sha256

    return AIReferentIncomingSyncResponse(
        created_count=created_count,
        updated_count=updated_count,
        unchanged_count=unchanged_count,
        received_count=len(payload.letters),
        synced_at=now,
    )


def _response(row: RowMapping) -> AIReferentIncomingLetterResponse:
    return AIReferentIncomingLetterResponse(
        id=str(row["id"]),
        agent_id=row["agent_id"],
        external_id=row["external_id"],
        sequence_number=row["sequence_number"],
        platform_incoming_number=row["platform_incoming_number"] or "",
        sender_letter_number=row["sender_letter_number"] or "",
        platform_incoming_date=row["platform_incoming_date"],
        platform_outgoing_date=row["platform_outgoing_date"],
        received_at=row["received_at"],
        processed_at=row["processed_at"],
        registered_at=row["registered_at"],
        sender_organization=row["sender_organization"] or "",
        sender_person=row["sender_person"] or "",
        subject=row["subject"] or "",
        responsible_external_id=row["responsible_external_id"] or "",
        responsible_display_name=row["responsible_display_name"] or "",
        responsible_user_id=(
            str(row["responsible_user_id"]) if row["responsible_user_id"] else None
        ),
        responsible_user_name=row["responsible_user_name"],
        urgency=row["urgency"],
        has_attachments=bool(row["has_attachments"]),
        attachments_count=row["attachments_count"],
        main_document_filename=row["main_document_filename"] or "",
        platform_record_id=row["platform_record_id"] or "",
        status=row["status"],
        fallback_used=bool(row["fallback_used"]),
        error_message=row["error_message"] or "",
        source=row["source"],
        revision=row["revision"],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


async def load_incoming_letters(
    connection: AsyncConnection,
    current_user: AuthenticatedUser,
    *,
    query: str = "",
    status: str | None = None,
) -> AIReferentIncomingRegistryResponse:
    await ensure_module_action(connection, current_user, "ai_referent", "view")
    responsible = users.alias("ai_incoming_responsible")
    statement = select(
        ai_referent_incoming_letters,
        responsible.c.full_name.label("responsible_user_name"),
    ).select_from(
        ai_referent_incoming_letters.join(
            responsible,
            responsible.c.id == ai_referent_incoming_letters.c.responsible_user_id,
            isouter=True,
        )
    )
    conditions = []
    if status:
        conditions.append(ai_referent_incoming_letters.c.status == status)
    cleaned = query.strip()
    if cleaned:
        pattern = f"%{cleaned}%"
        conditions.append(
            or_(
                ai_referent_incoming_letters.c.sequence_number.ilike(pattern),
                ai_referent_incoming_letters.c.platform_incoming_number.ilike(pattern),
                ai_referent_incoming_letters.c.sender_letter_number.ilike(pattern),
                ai_referent_incoming_letters.c.sender_organization.ilike(pattern),
                ai_referent_incoming_letters.c.sender_person.ilike(pattern),
                ai_referent_incoming_letters.c.subject.ilike(pattern),
                ai_referent_incoming_letters.c.responsible_display_name.ilike(pattern),
            )
        )
    if conditions:
        statement = statement.where(*conditions)
    rows = (
        await connection.execute(
            statement.order_by(
                ai_referent_incoming_letters.c.received_at.desc().nulls_last(),
                ai_referent_incoming_letters.c.updated_at.desc(),
            ).limit(500)
        )
    ).mappings().all()
    agent = (
        await connection.execute(
            select(ai_referent_agents)
            .where(ai_referent_agents.c.journal_storage_key.is_not(None))
            .order_by(ai_referent_agents.c.journal_updated_at.desc().nulls_last())
            .limit(1)
        )
    ).mappings().one_or_none()
    latest_seen = await connection.scalar(
        select(ai_referent_agents.c.last_seen_at)
        .order_by(ai_referent_agents.c.last_seen_at.desc())
        .limit(1)
    )
    counts_statement = select(
        func.count().label("total_count"),
        func.count().filter(
            ai_referent_incoming_letters.c.status.in_(_REGISTERED_STATUSES)
        ).label("registered_count"),
        func.count().filter(
            or_(
                ai_referent_incoming_letters.c.status.in_(_ATTENTION_STATUSES),
                ai_referent_incoming_letters.c.error_message != "",
            )
        ).label("attention_count"),
        func.count().filter(ai_referent_incoming_letters.c.has_attachments.is_(True)).label(
            "with_attachments_count"
        ),
    )
    if conditions:
        counts_statement = counts_statement.where(*conditions)
    counts = (await connection.execute(counts_statement)).mappings().one()
    return AIReferentIncomingRegistryResponse(
        letters=[_response(row) for row in rows],
        total_count=counts["total_count"],
        registered_count=counts["registered_count"],
        attention_count=counts["attention_count"],
        with_attachments_count=counts["with_attachments_count"],
        last_sync_at=latest_seen,
        journal=AIReferentJournalResponse(
            available=agent is not None,
            file_name=agent["journal_file_name"] if agent else None,
            byte_size=agent["journal_byte_size"] if agent else None,
            sha256=agent["journal_sha256"] if agent else None,
            updated_at=agent["journal_updated_at"] if agent else None,
            agent_name=agent["display_name"] if agent else None,
        ),
    )


async def save_journal_metadata(
    connection: AsyncConnection,
    *,
    agent_id: str,
    agent_name: str,
    storage_key: str,
    file_name: str,
    content_type: str,
    byte_size: int,
    sha256: str,
    updated_at: datetime,
) -> None:
    now = datetime.now(UTC)
    await connection.execute(
        pg_insert(ai_referent_agents)
        .values(
            agent_id=agent_id,
            display_name=agent_name,
            last_seen_at=now,
            journal_storage_key=storage_key,
            journal_file_name=file_name,
            journal_content_type=content_type,
            journal_byte_size=byte_size,
            journal_sha256=sha256,
            journal_updated_at=updated_at,
            created_at=now,
            updated_at=now,
        )
        .on_conflict_do_update(
            index_elements=[ai_referent_agents.c.agent_id],
            set_={
                "display_name": agent_name,
                "last_seen_at": now,
                "journal_storage_key": storage_key,
                "journal_file_name": file_name,
                "journal_content_type": content_type,
                "journal_byte_size": byte_size,
                "journal_sha256": sha256,
                "journal_updated_at": updated_at,
                "updated_at": now,
            },
        )
    )


async def latest_journal(
    connection: AsyncConnection,
    current_user: AuthenticatedUser,
) -> RowMapping:
    await ensure_module_action(connection, current_user, "ai_referent", "view")
    row = (
        await connection.execute(
            select(ai_referent_agents)
            .where(ai_referent_agents.c.journal_storage_key.is_not(None))
            .order_by(ai_referent_agents.c.journal_updated_at.desc().nulls_last())
            .limit(1)
        )
    ).mappings().one_or_none()
    if row is None:
        raise LookupError("Excel-журнал ещё не синхронизирован.")
    return row
