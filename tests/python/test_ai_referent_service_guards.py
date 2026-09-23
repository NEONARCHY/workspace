"""Deterministic service guard tests complement real PostgreSQL/HTTP integration."""

from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock
from uuid import uuid4

import pytest
from fastapi import HTTPException
from sqlalchemy.dialects import postgresql
from sqlalchemy.sql import Insert, Select, Update

from yuksalish_api import ai_referent_configuration_service as configuration
from yuksalish_api import ai_referent_service as letters
from yuksalish_api.ai_referent_configuration_schemas import (
    ReviewerConfigurationResponse,
    ReviewerConfigurationUpdate,
    ReviewerRuntimeAcknowledgement,
)
from yuksalish_api.ai_referent_schemas import AIReferentActionRequest
from yuksalish_api.auth import AuthenticatedUser


@pytest.fixture
def anyio_backend():
    return "asyncio"


def actor(role="employee"):
    return AuthenticatedUser(
        id=uuid4(),
        username="account",
        full_name="Account",
        position_id=None,
        job_title="Director",
        role=role,
    )


def mapped(value):
    result = Mock()
    result.mappings.return_value.one.return_value = value
    result.mappings.return_value.one_or_none.return_value = value
    result.mappings.return_value.all.return_value = value
    return result


@pytest.mark.anyio
async def test_configuration_read_applies_account_and_explicit_module_denials(monkeypatch):
    now = datetime.now(UTC)
    rows = [
        {
            "key": key,
            "label": key,
            "suggested_username": key,
            "user_id": uuid4(),
            "username": key,
            "full_name": key,
            "telegram_id": str(index + 1),
            "account_status": "active",
            "role": "employee",
            "position_id": None,
            "department_id": None,
            "enabled": True,
        }
        for index, key in enumerate(("askar", "bobur", "umid", "davronbek"))
    ]
    rows[2]["account_status"] = "blocked"
    rows[3]["enabled"] = False
    connection = SimpleNamespace(
        execute=AsyncMock(
            side_effect=[
                mapped({"revision": 7, "updated_at": now}),
                mapped(rows),
                mapped(
                    [
                        {
                            "agent_id": "test",
                            "display_name": "Robot",
                            "configuration_revision": 6,
                            "configuration_applied_at": now,
                            "configuration_error": None,
                            "last_seen_at": now,
                        }
                    ]
                ),
            ]
        )
    )
    permissions = AsyncMock(
        side_effect=[{"ai_referent": {"approve": True}}, {"ai_referent": {"approve": False}}]
    )
    monkeypatch.setattr(configuration, "module_permissions_for_user", permissions)
    result = await configuration.read_configuration(connection)
    assert [row.can_approve for row in result.reviewers] == [True, False, False, False]
    assert result.runtimes[0].applied_revision == 6
    assert permissions.await_count == 2
    assert "FOR SHARE" in str(
        connection.execute.call_args_list[0]
        .args[0]
        .compile(
            dialect=postgresql.dialect(),
        )
    )


@pytest.mark.anyio
async def test_configuration_save_changes_current_assignment_not_decision(monkeypatch):
    admin = actor("admin")
    next_user = uuid4()
    pending = {
        "id": uuid4(),
        "revision": 4,
        "reviewer_key": "askar",
        "reviewer_user_id": uuid4(),
        "status": "approved",
    }
    statements = []

    async def execute(statement):
        statements.append(statement)
        if isinstance(statement, Select):
            table = statement.get_final_froms()[0].name
            if table == "ai_referent_configuration":
                return mapped({"revision": 2})
            if table == "core_users":
                return mapped({"id": next_user})
            if table == "ai_referent_letters":
                key = statement.compile().params.get("reviewer_key_1")
                if key is None:
                    return mapped(pending)
                return mapped(
                    [pending, {**pending, "reviewer_user_id": next_user}] if key == "askar" else []
                )
        return mapped([])

    snapshot = ReviewerConfigurationResponse(revision=2, updatedAt=datetime.now(UTC), reviewers=[])
    monkeypatch.setattr(configuration, "read_configuration", AsyncMock(return_value=snapshot))
    monkeypatch.setattr(configuration, "notify_letter", AsyncMock())
    payload = ReviewerConfigurationUpdate(
        expectedRevision=2,
        reviewers=[
            {
                "key": key,
                "username": "new_account" if key == "askar" else "",
                "enabled": key == "askar",
            }
            for key in ("askar", "bobur", "umid", "davronbek")
        ],
    )
    await configuration.save_configuration(SimpleNamespace(execute=execute), admin, payload)
    updates = [
        statement.compile().params
        for statement in statements
        if isinstance(statement, Update)
        and statement.table.name == "ai_referent_letters"
        and "reviewer_user_id" in statement.compile().params
    ]
    assert len(updates) == 1
    assert updates[0]["reviewer_user_id"] == next_user
    assert updates[0]["revision"] == 5
    assert "status" not in updates[0]  # No rollback of an accepted decision.
    events = [
        statement.compile().params
        for statement in statements
        if isinstance(statement, Insert) and statement.table.name == "ai_referent_events"
    ]
    assert events[0]["from_status"] == events[0]["to_status"] == "approved"
    audits = [
        statement.compile().params
        for statement in statements
        if isinstance(statement, Insert) and statement.table.name == "core_audit_events"
    ]
    assert audits[0]["target_id"] == configuration._CONFIGURATION_AUDIT_ID
    assert audits[0]["actor_user_id"] == admin.id


