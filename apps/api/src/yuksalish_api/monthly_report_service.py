"""CA reporting with frozen rosters, private files and audited payroll decisions."""

import hashlib
import json
import logging
from calendar import monthrange
from collections.abc import Mapping, Sequence
from datetime import UTC, date, datetime, timedelta
from uuid import NAMESPACE_URL, UUID, uuid4, uuid5
from zoneinfo import ZoneInfo

from fastapi import HTTPException
from sqlalchemy import func, insert, select, text, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.engine import RowMapping
from sqlalchemy.ext.asyncio import AsyncConnection

from .access_control import ensure_module_action, module_permissions_for_user
from .auth import AuthenticatedUser
from .grant_files_service import GrantInitialFile, validated_files
from .monthly_report_schemas import (
    CalendarDayWrite,
    MonthlyCycle,
    MonthlyMember,
    MonthlyOverview,
    MonthlyReport,
    MonthlySubmission,
    ReportFile,
)
from .monthly_report_tables import calendar_days, cycles, members, reports
from .object_storage import ObjectStorage, ObjectStorageError
from .repository import _trip_directory_deputy_id, _upsert_notification
from .tables import audit_events, departments, hr_settings, users, workspace_notifications

MODULE = "ai_monthly_reports"
ZONE = ZoneInfo("Asia/Tashkent")
logger = logging.getLogger(__name__)


def reporting_month(today: date) -> date | None:
    if today.day >= 20:
        return today.replace(day=1)
    if today.day <= 5:
        return (today.replace(day=1) - timedelta(days=1)).replace(day=1)
    return None


def reminder_date(month: date, overrides: Mapping[date, bool]) -> date:
    """Three working days strictly before the calendar month ends."""
    cursor = month.replace(day=monthrange(month.year, month.month)[1])
    remaining = 3
    while remaining:
        cursor -= timedelta(days=1)
        if overrides.get(cursor, cursor.weekday() < 5):
            remaining -= 1
    return cursor


def is_central(department_id: UUID | None, directory: Mapping[UUID, RowMapping]) -> bool:
    seen: set[UUID] = set()
    while department_id is not None and department_id not in seen:
        seen.add(department_id)
        row = directory.get(department_id)
        if row is None:
            break
        if row["scope"] == "regional":
            return False
        department_id = row["parent_id"]
    return True


async def _actors(c: AsyncConnection) -> tuple[UUID | None, UUID | None, UUID | None]:
    settings = (
        (await c.execute(select(hr_settings).where(hr_settings.c.id == 1))).mappings().first()
    )
    active = set((await c.execute(select(users.c.id).where(users.c.status == "active"))).scalars())
    chair = settings["chair_user_id"] if settings else None
    accountant = settings["accountant_user_id"] if settings else None
    return (
        chair if chair in active else None,
        await _trip_directory_deputy_id(c),
        accountant if accountant in active else None,
    )


async def ensure_cycle(c: AsyncConnection, month: date, now: datetime) -> None:
    # One transaction owns initialization; no partially materialized roster is observable.
    await c.execute(
        text("SELECT pg_advisory_xact_lock(:key)"),
        {"key": 71220000 + month.year * 12 + month.month},
    )
    if await c.scalar(select(cycles.c.month).where(cycles.c.month == month)):
        return
    overrides = dict(
        (await c.execute(select(calendar_days.c.day, calendar_days.c.working))).tuples().all()
    )
    await c.execute(
        insert(cycles).values(
            month=month,
            reminder_on=reminder_date(month, overrides),
            created_at=now,
            comment="",
            authorization_snapshot={},
        )
    )
    directory = {r["id"]: r for r in (await c.execute(select(departments))).mappings()}
    roster = (await c.execute(select(users).where(users.c.status == "active"))).mappings().all()
    values = [
        {
            "month": month,
            "user_id": r["id"],
            "name": r["full_name"],
            "department": directory[r["department_id"]]["name"]
            if r["department_id"] in directory
            else "Центральный аппарат",
        }
        for r in roster
        if is_central(r["department_id"], directory)
    ]
    if values:
        await c.execute(insert(members), values)


