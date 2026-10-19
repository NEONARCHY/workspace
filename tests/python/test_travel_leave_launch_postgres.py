"""Real PostgreSQL launch regressions; all people and documents are synthetic."""

# Human-facing Russian messages and Uzbek sample data are intentional.
# ruff: noqa: RUF001

import hashlib
import os
from collections.abc import AsyncIterator
from datetime import UTC, date, datetime
from io import BytesIO
from uuid import UUID, uuid4
from zoneinfo import ZoneInfo

import pytest
from PIL import Image, ImageDraw
from pypdf import PdfReader
from sqlalchemy import func, insert, select
from sqlalchemy.ext.asyncio import AsyncConnection, create_async_engine

from yuksalish_api.absence_service import AbsenceError, _ensure_no_conflict
from yuksalish_api.auth import AuthenticatedUser
from yuksalish_api.employee_availability import ensure_trip_available, lock_employee_schedules
from yuksalish_api.errors import WorkspaceRepositoryError
from yuksalish_api.hr_hiring_tables import hiring_signatures
from yuksalish_api.hr_schemas import HrProfileWrite
from yuksalish_api.hr_service import HrError, save_profile
from yuksalish_api.leave_service import (
    LeaveError,
    create_leave,
    review_hr,
    revise_leave,
    withdraw_leave,
)
from yuksalish_api.object_storage import InMemoryObjectStorage
from yuksalish_api.repository import (
    act_on_trip_request,
    create_trip_request,
    delete_trip_request,
    get_trip_request,
)
from yuksalish_api.tables import (
    calendar_event_attendees,
    calendar_events,
    hr_settings,
    positions,
    trip_order_counters,
    trip_requests,
    users,
    workspace_notifications,
)
from yuksalish_api.trip_document_service import issue_order, prepare_signed_brief, read_document
from yuksalish_api.workspace_schemas import (
    CreateTripRequest,
    LeaveHrDecisionRequest,
    LeaveWriteRequest,
    TripActionRequest,
)

Fixture = tuple[AsyncConnection, dict[str, AuthenticatedUser], InMemoryObjectStorage]
pytestmark = [pytest.mark.anyio, pytest.mark.postgres]


@pytest.fixture
async def launch_db() -> AsyncIterator[Fixture]:
    url = os.environ.get("YUKSALISH_TEST_DATABASE_URL", "")
    if not url:
        pytest.skip("Isolated PostgreSQL not configured")
    if "test" not in url.rsplit("/", 1)[-1]:
        raise RuntimeError("Launch audit refuses a non-test database")
    engine = create_async_engine(url)
    try:
        async with engine.connect() as connection:
            transaction = await connection.begin()
            try:
                position_id = await connection.scalar(select(positions.c.id).where(
                    positions.c.name.ilike("Rais birinchi%"),
                ).limit(1))
                assert position_id
                actors = {}
                for key in ("employee", "hr", "deputy", "chair", "other", "admin"):
                    user_id = uuid4()
                    role = "superadmin" if key == "admin" else "employee"
                    await connection.execute(insert(users).values(
                        id=user_id, username=f"launch-{user_id.hex[:12]}",
                        full_name=f"Test {key}", role=role, status="active",
                        position_id=position_id if key == "deputy" else None,
                        job_title="Bosh mutaxassis", created_at=datetime.now(UTC),
                        updated_at=datetime.now(UTC),
                    ))
                    actors[key] = AuthenticatedUser(
                        id=user_id, username=key, full_name=f"Test {key}", role=role,
                        job_title="Bosh mutaxassis",
                        position_id=position_id if key == "deputy" else None,
                    )
                await connection.execute(insert(hr_settings).values(
                    id=1, hr_user_id=actors["hr"].id, chair_user_id=actors["chair"].id,
                    updated_by_user_id=actors["hr"].id, updated_at=datetime.now(UTC),
                ))
                yield connection, actors, InMemoryObjectStorage()
            finally:
                await transaction.rollback()
    finally:
        await engine.dispose()