@pytest.mark.anyio
async def test_configuration_conflicts_and_unknown_accounts_do_not_write(monkeypatch):
    payload = ReviewerConfigurationUpdate(
        expectedRevision=2,
        reviewers=[
            {"key": key, "username": "unknown" if key == "askar" else "", "enabled": key == "askar"}
            for key in ("askar", "bobur", "umid", "davronbek")
        ],
    )
    connection = SimpleNamespace(execute=AsyncMock(return_value=mapped({"revision": 3})))
    with pytest.raises(HTTPException) as stale:
        await configuration.save_configuration(connection, actor("admin"), payload)
    assert stale.value.status_code == 409
    assert connection.execute.await_count == 1
    monkeypatch.setattr(configuration, "read_configuration", AsyncMock())
    connection.execute = AsyncMock(side_effect=[mapped({"revision": 2}), mapped(None)])
    with pytest.raises(HTTPException) as invalid:
        await configuration.save_configuration(connection, actor("admin"), payload)
    assert invalid.value.status_code == 422
    assert all(isinstance(call.args[0], Select) for call in connection.execute.call_args_list)


@pytest.mark.anyio
async def test_runtime_ack_rejects_future_revision_and_keeps_failure_visible():
    connection = SimpleNamespace(scalar=AsyncMock(return_value=4), execute=AsyncMock())
    with pytest.raises(HTTPException) as future:
        await configuration.acknowledge_configuration(
            connection,
            ReviewerRuntimeAcknowledgement(
                agentId="test",
                agentName="Robot",
                revision=5,
            ),
        )
    assert future.value.status_code == 409
    connection.execute.assert_not_called()
    await configuration.acknowledge_configuration(
        connection,
        ReviewerRuntimeAcknowledgement(
            agentId="test",
            agentName="Robot",
            revision=4,
            error="Operation pending",
        ),
    )
    params = connection.execute.call_args.args[0].compile().params
    assert params["configuration_error"] == "Operation pending"
    assert params["configuration_applied_at"] is None


@pytest.mark.anyio
@pytest.mark.parametrize("case", ["missing", "unassigned", "denied", "allowed"])
async def test_reviewer_validation_uses_account_and_module_permission(monkeypatch, case):
    user = actor()
    record = {
        "id": user.id,
        "username": user.username,
        "full_name": user.full_name,
        "role": "employee",
        "position_id": None,
        "department_id": None,
    }
    connection = SimpleNamespace(
        execute=AsyncMock(return_value=mapped(None if case == "missing" else record)),
        scalar=AsyncMock(return_value=None if case == "unassigned" else "askar"),
    )
    monkeypatch.setattr(
        letters,
        "module_permissions_for_user",
        AsyncMock(
            return_value={
                "ai_referent": {"approve": case != "denied"},
            }
        ),
    )
    assert await letters._validate_reviewer(connection, None) is None
    if case == "allowed":
        assert await letters._validate_reviewer(connection, user.id) == "askar"
    else:
        with pytest.raises(letters.AIReferentServiceError) as error:
            await letters._validate_reviewer(connection, user.id)
        assert error.value.status_code == 422


