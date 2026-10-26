"""Fail-closed recovery of approved delivery jobs; never infer delivery from a PDF."""

from sqlalchemy import select
from sqlalchemy.engine import RowMapping
from sqlalchemy.ext.asyncio import AsyncConnection

from .tables import ai_referent_delivery_commands as commands
from .tables import ai_referent_events as events
from .tables import ai_referent_files as files


async def failed_delivery_retry_plan(
    connection: AsyncConnection, row: RowMapping
) -> tuple[str, str]:
    """Return the existing command kind and a human-readable blocking reason.

    Callers performing mutations hold the configuration and letter locks, also
    used by claim/result. Only a completed, explicitly failed pre-send job is safe.
    External mail has no transaction with PostgreSQL: operator verification of the
    external journal remains mandatory and is recorded with the retry decision.
    """
    if row["workflow_kind"] != "delivery" or row["status"] != "failed":
        return "", "Повтор возможен только после ошибки подготовки отправки."
    if row.get("sent_at"):
        return "", "Есть подтверждение отправки. Повторная отправка заблокирована."
    history = (
        await connection.execute(
            select(events).where(events.c.letter_id == row["id"])
            .order_by(events.c.created_at.desc(), events.c.id.desc())
        )
    ).mappings().all()
    if any(event["to_status"] == "sent" for event in history):
        return "", "История содержит подтверждение отправки. Повтор заблокирован."
    approval = next((event for event in history if (
        event["event_type"] == "letter.approve"
        and event["to_status"] in {"approved", "queued"}
    )), None)
    if (
        approval is None or not row.get("outgoing_number") or not row.get("year_suffix")
        or any(
            event["created_at"] >= approval["created_at"]
            and (event["to_status"] in {"needs_revision", "pending_review", "cancelled"}
                 or event["event_type"] == "letter.updated")
            for event in history
        )
    ):
        return "", "Нет действующего завершённого согласования. Повтор без него запрещён."
    jobs = (
        await connection.execute(
            select(commands).where(commands.c.letter_id == row["id"])
            .order_by(commands.c.created_at.desc(), commands.c.id.desc())
        )
    ).mappings().all()
    if any(job["status"] in {"pending", "claimed"} for job in jobs):
        return "", "Для письма уже есть активное задание. Дождитесь завершения текущего задания."
    if any((job["result"] or {}).get("outcome") == "sent" for job in jobs):
        return "", "Робот уже подтвердил отправку. Повтор заблокирован."
    if (
        any(job["kind"] in {"send", "record_sent", "delete"} for job in jobs)
        or any((job["result"] or {}).get("outcome") == "unknown" for job in jobs)
        or any(event["to_status"] == "delivery_unknown" for event in history)
    ):
        return "", (
            "Была попытка внешней отправки или неизвестный результат. "
            "Нужна сверка доставки референтом."
        )
    if (
        not jobs or jobs[0]["status"] != "completed"
        or jobs[0]["kind"] not in {"prepare", "dispatch", "reprepare"}
        or (jobs[0]["result"] or {}).get("outcome") != "failed"
    ):
        return "", (
            "Нет достоверного результата последнего задания. Сначала сверьте журнал референта."
        )
    if row.get("final_pdf_file_id"):
        signed = await connection.scalar(select(files.c.id).where(
            files.c.id == row["final_pdf_file_id"],
            files.c.owner_id == row["id"], files.c.kind == "outgoing",
            files.c.relative_path.like("signed/%"),
        ))
        if not signed:
            return "", "Подписанный PDF не подтверждён в пакете письма. Нужна сверка референта."
        return "dispatch", ""
    # Existing replacement preparation keeps the approved number/signatory and
    # always stops at the operator, never at a new approval or an automatic send.
    return "reprepare", ""
