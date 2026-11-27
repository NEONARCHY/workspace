"""Actual SQL transactions and PDF bytes; never connect to an ordinary application DB."""

import asyncio
import hashlib
import os
from datetime import UTC, date, datetime
from io import BytesIO
from unittest.mock import AsyncMock
from uuid import UUID, uuid4

import pytest
from pypdf import PdfReader
from sqlalchemy import func, insert, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import create_async_engine

from test_hr_hiring_pdf import signature
from yuksalish_api.auth import AuthenticatedUser
from yuksalish_api.errors import WorkspaceRepositoryError
from yuksalish_api.hr_hiring_tables import hiring_signatures
from yuksalish_api.object_storage import InMemoryObjectStorage, ObjectStorageError
from yuksalish_api.repository import _sync_trip_calendar_event, get_trip_request
from yuksalish_api.tables import (
    calendar_event_attendees,
    calendar_events,
    hr_settings,
    trip_document_revisions,
    trip_order_registrations,
    trip_request_actions,
    trip_request_employees,
    trip_requests,
    users,
)
from yuksalish_api.trip_document_service import read_document
from yuksalish_api.trip_order_pdf import order_pdf
from yuksalish_api.trip_order_registration import reserve_order_number
from yuksalish_api.trip_order_revision_service import act_on_order_revision
from yuksalish_api.workspace_schemas import TripActionRequest

pytestmark = [pytest.mark.anyio, pytest.mark.postgres]


def database_url():
    url = os.environ.get("YUKSALISH_TEST_DATABASE_URL", "")
    if not url:
        pytest.skip("Isolated PostgreSQL not configured")
    if "test" not in url.rsplit("/", 1)[-1]:
        raise RuntimeError("Order correction tests require an explicitly named test database")
    return url


@pytest.fixture
async def revision_trip():
    url = database_url()
    engine = create_async_engine(url)
    storage = InMemoryObjectStorage()
    async with engine.connect() as connection:
        transaction = await connection.begin()
        actors = {}
        now = datetime.now(UTC)
        for name in ["owner", "chair", "hr", "outsider", "admin", "replacement"]:
            user_id = uuid4()
            role = "superadmin" if name == "admin" else "employee"
            await connection.execute(insert(users).values(
                id=user_id, username=f"revision-{user_id.hex}", full_name=f"Synthetic {name}",
                role=role, status="active", created_at=now, updated_at=now,
            ))
            actors[name] = AuthenticatedUser(user_id, name, f"Synthetic {name}", None, None, role)
        settings = dict(hr_user_id=actors["hr"].id, chair_user_id=actors["chair"].id,
                        accountant_user_id=actors["admin"].id,
                        updated_by_user_id=actors["admin"].id, updated_at=now)
        await connection.execute(pg_insert(hr_settings).values(id=1, **settings)
                                 .on_conflict_do_update(
                                     index_elements=[hr_settings.c.id], set_=settings,
                                 ))
        image = signature()
        await storage.put("qa-signature", image, "image/png")
        await connection.execute(insert(hiring_signatures).values(
            user_id=actors["chair"].id, storage_key="qa-signature",
            sha256=hashlib.sha256(image).hexdigest(), updated_at=now,
        ))
        request_id = uuid4()
        number = f"{request_id.hex[:8]}-WS"
        old_time = datetime(2020, 11, 9, 5, 28, tzinfo=UTC)
        original = order_pdf(
            order_number=number, issued=old_time.date(), purpose="Old purpose",
            destination="Farg'ona", start=date(2020, 11, 9), end=date(2020, 11, 10),
            employees=[("Synthetic owner", "Mutaxassis")], expense_source="Loyiha",
            requester="Synthetic owner", chair="Synthetic chair", signature=image,
        )
        await storage.put("qa-old-order", original, "application/pdf")
        await connection.execute(insert(trip_requests).values(
            id=request_id, requester_user_id=actors["owner"].id, workflow_version=3,
            hr_processing_required=False, purpose="Old purpose", destination="Farg'ona",
            start_date=date(2020, 11, 9), end_date=date(2020, 11, 10), brief_text="Сафарга рухсат.",
            expense_source="Loyiha", stage="approved", status="approved", order_number=number,
            order_year=2020, order_issued_at=old_time, order_pdf_key="qa-old-order",
            order_pdf_sha256=hashlib.sha256(original).hexdigest(),
            order_signer_user_id=actors["chair"].id, created_at=old_time,
            updated_at=old_time, finished_at=old_time,
        ))
        await connection.execute(insert(trip_request_employees).values(
            request_id=request_id, user_id=actors["owner"].id,
        ))
        await _sync_trip_calendar_event(
            connection, await current(connection, request_id), approved=True, now=old_time,
        )
        yield connection, actors, storage, request_id, original, old_time
        await transaction.rollback()
    await engine.dispose()


