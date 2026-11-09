"""Reporting boundaries and a complete private-file/payroll scenario on isolated PostgreSQL."""

import asyncio
import os
from datetime import UTC, date, datetime
from uuid import UUID, uuid4

import pytest
from fastapi import HTTPException
from sqlalchemy import delete, func, insert, select
from sqlalchemy.ext.asyncio import create_async_engine

from yuksalish_api import monthly_report_service as service
from yuksalish_api.auth import AuthenticatedUser
from yuksalish_api.grant_files_service import GrantInitialFile
from yuksalish_api.monthly_report_schemas import CalendarDayWrite, MonthlySubmission
from yuksalish_api.monthly_report_tables import calendar_days, cycles, members, reports
from yuksalish_api.object_storage import InMemoryObjectStorage, ObjectStorageError
from yuksalish_api.seed import seed_demo_data
from yuksalish_api.tables import (
    audit_events,
    departments,
    module_access_rules,
    users,
    workspace_notifications,
)


@pytest.mark.parametrize(
    ("today", "expected"),
    [
        (date(2026, 11, 19), None),
        (date(2026, 11, 20), date(2026, 11, 1)),
        (date(2027, 1, 1), date(2026, 12, 1)),
        (date(2027, 1, 5), date(2026, 12, 1)),
        (date(2027, 1, 6), None),
    ],
)
def test_collection_window_and_year_boundary(today, expected):
    assert service.reporting_month(today) == expected


def test_three_workdays_excludes_month_end_and_honors_holidays_and_working_saturdays():
    month = date(2026, 11, 1)
    assert service.reminder_date(month, {}) == date(2026, 11, 25)
    assert service.reminder_date(month, {date(2026, 11, 26): False}) == date(2026, 11, 24)
    assert service.reminder_date(month, {date(2026, 11, 28): True}) == date(2026, 11, 26)
    assert service.reminder_date(date(2028, 2, 1), {}) == date(2028, 2, 24)


def test_regional_parent_excludes_a_central_child_and_unassigned_staff_are_central():
    regional, child = uuid4(), uuid4()
    directory = {
        regional: {"scope": "regional", "parent_id": None},
        child: {"scope": "central", "parent_id": regional},
    }
    assert not service.is_central(child, directory)
    assert service.is_central(None, directory)


class FailingStorage(InMemoryObjectStorage):
    async def put(self, key: str, content: bytes, content_type: str) -> None:
        if self._objects:
            raise ObjectStorageError("synthetic second-file failure")
        await super().put(key, content, content_type)


