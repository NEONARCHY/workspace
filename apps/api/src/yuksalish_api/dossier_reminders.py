"""Server-clock monthly check-in; never read or copy questionnaire contents."""

from datetime import UTC, date, datetime
from uuid import uuid4
from zoneinfo import ZoneInfo

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncConnection

from .auth import AuthenticatedUser
from .dossier_schemas import DossierReminder, DossierReminderAnswer
from .dossier_tables import dossier_monthly_reviews as reviews
from .errors import WorkspaceRepositoryError
from .tables import audit_events

ZONE = ZoneInfo("Asia/Tashkent")
CLOSED = {"no_changes", "skipped", "updated"}


def current_time() -> datetime:
    return datetime.now(UTC)


async def reminder(
    connection: AsyncConnection, actor: AuthenticatedUser, *, now: datetime | None = None,
) -> DossierReminder:
    today = (now or current_time()).astimezone(ZONE).date()
    period = today.replace(day=1)
    row = (await connection.execute(select(reviews).where(
        reviews.c.user_id == actor.id, reviews.c.period == period,
    ))).mappings().first()
    return DossierReminder(
        period=period.strftime("%Y-%m"), due_date=today.replace(day=25),
        due=today.day >= 25 and (not row or row["status"] not in CLOSED),
        status=row["status"] if row else "pending",
        responded_at=row["responded_at"] if row else None,
    )


async def _record(
    connection: AsyncConnection, actor: AuthenticatedUser, period: date,
    status: str, revision: int | None = None,
) -> None:
    now = current_time()
    statement = pg_insert(reviews).values(
        user_id=actor.id, period=period, status=status,
        responded_at=now, dossier_revision=revision,
    )
    await connection.execute(statement.on_conflict_do_update(
        index_elements=[reviews.c.user_id, reviews.c.period],
        set_={"status": status, "responded_at": now, "dossier_revision": revision},
    ))
    await connection.execute(audit_events.insert().values(
        id=uuid4(), actor_user_id=actor.id, action="dossier.monthly_review_answered",
        target_type="personnel_dossier", target_id=actor.id,
        details={"period": period.strftime("%Y-%m"), "answer": status, "revision": revision},
        created_at=now,
    ))


async def answer(
    connection: AsyncConnection, actor: AuthenticatedUser, payload: DossierReminderAnswer,
) -> DossierReminder:
    # Same lock as self-save: a stale tab cannot overwrite a completed update.
    await connection.execute(select(func.pg_advisory_xact_lock(actor.id.int % (2**63))))
    now = current_time()
    state = await reminder(connection, actor, now=now)
    today = now.astimezone(ZONE).date()
    if payload.period != state.period or today.day < 25:
        raise WorkspaceRepositoryError(409, "Период напоминания изменился. Обновите напоминание.")
    if state.status in CLOSED or state.status == payload.action:
        return state
    await _record(connection, actor, today.replace(day=1), payload.action)
    return await reminder(connection, actor, now=now)


async def record_self_update(
    connection: AsyncConnection, actor: AuthenticatedUser, revision: int,
) -> None:
    # Called inside the self-save transaction, after the questionnaire/revision is written.
    today = current_time().astimezone(ZONE).date()
    if today.day >= 25:
        await _record(connection, actor, today.replace(day=1), "updated", revision)