async def current(connection, request_id):
    return (await connection.execute(select(trip_requests).where(
        trip_requests.c.id == request_id,
    ))).mappings().one()


async def act(fixture, actor, action, **fields):
    connection, actors, storage, request_id, *_ = fixture
    await act_on_order_revision(
        connection, actors[actor], storage, request_id, TripActionRequest(action=action, **fields),
    )


async def prepare(fixture):
    await act(fixture, "owner", "revise_order", comment="Исправить реквизиты приказа")
    await act(fixture, "chair", "approve_revision")


@pytest.mark.parametrize("pending", [False, True])
async def test_hr_registers_approved_order_without_new_signature_or_trip_transition(
    revision_trip, pending,
):
    connection, actors, storage, request_id, original, finished = revision_trip
    if pending:
        await act(revision_trip, "owner", "revise_order", comment="Исправить номер")
    before = dict(await current(connection, request_id))
    event = dict((await connection.execute(select(calendar_events).where(
        calendar_events.c.trip_request_id == request_id,
    ))).mappings().one())
    # A fresh chairman signature is neither required nor read for registration.
    await connection.execute(hiring_signatures.delete().where(
        hiring_signatures.c.user_id == actors["chair"].id,
    ))
    for actor in ["owner", "chair", "outsider", "admin"]:
        with pytest.raises(WorkspaceRepositoryError) as denied:
            await act(revision_trip, actor, "update_order_details",
                      order_number="77", order_series="\u0430/ф")
        assert denied.value.status_code == 403
    allowed = await get_trip_request(connection, actors["hr"], request_id)
    assert "update_order_details" in allowed.allowed_actions
    fields = dict(order_number="77", order_series="\u0430/ф", order_date=date(2020, 11, 8))
    await act(revision_trip, "hr", "update_order_details", **fields)
    row = await current(connection, request_id)
    assert row["status"] == "approved" and row["finished_at"] == finished
    assert row["stage"] == before["stage"] and row["order_revision_stage"] is None
    for key in ["workflow_version", "hr_processing_required", "purpose", "order_purpose",
                "start_date", "end_date", "order_signer_user_id", "resolution_snapshot",
                "resolution_at", "resolved_brief_key"]:
        assert row[key] == before[key]
    assert row["order_number"] == "77" and row["order_manually_registered"]
    assert (await connection.execute(select(calendar_events).where(
        calendar_events.c.id == event["id"],
    ))).mappings().one() == event
    content, _, _ = await read_document(connection, actors["hr"], storage, request_id, "order")
    assert "77-son \u0430/ф" in PdfReader(BytesIO(content)).pages[0].extract_text()
    assert await storage.get("qa-old-order") == original
    audit_count = await connection.scalar(select(func.count()).select_from(
        trip_request_actions,
    ).where(trip_request_actions.c.request_id == request_id))
    await act(revision_trip, "hr", "update_order_details", **fields)
    assert await connection.scalar(select(func.count()).select_from(
        trip_request_actions,
    ).where(trip_request_actions.c.request_id == request_id)) == audit_count
    after = await get_trip_request(connection, actors["hr"], request_id)
    assert after.order_number == "77" and after.has_order_pdf
    assert any(version.number == before["order_number"] for version in after.document_versions)


async def test_hr_registration_keeps_previous_date_if_omitted(revision_trip):
    connection, _, _, request_id, _, finished = revision_trip
    await act(revision_trip, "hr", "update_order_details",
              order_number="77", order_series="\u0430/ф")
    row = await current(connection, request_id)
    assert row["order_issued_at"].date() == finished.date()


async def test_registration_keeps_assigned_hr_during_full_reissue(revision_trip):
    connection, actors, _, request_id, *_ = revision_trip
    await prepare(revision_trip)
    await connection.execute(update(hr_settings).where(hr_settings.c.id == 1).values(
        hr_user_id=actors["replacement"].id,
    ))
    with pytest.raises(WorkspaceRepositoryError) as denied:
        await act(revision_trip, "replacement", "update_order_details",
                  order_number="77", order_series="\u0430/ф")
    assert denied.value.status_code == 403
    await act(revision_trip, "hr", "update_order_details",
              order_number="77", order_series="\u0430/ф")
    assert (await get_trip_request(connection, actors["hr"], request_id)).order_number == "77"


