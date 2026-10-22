import asyncio
from datetime import UTC, datetime

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from pydantic import ValidationError
from sqlalchemy import func, select

from test_personnel_dossiers import data, scenario
from yuksalish_api import dossier_reminders as reminders
from yuksalish_api import dossier_service as service
from yuksalish_api.auth import require_user
from yuksalish_api.database import get_connection
from yuksalish_api.dossier_schemas import DossierReminderAnswer
from yuksalish_api.dossier_tables import dossier_monthly_reviews, dossiers
from yuksalish_api.errors import WorkspaceRepositoryError
from yuksalish_api.routers.dossiers import router
from yuksalish_api.tables import audit_events


def freeze(monkeypatch, instant):
    monkeypatch.setattr(reminders, "current_time", lambda: datetime.fromisoformat(instant))


@pytest.mark.parametrize(("instant", "period", "due"), [
    ("2026-10-24T18:59:59+00:00", "2026-10", False),
    ("2026-10-24T19:00:00+00:00", "2026-10", True),
    ("2026-10-31T18:59:59+00:00", "2026-10", True),
    ("2026-10-31T19:00:00+00:00", "2026-11", False),
    ("2026-12-31T19:00:00+00:00", "2027-01", False),
    ("2028-02-29T10:00:00+00:00", "2028-02", True),
])
def test_monthly_window_uses_server_tashkent_clock_without_writes(
    monkeypatch, instant, period, due,
):
    freeze(monkeypatch, instant)

    async def run():
        async with scenario() as (connection, actors):
            state = await reminders.reminder(connection, actors["employee"])
            assert state.period == period and state.due is due
            assert state.due_date.isoformat() == f"{period}-25"
            assert state.status == "pending" and state.responded_at is None
            assert await connection.scalar(select(func.count()).select_from(
                dossier_monthly_reviews,
            )) == 0
    asyncio.run(run())


@pytest.mark.parametrize("action", ["no_changes", "skipped"])
def test_answer_is_self_only_idempotent_and_expires_next_month(monkeypatch, action):
    freeze(monkeypatch, "2026-10-25T09:00:00+00:00")

    async def run():
        async with scenario() as (connection, actors):
            employee, other = actors["employee"], actors["hr"]
            payload = DossierReminderAnswer(period="2026-10", action=action)
            first = await reminders.answer(connection, employee, payload)
            assert not first.due and first.status == action
            repeated = await reminders.answer(connection, employee, payload)
            assert repeated.responded_at == first.responded_at
            # A second device with a different stale answer cannot overwrite the first.
            stale = await reminders.answer(connection, employee, DossierReminderAnswer(
                period="2026-10", action="update_requested",
            ))
            assert stale.status == action and not stale.due
            assert (await reminders.reminder(connection, other)).due
            assert await connection.scalar(select(func.count()).select_from(dossiers)) == 0
            events = (await connection.execute(select(audit_events.c.details).where(
                audit_events.c.actor_user_id == employee.id,
                audit_events.c.action == "dossier.monthly_review_answered",
            ))).scalars().all()
            assert events == [{"period": "2026-10", "answer": action, "revision": None}]
            freeze(monkeypatch, "2026-11-24T18:59:59+00:00")
            assert not (await reminders.reminder(connection, employee)).due
            freeze(monkeypatch, "2026-11-24T19:00:00+00:00")
            next_month = await reminders.reminder(connection, employee)
            assert next_month.due and next_month.period == "2026-11"
            with pytest.raises(WorkspaceRepositoryError) as stale_period:
                await reminders.answer(connection, employee, payload)
            assert stale_period.value.status_code == 409
    asyncio.run(run())


def test_update_requires_successful_self_save_not_open_draft_or_hr_changes(monkeypatch):
    freeze(monkeypatch, "2026-10-25T09:00:00+00:00")

    async def run():
        async with scenario() as (connection, actors):
            employee, hr = actors["employee"], actors["hr"]
            await reminders.answer(connection, employee, DossierReminderAnswer(
                period="2026-10", action="update_requested",
            ))
            assert (await reminders.reminder(connection, employee)).due
            await service.detail(connection, employee, employee.id)
            await service.save(connection, employee, employee.id, data(status="draft"))
            assert (await reminders.reminder(connection, employee)).status == "update_requested"
            await service.save(connection, hr, employee.id, data(1))
            assert (await reminders.reminder(connection, employee)).due
            with pytest.raises(WorkspaceRepositoryError):
                await service.save(connection, employee, employee.id, data(1))
            assert (await reminders.reminder(connection, employee)).due
            await service.save(connection, employee, employee.id, data(2))
            state = await reminders.reminder(connection, employee)
            assert not state.due and state.status == "updated"
            row = (await connection.execute(select(dossier_monthly_reviews).where(
                dossier_monthly_reviews.c.user_id == employee.id,
            ))).mappings().one()
            assert row["dossier_revision"] == 3
            assert state.responded_at.tzinfo == UTC
    asyncio.run(run())


def test_early_responses_are_rejected_and_http_contract_cannot_target_another_user(monkeypatch):
    freeze(monkeypatch, "2026-10-24T10:00:00+00:00")
    with pytest.raises(ValidationError):
        DossierReminderAnswer(period="2026-13", action="skipped")

    async def run():
        async with scenario() as (connection, actors):
            employee = actors["employee"]
            app = FastAPI()
            app.include_router(router, prefix="/api/v1")
            app.dependency_overrides[require_user] = lambda: employee

            async def test_connection():
                yield connection

            app.dependency_overrides[get_connection] = test_connection
            async with AsyncClient(
                transport=ASGITransport(app=app), base_url="http://test",
            ) as client:
                route = "/api/v1/personnel-dossiers/reminder"
                state = await client.get(route)
                assert state.status_code == 200
                assert state.headers["cache-control"] == "no-store"
                assert set(state.json()) == {"period", "dueDate", "due", "status", "respondedAt"}
                payload = {"period": "2026-10", "action": "no_changes"}
                early = await client.post(route, json=payload)
                assert early.status_code == 409
                freeze(monkeypatch, "2026-10-25T10:00:00+00:00")
                foreign = await client.post(route, json={**payload, "userId": str(actors["hr"].id)})
                assert foreign.status_code == 422
                saved = await client.post(route, json=payload)
                assert saved.status_code == 200 and not saved.json()["due"]
                assert saved.headers["cache-control"] == "no-store"
                assert (await client.get(route)).json() == saved.json()
    asyncio.run(run())
