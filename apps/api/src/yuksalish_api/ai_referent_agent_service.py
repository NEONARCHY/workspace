"""Fenced jobs: never silently repeat a possibly completed external send."""

from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

from fastapi import HTTPException
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncConnection

from .ai_referent_service import _event, _letter_row
from .ai_referent_shared_service import notify_letter, telegram_id_for
from .tables import (
    ai_referent_configuration,
    ai_referent_events,
    ai_referent_files,
    attachments,
    users,
)
from .tables import (
    ai_referent_delivery_commands as commands,
)
from .tables import (
    ai_referent_letters as letters,
)


async def expire_jobs(connection: AsyncConnection) -> int:
    await connection.execute(select(ai_referent_configuration).with_for_update())
    now = datetime.now(UTC)
    rows = (
        (
            await connection.execute(
                select(commands)
                .where(
                    commands.c.status == "claimed",
                    commands.c.lease_until < now,
                )
                .with_for_update()
            )
        )
        .mappings()
        .all()
    )
    for job in rows:
        status = "delivery_unknown" if job["kind"] == "send" else "failed"
        await connection.execute(
            update(commands)
            .where(commands.c.id == job["id"])
            .values(
                status="failed",
                last_error="Агент перестал подтверждать выполнение.",
                updated_at=now,
            )
        )
        row = await _letter_row(connection, job["letter_id"], lock=True)
        if row["status"] != "sending":
            continue
        await connection.execute(
            update(letters)
            .where(letters.c.id == row["id"])
            .values(
                status=status,
                revision=row["revision"] + 1,
                updated_at=now,
                delivery_error="Агент отключился. Проверьте журнал Exat перед повтором.",
            )
        )
        await _event(
            connection,
            row["id"],
            None,
            "agent.lease_expired",
            from_status="sending",
            to_status=status,
        )
        await notify_letter(
            connection,
            await _letter_row(connection, row["id"]),
            "Требуется проверка результата работы робота",
        )
    return len(rows)


async def claim_job(connection: AsyncConnection, agent_id: str) -> dict[str, object] | None:
    await connection.execute(select(ai_referent_configuration).with_for_update())
    assigned = await connection.scalar(select(ai_referent_configuration.c.execution_agent_id))
    if assigned != agent_id:
        raise HTTPException(409, "Сначала завершите сверку архива на назначенном ПК референта.")
    await expire_jobs(connection)
    # One physical Windows GUI/numbering journal, therefore one execution lane.
    active = await connection.scalar(
        select(commands.c.id).where(commands.c.status == "claimed").limit(1)
    )
    if active:
        return None
    job = (
        (
            await connection.execute(
                select(commands)
                .where(commands.c.status == "pending")
                .order_by(commands.c.created_at)
                .limit(1)
                .with_for_update(skip_locked=True)
            )
        )
        .mappings()
        .one_or_none()
    )
    if job is None:
        return None
    row = await _letter_row(connection, job["letter_id"], lock=True)
    if row["status"] != "queued":
        await connection.execute(
            update(commands).where(commands.c.id == job["id"]).values(status="cancelled")
        )
        return None
    now, lease = datetime.now(UTC), uuid4()
    await connection.execute(
        update(commands)
        .where(commands.c.id == job["id"])
        .values(
            status="claimed",
            claimed_by=agent_id,
            lease_token=lease,
            lease_until=now + timedelta(minutes=3),
            attempt_count=job["attempt_count"] + 1,
            updated_at=now,
        )
    )
    await connection.execute(
        update(letters)
        .where(letters.c.id == row["id"])
        .values(
            status="sending",
            revision=row["revision"] + 1,
            updated_at=now,
            delivery_error="",
        )
    )
    files = (
        (
            await connection.execute(
                select(attachments)
                .where(
                    attachments.c.owner_type == "ai_referent_letter",
                    attachments.c.owner_id == row["id"],
                )
                .order_by(attachments.c.created_at)
            )
        )
        .mappings()
        .all()
    )
    approver = await connection.scalar(
        select(ai_referent_events.c.actor_user_id)
        .where(
            ai_referent_events.c.letter_id == row["id"],
            ai_referent_events.c.event_type == "letter.approve",
            ai_referent_events.c.to_status == "approved",
        )
        .order_by(ai_referent_events.c.created_at.desc())
        .limit(1)
    )
    approval_name = (
        await connection.scalar(select(users.c.full_name).where(users.c.id == approver))
        if approver
        else None
    )
    signed = (
        (
            await connection.execute(
                select(ai_referent_files)
                .where(
                    ai_referent_files.c.kind == "outgoing",
                    ai_referent_files.c.owner_id == row["id"],
                    ai_referent_files.c.relative_path.like("signed/%"),
                )
                .order_by(ai_referent_files.c.created_at.desc())
                .limit(1)
            )
        )
        .mappings()
        .first()
    )
    return {
        "id": str(job["id"]),
        "leaseToken": str(lease),
        "kind": job["kind"],
        "letterId": str(row["id"]),
        "revision": row["revision"] + 1,
        "outgoingNumber": row["outgoing_number"],
        "yearSuffix": row["year_suffix"],
        "subject": row["subject"],
        "recipientOrganization": row["recipient_organization"],
        "recipientAddress": row["recipient_address"],
        "route": row["route"],
        "senderName": row["creator_name"],
        "reviewerName": approval_name or row["reviewer_name"],
        "senderTelegramId": await telegram_id_for(connection, row["created_by_user_id"]),
        "reviewerTelegramId": await telegram_id_for(connection, approver) if approver else None,
        "signedFile": {"id": str(signed["id"]), "sha256": signed["sha256"]} if signed else None,
        "files": [
            {
                "id": str(item["id"]),
                "name": item["file_name"],
                "role": item["document_role"],
                "sha256": item["sha256"],
                "byteSize": item["byte_size"],
            }
            for item in files
        ],
    }