def report_response(row: RowMapping) -> MonthlyReport:
    return MonthlyReport(
        id=str(row["id"]),
        month=row["month"],
        user_id=str(row["user_id"]),
        revision=row["revision"],
        comment=row["comment"],
        submitted_at=row["submitted_at"],
        files=[ReportFile(id=f["id"], name=f["name"], size=f["size"]) for f in row["files"]],
    )


async def _cycle_response(c: AsyncConnection, row: RowMapping, *, roster: bool) -> MonthlyCycle:
    people = (
        (
            await c.execute(
                select(members).where(members.c.month == row["month"]).order_by(members.c.name)
            )
        )
        .mappings()
        .all()
    )
    versions = (
        (
            await c.execute(
                select(reports).where(reports.c.month == row["month"]).order_by(reports.c.revision)
            )
        )
        .mappings()
        .all()
    )
    latest = {r["user_id"]: report_response(r) for r in versions}
    name = await c.scalar(select(users.c.full_name).where(users.c.id == row["authorized_by"]))
    return MonthlyCycle(
        month=row["month"],
        reminder_on=row["reminder_on"],
        total=len(people),
        submitted=len(latest),
        authorized_at=row["authorized_at"],
        authorized_by_name=name,
        comment=row["comment"],
        members=[
            MonthlyMember(
                user_id=str(p["user_id"]),
                name=p["name"],
                department=p["department"],
                report=latest.get(p["user_id"]),
            )
            for p in people
        ]
        if roster
        else [],
    )


async def overview(
    c: AsyncConnection,
    user: AuthenticatedUser,
    *,
    now: datetime | None = None,
) -> MonthlyOverview:
    await ensure_module_action(c, user, MODULE, "view")
    access = (await module_permissions_for_user(c, user))[MODULE]
    current = now or datetime.now(UTC)
    today = current.astimezone(ZONE).date()
    active = reporting_month(today)
    if active:
        await ensure_cycle(c, active, current)
    chair, deputy, accountant = await _actors(c)
    review = user.id in {chair, deputy} or user.role in {"admin", "superadmin"}
    own = (
        (
            await c.execute(
                select(reports)
                .where(reports.c.user_id == user.id)
                .order_by(reports.c.submitted_at.desc())
            )
        )
        .mappings()
        .all()
    )
    own_months = select(members.c.month).where(members.c.user_id == user.id)
    eligible = set((await c.execute(own_months)).scalars())
    query = select(cycles).order_by(cycles.c.month.desc())
    if not review:
        query = query.where(cycles.c.month.in_(own_months) | (cycles.c.accountant_id == user.id))
    cycle_rows = (await c.execute(query)).mappings().all()
    items = [await _cycle_response(c, r, roster=review) for r in cycle_rows]
    for item in items:
        item.can_submit = item.month in eligible and item.authorized_at is None and access["create"]
    reminder = None
    if access["create"] and active in eligible and not any(r["month"] == active for r in own):
        cycle = next((r for r in cycle_rows if r["month"] == active), None)
        if cycle and today >= cycle["reminder_on"] and not cycle["authorized_at"]:
            reminder = active
    notice = None
    notice_id = None
    if user.id == accountant:
        notification = (
            (
                await c.execute(
                    select(workspace_notifications)
                    .where(
                        workspace_notifications.c.user_id == user.id,
                        workspace_notifications.c.event_key.like("monthly-payroll:%"),
                        workspace_notifications.c.read_at.is_(None),
                        workspace_notifications.c.dismissed_at.is_(None),
                    )
                    .order_by(workspace_notifications.c.occurred_at)
                )
            )
            .mappings()
            .first()
        )
        if notification:
            month = date.fromisoformat(notification["event_key"].split(":", 1)[1])
            row = (await c.execute(select(cycles).where(cycles.c.month == month))).mappings().one()
            notice = await _cycle_response(c, row, roster=False)
            notice_id = str(notification["id"])
    return MonthlyOverview(
        today=today,
        active_month=active,
        dashboard_visible=active is not None and user.id in {chair, deputy},
        can_review=review,
        can_authorize=user.id == deputy and access["approve"],
        can_configure=user.role in {"admin", "superadmin"},
        reminder_month=reminder,
        payroll_notice=notice,
        payroll_notice_id=notice_id,
        cycles=items,
        reports=[report_response(r) for r in own],
    )


