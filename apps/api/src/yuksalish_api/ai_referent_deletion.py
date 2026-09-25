"""Delete a withdrawn letter, never race an external delivery."""

from datetime import UTC, datetime
from uuid import UUID, uuid4

from fastapi import HTTPException
from sqlalchemy import delete, insert, select, update
from sqlalchemy.ext.asyncio import AsyncConnection

from .access_control import ensure_module_action
from .auth import AuthenticatedUser
from .tables import (
    ai_referent_comment_audio,
    ai_referent_configuration,
    ai_referent_delivery_commands,
    ai_referent_events,
    ai_referent_files,
    ai_referent_letters,
    ai_referent_operations,
    ai_referent_telegram_outbox,
    attachments,
    audit_events,
    workspace_notifications,
)


async def purge_letter(connection: AsyncConnection, letter_id: UUID) -> None:
    # Keep the minimal deletion audit and monotonic number counter. Blob retention is
    # deliberate: rollback/backups must not point at already-destroyed objects.
    for table in (
        ai_referent_comment_audio,
        ai_referent_events,
        ai_referent_operations,
        ai_referent_telegram_outbox,
        ai_referent_delivery_commands,
    ):
        await connection.execute(delete(table).where(table.c.letter_id == letter_id))
    await connection.execute(
        delete(attachments).where(
            attachments.c.owner_type == "ai_referent_letter",
            attachments.c.owner_id == letter_id,
        )
    )
    await connection.execute(
        delete(ai_referent_files).where(
            ai_referent_files.c.kind == "outgoing",
            ai_referent_files.c.owner_id == letter_id,
        )
    )
    await connection.execute(
        delete(workspace_notifications).where(
            workspace_notifications.c.section == "ai_referent",
            workspace_notifications.c.entity_id == letter_id,
        )
    )
    await connection.execute(
        delete(ai_referent_letters).where(ai_referent_letters.c.id == letter_id)
    )


async def request_deletion(
    connection: AsyncConnection,
    user: AuthenticatedUser,
    letter_id: UUID,
    revision: int,
) -> dict[str, bool]:
    await ensure_module_action(connection, user, "ai_referent", "edit")
    await connection.execute(select(ai_referent_configuration).with_for_update())
    row = (
        (
            await connection.execute(
                select(ai_referent_letters)
                .where(
                    ai_referent_letters.c.id == letter_id,
                )
                .with_for_update()
            )
        )
        .mappings()
        .first()
    )
    if row is None:
        return {"queued": False}
    if row["created_by_user_id"] != user.id:
        raise HTTPException(403, "Удалить письмо может только автор.")
    if row["revision"] != revision:
        raise HTTPException(409, "Письмо изменилось. Проверьте актуальное состояние.")
    if row["status"] in {"sent", "signed", "sending", "queued", "delivery_unknown"}:
        raise HTTPException(
            409,
            "Удаление сейчас небезопасно: письмо исполняется или доставка уже произошла. "
            "Для неизвестной доставки сначала нужна сверка референта.",
        )
    now = datetime.now(UTC)
    await connection.execute(
        insert(audit_events).values(
            id=uuid4(),
            actor_user_id=user.id,
            action="ai_referent.delete",
            target_type="ai_referent_letter",
            target_id=letter_id,
            details={"fromStatus": row["status"], "number": row["outgoing_number"]},
            created_at=now,
        )
    )
    if row["outgoing_number"] is None:
        await purge_letter(connection, letter_id)
        return {"queued": False}
    # Robot first closes its compose window and withdraws the local registry row.
    await connection.execute(
        update(ai_referent_letters)
        .where(ai_referent_letters.c.id == letter_id)
        .values(
            status="queued",
            revision=revision + 1,
            updated_at=now,
        )
    )
    await connection.execute(
        insert(ai_referent_delivery_commands).values(
            id=uuid4(),
            letter_id=letter_id,
            route=row["route"],
            status="pending",
            kind="delete",
            idempotency_key=f"delete:{letter_id}:{revision}",
            attempt_count=0,
            last_error="",
            created_at=now,
            updated_at=now,
        )
    )
    return {"queued": True}
