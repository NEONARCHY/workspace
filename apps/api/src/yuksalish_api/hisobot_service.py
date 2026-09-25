"""Shared Hisobot state. PostgreSQL is authoritative for submissions from either client."""

from datetime import UTC, date, datetime, time, timedelta
from uuid import uuid4
from zoneinfo import ZoneInfo

from fastapi import HTTPException
from sqlalchemy import and_, or_, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncConnection

from .auth import AuthenticatedUser
from .hisobot_schemas import (
    BridgeReport,
    BridgeReportExemption,
    BridgeRosterMember,
    BridgeVacationSnapshot,
    HisobotProfile,
    HisobotReport,
    HisobotReportInput,
)
from .tables import (
    absence_requests,
    hisobot_live_reports,
    hisobot_live_vacations,
    telegram_bot_grants,
    telegram_identities,
    users,
    workspace_notifications,
)
from .telegram_access_schemas import HISOBOT_REGIONS

TASHKENT = ZoneInfo("Asia/Tashkent")
REMINDER_SLOTS = (time(17, 40), time(18, 0), time(18, 10), time(18, 20), time(18, 25))


def local_now(now: datetime | None = None) -> datetime:
    value = now or datetime.now(UTC)
    return value.astimezone(TASHKENT)


def _report(row: object) -> HisobotReport:
    return HisobotReport.model_validate(row)


async def _grant(connection: AsyncConnection, user: AuthenticatedUser):
    row = (await connection.execute(
        select(telegram_bot_grants, telegram_identities.c.telegram_id)
        .join(telegram_identities, telegram_identities.c.user_id == telegram_bot_grants.c.user_id)
        .where(telegram_bot_grants.c.user_id == user.id,
               telegram_bot_grants.c.bot_key == "hisobot",
               telegram_identities.c.telegram_id.is_not(None))
    )).mappings().one_or_none()
    if row is None:
        raise HTTPException(403, "AI Hisobot: администратор ещё не выдал вам доступ и Telegram ID.")
    return row


async def _today_report(connection: AsyncConnection, telegram_id: str, day: date):
    return (await connection.execute(select(hisobot_live_reports).where(
        hisobot_live_reports.c.telegram_id == telegram_id,
        hisobot_live_reports.c.report_date == day,
    ))).mappings().one_or_none()


async def profile(connection: AsyncConnection, user: AuthenticatedUser,
                  now: datetime | None = None) -> HisobotProfile:
    grant = await _grant(connection, user)
    current = local_now(now)
    today_report = await _today_report(connection, grant["telegram_id"], current.date())
    clock = current.time().replace(tzinfo=None)
    absence_kind = next((item.kind for item in await report_exemptions(
        connection, current.date(), current.date()
    ) if item.telegram_id == grant["telegram_id"]), None)
    return HisobotProfile(
        telegram_id=grant["telegram_id"], full_name=user.full_name,
        position=user.job_title or "", report_scope=grant["report_scope"] or "central",
        region_name=grant["region_name"], report_required=bool(grant["report_required"]),
        management_access=bool(grant["hisobot_manager"]), today=current.date(),
        absence_kind=absence_kind,
        can_submit=bool(grant["report_required"] and current.weekday() < 5
                        and time(12) <= clock < time(18, 30)),
        today_report=_report(today_report) if today_report else None,
    )


async def _store_report(connection: AsyncConnection, *, telegram_id: str,
                        employee_key: str, full_name: str, position: str,
                        report_scope: str, region_name: str | None, report_date: date,
                        content: str, submitted_at: datetime, is_late: bool,
                        source: str) -> HisobotReport:
    user_id = await connection.scalar(select(telegram_identities.c.user_id).where(
        telegram_identities.c.telegram_id == telegram_id
    ))
    now = datetime.now(UTC)
    statement = pg_insert(hisobot_live_reports).values(
        id=uuid4(), user_id=user_id, telegram_id=telegram_id, employee_key=employee_key,
        full_name=full_name, position=position, report_scope=report_scope,
        region_name=region_name, report_date=report_date, content=content.strip(),
        submitted_at=submitted_at, is_late=is_late, source=source,
        created_at=now, updated_at=now,
    )
    await connection.execute(statement.on_conflict_do_update(
        index_elements=[hisobot_live_reports.c.telegram_id, hisobot_live_reports.c.report_date],
        set_={
            "user_id": statement.excluded.user_id,
            "employee_key": statement.excluded.employee_key,
            "full_name": statement.excluded.full_name,
            "position": statement.excluded.position,
            "report_scope": statement.excluded.report_scope,
            "region_name": statement.excluded.region_name,
            "content": statement.excluded.content,
            "submitted_at": statement.excluded.submitted_at,
            "is_late": statement.excluded.is_late,
            "source": statement.excluded.source,
            "updated_at": now,
        },
        where=hisobot_live_reports.c.submitted_at < statement.excluded.submitted_at,
    ))
    row = await _today_report(connection, telegram_id, report_date)
    await resolve_reminders(connection, report_date, telegram_id, report_scope, region_name)
    return _report(row)