async def _audit(
    c: AsyncConnection,
    user: AuthenticatedUser,
    action: str,
    target: UUID | None,
    details: dict[str, object],
) -> None:
    await c.execute(
        insert(audit_events).values(
            id=uuid4(),
            actor_user_id=user.id,
            action=f"monthly_reports.{action}",
            target_type="monthly_report" if target else "monthly_reporting_period",
            target_id=target
            or uuid5(
                NAMESPACE_URL,
                f"workspace:monthly:{details.get('month', details.get('day'))}",
            ),
            details=details,
            created_at=datetime.now(UTC),
        )
    )


async def submit(
    c: AsyncConnection,
    user: AuthenticatedUser,
    payload: MonthlySubmission,
    files: Sequence[GrantInitialFile],
    storage: ObjectStorage,
) -> MonthlyReport:
    await ensure_module_action(c, user, MODULE, "create")
    prepared = validated_files(files, 25 * 1024 * 1024)
    if len(prepared) > 5 or sum(len(f.content) for f in prepared) > 50 * 1024 * 1024:
        raise HTTPException(413, "Максимум 5 файлов общим размером до 50 МБ")
    digest = hashlib.sha256(
        json.dumps(
            {
                "month": str(payload.month),
                "comment": payload.comment,
                "files": [
                    (f.file_name, f.content_type, hashlib.sha256(f.content).hexdigest())
                    for f in prepared
                ],
            },
            sort_keys=True,
        ).encode()
    ).hexdigest()
    # Serializes retries even when a client reuses a key for another month.
    await c.execute(
        text("SELECT pg_advisory_xact_lock(:key)"), {"key": payload.id.int % (2**63 - 1)}
    )
    existing = (
        (await c.execute(select(reports).where(reports.c.id == payload.id))).mappings().first()
    )
    if existing:
        if existing["user_id"] != user.id or existing["digest"] != digest:
            raise HTTPException(409, "Ключ отправки уже использован для другого отчёта")
        return report_response(existing)
    cycle = (
        (await c.execute(select(cycles).where(cycles.c.month == payload.month).with_for_update()))
        .mappings()
        .first()
    )
    if cycle is None:
        raise HTTPException(409, "Приём отчётов за этот месяц ещё не открыт")
    if cycle["authorized_at"]:
        raise HTTPException(409, "Начисление уже разрешено. Отчёт сохранён без изменений")
    member = await c.scalar(
        select(members.c.user_id).where(
            members.c.month == payload.month,
            members.c.user_id == user.id,
        )
    )
    if member is None:
        raise HTTPException(403, "Вы не включены в состав ЦА этого отчётного месяца")
    revision = 1 + (
        await c.scalar(
            select(func.max(reports.c.revision)).where(
                reports.c.month == payload.month,
                reports.c.user_id == user.id,
            )
        )
        or 0
    )
    keys: list[str] = []
    stored: list[dict[str, object]] = []
    complete = False
    commit_started = False
    try:
        for f in prepared:
            file_id = uuid4()
            key = f"monthly-reports/{payload.id}/{file_id}"
            keys.append(key)
            await storage.put(key, f.content, f.content_type)
            stored.append(
                {
                    "id": str(file_id),
                    "name": f.file_name,
                    "size": len(f.content),
                    "key": key,
                    "type": f.content_type,
                }
            )
        await c.execute(
            insert(reports).values(
                id=payload.id,
                month=payload.month,
                user_id=user.id,
                revision=revision,
                comment=payload.comment,
                digest=digest,
                files=stored,
                submitted_at=datetime.now(UTC),
            )
        )
        await c.execute(
            update(workspace_notifications)
            .where(
                workspace_notifications.c.user_id == user.id,
                workspace_notifications.c.event_key == f"monthly-report:{payload.month}",
            )
            .values(resolved_at=datetime.now(UTC))
        )
        await _audit(
            c, user, "submitted", payload.id, {"month": str(payload.month), "revision": revision}
        )
        result = (
            (await c.execute(select(reports).where(reports.c.id == payload.id))).mappings().one()
        )
        # Commit before HTTP success/events. If the commit fails, clean uncommitted objects.
        commit_started = True
        await c.commit()
        complete = True
        return report_response(result)
    finally:
        # A connection failure during COMMIT has an unknown outcome: retaining random
        # objects is safer than deleting files that might already back a committed report.
        if not complete and not commit_started:
            for key in keys:
                try:
                    await storage.delete(key)
                except ObjectStorageError:
                    logger.warning("Could not clean an uncommitted monthly report file")


