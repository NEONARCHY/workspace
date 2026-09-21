from datetime import UTC, datetime
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
from fastapi import HTTPException

from yuksalish_api.auth import AuthenticatedUser
from yuksalish_api.hr_schemas import (
    HrProfileCreate,
    HrProfileImport,
    HrProfileImportResponse,
    HrProfileResponse,
    HrProfileWrite,
    HrRegisterAction,
    HrRegisterResponse,
    HrSettingsResponse,
    HrSettingsWrite,
    HrTerminationWrite,
)
from yuksalish_api.hr_service import HrError
from yuksalish_api.routers import hr


@pytest.fixture
def actor() -> AuthenticatedUser:
    return AuthenticatedUser(
        id=uuid4(),
        username="hr-admin",
        full_name="HR Admin",
        position_id=None,
        job_title=None,
        role="superadmin",
    )


def profile(actor: AuthenticatedUser) -> HrProfileResponse:
    return HrProfileResponse(
        id=uuid4(),
        user_id=actor.id,
        full_name=actor.full_name,
        employment_date=datetime(2024, 1, 1, tzinfo=UTC).date(),
        service_anchor_date=datetime(2026, 8, 31, tzinfo=UTC).date(),
        service_years=5,
        service_months=0,
        service_days=0,
        allowance_percent=30,
        employment_status="active",
        hidden_after_year=False,
        updated_at=datetime.now(UTC),
    )


@pytest.mark.anyio
async def test_hr_router_delegates_every_authorized_action(
    monkeypatch: pytest.MonkeyPatch, actor: AuthenticatedUser
) -> None:
    connection = object()
    item = profile(actor)
    register = HrRegisterResponse(
        id=uuid4(),
        period="2026-09",
        version=1,
        status="draft",
        created_at=datetime.now(UTC),
    )
    overview = hr.HrOverviewResponse(settings=HrSettingsResponse(), profiles=[item])
    monkeypatch.setattr(hr, "load_overview", AsyncMock(return_value=overview))
    monkeypatch.setattr(hr, "save_settings", AsyncMock(return_value=overview.settings))
    monkeypatch.setattr(hr, "save_profile", AsyncMock(return_value=item))
    monkeypatch.setattr(hr, "create_profile", AsyncMock(return_value=item))
    monkeypatch.setattr(
        hr,
        "import_profiles",
        AsyncMock(return_value=HrProfileImportResponse(created=1, already_imported=0)),
    )
    monkeypatch.setattr(hr, "terminate_profile", AsyncMock(return_value=item))
    monkeypatch.setattr(hr, "history", AsyncMock(return_value=[]))
    monkeypatch.setattr(hr, "generate_register", AsyncMock(return_value=register))
    monkeypatch.setattr(hr, "act_register", AsyncMock(return_value=register))

    assert await hr.get_hr(actor, connection) == overview
    assert await hr.put_settings(HrSettingsWrite(), actor, connection) == overview.settings
    write = HrProfileWrite(
        employment_date=datetime(2024, 1, 1, tzinfo=UTC).date(),
        service_anchor_date=datetime(2026, 8, 31, tzinfo=UTC).date(),
        service_years=5,
        service_months=0,
        service_days=0,
        service_reason="Подтверждено трудовой книжкой",
    )
    assert await hr.put_profile(actor.id, write, actor, connection) == item
    create = HrProfileCreate(
        full_name="Новый сотрудник", job_title="Специалист", **write.model_dump()
    )
    assert await hr.post_profile(create, actor, connection) == item
    imported = HrProfileImport(
        source_label="2026.xlsx:сентябрь", rows=[create.model_dump() | {"source_row": 13}]
    )
    assert await hr.post_profile_import(imported, actor, connection) == HrProfileImportResponse(
        created=1, already_imported=0
    )
    termination = HrTerminationWrite(
        terminated_on=datetime(2026, 9, 30, tzinfo=UTC).date(),
        termination_reason="Трудовой договор прекращён",
    )
    assert await hr.post_termination(item.id, termination, actor, connection) == item
    assert await hr.get_history(item.id, actor, connection) == []
    assert await hr.post_generate("2026-09", actor, connection) == register
    assert (
        await hr.post_action(register.id, HrRegisterAction(action="submit"), actor, connection)
        == register
    )


@pytest.mark.anyio
async def test_hr_router_returns_service_error_as_http_error(
    monkeypatch: pytest.MonkeyPatch, actor: AuthenticatedUser
) -> None:
    monkeypatch.setattr(hr, "load_overview", AsyncMock(side_effect=HrError(403, "Нет доступа")))

    with pytest.raises(HTTPException) as raised:
        await hr.get_hr(actor, object())

    assert raised.value.status_code == 403
    assert raised.value.detail == "Нет доступа"