async def test_hr_revision_checks_requester_dates_and_keeps_hr_action(launch_db: Fixture) -> None:
    connection, actors, storage = launch_db
    first = await create_leave(connection, actors["employee"], storage, LeaveWriteRequest(
        application_text="Менга меҳнат таътили беришингизни сўрайман.",
        starts_on=date(2027, 1, 10), ends_on=date(2027, 1, 20),
    ))
    second = await create_leave(connection, actors["employee"], storage, LeaveWriteRequest(
        application_text="Кейинги таътил.", starts_on=date(2027, 2, 1),
    ))
    with pytest.raises(LeaveError, match="пересекается"):
        await revise_leave(connection, actors["hr"], storage, UUID(second.id), LeaveWriteRequest(
            application_text="Уточнённое заявление", starts_on=date(2027, 1, 12),
        ))
    await create_leave(connection, actors["hr"], storage, LeaveWriteRequest(
        application_text="Личное заявление кадровика", starts_on=date(2027, 2, 2),
    ))
    revised = await revise_leave(connection, actors["hr"], storage, UUID(second.id),
        LeaveWriteRequest(application_text="Уточнённое заявление", starts_on=date(2027, 2, 2)))
    assert revised.requested_starts_on == date(2027, 2, 2)
    assert await connection.scalar(select(func.count()).select_from(workspace_notifications).where(
        workspace_notifications.c.entity_id == UUID(second.id),
        workspace_notifications.c.user_id == actors["hr"].id,
        workspace_notifications.c.requires_action.is_(True),
        workspace_notifications.c.resolved_at.is_(None),
    )) == 1
    with pytest.raises(LeaveError, match="уже изменилось"):
        await review_hr(connection, actors["hr"], UUID(second.id), LeaveHrDecisionRequest(
            action="reject", comment="Old browser tab", expected_updated_at=second.updated_at,
        ))
    assert first.status == "pending_hr"


async def test_linked_hr_profile_supplies_organization_tenure_to_leave(launch_db: Fixture) -> None:
    connection, actors, storage = launch_db
    payload = HrProfileWrite(
        employment_date=date(2020, 1, 10), service_anchor_date=date(2026, 1, 10),
        service_years=6, service_months=0, service_days=0, service_reason="Test hiring order",
    )
    with pytest.raises(HrError) as denied:
        await save_profile(connection, actors["employee"], actors["employee"].id, payload)
    assert denied.value.status_code == 403
    profile = await save_profile(connection, actors["hr"], actors["employee"].id, payload)
    updated = await save_profile(connection, actors["hr"], actors["employee"].id, payload)
    assert updated.id == profile.id and updated.user_id == actors["employee"].id
    leave = await create_leave(connection, actors["employee"], storage, LeaveWriteRequest(
        application_text="Менга меҳнат таътили беришингизни сўрайман.",
        starts_on=date(2027, 6, 1), ends_on=date(2027, 6, 23),
    ))
    assert leave.organization_employment_date == payload.employment_date
    reviewed = await review_hr(connection, actors["hr"], UUID(leave.id), LeaveHrDecisionRequest(
        action="approve", starts_on=date(2027, 6, 1), ends_on=date(2027, 6, 23),
        work_year_starts_on=date(2026, 6, 1), work_year_ends_on=date(2027, 5, 31),
        calendar_days=23, paid_days=18, tenure_additional_days=2, return_on=date(2027, 6, 24),
        order_employee_name="Test Employee", order_job_title="Bosh mutaxassis",
        order_signer_name="Test Deputy", order_number="QA-LINK",
        accounting_officer="Test Accountant",
    ))
    assert reviewed.tenure_additional_days == 2
    assert reviewed.organization_employment_date == payload.employment_date