async def authorize(
    c: AsyncConnection,
    user: AuthenticatedUser,
    month: date,
    comment: str,
) -> MonthlyCycle:
    await ensure_module_action(c, user, MODULE, "approve")
    _, deputy, accountant = await _actors(c)
    if user.id != deputy:
        raise HTTPException(403, "Разрешение даёт только назначенный первый заместитель")
    if not accountant or accountant == deputy:
        raise HTTPException(409, "Назначьте действующего главного бухгалтера в настройках HR")
    row = (
        (await c.execute(select(cycles).where(cycles.c.month == month).with_for_update()))
        .mappings()
        .first()
    )
    if row is None:
        raise HTTPException(404, "Отчётный месяц не найден")
    if row["authorized_at"]:
        if row["comment"] != comment:
            raise HTTPException(409, "Разрешение уже сохранено, комментарий отличается")
        return await _cycle_response(c, row, roster=True)
    summary = await _cycle_response(c, row, roster=True)
    now = datetime.now(UTC)
    await c.execute(
        update(workspace_notifications)
        .where(
            workspace_notifications.c.event_key == f"monthly-report:{month}",
            workspace_notifications.c.resolved_at.is_(None),
        )
        .values(resolved_at=now)
    )
    await c.execute(
        update(cycles)
        .where(cycles.c.month == month)
        .values(
            authorized_at=now,
            authorized_by=user.id,
            accountant_id=accountant,
            comment=comment,
            authorization_snapshot={
                "total": summary.total,
                "submitted": summary.submitted,
                "reportIds": [m.report.id for m in summary.members if m.report],
            },
        )
    )
    await _upsert_notification(
        c,
        user_id=accountant,
        event_key=f"monthly-payroll:{month}",
        kind="hisobot",
        priority="attention",
        title=f"Разрешено начисление ЗП за {month:%m.%Y}",
        body=f"{user.full_name} разрешил начисление заработной платы. {comment}".strip(),
        section=MODULE,
        entity_id=None,
        requires_action=False,
        occurred_at=now,
    )
    await _audit(
        c,
        user,
        "payroll_authorized",
        None,
        {
            "month": str(month),
            "comment": comment,
            "accountantId": str(accountant),
            "total": summary.total,
            "submitted": summary.submitted,
        },
    )
    result = (await c.execute(select(cycles).where(cycles.c.month == month))).mappings().one()
    return await _cycle_response(c, result, roster=True)


async def file_metadata(
    c: AsyncConnection, user: AuthenticatedUser, report_id: UUID, file_id: UUID
) -> dict[str, str]:
    await ensure_module_action(c, user, MODULE, "view")
    row = (await c.execute(select(reports).where(reports.c.id == report_id))).mappings().first()
    chair, deputy, _ = await _actors(c)
    if not row or (
        row["user_id"] != user.id
        and user.id not in {chair, deputy}
        and user.role not in {"admin", "superadmin"}
    ):
        raise HTTPException(404, "Файл отчёта не найден")
    for item in row["files"]:
        if item["id"] == str(file_id):
            return {"key": item["key"], "name": item["name"], "type": item["type"]}
    raise HTTPException(404, "Файл отчёта не найден")