async def test_hr_registration_storage_failure_preserves_pending_revision(
    revision_trip, monkeypatch,
):
    connection, _, storage, request_id, original, _ = revision_trip
    await act(revision_trip, "owner", "revise_order", comment="Исправить номер")
    before = dict(await current(connection, request_id))
    monkeypatch.setattr(storage, "put", AsyncMock(side_effect=ObjectStorageError("unavailable")))
    with pytest.raises(ObjectStorageError):
        async with connection.begin_nested():
            await act(revision_trip, "hr", "update_order_details",
                      order_number="77", order_series="a/f")
    assert dict(await current(connection, request_id)) == before
    assert await storage.get("qa-old-order") == original
    assert await connection.scalar(select(func.count()).select_from(trip_order_registrations).where(
        trip_order_registrations.c.request_id == request_id,
    )) == 0


async def test_hr_registration_retains_each_previous_number(revision_trip):
    connection, _, _, request_id, *_ = revision_trip
    for number in ["77", "78"]:
        await act(revision_trip, "hr", "update_order_details", order_number=number,
                  order_series="A/F", order_date=date(2020, 11, 8))
    other_id = uuid4()
    other_row = dict(await current(connection, request_id))
    other_row.update(id=other_id, order_pdf_key=None, order_pdf_sha256=None,
                     order_number=None, order_year=None)
    await connection.execute(insert(trip_requests).values(**other_row))
    for number in ["77", "78"]:
        with pytest.raises(WorkspaceRepositoryError, match="уже зарегистрированы"):
            await reserve_order_number(connection, other_id, year=2020, number=number, series="a/f")


async def test_legacy_order_gets_real_resolution_then_hr_and_preserves_original(revision_trip):
    connection, actors, storage, request_id, original, finished = revision_trip
    event = dict((await connection.execute(select(calendar_events).where(
        calendar_events.c.trip_request_id == request_id,
    ))).mappings().one())
    attendees = [dict(item) for item in (await connection.execute(
        select(calendar_event_attendees).where(calendar_event_attendees.c.event_id == event["id"]),
    )).mappings().all()]
    before = await get_trip_request(connection, actors["owner"], request_id)
    assert "revise_order" in before.allowed_actions and not before.has_resolution
    await act(revision_trip, "owner", "revise_order", comment="Исправить реквизиты приказа")
    row = await current(connection, request_id)
    assert row["order_revision_stage"] == "chair"
    assert row["order_pdf_key"] == "qa-old-order" and row["finished_at"] == finished
    for actor in ["hr", "outsider", "admin"]:
        with pytest.raises(WorkspaceRepositoryError):
            await act(revision_trip, actor, "approve_revision")
    await act(revision_trip, "chair", "approve_revision")
    content, media, _ = await read_document(
        connection, actors["hr"], storage, request_id, "revision-brief",
    )
    assert media == "application/pdf"
    page = PdfReader(BytesIO(content)).pages[0]
    assert "Буйруқ учун" in page.extract_text() and len(page.images) == 2
    row = await current(connection, request_id)
    assert row["order_pdf_key"] == "qa-old-order" and not row["resolved_brief_key"]
    # Settings changes do not transfer the HR decision that was already assigned.
    await connection.execute(update(hr_settings).where(hr_settings.c.id == 1).values(
        hr_user_id=actors["replacement"].id,
    ))
    fields = dict(order_number="77", order_series="a/f", order_purpose="Новая цель",
                  order_date=date(2020, 11, 8))
    with pytest.raises(WorkspaceRepositoryError):
        await act(revision_trip, "replacement", "complete_revision", **fields)
    await act(revision_trip, "hr", "complete_revision", **fields)
    result = await get_trip_request(connection, actors["hr"], request_id)
    assert result.stage == "approved" and result.status == "approved"
    assert result.finished_at == finished and result.order_revision_stage is None
    assert result.has_resolution and result.order_number == "77"
    assert not result.hr_processing_required and result.order_manually_registered
    assert result.workflow_version == before.workflow_version
    assert result.order_issued_at.astimezone(finished.tzinfo).date() == date(2020, 11, 7)
    new_order, _, _ = await read_document(connection, actors["hr"], storage, request_id, "order")
    saved_resolution, _, _ = await read_document(
        connection, actors["hr"], storage, request_id, "brief",
    )
    assert saved_resolution == content
    assert "Новая цель" in PdfReader(BytesIO(new_order)).pages[0].extract_text()
    versions = result.document_versions
    assert len([version for version in versions if version.kind == "order"]) == 2
    originals = []
    for version in versions:
        data, _, _ = await read_document(
            connection, actors["owner"], storage, request_id, "archived",
            revision_id=UUID(version.id),
        )
        originals.append(data)
    assert original in originals
    count = await connection.scalar(select(func.count()).select_from(trip_document_revisions))
    await act(revision_trip, "hr", "complete_revision", **fields)
    after = await connection.scalar(select(func.count()).select_from(trip_document_revisions))
    assert after == count
    history = (await connection.execute(select(trip_request_actions).where(
        trip_request_actions.c.request_id == request_id,
    ).order_by(trip_request_actions.c.created_at))).mappings().all()
    assert [row["action"] for row in history] == [
        "revise_order", "approve_revision", "complete_revision",
    ]
    assert all(row["from_stage"] == row["to_stage"] == "approved" for row in history)
    assert dict((await connection.execute(select(calendar_events).where(
        calendar_events.c.trip_request_id == request_id,
    ))).mappings().one()) == event
    assert [dict(item) for item in (await connection.execute(select(calendar_event_attendees).where(
        calendar_event_attendees.c.event_id == event["id"],
    ))).mappings().all()] == attendees


