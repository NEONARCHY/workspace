from __future__ import annotations

import calendar
from datetime import UTC, date, datetime
from decimal import Decimal
from typing import Literal, Protocol, cast
from uuid import UUID, uuid4
from zoneinfo import ZoneInfo

from sqlalchemy import and_, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncConnection

from .access_control import ensure_module_action
from .auth import AuthenticatedUser
from .hr_schemas import (
    HrHistoryResponse,
    HrOverviewResponse,
    HrProfileCreate,
    HrProfileImport,
    HrProfileImportResponse,
    HrProfileResponse,
    HrProfileWrite,
    HrRegisterAction,
    HrRegisterItemResponse,
    HrRegisterResponse,
    HrSettingsResponse,
    HrSettingsWrite,
    HrTerminationWrite,
)
from .tables import (
    audit_events,
    hr_employee_profiles,
    hr_monthly_register_items,
    hr_monthly_registers,
    hr_service_history,
    hr_settings,
    users,
    workspace_notifications,
)


class HrError(ValueError):
    def __init__(self, status_code: int, detail: str) -> None:
        super().__init__(detail)
        self.status_code, self.detail = status_code, detail


class _ProfileRow(Protocol):
    id: UUID
    user_id: UUID | None
    full_name: str
    job_title: str | None
    employment_date: date
    service_anchor_date: date
    service_years: int
    service_months: int
    service_days: int
    employment_status: Literal["active", "terminated"]
    terminated_on: date | None
    termination_reason: str | None
    hidden_after_year: bool
    updated_at: datetime


def _add_months(value: date, months: int) -> date:
    target = value.month - 1 + months
    year, month = value.year + target // 12, target % 12 + 1
    return date(year, month, min(value.day, calendar.monthrange(year, month)[1]))


def service_parts(
    anchor: date, years: int, months: int, days: int, at: date
) -> tuple[int, int, int]:
    """Calendar arithmetic, not 30-day approximation; future anchors never add tenure."""
    at = max(anchor, at)
    year_delta = at.year - anchor.year
    anniversary = date(
        anchor.year + year_delta,
        anchor.month,
        min(anchor.day, calendar.monthrange(anchor.year + year_delta, anchor.month)[1]),
    )
    if at < anniversary:
        year_delta -= 1
        anniversary = date(
            anchor.year + year_delta,
            anchor.month,
            min(anchor.day, calendar.monthrange(anchor.year + year_delta, anchor.month)[1]),
        )
    month_delta = (
        (at.year - anniversary.year) * 12
        + at.month
        - anniversary.month
        - (at.day < anniversary.day)
    )
    month_base = _add_months(anniversary, month_delta)
    extra_days = (at - month_base).days
    total_months = months + month_delta
    return years + year_delta + total_months // 12, total_months % 12, days + extra_days


def allowance(years: int, months: int) -> Decimal:
    value = years + months / 12
    if value < 1:
        return Decimal("0")
    if value < 3:
        return Decimal("10")
    if value < 5:
        return Decimal("20")
    if value < 10:
        return Decimal("30")
    if value < 15:
        return Decimal("40")
    if value < 20:
        return Decimal("50")
    return Decimal("60")


async def _settings(connection: AsyncConnection) -> HrSettingsResponse:
    row = (
        (await connection.execute(select(hr_settings).where(hr_settings.c.id == 1)))
        .mappings()
        .first()
    )
    return HrSettingsResponse.model_validate(row or {})


async def _is_actor(connection: AsyncConnection, actor: AuthenticatedUser, kind: str) -> bool:
    if actor.role in {"admin", "superadmin"}:
        return True
    settings = await _settings(connection)
    assigned = cast(UUID | None, getattr(settings, f"{kind}_user_id"))
    return assigned == actor.id


async def _require_actor(
    connection: AsyncConnection, actor: AuthenticatedUser, kind: str, action: str
) -> None:
    await ensure_module_action(connection, actor, "hr", action)  # type: ignore[arg-type]
    if not await _is_actor(connection, actor, kind):
        raise HrError(403, "Для этого этапа назначен другой сотрудник")