async def save_calendar(
    c: AsyncConnection, user: AuthenticatedUser, payload: CalendarDayWrite
) -> None:
    if user.role not in {"admin", "superadmin"}:
        raise HTTPException(403, "Календарь настраивает администратор")
    await ensure_module_action(c, user, MODULE, "admin")
    month = payload.day.replace(day=1)
    await c.execute(
        text("SELECT pg_advisory_xact_lock(:key)"),
        {"key": 71220000 + month.year * 12 + month.month},
    )
    statement = pg_insert(calendar_days).values(
        day=payload.day,
        working=payload.working,
        note=payload.note,
        updated_by=user.id,
        updated_at=datetime.now(UTC),
    )
    await c.execute(
        statement.on_conflict_do_update(
            index_elements=[calendar_days.c.day],
            set_={
                k: statement.excluded[k] for k in ("working", "note", "updated_by", "updated_at")
            },
        )
    )
    overrides = dict(
        (await c.execute(select(calendar_days.c.day, calendar_days.c.working))).tuples().all()
    )
    scheduled = reminder_date(month, overrides)
    await c.execute(
        update(cycles)
        .where(
            cycles.c.month == month,
            cycles.c.authorized_at.is_(None),
        )
        .values(reminder_on=scheduled)
    )
    if scheduled > datetime.now(ZONE).date():
        await c.execute(
            update(workspace_notifications)
            .where(
                workspace_notifications.c.event_key == f"monthly-report:{month}",
                workspace_notifications.c.resolved_at.is_(None),
            )
            .values(resolved_at=datetime.now(UTC))
        )
    await _audit(c, user, "calendar_updated", None, payload.model_dump(mode="json"))


async def materialize_monthly_reports(c: AsyncConnection, now: datetime | None = None) -> int:
    current = now or datetime.now(UTC)
    today = current.astimezone(ZONE).date()
    # An unanswered action from a closed collection window must not remain actionable.
    retired = (
        (
            await c.execute(
                update(workspace_notifications)
                .where(
                    workspace_notifications.c.event_key.like("monthly-report:%"),
                    workspace_notifications.c.resolved_at.is_(None),
                    workspace_notifications.c.event_key
                    != f"monthly-report:{reporting_month(today)}",
                )
                .values(resolved_at=current)
                .returning(workspace_notifications.c.id)
            )
        )
        .scalars()
        .all()
    )
    month = reporting_month(today)
    if month is None:
        return len(retired)
    await ensure_cycle(c, month, current)
    cycle = (await c.execute(select(cycles).where(cycles.c.month == month))).mappings().one()
    if cycle["authorized_at"] or today < cycle["reminder_on"]:
        return len(retired)
    pending = (
        (
            await c.execute(
                select(members.c.user_id)
                .join(users, users.c.id == members.c.user_id)
                .where(
                    members.c.month == month,
                    users.c.status == "active",
                    members.c.user_id.not_in(
                        select(workspace_notifications.c.user_id).where(
                            workspace_notifications.c.event_key == f"monthly-report:{month}",
                            (
                                workspace_notifications.c.resolved_at.is_(None)
                                | workspace_notifications.c.dismissed_at.is_not(None)
                            ),
                        )
                    ),
                    members.c.user_id.not_in(
                        select(reports.c.user_id).where(reports.c.month == month)
                    ),
                )
            )
        )
        .scalars()
        .all()
    )
    for uid in pending:
        await _upsert_notification(
            c,
            user_id=uid,
            event_key=f"monthly-report:{month}",
            kind="hisobot",
            priority="attention",
            title=f"Отправьте ежемесячный отчёт за {month:%m.%Y}",
            body="Скачайте шаблон, заполните и прикрепите отчёт в разделе «Ойлик ҳисоботлар».",
            section=MODULE,
            entity_id=None,
            requires_action=True,
            occurred_at=current,
            is_reminder=True,
        )
        await c.execute(
            update(workspace_notifications)
            .where(
                workspace_notifications.c.user_id == uid,
                workspace_notifications.c.event_key == f"monthly-report:{month}",
                workspace_notifications.c.resolved_at.is_not(None),
            )
            .values(resolved_at=None)
        )
    # Notifications deduplicate per employee/month; UI polls its own state as well.
    return len(retired) + len(pending)