async def test_cancelling_after_resolution_keeps_the_current_order(revision_trip):
    connection, actors, _, request_id, _, finished = revision_trip
    await prepare(revision_trip)
    await act(revision_trip, "owner", "cancel_revision", comment="Реквизиты уже верны")
    row = await current(connection, request_id)
    assert row["order_revision_stage"] is None and row["status"] == "approved"
    assert row["order_pdf_key"] == "qa-old-order" and row["finished_at"] == finished
    assert not row["hr_processing_required"] and not row["resolved_brief_key"]
    with pytest.raises(WorkspaceRepositoryError):
        await act(revision_trip, "hr", "complete_revision", order_number="77", order_series="a/f")
    result = await get_trip_request(connection, actors["owner"], request_id)
    assert "revise_order" in result.allowed_actions


async def test_missing_hr_configuration_keeps_the_revision_with_the_chair(revision_trip):
    connection, _, _, request_id, _, _ = revision_trip
    await act(revision_trip, "owner", "revise_order", comment="Исправить реквизиты")
    await connection.execute(update(hr_settings).where(hr_settings.c.id == 1).values(
        hr_user_id=None,
    ))
    with pytest.raises(WorkspaceRepositoryError, match="кадровика"):
        await act(revision_trip, "chair", "approve_revision")
    row = await current(connection, request_id)
    assert row["order_revision_stage"] == "chair" and row["order_pdf_key"] == "qa-old-order"


async def test_signed_image_source_remains_downloadable_as_an_original(revision_trip):
    connection, actors, storage, request_id, _, finished = revision_trip
    source = signature()
    digest = hashlib.sha256(source).hexdigest()
    await storage.put("qa-original-image", source, "image/png")
    await connection.execute(update(trip_requests).where(trip_requests.c.id == request_id).values(
        brief_attachment_key="qa-original-image", brief_attachment_sha256=digest,
        brief_attachment_name="original.png", brief_attachment_type="image/png",
        brief_attachment_size=len(source), original_signature_confirmed_at=finished,
        signed_brief_key="qa-original-image", signed_brief_sha256=digest,
    ))
    await prepare(revision_trip)
    await act(revision_trip, "hr", "complete_revision", order_number="77", order_series="a/f")
    content, media, name = await read_document(
        connection, actors["owner"], storage, request_id, "attachment",
    )
    assert content == source and media == "image/png" and name == "original.png"
    result = await get_trip_request(connection, actors["owner"], request_id)
    assert all(version.kind != "brief" for version in result.document_versions)