@pytest.mark.postgres
def test_monthly_report_workflow_preserves_versions_private_files_and_one_salary_decision(
    monkeypatch,
):
    url = os.environ.get("YUKSALISH_TEST_DATABASE_URL")
    if not url:
        pytest.skip("YUKSALISH_TEST_DATABASE_URL is not configured")

    async def scenario():
        engine = create_async_engine(url)
        await seed_demo_data(engine)
        month = date(2098, 11, 1)
        now = datetime(2098, 11, 28, 12, tzinfo=UTC)
        people = []
        regional = uuid4()
        try:
            async with engine.connect() as c:
                await c.execute(
                    insert(departments).values(
                        id=regional,
                        code=f"month-{regional.hex[:8]}",
                        name="Monthly regional QA",
                        scope="regional",
                        created_at=now,
                    )
                )
                for index, role in enumerate(
                    [
                        "employee",
                        "employee",
                        "manager",
                        "manager",
                        "employee",
                        "superadmin",
                        "employee",
                    ]
                ):
                    uid = uuid4()
                    await c.execute(
                        insert(users).values(
                            id=uid,
                            username=f"monthly-{uid.hex}",
                            full_name=f"Monthly QA {index}",
                            role=role,
                            status="active",
                            created_at=now,
                            updated_at=now,
                            department_id=regional if index == 6 else None,
                        )
                    )
                    people.append(
                        AuthenticatedUser(
                            id=uid,
                            username=f"monthly-{uid.hex}",
                            full_name=f"Monthly QA {index}",
                            role=role,
                            position_id=None,
                            job_title=None,
                            department_id=regional if index == 6 else None,
                        )
                    )
                owner, stranger, chair, deputy, accountant, admin, region_user = people

                async def actors(_c):
                    return chair.id, deputy.id, accountant.id

                monkeypatch.setattr(service, "_actors", actors)
                await c.commit()
                await service.ensure_cycle(c, month, now)
                await c.commit()
                base = await service.overview(c, chair, now=now)
                assert base.dashboard_visible and base.can_review and not base.can_authorize
                assert region_user.id not in {UUID(m.user_id) for m in base.cycles[0].members}
                assert (await service.overview(c, owner, now=now)).reminder_month == month
                assert not (await service.overview(c, region_user, now=now)).reminder_month
                assert not (await service.overview(c, owner, now=now)).cycles[0].members
                rule_ids = [uuid4(), uuid4()]
                for rule_id, actor in zip(rule_ids, [owner, deputy], strict=True):
                    await c.execute(
                        insert(module_access_rules).values(
                            id=rule_id,
                            subject_type="user",
                            subject_key=str(actor.id),
                            module_key="ai_monthly_reports",
                            permissions={
                                "view": True,
                                "create": False,
                                "edit": False,
                                "approve": False,
                                "admin": False,
                            },
                            created_by_user_id=admin.id,
                            created_at=now,
                            updated_at=now,
                        )
                    )
                readonly = await service.overview(c, owner, now=now)
                assert not readonly.reminder_month and not readonly.cycles[0].can_submit
                assert not (await service.overview(c, deputy, now=now)).can_authorize
                with pytest.raises(HTTPException) as no_upload:
                    await service.submit(
                        c,
                        owner,
                        MonthlySubmission(id=uuid4(), month=month),
                        [GrantInitialFile("denied.txt", "text/plain", b"not stored")],
                        InMemoryObjectStorage(),
                    )
                assert no_upload.value.status_code == 403
                with pytest.raises(HTTPException) as no_payroll:
                    await service.authorize(c, deputy, month, "")
                assert no_payroll.value.status_code == 403
                await c.execute(
                    delete(module_access_rules).where(module_access_rules.c.id.in_(rule_ids))
                )
                first = await service.materialize_monthly_reports(c, now)
                assert first > 0
                assert await service.materialize_monthly_reports(c, now) == 0
                await c.commit()
                storage = InMemoryObjectStorage()
                payload = MonthlySubmission(id=uuid4(), month=month, comment="First report")
                files = [GrantInitialFile("report.docx", "application/octet-stream", b"report-v1")]
                result = await service.submit(c, owner, payload, files, storage)
                assert result.revision == 1
                assert (await service.submit(c, owner, payload, files, storage)).id == result.id
                with pytest.raises(HTTPException) as denied:
                    await service.submit(c, stranger, payload, files, storage)
                assert denied.value.status_code == 409
                with pytest.raises(HTTPException) as hidden:
                    await service.file_metadata(c, stranger, payload.id, UUID(result.files[0].id))
                assert hidden.value.status_code == 404
                assert (
                    await service.file_metadata(c, chair, payload.id, UUID(result.files[0].id))
                )["name"] == "report.docx"
                assert not (await service.overview(c, owner, now=now)).reminder_month
                newer = await service.submit(
                    c,
                    owner,
                    MonthlySubmission(id=uuid4(), month=month, comment="Second report"),
                    [GrantInitialFile("revised.docx", "application/octet-stream", b"report-v2")],
                    storage,
                )
                assert newer.revision == 2
                overview = await service.overview(c, chair, now=now)
                assert overview.cycles[0].submitted == 1
                assert len((await service.overview(c, owner, now=now)).reports) == 2
                failure = FailingStorage()
                with pytest.raises(ObjectStorageError):
                    await service.submit(
                        c,
                        owner,
                        MonthlySubmission(id=uuid4(), month=month),
                        [
                            GrantInitialFile("a.txt", "text/plain", b"a"),
                            GrantInitialFile("b.txt", "text/plain", b"b"),
                        ],
                        failure,
                    )
                assert not failure._objects
                await c.rollback()
                assert (
                    await c.scalar(
                        select(func.count()).select_from(reports).where(reports.c.month == month)
                    )
                    == 2
                )
                for forbidden in [owner, chair, accountant, admin]:
                    with pytest.raises(HTTPException) as forbidden_decision:
                        await service.authorize(c, forbidden, month, "")
                    assert forbidden_decision.value.status_code == 403
                decision = await service.authorize(
                    c, deputy, month, "Permission with missing reports"
                )
                assert decision.authorized_at and decision.submitted == 1
                await service.authorize(c, deputy, month, "Permission with missing reports")
                await c.commit()
                assert (
                    await c.scalar(
                        select(func.count())
                        .select_from(workspace_notifications)
                        .where(
                            workspace_notifications.c.user_id == accountant.id,
                            workspace_notifications.c.event_key == f"monthly-payroll:{month}",
                        )
                    )
                    == 1
                )
                assert (await service.overview(c, accountant, now=now)).payroll_notice
                assert not (await service.overview(c, owner, now=now)).payroll_notice
                with pytest.raises(HTTPException) as locked:
                    await service.submit(
                        c, owner, MonthlySubmission(id=uuid4(), month=month), files, storage
                    )
                assert locked.value.status_code == 409
                # A lost HTTP response can safely retry the original successful upload even now.
                assert (await service.submit(c, owner, payload, files, storage)).id == result.id
                assert not (
                    await service.overview(c, chair, now=datetime(2098, 12, 6, tzinfo=UTC))
                ).dashboard_visible
                await c.rollback()
                with pytest.raises(HTTPException):
                    await service.save_calendar(
                        c, owner, CalendarDayWrite(day=month, working=False, note="Holiday")
                    )
        finally:
            async with engine.begin() as c:
                ids = [p.id for p in people]
                await c.execute(
                    delete(workspace_notifications).where(
                        workspace_notifications.c.event_key.in_(
                            [f"monthly-report:{month}", f"monthly-payroll:{month}"]
                        )
                    )
                )
                await c.execute(delete(reports).where(reports.c.month == month))
                await c.execute(delete(members).where(members.c.month == month))
                await c.execute(delete(cycles).where(cycles.c.month == month))
                await c.execute(delete(calendar_days).where(calendar_days.c.updated_by.in_(ids)))
                await c.execute(delete(audit_events).where(audit_events.c.actor_user_id.in_(ids)))
                await c.execute(
                    delete(module_access_rules).where(
                        module_access_rules.c.subject_key.in_([str(uid) for uid in ids])
                    )
                )
                await c.execute(delete(users).where(users.c.id.in_(ids)))
                await c.execute(delete(departments).where(departments.c.id == regional))
            await engine.dispose()

    asyncio.run(scenario())