async def _trip(connection: AsyncConnection, user: AuthenticatedUser) -> UUID:
    trip = await create_trip_request(connection, user, CreateTripRequest(
        destination="Samarqand, O‘zbekiston", start_date=date(2027, 3, 10),
        end_date=date(2027, 3, 12), employee_ids=[str(user.id)],
        purpose="Hamkorlar bilan loyiha doirasida amaliy seminar o'tkazish",
        expense_source="loyiha mablag‘lari", brief_format="generated",
    ))
    return UUID(trip.id)


async def _sign(connection: AsyncConnection, storage: InMemoryObjectStorage, user_id: UUID) -> None:
    image = Image.new("RGBA", (100, 240), (0, 0, 0, 0))
    ImageDraw.Draw(image).line([(10, 220), (45, 10), (90, 190)], fill="blue", width=4)
    stream = BytesIO()
    image.save(stream, "PNG")
    content = stream.getvalue()
    key = f"audit/signature-{user_id}.png"
    await storage.put(key, content, "image/png")
    await connection.execute(insert(hiring_signatures).values(
        user_id=user_id, storage_key=key, sha256=hashlib.sha256(content).hexdigest(),
        updated_at=datetime.now(UTC),
    ))


async def test_trip_full_cycle_documents_calendar_and_immutable_annulment(
    launch_db: Fixture,
) -> None:
    connection, actors, storage = launch_db
    request_id = await _trip(connection, actors["employee"])
    with pytest.raises(WorkspaceRepositoryError):
        await prepare_signed_brief(connection, actors["admin"], storage, request_id)
    await prepare_signed_brief(connection, actors["employee"], storage, request_id)
    brief, _, _ = await read_document(connection, actors["employee"], storage,
                                      request_id, "brief")
    text = " ".join(page.extract_text() for page in PdfReader(BytesIO(brief)).pages)
    assert "Test employee" in text and "Test admin" not in text
    assert len(PdfReader(BytesIO(brief)).pages[0].images) == 1  # only logo
    with pytest.raises(WorkspaceRepositoryError):
        await read_document(connection, actors["other"], storage, request_id, "brief")
    await act_on_trip_request(connection, actors["employee"], request_id,
                              TripActionRequest(action="submit"))
    with pytest.raises(WorkspaceRepositoryError):
        await act_on_trip_request(connection, actors["chair"], request_id,
                                  TripActionRequest(action="approve"))
    await act_on_trip_request(connection, actors["deputy"], request_id,
                              TripActionRequest(action="return", comment="Уточнить программу"))
    # The authorized action receipt must not open subsequent access to the private draft.
    with pytest.raises(WorkspaceRepositoryError) as private_draft:
        await get_trip_request(connection, actors["deputy"], request_id)
    assert private_draft.value.status_code == 404
    await prepare_signed_brief(connection, actors["employee"], storage, request_id)
    await act_on_trip_request(connection, actors["employee"], request_id,
                              TripActionRequest(action="resubmit"))
    await act_on_trip_request(connection, actors["deputy"], request_id,
                              TripActionRequest(action="approve"))
    preview, _, _ = await read_document(connection, actors["chair"], storage,
                                        request_id, "order-preview")
    assert "IMZOLANMAGAN" in PdfReader(BytesIO(preview)).pages[0].extract_text()
    with pytest.raises(WorkspaceRepositoryError, match="подпись"):
        await issue_order(connection, actors["chair"], storage, request_id)
    assert await connection.scalar(select(func.count()).select_from(trip_order_counters)) == 0
    await _sign(connection, storage, actors["chair"].id)
    await issue_order(connection, actors["chair"], storage, request_id)
    approved = await act_on_trip_request(connection, actors["chair"], request_id,
                                         TripActionRequest(action="approve"))
    assert approved.status == "approved"
    order, _, _ = await read_document(connection, actors["employee"], storage, request_id, "order")
    page = PdfReader(BytesIO(order)).pages[0]
    assert len(page.images) == 2 and "2027-yil" in page.extract_text()
    await issue_order(connection, actors["chair"], storage, request_id)
    replay = await act_on_trip_request(connection, actors["chair"], request_id,
                                       TripActionRequest(action="approve"))
    assert replay.order_number == approved.order_number
    assert await connection.scalar(select(trip_order_counters.c.last_sequence)) == 1
    event = (await connection.execute(select(calendar_events).where(
        calendar_events.c.trip_request_id == request_id,
    ))).mappings().one()
    assert event["status"] == "scheduled" and event["all_day"]
    assert await connection.scalar(select(calendar_event_attendees.c.status).where(
        calendar_event_attendees.c.event_id == event["id"],
        calendar_event_attendees.c.user_id == actors["employee"].id,
    )) == "accepted"
    with pytest.raises(LeaveError, match="поездкой"):
        await create_leave(connection, actors["employee"], storage, LeaveWriteRequest(
            application_text="Пересекающийся отпуск", starts_on=date(2027, 3, 12),
        ))
    local = ZoneInfo("Asia/Tashkent")
    with pytest.raises(AbsenceError, match="командировки"):
        await _ensure_no_conflict(
            connection, actors["employee"].id,
            datetime(2027, 3, 10, 12, tzinfo=local), datetime(2027, 3, 10, 18, tzinfo=local),
        )
    # An absence ending at midnight before the first travel day does not overlap.
    await _ensure_no_conflict(
        connection, actors["employee"].id,
        datetime(2027, 3, 9, 12, tzinfo=local), datetime(2027, 3, 10, 0, tzinfo=local),
    )
    await act_on_trip_request(connection, actors["employee"], request_id,
                              TripActionRequest(action="annul", comment="Мероприятие отменено"))
    assert await connection.scalar(select(calendar_events.c.status).where(
        calendar_events.c.id == event["id"],
    )) == "cancelled"
    assert (await read_document(connection, actors["employee"], storage,
                               request_id, "order"))[0] == order
    await delete_trip_request(connection, actors["admin"], request_id)
    assert await connection.scalar(select(trip_requests.c.deleted_at).where(
        trip_requests.c.id == request_id,
    )) is not None