def _profile_response(row: object, today: date) -> HrProfileResponse:
    value = cast(_ProfileRow, row)
    years, months, days = service_parts(
        value.service_anchor_date,
        value.service_years,
        value.service_months,
        value.service_days,
        min(today, value.terminated_on) if value.terminated_on else today,
    )
    return HrProfileResponse(
        id=value.id,
        user_id=value.user_id,
        full_name=value.full_name,
        job_title=value.job_title,
        employment_date=value.employment_date,
        service_anchor_date=value.service_anchor_date,
        service_years=years,
        service_months=months,
        service_days=days,
        allowance_percent=allowance(years, months),
        employment_status=value.employment_status,
        terminated_on=value.terminated_on,
        termination_reason=value.termination_reason,
        hidden_after_year=value.hidden_after_year,
        updated_at=value.updated_at,
    )


async def load_overview(
    connection: AsyncConnection, actor: AuthenticatedUser
) -> HrOverviewResponse:
    await ensure_module_action(connection, actor, "hr", "view")
    profile_query = select(hr_employee_profiles).order_by(hr_employee_profiles.c.full_name)
    rows = (await connection.execute(profile_query)).all()
    registers = (
        await connection.execute(
            select(hr_monthly_registers)
            .order_by(hr_monthly_registers.c.period.desc(), hr_monthly_registers.c.version.desc())
            .limit(24)
        )
    ).all()
    result: list[HrRegisterResponse] = []
    for register in registers:
        item_rows = (
            await connection.execute(
                select(hr_monthly_register_items)
                .where(hr_monthly_register_items.c.register_id == register.id)
                .order_by(hr_monthly_register_items.c.full_name)
            )
        ).all()
        result.append(
            HrRegisterResponse(
                id=register.id,
                period=register.period,
                version=register.version,
                status=register.status,
                return_comment=register.return_comment,
                created_at=register.created_at,
                submitted_at=register.submitted_at,
                approved_at=register.approved_at,
                accounted_at=register.accounted_at,
                items=[
                    HrRegisterItemResponse(
                        user_id=item.user_id,
                        full_name=item.full_name,
                        job_title=item.job_title,
                        service_years=item.service_years,
                        service_months=item.service_months,
                        service_days=item.service_days,
                        allowance_percent=item.allowance_percent,
                    )
                    for item in item_rows
                ],
            )
        )
    return HrOverviewResponse(
        settings=await _settings(connection),
        profiles=[_profile_response(row, date.today()) for row in rows],
        registers=result,
    )


async def save_settings(
    connection: AsyncConnection, actor: AuthenticatedUser, payload: HrSettingsWrite
) -> HrSettingsResponse:
    await _require_actor(connection, actor, "hr", "admin")
    now = datetime.now(UTC)
    await connection.execute(
        pg_insert(hr_settings)
        .values(id=1, **payload.model_dump(), updated_by_user_id=actor.id, updated_at=now)
        .on_conflict_do_update(
            index_elements=[hr_settings.c.id],
            set_={**payload.model_dump(), "updated_by_user_id": actor.id, "updated_at": now},
        )
    )
    return await _settings(connection)


async def save_profile(
    connection: AsyncConnection, actor: AuthenticatedUser, user_id: UUID, payload: HrProfileWrite
) -> HrProfileResponse:
    await _require_actor(connection, actor, "hr", "edit")
    user = (
        await connection.execute(
            select(users.c.id, users.c.full_name, users.c.job_title).where(users.c.id == user_id)
        )
    ).one_or_none()
    if user is None:
        raise HrError(404, "Сотрудник не найден")
    now, profile_id = datetime.now(UTC), uuid4()
    values = payload.model_dump() | {
        "full_name": user.full_name,
        "job_title": user.job_title,
        "employment_status": "active",
        "terminated_on": None,
        "termination_reason": None,
        "hidden_after_year": False,
        "updated_at": now,
    }
    await connection.execute(
        pg_insert(hr_employee_profiles)
        .values(
            id=profile_id, user_id=user_id, created_by_user_id=actor.id, created_at=now, **values
        )
        .on_conflict_do_update(index_elements=[hr_employee_profiles.c.user_id], set_=values)
    )
    profile = (
        await connection.execute(
            select(hr_employee_profiles).where(hr_employee_profiles.c.user_id == user_id)
        )
    ).one()
    await connection.execute(
        hr_service_history.insert().values(
            id=uuid4(),
            profile_id=profile.id,
            actor_user_id=actor.id,
            created_at=now,
            reason=payload.service_reason,
            service_anchor_date=payload.service_anchor_date,
            service_years=payload.service_years,
            service_months=payload.service_months,
            service_days=payload.service_days,
        )
    )
    await _audit(connection, actor.id, "hr.profile_saved", profile.id, {"userId": str(user_id)})
    row = (
        await connection.execute(
            select(hr_employee_profiles).where(hr_employee_profiles.c.user_id == user_id)
        )
    ).one()
    return _profile_response(row, date.today())