async def test_storage_failure_rolls_back_new_registration_and_keeps_pending_order(
    revision_trip, monkeypatch,
):
    connection, _, storage, request_id, _, _ = revision_trip
    await prepare(revision_trip)
    monkeypatch.setattr(storage, "put", AsyncMock(side_effect=ObjectStorageError("unavailable")))
    with pytest.raises(ObjectStorageError):
        async with connection.begin_nested():
            await act(revision_trip, "hr", "complete_revision",
                      order_number="77", order_series="a/f")
    row = await current(connection, request_id)
    assert row["order_revision_stage"] == "hr" and row["order_pdf_key"] == "qa-old-order"
    assert await connection.scalar(select(func.count()).select_from(trip_order_registrations).where(
        trip_order_registrations.c.request_id == request_id,
    )) == 0


async def test_archived_manual_numbers_cannot_be_reused_by_another_trip(revision_trip):
    connection, _, _, request_id, _, _ = revision_trip
    for number in ["77", "78"]:
        await prepare(revision_trip)
        await act(revision_trip, "hr", "complete_revision", order_number=number,
                  order_series="A/F", order_date=date(2020, 11, 8))
    other_id = uuid4()
    row = dict(await current(connection, request_id))
    row.update(id=other_id, order_pdf_key=None, order_pdf_sha256=None,
               order_number=None, order_year=None)
    await connection.execute(insert(trip_requests).values(**row))
    for number in ["77", "78"]:
        with pytest.raises(WorkspaceRepositoryError, match="уже зарегистрированы"):
            await reserve_order_number(connection, other_id, year=2020, number=number, series="a/f")
    assert (await current(connection, request_id))["order_number"] == "78"


async def test_outsider_cannot_request_or_read_other_trips_versions(revision_trip):
    connection, actors, storage, request_id, _, _ = revision_trip
    with pytest.raises(WorkspaceRepositoryError):
        await act(revision_trip, "outsider", "revise_order", comment="Try")
    await prepare(revision_trip)
    result = await get_trip_request(connection, actors["owner"], request_id)
    version_id = UUID(result.document_versions[0].id)
    with pytest.raises(WorkspaceRepositoryError):
        await read_document(connection, actors["outsider"], storage, request_id,
                            "archived", revision_id=version_id)
    with pytest.raises(WorkspaceRepositoryError):
        await read_document(connection, actors["owner"], storage, request_id,
                            "archived", revision_id=uuid4())
    other_id, other_version = uuid4(), uuid4()
    row = dict(await current(connection, request_id))
    row.update(id=other_id, order_pdf_key=None, order_number=None, order_year=None)
    await connection.execute(insert(trip_requests).values(**row))
    await connection.execute(insert(trip_document_revisions).values(
        id=other_version, request_id=other_id, actor_user_id=actors["owner"].id, kind="order",
        storage_key="qa-old-order", sha256=hashlib.sha256(revision_trip[4]).hexdigest(),
        facts={}, created_at=datetime.now(UTC),
    ))
    with pytest.raises(WorkspaceRepositoryError):
        await read_document(connection, actors["owner"], storage, request_id,
                            "archived", revision_id=other_version)


async def test_simultaneous_registrations_have_only_one_owner():
    engine = create_async_engine(database_url())
    owner, first, second = uuid4(), uuid4(), uuid4()
    number = f"race-{uuid4().hex[:12]}"
    try:
        async with engine.begin() as connection:
            now = datetime.now(UTC)
            await connection.execute(insert(users).values(
                id=owner, username=f"race-{owner.hex}", full_name="Synthetic race", role="employee",
                status="active", created_at=now, updated_at=now,
            ))
            for request_id in [first, second]:
                await connection.execute(insert(trip_requests).values(
                    id=request_id, requester_user_id=owner, purpose="QA", destination="QA",
                    start_date=date(2030, 1, 1), end_date=date(2030, 1, 2),
                    created_at=now, updated_at=now,
                ))

        async def register(request_id):
            try:
                async with engine.begin() as connection:
                    await reserve_order_number(connection, request_id, year=2030,
                                               number=number, series="qa")
                return "registered"
            except WorkspaceRepositoryError:
                return "conflict"

        results = await asyncio.wait_for(
            asyncio.gather(register(first), register(second)), timeout=10,
        )
        assert sorted(results) == ["conflict", "registered"]
    finally:
        async with engine.begin() as connection:
            await connection.execute(trip_order_registrations.delete().where(
                trip_order_registrations.c.request_id.in_([first, second]),
            ))
            await connection.execute(trip_requests.delete().where(
                trip_requests.c.id.in_([first, second]),
            ))
            await connection.execute(users.delete().where(users.c.id == owner))
        await engine.dispose()
