"""HTTP limits, authenticated assets and failure behavior without live credentials."""

from datetime import UTC, date, datetime
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import AsyncConnection

from yuksalish_api.access_control import request_module_action
from yuksalish_api.auth import AuthenticatedUser, require_user
from yuksalish_api.database import get_connection
from yuksalish_api.monthly_report_schemas import (
    MonthlyCycle,
    MonthlyOverview,
    MonthlyReport,
    MonthlySubmission,
)
from yuksalish_api.object_storage import InMemoryObjectStorage, ObjectStorageError
from yuksalish_api.routers import monthly_reports as endpoint


@pytest.fixture
def monthly_api(monkeypatch):
    user = AuthenticatedUser(
        id=uuid4(),
        username="monthly-qa",
        full_name="Monthly QA",
        position_id=None,
        job_title=None,
        role="employee",
    )
    connection = AsyncMock(spec=AsyncConnection)
    payload = MonthlySubmission(id=uuid4(), month=date(2026, 11, 1))
    report = MonthlyReport(
        id=str(payload.id),
        month=payload.month,
        user_id=str(user.id),
        revision=1,
        comment="",
        submitted_at=datetime.now(UTC),
        files=[],
    )
    app = FastAPI()
    app.include_router(endpoint.router)
    app.state.object_storage = InMemoryObjectStorage()
    app.state.event_bus = SimpleNamespace(publish=AsyncMock())
    app.dependency_overrides[require_user] = lambda: user

    async def connected():
        yield connection

    app.dependency_overrides[get_connection] = connected
    guard = AsyncMock()
    submit = AsyncMock(return_value=report)
    monkeypatch.setattr(endpoint, "ensure_module_action", guard)
    monkeypatch.setattr(endpoint, "submit", submit)
    with TestClient(app) as client:
        yield client, payload, submit, guard, app, connection


def test_upload_parses_all_files_without_changing_month_or_comment(monthly_api):
    client, payload, submit, _, app, _ = monthly_api
    response = client.post(
        "/monthly-reports/submit",
        data={"payload": payload.model_dump_json(by_alias=True)},
        files=[
            ("files", ("report.docx", b"report", "application/octet-stream")),
            ("files", ("results.pdf", b"results", "application/pdf")),
        ],
    )
    assert response.status_code == 201
    assert submit.call_args.args[2] == payload
    assert [f.content for f in submit.call_args.args[3]] == [b"report", b"results"]
    app.state.event_bus.publish.assert_awaited_once()


def test_failed_storage_does_not_publish_success_and_invalid_metadata_does_not_submit(monthly_api):
    client, payload, submit, _, app, _ = monthly_api
    response = client.post(
        "/monthly-reports/submit",
        data={"payload": "invalid"},
        files={"files": ("a.docx", b"report")},
    )
    assert response.status_code == 422
    submit.assert_not_awaited()
    submit.side_effect = ObjectStorageError("synthetic outage")
    response = client.post(
        "/monthly-reports/submit",
        data={"payload": payload.model_dump_json()},
        files={"files": ("a.docx", b"report")},
    )
    assert response.status_code == 503
    app.state.event_bus.publish.assert_not_awaited()


def test_template_is_the_original_docx_and_requires_module_access(monthly_api):
    client, _, _, guard, _, _ = monthly_api
    response = client.get("/monthly-reports/template")
    assert response.status_code == 200
    template = (
        Path(endpoint.__file__).resolve().parents[1] / "hr_assets/monthly-report-template.docx"
    )
    assert response.content == template.read_bytes()
    assert response.headers["cache-control"] == "no-store"
    guard.side_effect = HTTPException(403, "Module denied")
    assert client.get("/monthly-reports/template").status_code == 403


def test_payroll_commits_before_publishing_and_denial_does_neither(monthly_api, monkeypatch):
    client, payload, _, _, app, connection = monthly_api
    order = []
    connection.commit.side_effect = lambda: order.append("commit")
    app.state.event_bus.publish.side_effect = lambda *_: order.append("publish")
    decide = AsyncMock(
        return_value=MonthlyCycle(
            month=payload.month,
            reminder_on=payload.month,
            total=1,
            submitted=0,
            comment="",
            members=[],
        )
    )
    monkeypatch.setattr(endpoint, "authorize", decide)
    assert client.post("/monthly-reports/2026-11-01/authorize", json={}).status_code == 200
    assert order == ["commit", "publish"]
    order.clear()
    decide.side_effect = HTTPException(403, "Not the first deputy")
    assert client.post("/monthly-reports/2026-11-01/authorize", json={}).status_code == 403
    assert not order


def test_module_actions_cover_direct_requests():
    assert request_module_action("/api/v1/monthly-reports", "GET") == ("ai_monthly_reports", "view")
    assert request_module_action("/api/v1/monthly-reports/submit", "POST") == (
        "ai_monthly_reports",
        "create",
    )
    assert request_module_action("/api/v1/monthly-reports/2026-11-01/authorize", "POST") == (
        "ai_monthly_reports",
        "approve",
    )
    assert request_module_action("/api/v1/monthly-reports/calendar/days", "PUT") == (
        "ai_monthly_reports",
        "admin",
    )


def test_first_overview_commits_materialized_roster_before_http_success(monthly_api, monkeypatch):
    client, _, _, _, _, connection = monthly_api
    monkeypatch.setattr(
        endpoint,
        "overview",
        AsyncMock(
            return_value=MonthlyOverview(
                today=date(2026, 11, 25),
                active_month=None,
                dashboard_visible=False,
                can_review=False,
                can_authorize=False,
                can_configure=False,
                reminder_month=None,
                cycles=[],
                reports=[],
            )
        ),
    )
    assert client.get("/monthly-reports").status_code == 200
    connection.commit.assert_awaited_once()
    connection.commit.side_effect = RuntimeError("synthetic commit failure")
    with pytest.raises(RuntimeError, match="synthetic commit failure"):
        client.get("/monthly-reports")


def test_calendar_commit_failure_cannot_report_http_success(monthly_api, monkeypatch):
    client, _, _, _, _, connection = monthly_api
    monkeypatch.setattr(endpoint, "save_calendar", AsyncMock())
    payload = {"day": "2026-11-27", "working": False, "note": "Organization holiday"}
    assert client.put("/monthly-reports/calendar/days", json=payload).status_code == 204
    connection.commit.assert_awaited_once()
    connection.commit.side_effect = RuntimeError("synthetic commit failure")
    with pytest.raises(RuntimeError, match="synthetic commit failure"):
        client.put("/monthly-reports/calendar/days", json=payload)