async def create_profile(
    connection: AsyncConnection, actor: AuthenticatedUser, payload: HrProfileCreate
) -> HrProfileResponse:
    await _require_actor(connection, actor, "hr", "edit")
    now, profile_id = datetime.now(UTC), uuid4()
    values = payload.model_dump() | {
        "id": profile_id,
        "user_id": None,
        "employment_status": "active",
        "terminated_on": None,
        "termination_reason": None,
        "hidden_after_year": False,
        "created_by_user_id": actor.id,
        "created_at": now,
        "updated_at": now,
    }
    await connection.execute(hr_employee_profiles.insert().values(**values))
    await connection.execute(
        hr_service_history.insert().values(
            id=uuid4(),
            profile_id=profile_id,
            actor_user_id=actor.id,
            created_at=now,
            reason=payload.service_reason,
            service_anchor_date=payload.service_anchor_date,
            service_years=payload.service_years,
            service_months=payload.service_months,
            service_days=payload.service_days,
        )
    )
    await _audit(connection, actor.id, "hr.profile_created", profile_id, {"source": "manual"})
    row = (
        await connection.execute(
            select(hr_employee_profiles).where(hr_employee_profiles.c.id == profile_id)
        )
    ).one()
    return _profile_response(row, date.today())


async def import_profiles(
    connection: AsyncConnection, actor: AuthenticatedUser, payload: HrProfileImport
) -> HrProfileImportResponse:
    await _require_actor(connection, actor, "hr", "edit")
    now, created, already_imported = datetime.now(UTC), 0, 0
    for row in payload.rows:
        import_key = f"{payload.source_label}:{row.source_row}"
        result = await connection.execute(
            pg_insert(hr_employee_profiles)
            .values(
                id=uuid4(),
                user_id=None,
                full_name=row.full_name,
                job_title=row.job_title,
                import_key=import_key,
                employment_date=row.employment_date,
                service_anchor_date=row.service_anchor_date,
                service_years=row.service_years,
                service_months=row.service_months,
                service_days=row.service_days,
                service_reason=row.service_reason,
                employment_status="active",
                terminated_on=None,
                termination_reason=None,
                hidden_after_year=False,
                created_by_user_id=actor.id,
                created_at=now,
                updated_at=now,
            )
            .on_conflict_do_nothing(index_elements=[hr_employee_profiles.c.import_key])
            .returning(hr_employee_profiles.c.id)
        )
        profile_id = result.scalar_one_or_none()
        if profile_id is None:
            already_imported += 1
            continue
        created += 1
        await connection.execute(
            hr_service_history.insert().values(
                id=uuid4(),
                profile_id=profile_id,
                actor_user_id=actor.id,
                created_at=now,
                reason=row.service_reason,
                service_anchor_date=row.service_anchor_date,
                service_years=row.service_years,
                service_months=row.service_months,
                service_days=row.service_days,
            )
        )
    await _audit(
        connection,
        actor.id,
        "hr.profiles_imported",
        actor.id,
        {"source": payload.source_label, "created": created, "alreadyImported": already_imported},
    )
    return HrProfileImportResponse(created=created, already_imported=already_imported)


