"""Isolated PostgreSQL regression for the employee → HR → deputy leave route."""

# Synthetic Cyrillic document names and Russian error messages are intentional.
# ruff: noqa: RUF001

import os
from datetime import UTC, datetime, timedelta
from io import BytesIO
from uuid import UUID, uuid4

import pytest
from PIL import Image, ImageDraw
from pypdf import PdfReader
from sqlalchemy import insert, select
from sqlalchemy.ext.asyncio import create_async_engine

from yuksalish_api.absence_service import presence_summary
from yuksalish_api.auth import AuthenticatedUser
from yuksalish_api.leave_service import (
    LeaveError,
    create_leave,
    preview_hr_order,
    read_leave_document,
    review_deputy,
    review_hr,
    revise_leave,
    save_deputy_signature,
    save_tenure_rules,
    visible_leaves,
    withdraw_leave,
)
from yuksalish_api.object_storage import InMemoryObjectStorage
from yuksalish_api.tables import (
    hr_employee_profiles,
    hr_settings,
    leave_request_actions,
    positions,
    users,
)
from yuksalish_api.workspace_schemas import (
    LeaveDeputyDecisionRequest,
    LeaveHrDecisionRequest,
    LeaveTenureRule,
    LeaveTenureRulesWrite,
    LeaveWriteRequest,
)


def _signature() -> bytes:
    image = Image.new("RGBA", (320, 100), (0, 0, 0, 0))
    ImageDraw.Draw(image).line([(12, 72), (95, 12), (180, 72), (300, 28)], fill="blue", width=4)
    output = BytesIO()
    image.save(output, "PNG")
    return output.getvalue()