@pytest.mark.anyio
@pytest.mark.parametrize(
    "action,status,target",
    [
        ("submit", "draft", "pending_review"),
        ("approve", "pending_review", "approved"),
        ("return_for_revision", "pending_review", "needs_revision"),
        ("queue_delivery", "approved", "queued"),
        ("retry_delivery", "failed", "queued"),
        ("cancel", "pending_review", "cancelled"),
    ],
)
async def test_letter_actions_keep_revision_audit_and_delivery_idempotency(
    monkeypatch, action, status, target
):
    user = actor()
    letter_id = uuid4()
    row = {
        "id": letter_id,
        "revision": 3,
        "status": status,
        "created_by_user_id": user.id,
        "reviewer_user_id": user.id,
        "route": "exat",
    }
    connection = SimpleNamespace(execute=AsyncMock(), scalar=AsyncMock(return_value=1))
    monkeypatch.setattr(letters, "_letter_row", AsyncMock(return_value=row))
    monkeypatch.setattr(letters, "ensure_module_action", AsyncMock())
    validate = AsyncMock(return_value="askar")
    monkeypatch.setattr(letters, "_validate_reviewer", validate)
    monkeypatch.setattr(letters, "_reserve_number", AsyncMock(return_value=(42, "26")))
    event = AsyncMock()
    monkeypatch.setattr(letters, "_event", event)
    notification = AsyncMock()
    monkeypatch.setattr(letters, "notify_letter", notification)
    marker = object()
    monkeypatch.setattr(letters, "_response", AsyncMock(return_value=marker))
    result = await letters.act_on_letter(
        connection,
        user,
        letter_id,
        AIReferentActionRequest(
            action=action,
            expectedRevision=3,
            comment="Decision reason",
        ),
    )
    assert result is marker
    notification.assert_awaited_once()
    mutations = [
        call.args[0]
        for call in connection.execute.call_args_list
        if isinstance(call.args[0], Update)
    ]
    assert mutations[0].compile().params["status"] == target
    assert mutations[0].compile().params["revision"] == 4
    assert event.call_args.kwargs["from_status"] == status
    assert event.call_args.kwargs["to_status"] == target
    if action != "cancel":
        validate.assert_awaited_once_with(connection, user.id)
    queued = [
        call.args[0]
        for call in connection.execute.call_args_list
        if isinstance(call.args[0], Insert)
        and call.args[0].table.name == "ai_referent_delivery_commands"
    ]
    assert len(queued) == (1 if target == "queued" else 0)
    if queued:
        assert queued[0].compile().params["idempotency_key"] == f"letter:{letter_id}:revision:4"


@pytest.mark.anyio
@pytest.mark.parametrize(
    "action,status,owner,revision,comment,error_code",
    [
        ("approve", "pending_review", True, 1, "", 409),
        ("approve", "pending_review", False, 3, "", 403),
        ("approve", "approved", True, 3, "", 409),
        ("return_for_revision", "approved", True, 3, "Reason", 409),
        ("return_for_revision", "pending_review", True, 3, "", 422),
        ("queue_delivery", "draft", True, 3, "", 409),
        ("submit", "draft", False, 3, "", 403),
        ("cancel", "sent", True, 3, "", 403),
    ],
)
async def test_letter_action_rejection_never_mutates_data(
    monkeypatch, action, status, owner, revision, comment, error_code
):
    user = actor()
    assigned = user.id if owner else uuid4()
    row = {
        "revision": 3,
        "status": status,
        "created_by_user_id": assigned,
        "reviewer_user_id": assigned,
    }
    monkeypatch.setattr(letters, "_letter_row", AsyncMock(return_value=row))
    monkeypatch.setattr(letters, "ensure_module_action", AsyncMock())
    monkeypatch.setattr(letters, "_validate_reviewer", AsyncMock(return_value="askar"))
    connection = SimpleNamespace(execute=AsyncMock())
    with pytest.raises(letters.AIReferentServiceError) as error:
        await letters.act_on_letter(
            connection,
            user,
            uuid4(),
            AIReferentActionRequest(
                action=action,
                expectedRevision=revision,
                comment=comment,
            ),
        )
    assert error.value.status_code == error_code
    assert all(isinstance(call.args[0], Select) for call in connection.execute.call_args_list)