async def submit_report(connection: AsyncConnection, user: AuthenticatedUser,
                        payload: HisobotReportInput) -> HisobotReport:
    current = local_now()
    grant = await _grant(connection, user)
    if not grant["report_required"]:
        raise HTTPException(403, "Для вас сдача отчёта не требуется.")
    if current.weekday() >= 5 or not time(12) <= current.time().replace(tzinfo=None) < time(18, 30):
        raise HTTPException(409, "Приём отчётов по будням: 12:00-18:30.")
    return await _store_report(
        connection, telegram_id=grant["telegram_id"], employee_key=str(user.id),
        full_name=user.full_name, position=user.job_title or "",
        report_scope=grant["report_scope"] or "central", region_name=grant["region_name"],
        report_date=current.date(), content=payload.content, submitted_at=current,
        is_late=current.time().replace(tzinfo=None) > time(18), source="workspace",
    )


async def import_reports(
    connection: AsyncConnection, reports: list[BridgeReport]
) -> list[HisobotReport]:
    saved = []
    for report in reports:
        if report.report_scope == "hudud" and report.region_name not in HISOBOT_REGIONS:
            raise HTTPException(422, "Неизвестный регион в отчёте.")
        saved.append(await _store_report(
            connection, telegram_id=report.telegram_id, employee_key=report.employee_key,
            full_name=report.full_name, position=report.position,
            report_scope=report.report_scope, region_name=report.region_name,
            report_date=report.report_date, content=report.content,
            submitted_at=report.submitted_at, is_late=report.is_late, source="telegram",
        ))
    return saved


async def history(connection: AsyncConnection, user: AuthenticatedUser, *,
                  before_date: date | None = None, limit: int = 100) -> list[HisobotReport]:
    grant = await _grant(connection, user)
    query = select(hisobot_live_reports).where(or_(
        hisobot_live_reports.c.telegram_id == grant["telegram_id"],
        hisobot_live_reports.c.user_id == user.id,
    ))
    if before_date is not None:
        query = query.where(hisobot_live_reports.c.report_date < before_date)
    rows = (await connection.execute(
        query.order_by(hisobot_live_reports.c.report_date.desc()).limit(limit)
    )).mappings().all()
    return [_report(row) for row in rows]


async def management_history(connection: AsyncConnection, user: AuthenticatedUser,
                             start_date: date, end_date: date) -> list[HisobotReport]:
    grant = await _grant(connection, user)
    if not grant["hisobot_manager"] and user.role not in {"admin", "superadmin"}:
        raise HTTPException(403, "Просмотр отчётов сотрудников доступен только руководству.")
    if end_date < start_date or (end_date - start_date).days > 366:
        raise HTTPException(422, "Период не может превышать один год.")
    rows = (await connection.execute(select(hisobot_live_reports).where(
        hisobot_live_reports.c.report_date.between(start_date, end_date)
    ).order_by(hisobot_live_reports.c.report_date.desc(),
               hisobot_live_reports.c.report_scope,
               hisobot_live_reports.c.region_name,
               hisobot_live_reports.c.full_name))).mappings().all()
    return [_report(row) for row in rows]


async def bridge_reports(connection: AsyncConnection, start_date: date,
                         end_date: date) -> list[HisobotReport]:
    if end_date < start_date or (end_date - start_date).days > 31:
        raise HTTPException(422, "Период синхронизации не может превышать 31 день.")
    rows = (await connection.execute(select(hisobot_live_reports).where(
        hisobot_live_reports.c.report_date.between(start_date, end_date)
    ).order_by(hisobot_live_reports.c.report_date,
               hisobot_live_reports.c.telegram_id))).mappings().all()
    return [_report(row) for row in rows]