@pytest.mark.anyio
@pytest.mark.postgres
async def test_leave_is_authorized_audited_and_signed_only_after_deputy() -> None:
    url = os.environ.get("YUKSALISH_TEST_DATABASE_URL", "")
    if not url:
        pytest.skip("Isolated PostgreSQL not configured")
    if "test" not in url.rsplit("/", 1)[-1]:
        raise RuntimeError("Leave workflow test refuses a non-test database")
    engine = create_async_engine(url)
    storage = InMemoryObjectStorage()
    try:
        async with engine.connect() as connection:
            transaction = await connection.begin()
            try:
                position_id = await connection.scalar(
                    select(positions.c.id)
                    .where(
                        positions.c.name.ilike("Rais birinchi%"),
                    )
                    .limit(1)
                )
                assert position_id is not None
                actors: dict[str, AuthenticatedUser] = {}
                for role, name in (
                    ("employee", "Тестова Зебо"),
                    ("hr", "Кадровик Тест"),
                    ("deputy", "Тестов Али"),
                    ("other", "Посторонний Тест"),
                ):
                    user_id = uuid4()
                    user_role = "employee"
                    await connection.execute(
                        insert(users).values(
                            id=user_id,
                            username=f"leaveqa-{user_id.hex[:10]}",
                            full_name=name,
                            job_title="Chief specialist" if role == "employee" else None,
                            role=user_role,
                            status="active",
                            position_id=position_id if role == "deputy" else None,
                            created_at=datetime.now(UTC),
                            updated_at=datetime.now(UTC),
                        )
                    )
                    actors[role] = AuthenticatedUser(
                        id=user_id,
                        username=role,
                        full_name=name,
                        role=user_role,
                        position_id=position_id if role == "deputy" else None,
                        job_title="Chief specialist" if role == "employee" else None,
                    )
                await connection.execute(
                    insert(hr_settings).values(
                        id=1,
                        hr_user_id=actors["hr"].id,
                        chair_user_id=actors["other"].id,
                        updated_by_user_id=actors["hr"].id,
                        updated_at=datetime.now(UTC),
                    )
                )
                start = datetime.now(UTC).date() + timedelta(days=30)
                end = start + timedelta(days=20)
                await connection.execute(insert(hr_employee_profiles).values(
                    id=uuid4(), user_id=actors["employee"].id, full_name="Тестова Зебо",
                    employment_date=start.replace(year=start.year - 6),
                    employment_status="active", created_at=datetime.now(UTC),
                    updated_at=datetime.now(UTC),
                ))
                created = await create_leave(
                    connection,
                    actors["employee"],
                    storage,
                    LeaveWriteRequest(
                        application_text="Менга меҳнат таътили беришингизни сўрайман.",
                        starts_on=start,
                    ),
                )
                request_id = UUID(created.id)
                assert created.status == "pending_hr" and created.can_revise
                corrected = await revise_leave(
                    connection, actors["hr"], storage, request_id,
                    LeaveWriteRequest(
                        application_text="Уточнённое заявление кадровика.", starts_on=start
                    ),
                )
                assert corrected.application_text == "Уточнённое заявление кадровика."
                assert corrected.actions[-1].action == "hr_corrected"
                corrected_pdf = await read_leave_document(
                    connection, actors["hr"], storage, request_id, "application"
                )
                corrected_text = PdfReader(BytesIO(corrected_pdf)).pages[0].extract_text()
                assert "Тестова Зебо" in corrected_text
                assert "Кадрлар хизмати томонидан" in corrected_text
                rules = LeaveTenureRulesWrite(rules=[
                    LeaveTenureRule(after_years=5, extra_days=2),
                    LeaveTenureRule(after_years=10, extra_days=4),
                ])
                with pytest.raises(LeaveError) as unauthorized_rules:
                    await save_tenure_rules(connection, actors["other"], rules)
                assert unauthorized_rules.value.status_code == 403
                saved_rules = await save_tenure_rules(connection, actors["hr"], rules)
                assert saved_rules.tenure_rules == rules.rules
                assert len(await visible_leaves(connection, actors["other"])) == 0
                with pytest.raises(LeaveError) as forbidden:
                    await review_hr(
                        connection,
                        actors["other"],
                        request_id,
                        LeaveHrDecisionRequest(action="reject", comment="Нет"),
                    )
                assert forbidden.value.status_code == 403
                approval_payload = LeaveHrDecisionRequest(
                        action="approve",
                        starts_on=start,
                        ends_on=end,
                        work_year_starts_on=start - timedelta(days=365),
                        work_year_ends_on=start - timedelta(days=1),
                        calendar_days=21,
                        paid_days=18,
                        tenure_additional_days=2,
                        return_on=end + timedelta(days=1),
                        order_employee_name="Тестова Зебо",
                        order_job_title="бош мутахассис",
                        order_signer_name="Тестов Али",
                        order_number="10",
                        accounting_officer="Тестов Бек",
                        order_clause_2="Ишга чиқиш санаси алоҳида белгилансин.",
                )
                with pytest.raises(LeaveError) as invalid_tenure:
                    await review_hr(
                        connection, actors["hr"], request_id,
                        approval_payload.model_copy(update={"tenure_additional_days": 4}),
                    )
                assert invalid_tenure.value.status_code == 422
                with pytest.raises(LeaveError) as forbidden_preview:
                    await preview_hr_order(
                        connection, actors["other"], request_id, approval_payload
                    )
                assert forbidden_preview.value.status_code == 403
                draft = await preview_hr_order(
                    connection, actors["hr"], request_id, approval_payload
                )
                assert "алоҳида" in PdfReader(BytesIO(draft)).pages[0].extract_text()
                reviewed = await review_hr(
                    connection,
                    actors["hr"],
                    request_id,
                    approval_payload,
                )
                assert reviewed.status == "pending_deputy"
                assert reviewed.tenure_additional_days == 2
                preview = await read_leave_document(
                    connection, actors["employee"], storage, request_id, "order-preview"
                )
                assert len(PdfReader(BytesIO(preview)).pages[0].images) == 1
                assert (
                    "ташкилотдаги иш стажи учун 2 кун"
                    in PdfReader(BytesIO(preview)).pages[0].extract_text()
                )
                with pytest.raises(LeaveError) as unsigned:
                    await review_deputy(
                        connection,
                        actors["deputy"],
                        storage,
                        request_id,
                        LeaveDeputyDecisionRequest(action="approve"),
                    )
                assert unsigned.value.status_code == 409
                await save_deputy_signature(connection, actors["deputy"], storage, _signature())
                with pytest.raises(LeaveError) as forbidden_deputy:
                    await review_deputy(
                        connection,
                        actors["other"],
                        storage,
                        request_id,
                        LeaveDeputyDecisionRequest(action="approve"),
                    )
                assert forbidden_deputy.value.status_code == 403
                approved = await review_deputy(
                    connection,
                    actors["deputy"],
                    storage,
                    request_id,
                    LeaveDeputyDecisionRequest(action="approve"),
                )
                assert approved.status == "approved" and approved.order_number == "10"
                order = await read_leave_document(
                    connection, actors["employee"], storage, request_id, "order"
                )
                assert len(PdfReader(BytesIO(order)).pages[0].images) == 2
                history = (
                    (
                        await connection.execute(
                            select(leave_request_actions).where(
                                leave_request_actions.c.request_id == request_id
                            )
                        )
                    )
                    .mappings()
                    .all()
                )
                assert [row["action"] for row in history] == [
                    "created",
                    "hr_approved",
                    "deputy_approved",
                ]
                summary = await presence_summary(connection, allow_admin=True)
                assert any(item.user_id == str(actors["employee"].id) for item in summary)

                with pytest.raises(LeaveError) as hidden_document:
                    await read_leave_document(
                        connection, actors["other"], storage, request_id, "order"
                    )
                assert hidden_document.value.status_code == 404
                with pytest.raises(LeaveError) as replay:
                    await review_deputy(
                        connection,
                        actors["deputy"],
                        storage,
                        request_id,
                        LeaveDeputyDecisionRequest(action="approve"),
                    )
                assert replay.value.status_code == 409
                with pytest.raises(LeaveError) as overlap:
                    await create_leave(
                        connection,
                        actors["employee"],
                        storage,
                        LeaveWriteRequest(application_text="Иккинчи ариза", starts_on=start),
                    )
                assert overlap.value.status_code == 409

                next_start = end + timedelta(days=30)
                second = await create_leave(
                    connection,
                    actors["employee"],
                    storage,
                    LeaveWriteRequest(
                        application_text="Янги ариза",
                        starts_on=next_start,
                    ),
                )
                second_id = UUID(second.id)
                with pytest.raises(LeaveError) as missing_reason:
                    await review_hr(
                        connection,
                        actors["hr"],
                        second_id,
                        LeaveHrDecisionRequest(action="return"),
                    )
                assert missing_reason.value.status_code == 422
                returned = await review_hr(
                    connection,
                    actors["hr"],
                    second_id,
                    LeaveHrDecisionRequest(action="return", comment="Уточните дату"),
                )
                assert returned.status == "needs_revision" and not returned.can_revise
                assert (await visible_leaves(connection, actors["employee"]))[0].can_revise
                revised = await revise_leave(
                    connection,
                    actors["employee"],
                    storage,
                    second_id,
                    LeaveWriteRequest(
                        application_text="Тузатилган ариза",
                        starts_on=next_start + timedelta(days=1),
                    ),
                )
                assert revised.status == "pending_hr"
                withdrawn = await withdraw_leave(connection, actors["employee"], second_id)
                assert withdrawn.status == "withdrawn" and not withdrawn.can_withdraw
                assert [entry.action for entry in withdrawn.actions] == [
                    "created",
                    "returned",
                    "revised",
                    "withdrawn",
                ]
            finally:
                await transaction.rollback()
    finally:
        await engine.dispose()
