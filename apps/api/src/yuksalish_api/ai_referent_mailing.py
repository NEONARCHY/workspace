"""Official mailing recipients and their fenced delivery commands."""

import re
from datetime import UTC, datetime
from typing import Literal
from uuid import UUID, uuid4

from fastapi import HTTPException
from sqlalchemy import delete, insert, select, update
from sqlalchemy.engine import RowMapping
from sqlalchemy.ext.asyncio import AsyncConnection

from .access_control import module_permissions_for_user
from .ai_referent_recipient_service import load_recipients
from .ai_referent_schemas import AIReferentMailingRecipient, AIReferentMailingRecipientInput
from .auth import load_authenticated_user
from .tables import ai_referent_delivery_commands as commands
from .tables import ai_referent_mailing_recipients as recipients

EMAIL = re.compile(r"[A-Za-z0-9_][A-Za-z0-9._%+-]*@[A-Za-z0-9][A-Za-z0-9.-]*\.[A-Za-z]{2,}")


async def replace_recipients(
    connection: AsyncConnection,
    letter_id: UUID,
    inputs: list[AIReferentMailingRecipientInput],
) -> list[AIReferentMailingRecipient]:
    values = []
    for position, item in enumerate(inputs):
        address = item.address
        if item.directory_id:
            directory = await load_recipients(connection, address, "", 0, 2000)
            entry = next(
                (entry for entry in directory.entries
                 if entry.id == item.directory_id and address in entry.addresses),
                None,
            )
            if entry is None:
                raise HTTPException(422, f"Адрес {address} изменился в справочнике.")
            organization = entry.address_book_organization or entry.name
        else:
            entry = None
            organization = item.organization
        if EMAIL.fullmatch(address):
            route = "exat" if address.lower().endswith("@exat.uz") else "webmail"
        elif entry is not None and "@" not in address:
            route = entry.route
        else:
            raise HTTPException(422, f"Укажите корректный адрес: {address}")
        values.append(dict(
            id=uuid4(), letter_id=letter_id, position=position, organization=organization,
            address=address, address_key=address.casefold(), directory_id=item.directory_id,
            route=route, status="draft", detail="", attempts=0,
        ))
    await connection.execute(delete(recipients).where(recipients.c.letter_id == letter_id))
    await connection.execute(insert(recipients), values)
    return [AIReferentMailingRecipient.model_validate(value) for value in values]


async def load_recipients_for_letter(
    connection: AsyncConnection, letter_id: UUID
) -> list[AIReferentMailingRecipient]:
    rows = (await connection.execute(
        select(recipients).where(recipients.c.letter_id == letter_id)
        .order_by(recipients.c.position)
    )).mappings().all()
    return [AIReferentMailingRecipient.model_validate(dict(row)) for row in rows]


async def enqueue_recipient(
    connection: AsyncConnection, letter: RowMapping, recipient: AIReferentMailingRecipient,
    actor_id: UUID,
) -> None:
    now = datetime.now(UTC)
    await connection.execute(insert(commands).values(
        id=uuid4(), letter_id=letter["id"], recipient_id=recipient.id,
        requested_by=actor_id, approved_pdf_id=letter["final_pdf_file_id"],
        route=recipient.route, status="pending", kind="send",
        idempotency_key=f"recipient:{recipient.id}:attempt:{recipient.attempts + 1}",
        created_at=now, updated_at=now,
    ))
    await set_recipient_status(connection, recipient.id, "queued", "")


async def set_recipient_status(
    connection: AsyncConnection, recipient_id: UUID, status: str, detail: str,
) -> None:
    values: dict[str, object] = {"status": status, "detail": detail}
    if status == "sending":
        values["attempts"] = recipients.c.attempts + 1
    await connection.execute(
        update(recipients).where(recipients.c.id == recipient_id).values(**values)
    )


async def stop_pending(connection: AsyncConnection, letter_id: UUID) -> int:
    ids = (await connection.execute(
        update(commands).where(
            commands.c.letter_id == letter_id, commands.c.recipient_id.is_not(None),
            commands.c.status == "pending",
        ).values(status="cancelled", updated_at=datetime.now(UTC))
        .returning(commands.c.recipient_id)
    )).scalars().all()
    if ids:
        await connection.execute(update(recipients).where(recipients.c.id.in_(ids)).values(
            status="stopped", detail="Отменено до начала отправки.",
        ))
    return len(ids)


async def mailing_status(connection: AsyncConnection, letter_id: UUID) -> str:
    states = set((await connection.execute(
        select(recipients.c.status).where(recipients.c.letter_id == letter_id)
    )).scalars())
    if "sending" in states:
        return "sending"
    if "unknown" in states:
        return "delivery_unknown"
    if "queued" in states:
        return "queued"
    if states == {"sent"}:
        return "sent"
    if states == {"stopped"}:
        return "cancelled"
    return "failed"


async def may_send_recipient(
    connection: AsyncConnection, job: RowMapping, letter: RowMapping
) -> bool:
    if not job["approved_pdf_id"] or job["approved_pdf_id"] != letter["final_pdf_file_id"]:
        return False
    checks: tuple[tuple[UUID | None, Literal["admin", "edit"]], ...] = (
        (job["requested_by"], "admin"), (letter["created_by_user_id"], "edit"),
    )
    for user_id, action in checks:
        if user_id is None:
            return False
        user = await load_authenticated_user(connection, user_id)
        if user is None:
            return False
        permissions = await module_permissions_for_user(connection, user)
        if not permissions.get("ai_referent", {}).get(action, False):
            return False
    return True