async def bridge_roster(connection: AsyncConnection) -> list[BridgeRosterMember]:
    rows = (await connection.execute(
        select(users, telegram_bot_grants, telegram_identities.c.telegram_id)
        .join(telegram_bot_grants, users.c.id == telegram_bot_grants.c.user_id)
        .join(telegram_identities, users.c.id == telegram_identities.c.user_id)
        .where(users.c.status == "active", telegram_bot_grants.c.bot_key == "hisobot",
               telegram_identities.c.telegram_id.is_not(None))
    )).mappings().all()
    return [BridgeRosterMember(
        telegram_id=row["telegram_id"], employee_key=str(row["id"]),
        full_name=row["full_name"], position=row["job_title"] or "",
        report_scope=row["report_scope"] or "central", region_name=row["region_name"],
        report_required=bool(row["report_required"]),
        management_access=bool(row["hisobot_manager"]),
    ) for row in rows]


async def replace_vacations(connection: AsyncConnection, snapshot: BridgeVacationSnapshot) -> None:
    ids = [item.telegram_id for item in snapshot.vacations]
    if ids:
        await connection.execute(hisobot_live_vacations.delete().where(
            hisobot_live_vacations.c.telegram_id.not_in(ids)
        ))
    else:
        await connection.execute(hisobot_live_vacations.delete())
    now = datetime.now(UTC)
    for item in snapshot.vacations:
        statement = pg_insert(hisobot_live_vacations).values(
            telegram_id=item.telegram_id, starts_date=item.starts_date,
            through_date=item.through_date, updated_at=now
        )
        await connection.execute(statement.on_conflict_do_update(
            index_elements=[hisobot_live_vacations.c.telegram_id],
            set_={"starts_date": item.starts_date,
                  "through_date": item.through_date, "updated_at": now},
        ))


async def report_exemptions(connection: AsyncConnection, start: date,
                            end: date) -> list[BridgeReportExemption]:
    """Approved leave, acknowledged illness and legacy bot vacations by local date."""
    if end < start or (end - start).days > 366:
        raise HTTPException(422, "Период отсутствий не может превышать один год.")
    start_utc = datetime.combine(start, time.min, tzinfo=TASHKENT).astimezone(UTC)
    end_utc = datetime.combine(end, time.max, tzinfo=TASHKENT).astimezone(UTC)
    rows = (await connection.execute(
        select(telegram_identities.c.telegram_id, absence_requests.c.kind,
               absence_requests.c.starts_at, absence_requests.c.ends_at)
        .join(telegram_identities,
              telegram_identities.c.user_id == absence_requests.c.requester_user_id)
        .where(or_(
                   and_(absence_requests.c.kind.in_(("vacation", "personal_time")),
                        absence_requests.c.status == "approved"),
                   and_(absence_requests.c.kind == "sick_leave",
                        absence_requests.c.status == "acknowledged"),
               ),
               absence_requests.c.starts_at <= end_utc,
               absence_requests.c.ends_at >= start_utc,
               telegram_identities.c.telegram_id.is_not(None))
    )).all()
    exemptions: list[BridgeReportExemption] = []
    for row in rows:
        starts = row.starts_at.astimezone(TASHKENT)
        ends = row.ends_at.astimezone(TASHKENT)
        if row.kind == "personal_time":
            day = max(starts.date(), start)
            while day <= min(ends.date(), end):
                deadline = datetime.combine(day, time(18, 30), tzinfo=TASHKENT)
                if starts <= deadline <= ends:
                    exemptions.append(BridgeReportExemption(
                        telegram_id=row.telegram_id, starts_date=day,
                        through_date=day, kind="personal_time",
                    ))
                day += timedelta(days=1)
        else:
            exemptions.append(BridgeReportExemption(
                telegram_id=row.telegram_id, starts_date=starts.date(),
                through_date=ends.date(), kind=row.kind,
            ))
    legacy = (await connection.execute(select(hisobot_live_vacations).where(
        hisobot_live_vacations.c.starts_date <= end,
        hisobot_live_vacations.c.through_date >= start,
    ))).mappings().all()
    exemptions.extend(BridgeReportExemption(
        telegram_id=row["telegram_id"], starts_date=row["starts_date"],
        through_date=row["through_date"], kind="vacation",
    ) for row in legacy)
    return exemptions