async def heartbeat_job(
    connection: AsyncConnection, job_id: UUID, lease: UUID, agent_id: str
) -> None:
    result = await connection.execute(
        update(commands)
        .where(
            commands.c.id == job_id,
            commands.c.lease_token == lease,
            commands.c.claimed_by == agent_id,
            commands.c.status == "claimed",
            commands.c.lease_until > datetime.now(UTC),
        )
        .values(lease_until=datetime.now(UTC) + timedelta(minutes=3))
    )
    if result.rowcount != 1:
        raise HTTPException(409, "Задание больше не принадлежит этому агенту.")


async def complete_job(
    connection: AsyncConnection,
    job_id: UUID,
    lease: UUID,
    agent_id: str,
    outcome: str,
    detail: str,
    signed_pages: int | None = None,
) -> None:
    await connection.execute(select(ai_referent_configuration).with_for_update())
    job = (
        (
            await connection.execute(
                select(commands).where(commands.c.id == job_id).with_for_update()
            )
        )
        .mappings()
        .one_or_none()
    )
    if job is None or job["lease_token"] != lease or job["claimed_by"] != agent_id:
        raise HTTPException(409, "Устаревшее подтверждение задания.")
    result: dict[str, object] = {"outcome": outcome, "detail": detail}
    if signed_pages is not None:
        result["signedPages"] = signed_pages
    if job["status"] == "completed" and job["result"] == result:
        return
    if job["status"] != "claimed" or job["lease_until"] < datetime.now(UTC):
        raise HTTPException(409, "Срок задания истёк; результат требуется проверить вручную.")
    row = await _letter_row(connection, job["letter_id"], lock=True)
    if row["status"] != "sending":
        raise HTTPException(409, "Состояние письма уже изменилось.")
    if row["workflow_kind"] == "sign_only" and job["kind"] != "sign_only":
        raise HTTPException(409, "Для подписи без отправки назначено неверное задание.")
    if row["workflow_kind"] == "sign_only" and outcome == "sent":
        raise HTTPException(422, "Внешняя отправка в режиме подписи запрещена.")
    if outcome == "prepared":
        if job["kind"] not in {"prepare", "sign_only"}:
            raise HTTPException(422, "Неверный результат отправки.")
        if job["kind"] == "sign_only":
            if signed_pages is None or not 1 <= signed_pages <= 100:
                raise HTTPException(422, "Укажите число подписанных страниц.")
            produced = (
                await connection.execute(
                    select(ai_referent_files.c.relative_path).where(
                        ai_referent_files.c.owner_id == row["id"],
                        ai_referent_files.c.kind == "outgoing",
                        ai_referent_files.c.relative_path.like(f"signed/{job_id}/%"),
                    )
                )
            ).scalars().all()
            expected = {f"signed/{job_id}/{page:03d}.pdf" for page in range(1, signed_pages + 1)}
            if set(produced) != expected:
                raise HTTPException(422, "Нужен отдельный подписанный PDF для каждой страницы.")
            status = "signed"
        else:
            signed = await connection.scalar(
                select(ai_referent_files.c.id).where(
                    ai_referent_files.c.owner_id == row["id"],
                    ai_referent_files.c.kind == "outgoing",
                    ai_referent_files.c.relative_path == f"signed/{job_id}.pdf",
                )
            )
            if not signed:
                raise HTTPException(422, "Сначала загрузите подписанный PDF этого задания.")
            status = (
                "awaiting_final_send"
                if row["reviewer_key"] == "bobur" else "referent_review_pending"
            )
    elif outcome == "sent":
        if job["kind"] != "send" or len(detail.strip()) < 3:
            raise HTTPException(422, "Требуется подтверждение фактической отправки.")
        status = "sent"
    else:
        # Even a reported send failure may have happened after the external click.
        status = "delivery_unknown" if job["kind"] == "send" else "failed"
    now = datetime.now(UTC)
    await connection.execute(
        update(commands)
        .where(commands.c.id == job_id)
        .values(
            status="completed",
            result=result,
            completed_at=now,
            updated_at=now,
            last_error=detail if status in {"failed", "delivery_unknown"} else "",
        )
    )
    await connection.execute(
        update(letters)
        .where(letters.c.id == row["id"])
        .values(
            status=status,
            revision=row["revision"] + 1,
            updated_at=now,
            sent_at=now if status == "sent" else row["sent_at"],
            delivery_error=detail if status in {"failed", "delivery_unknown"} else "",
        )
    )
    await _event(
        connection,
        row["id"],
        None,
        f"agent.{outcome}",
        from_status="sending",
        to_status=status,
        comment=detail,
    )
    await notify_letter(
        connection,
        await _letter_row(connection, row["id"]),
        {
            "awaiting_final_send": "Подписанный PDF ожидает финального решения",
            "referent_review_pending": "Письмо готово: требуется отправка референтом",
            "signed": "Письма подписаны и доступны отдельными PDF — без отправки адресатам",
            "sent": "Письмо отправлено",
            "failed": "Ошибка подготовки письма",
            "delivery_unknown": "Результат отправки требует проверки",
        }[status],
    )