async def terminate_profile(
    connection: AsyncConnection,
    actor: AuthenticatedUser,
    profile_id: UUID,
    payload: HrTerminationWrite,
) -> HrProfileResponse:
    await _require_actor(connection, actor, "hr", "edit")
    now = datetime.now(UTC)
    result = await connection.execute(
        update(hr_employee_profiles)
        .where(hr_employee_profiles.c.id == profile_id)
        .values(
            employment_status="terminated",
            terminated_on=payload.terminated_on,
            termination_reason=payload.termination_reason,
            updated_at=now,
        )
    )
    if not result.rowcount:
        raise HrError(404, "Кадровая карточка не найдена")
    profile = (
        await connection.execute(
            select(hr_employee_profiles.c.user_id).where(hr_employee_profiles.c.id == profile_id)
        )
    ).one()
    if profile.user_id is not None:
        await connection.execute(
            update(users)
            .where(users.c.id == profile.user_id)
            .values(status="archived", updated_at=now)
        )
    row = (
        await connection.execute(
            select(hr_employee_profiles).where(hr_employee_profiles.c.id == profile_id)
        )
    ).one()
    await _audit(
        connection,
        actor.id,
        "hr.employee_terminated",
        row.id,
        {"userId": str(profile.user_id) if profile.user_id else None},
    )
    return _profile_response(row, date.today())


async def history(
    connection: AsyncConnection, actor: AuthenticatedUser, profile_id: UUID
) -> list[HrHistoryResponse]:
    await ensure_module_action(connection, actor, "hr", "view")
    rows = (
        await connection.execute(
            select(hr_service_history)
            .join(
                hr_employee_profiles, hr_employee_profiles.c.id == hr_service_history.c.profile_id
            )
            .where(hr_employee_profiles.c.id == profile_id)
            .order_by(hr_service_history.c.created_at.desc())
        )
    ).all()
    return [
        HrHistoryResponse(
            service_anchor_date=row.service_anchor_date,
            service_years=row.service_years,
            service_months=row.service_months,
            service_days=row.service_days,
            reason=row.reason,
            created_at=row.created_at,
        )
        for row in rows
    ]


async def generate_register(
    connection: AsyncConnection, actor: AuthenticatedUser, period: str
) -> HrRegisterResponse:
    await _require_actor(connection, actor, "hr", "create")
    try:
        year, month = map(int, period.split("-"))
        snapshot = date(year, month, calendar.monthrange(year, month)[1])
    except ValueError as error:
        raise HrError(422, "Период должен иметь вид YYYY-MM") from error
    existing = (
        await connection.execute(
            select(hr_monthly_registers).where(
                and_(hr_monthly_registers.c.period == period, hr_monthly_registers.c.version == 1)
            )
        )
    ).one_or_none()
    if existing:
        return (await load_overview(connection, actor)).registers[
            [item.id for item in (await load_overview(connection, actor)).registers].index(
                existing.id
            )
        ]
    now, register_id = datetime.now(UTC), uuid4()
    await connection.execute(
        hr_monthly_registers.insert().values(
            id=register_id,
            period=period,
            version=1,
            status="draft",
            created_by_user_id=actor.id,
            created_at=now,
            updated_at=now,
            submitted_at=None,
            approved_at=None,
            accounted_at=None,
            return_comment=None,
        )
    )
    profiles = (
        await connection.execute(
            select(hr_employee_profiles)
            .where(
                and_(
                    hr_employee_profiles.c.employment_status == "active",
                    hr_employee_profiles.c.employment_date <= snapshot,
                )
            )
        )
    ).all()
    for profile in profiles:
        years, months, days = service_parts(
            profile.service_anchor_date,
            profile.service_years,
            profile.service_months,
            profile.service_days,
            snapshot,
        )
        await connection.execute(
            hr_monthly_register_items.insert().values(
                id=uuid4(),
                register_id=register_id,
                user_id=profile.user_id,
                full_name=profile.full_name,
                job_title=profile.job_title,
                service_years=years,
                service_months=months,
                service_days=days,
                allowance_percent=allowance(years, months),
            )
        )
    return (await load_overview(connection, actor)).registers[0]