async def resolve_reminders(connection: AsyncConnection, day: date, telegram_id: str,
                            scope: str, region_name: str | None) -> None:
    query = select(telegram_identities.c.user_id).where(
        telegram_identities.c.telegram_id == telegram_id
    )
    if scope == "hudud" and region_name:
        query = select(telegram_bot_grants.c.user_id).where(
            telegram_bot_grants.c.bot_key == "hisobot",
            telegram_bot_grants.c.report_scope == "hudud",
            telegram_bot_grants.c.region_name == region_name,
        )
    user_ids = (await connection.execute(query)).scalars().all()
    if user_ids:
        await connection.execute(update(workspace_notifications).where(
            workspace_notifications.c.user_id.in_(user_ids),
            workspace_notifications.c.event_key.like(f"hisobot:{day.isoformat()}:%"),
            workspace_notifications.c.resolved_at.is_(None),
        ).values(resolved_at=datetime.now(UTC)))


async def materialize_hisobot_reminders(connection: AsyncConnection,
                                       now: datetime | None = None) -> int:
    current = local_now(now)
    clock = current.time().replace(tzinfo=None)
    today_start = datetime.combine(current.date(), time.min, tzinfo=TASHKENT).astimezone(UTC)
    await connection.execute(update(workspace_notifications).where(
        workspace_notifications.c.event_key.like("hisobot:%"),
        workspace_notifications.c.occurred_at < today_start,
        workspace_notifications.c.resolved_at.is_(None),
    ).values(resolved_at=current.astimezone(UTC)))
    if current.weekday() >= 5 or clock >= time(18, 30):
        if clock >= time(18, 30):
            await connection.execute(update(workspace_notifications).where(
                workspace_notifications.c.event_key.like(
                    f"hisobot:{current.date().isoformat()}:%"
                ),
                workspace_notifications.c.resolved_at.is_(None),
            ).values(resolved_at=current.astimezone(UTC)))
        return 0
    due = [slot for slot in REMINDER_SLOTS if slot <= clock]
    if not due:
        return 0
    slot = due[-1]
    roster = await bridge_roster(connection)
    today_rows = (await connection.execute(select(
        hisobot_live_reports.c.telegram_id, hisobot_live_reports.c.report_scope,
        hisobot_live_reports.c.region_name
    ).where(hisobot_live_reports.c.report_date == current.date()))).all()
    submitted_ids = {row.telegram_id for row in today_rows}
    submitted_regions = {row.region_name for row in today_rows
                         if row.report_scope == "hudud" and row.region_name}
    exemptions = {item.telegram_id for item in await report_exemptions(
        connection, current.date(), current.date()
    ) if item.starts_date <= current.date() <= item.through_date}
    if exemptions:
        exempt_users = (await connection.execute(select(telegram_identities.c.user_id).where(
            telegram_identities.c.telegram_id.in_(exemptions)
        ))).scalars().all()
        await connection.execute(update(workspace_notifications).where(
            workspace_notifications.c.user_id.in_(exempt_users),
            workspace_notifications.c.event_key.like(f"hisobot:{current.date().isoformat()}:%"),
            workspace_notifications.c.resolved_at.is_(None),
        ).values(resolved_at=datetime.now(UTC)))
    from .repository import _upsert_notification

    created = 0
    for member in roster:
        if (not member.report_required or member.telegram_id in submitted_ids
                or member.telegram_id in exemptions
                or (member.report_scope == "hudud" and member.region_name in submitted_regions)):
            continue
        user_id = await connection.scalar(select(telegram_identities.c.user_id).where(
            telegram_identities.c.telegram_id == member.telegram_id
        ))
        event_key = f"hisobot:{current.date().isoformat()}:{slot:%H%M}"
        exists = await connection.scalar(select(workspace_notifications.c.id).where(
            workspace_notifications.c.user_id == user_id,
            workspace_notifications.c.event_key == event_key,
        ))
        if exists:
            continue
        await _upsert_notification(
            connection, user_id=user_id, event_key=event_key, kind="hisobot",
            priority="attention", title="AI Hisobot · отчёт не сдан",
            body="Отправьте ежедневный отчёт до 18:30. После отправки напоминания прекратятся.",
            section="ai_hisobot", entity_id=None, requires_action=True,
            occurred_at=current, is_reminder=True,
        )
        created += 1
    return created