async def test_trip_cannot_overlap_leave_and_withdraw_does_not_lose_history(
    launch_db: Fixture,
) -> None:
    connection, actors, storage = launch_db
    request_id = await _trip(connection, actors["employee"])
    leave = await create_leave(connection, actors["employee"], storage, LeaveWriteRequest(
        application_text="Отпуск в даты поездки", starts_on=date(2027, 3, 12),
    ))
    with pytest.raises(WorkspaceRepositoryError, match="отпуск"):
        await ensure_trip_available(connection, request_id, date(2027, 3, 10), date(2027, 3, 12))
    await withdraw_leave(connection, actors["employee"], UUID(leave.id))
    await ensure_trip_available(connection, request_id, date(2027, 3, 10), date(2027, 3, 12))
    await prepare_signed_brief(connection, actors["employee"], storage, request_id)
    await act_on_trip_request(connection, actors["employee"], request_id,
                              TripActionRequest(action="submit"))
    await act_on_trip_request(connection, actors["employee"], request_id,
                              TripActionRequest(action="withdraw", comment="Исправить даты"))
    result = await get_trip_request(connection, actors["employee"], request_id)
    assert result.stage == "launch" and result.status == "needs_revision"
    assert result.actions[-1].action == "withdraw"


async def test_schedule_lock_serializes_connections_and_releases_on_rollback(
    launch_db: Fixture,
) -> None:
    connection, actors, _ = launch_db
    user_id = actors["employee"].id
    try_lock = select(func.pg_try_advisory_xact_lock(
        func.hashtextextended(f"employee-availability:{user_id}", 0),
    ))
    async with connection.engine.connect() as first, connection.engine.connect() as second:
        await lock_employee_schedules(first, [user_id, user_id])
        assert await second.scalar(try_lock) is False
        await first.rollback()
        assert await second.scalar(try_lock) is True
        await second.rollback()