async def act_register(
    connection: AsyncConnection,
    actor: AuthenticatedUser,
    register_id: UUID,
    payload: HrRegisterAction,
) -> HrRegisterResponse:
    register = (
        await connection.execute(
            select(hr_monthly_registers).where(hr_monthly_registers.c.id == register_id)
        )
    ).one_or_none()
    if register is None:
        raise HrError(404, "Реестр не найден")
    action_to_actor = {
        "submit": "hr",
        "approve": "chair",
        "return": "chair",
        "account": "accountant",
    }
    await _require_actor(connection, actor, action_to_actor[payload.action], "approve")
    transitions = {
        ("draft", "submit"): "pending_chair",
        ("returned", "submit"): "pending_chair",
        ("pending_chair", "approve"): "approved",
        ("pending_chair", "return"): "returned",
        ("approved", "account"): "closed",
    }
    status = transitions.get((register.status, payload.action))
    if status is None or (payload.action == "return" and not payload.comment):
        raise HrError(
            409 if status is None else 422, "Этот переход недоступен или не указан комментарий"
        )
    now = datetime.now(UTC)
    values = {
        "status": status,
        "updated_at": now,
        "return_comment": payload.comment if payload.action == "return" else None,
    }
    if payload.action == "submit":
        values["submitted_at"] = now
    if payload.action == "approve":
        values["approved_at"] = now
    if payload.action == "account":
        values["accounted_at"] = now
    await connection.execute(
        update(hr_monthly_registers)
        .where(hr_monthly_registers.c.id == register_id)
        .values(**values)
    )
    recipient_kind = {
        "submit": "chair",
        "approve": "accountant",
        "return": "hr",
        "account": "accountant",
    }[payload.action]
    recipient = getattr(await _settings(connection), f"{recipient_kind}_user_id")
    if recipient and recipient != actor.id:
        await _notify(connection, recipient, register_id, payload.action, register.period, now)
    await _audit(
        connection,
        actor.id,
        f"hr.register_{payload.action}",
        register_id,
        {"period": register.period, "comment": payload.comment},
    )
    overview = await load_overview(connection, actor)
    return next(item for item in overview.registers if item.id == register_id)


async def _audit(
    connection: AsyncConnection, actor: UUID, action: str, target: UUID, details: dict[str, object]
) -> None:
    await connection.execute(
        audit_events.insert().values(
            id=uuid4(),
            actor_user_id=actor,
            action=action,
            target_type="hr",
            target_id=target,
            details=details,
            created_at=datetime.now(UTC),
        )
    )


async def _notify(
    connection: AsyncConnection,
    user_id: UUID,
    register_id: UUID,
    action: str,
    period: str,
    now: datetime,
) -> None:
    await connection.execute(
        pg_insert(workspace_notifications)
        .values(
            id=uuid4(),
            user_id=user_id,
            event_key=f"hr:{register_id}:{action}",
            kind="approval",
            priority="normal",
            title="Реестр стажа ждёт действия",
            body=f"Реестр надбавки за {period} передан на следующий этап.",
            section="hr",
            entity_id=register_id,
            requires_action=True,
            is_reminder=False,
            occurred_at=now,
            read_at=None,
            resolved_at=None,
            desktop_delivered_at=None,
        )
        .on_conflict_do_nothing(
            index_elements=[workspace_notifications.c.user_id, workspace_notifications.c.event_key]
        )
    )


async def materialize_previous_month_register(connection: AsyncConnection) -> int:
    """Scheduler entrypoint; safe to call every minute because period/version is unique."""
    current = datetime.now(ZoneInfo("Asia/Tashkent")).date()
    if current.day != 1:
        return 0
    settings = await _settings(connection)
    if settings.hr_user_id is None:
        return 0
    person = (
        await connection.execute(select(users).where(users.c.id == settings.hr_user_id))
    ).one_or_none()
    if person is None or person.status != "active":
        return 0
    previous = _add_months(current.replace(day=1), -1).strftime("%Y-%m")
    existing = (
        await connection.execute(
            select(hr_monthly_registers.c.id).where(
                and_(hr_monthly_registers.c.period == previous, hr_monthly_registers.c.version == 1)
            )
        )
    ).scalar_one_or_none()
    if existing is not None:
        return 0
    actor = AuthenticatedUser(
        id=person.id,
        username=person.username,
        full_name=person.full_name,
        position_id=person.position_id,
        job_title=person.job_title,
        role=person.role,
        department_id=person.department_id,
    )
    await generate_register(connection, actor, previous)
    return 1
