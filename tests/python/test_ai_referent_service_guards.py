"""Deterministic service guard tests complement real PostgreSQL/HTTP integration."""

from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock
from uuid import uuid4

import pytest
from fastapi import HTTPException
from sqlalchemy.dialects import postgresql
from sqlalchemy.sql import Insert, Select, Update

from yuksalish_api import ai_referent_agent_service as agent
from yuksalish_api import ai_referent_configuration_service as configuration
from yuksalish_api import ai_referent_deletion as deletion
from yuksalish_api import ai_referent_progress as progress
from yuksalish_api import ai_referent_service as letters
from yuksalish_api import repository
from yuksalish_api.ai_referent_configuration_schemas import (
    ReviewerConfigurationResponse,
    ReviewerConfigurationUpdate,
    ReviewerRuntimeAcknowledgement,
)
from yuksalish_api.ai_referent_files_service import (
    file_metadata,
    is_internal_packet_file,
    packet_archive_filename,
    packet_entries,
)
from yuksalish_api.ai_referent_schemas import AIReferentActionRequest
from yuksalish_api.auth import AuthenticatedUser
from yuksalish_api.errors import WorkspaceRepositoryError
from yuksalish_api.routers import ai_referent_shared as shared


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


@pytest.mark.parametrize(
    ("status", "review_actions"),
    [
        ("pending_review", {"approve", "return_for_revision"}),
        ("approved", {"queue_delivery"}),
        ("failed", {"retry_delivery", "return_for_revision"}),
        ("awaiting_final_send", {"release_delivery", "return_for_revision"}),
    ],
)
@pytest.mark.parametrize("role", ["admin", "superadmin"])
def test_administrator_cannot_take_another_reviewers_actions(
    role, status, review_actions
):
    administrator = actor(role)
    row = {
        "status": status,
        "workflow_kind": "delivery",
        "created_by_user_id": uuid4(),
        "reviewer_user_id": uuid4(),
        "recipient_organization": "Partner",
        "recipient_address": "partner@exat.uz",
    }
    actions, _ = letters._available_actions(
        row, administrator, may_approve=True, may_operate=True, attachment_count=1
    )
    assert review_actions.isdisjoint(actions)
    row["reviewer_user_id"] = administrator.id
    assigned_actions, _ = letters._available_actions(
        row, administrator, may_approve=True, may_operate=True, attachment_count=1
    )
    assert review_actions.issubset(assigned_actions)


@pytest.mark.parametrize("role", ["admin", "superadmin"])
def test_administrator_keeps_referent_delivery_actions(role):
    administrator = actor(role)
    row = {
        "status": "referent_review_pending",
        "workflow_kind": "delivery",
        "created_by_user_id": uuid4(),
        "reviewer_user_id": uuid4(),
        "recipient_organization": "Partner",
        "recipient_address": "partner@exat.uz",
    }
    actions, _ = letters._available_actions(
        row, administrator, may_approve=True, may_operate=True, attachment_count=1
    )
    assert {"send", "replace_document", "mark_sent"}.issubset(actions)


@pytest.mark.parametrize("role", ["admin", "superadmin"])
def test_administrator_cannot_edit_or_cancel_another_draft(role):
    administrator = actor(role)
    row = {
        "status": "draft",
        "workflow_kind": "delivery",
        "created_by_user_id": uuid4(),
        "reviewer_user_id": uuid4(),
        "recipient_organization": "Partner",
        "recipient_address": "partner@exat.uz",
    }
    actions, can_edit = letters._available_actions(
        row, administrator, may_approve=True, may_operate=True, attachment_count=1
    )
    assert not can_edit
    assert not {"submit", "cancel"}.intersection(actions)


def mapped(value):
    result = Mock()
    result.mappings.return_value.one.return_value = value
    result.mappings.return_value.one_or_none.return_value = value
    result.mappings.return_value.all.return_value = value
    return result


def test_packet_archive_filename_is_readable_and_windows_safe():
    assert packet_archive_filename("0439/26-AI", 'Материалы: проект "Навои"') == (
        "0439-26-AI — Материалы проект Навои.zip"
    )
    assert packet_archive_filename("", "") == "Пакет документов.zip"


@pytest.mark.parametrize(
    "name",
    ["000364 - metadata.json", "000364 - hashes.json", "000364 - ai_result.json"],
)
def test_incoming_packet_hides_machine_sidecars(name):
    assert is_internal_packet_file("incoming", name)
    assert is_internal_packet_file("archive", f"folder/{name}")
    assert not is_internal_packet_file("outgoing", name)
    assert not is_internal_packet_file("incoming", "analysis.json")


@pytest.mark.anyio
async def test_signed_outgoing_packet_contains_final_pdf_and_attachments_only():
    owner_id, primary_id, additional_id, final_id, old_pdf_id = (uuid4() for _ in range(5))
    created_at = datetime.now(UTC)
    connection = Mock()
    connection.scalar = AsyncMock(return_value=final_id)
    connection.execute = AsyncMock(side_effect=[
        mapped([
            {"id": primary_id, "file_name": "unsigned.docx", "document_role": "primary",
             "byte_size": 1, "sha256": "a", "created_at": created_at},
            {"id": additional_id, "file_name": "appendix.pdf", "document_role": "additional",
             "byte_size": 1, "sha256": "b", "created_at": created_at},
        ]),
        mapped([
            {"id": final_id, "relative_path": "signed/final.pdf", "byte_size": 1,
             "sha256": "c", "created_at": created_at},
            {"id": old_pdf_id, "relative_path": "signed/old.pdf", "byte_size": 1,
             "sha256": "d", "created_at": created_at},
        ]),
        mapped({"workflow_kind": "delivery", "status": "signed"}),
    ])
    entries = await packet_entries(connection, "outgoing", owner_id)
    assert {entry["id"] for entry in entries} == {str(additional_id), str(final_id)}
    delivery_lookup = connection.scalar.await_args.args[0]
    assert "workflow_kind" in str(delivery_lookup)


@pytest.mark.anyio
async def test_sign_only_packet_keeps_all_published_signed_pages():
    owner_id, job_id, first_id, second_id = (uuid4() for _ in range(4))
    created_at = datetime.now(UTC)
    connection = Mock()
    connection.scalar = AsyncMock(side_effect=[None, job_id])
    connection.execute = AsyncMock(side_effect=[
        mapped([]),
        mapped([
            {"id": first_id, "relative_path": f"signed/{job_id}/001.pdf",
             "byte_size": 1, "sha256": "a", "created_at": created_at},
            {"id": second_id, "relative_path": f"signed/{job_id}/002.pdf",
             "byte_size": 1, "sha256": "b", "created_at": created_at},
        ]),
        mapped({"workflow_kind": "sign_only", "status": "signed"}),
    ])
    entries = await packet_entries(connection, "outgoing", owner_id)
    assert {entry["id"] for entry in entries} == {str(first_id), str(second_id)}


@pytest.mark.anyio
async def test_incoming_sidecar_cannot_be_downloaded_directly():
    connection = Mock()
    connection.execute = AsyncMock(return_value=mapped({"relative_path": "000364 - metadata.json"}))
    with pytest.raises(HTTPException) as error:
        await file_metadata(connection, "incoming", uuid4(), uuid4(), "packet")
    assert error.value.status_code == 404
    with pytest.raises(HTTPException) as alternate_source_error:
        await file_metadata(connection, "incoming", uuid4(), uuid4(), "attachment")
    assert alternate_source_error.value.status_code == 404


@pytest.mark.anyio
async def test_incoming_packet_excludes_sidecars_but_keeps_letter():
    owner_id = uuid4()
    created_at = datetime.now(UTC)
    sidecar_id, letter_id = uuid4(), uuid4()
    connection = Mock()
    connection.execute = AsyncMock(return_value=mapped([
        {"id": sidecar_id, "relative_path": "000364 - hashes.json", "byte_size": 1,
         "sha256": "a", "created_at": created_at},
        {"id": letter_id, "relative_path": "000364 - letter.pdf", "byte_size": 2,
         "sha256": "b", "created_at": created_at},
    ]))
    entries = await packet_entries(connection, "incoming", owner_id)
    assert [entry["id"] for entry in entries] == [str(letter_id)]


@pytest.mark.parametrize("role", ["employee", "manager", "admin", "superadmin"])
def test_sent_letter_visibility_is_owner_or_leadership(role):
    user = actor(role)
    other = uuid4()
    row = {
        "status": "sent", "created_by_user_id": other,
        "reviewer_user_id": user.id, "initial_reviewer_user_id": user.id,
        "final_reviewer_user_id": user.id,
    }
    assert letters._may_view(row, user) is (role != "employee")
    row["created_by_user_id"] = user.id
    assert letters._may_view(row, user)
    row["status"] = "pending_review"
    assert letters._may_view(row, user)


@pytest.mark.parametrize("role", ["admin", "superadmin"])
@pytest.mark.parametrize(
    "status",
    [
        "draft", "needs_revision", "pending_review", "approved", "queued",
        "sending", "awaiting_final_send", "failed", "cancelled", "signed",
    ],
)
def test_administrator_cannot_view_other_letters_before_operator_stage(role, status):
    administrator = actor(role)
    row = {
        "status": status,
        "created_by_user_id": uuid4(),
        "reviewer_user_id": uuid4(),
    }
    assert not letters._may_view(row, administrator, may_operate=True)


@pytest.mark.parametrize(
    "status", ["referent_review_pending", "operator_revision", "delivery_unknown", "sent"]
)
def test_operator_can_view_final_stage_and_history(status):
    operator = actor()
    row = {
        "status": status,
        "created_by_user_id": uuid4(),
        "reviewer_user_id": uuid4(),
    }
    assert letters._may_view(row, operator, may_operate=True)
    assert not letters._may_view(row, operator)


@pytest.mark.anyio
async def test_sent_letter_direct_open_denied_to_other_employee(monkeypatch):
    user = actor()
    row = {
        "status": "sent", "created_by_user_id": uuid4(),
        "reviewer_user_id": user.id, "initial_reviewer_user_id": user.id,
        "final_reviewer_user_id": user.id,
    }
    monkeypatch.setattr(letters, "_letter_row", AsyncMock(return_value=row))
    monkeypatch.setattr(letters, "ensure_module_action", AsyncMock())
    monkeypatch.setattr(
        letters, "module_permissions_for_user",
        AsyncMock(return_value={"ai_referent": {"admin": False}}),
    )
    with pytest.raises(letters.AIReferentServiceError) as error:
        await letters.load_letter(Mock(), user, uuid4())
    assert error.value.status_code == 404


@pytest.mark.anyio
async def test_administrator_cannot_open_other_pending_letter(monkeypatch):
    administrator = actor("admin")
    row = {
        "status": "pending_review",
        "created_by_user_id": uuid4(),
        "reviewer_user_id": uuid4(),
    }
    monkeypatch.setattr(letters, "_letter_row", AsyncMock(return_value=row))
    monkeypatch.setattr(letters, "ensure_module_action", AsyncMock())
    monkeypatch.setattr(
        letters,
        "module_permissions_for_user",
        AsyncMock(return_value={"ai_referent": {"admin": True}}),
    )
    with pytest.raises(letters.AIReferentServiceError) as error:
        await letters.load_letter(Mock(), administrator, uuid4())
    assert error.value.status_code == 404


@pytest.mark.anyio
async def test_administrator_letter_list_is_limited_to_operator_stage_and_history(monkeypatch):
    administrator = actor("admin")
    connection = SimpleNamespace(execute=AsyncMock(side_effect=[mapped([]), mapped([])]))
    monkeypatch.setattr(letters, "ensure_module_action", AsyncMock())
    monkeypatch.setattr(
        letters,
        "module_permissions_for_user",
        AsyncMock(return_value={"ai_referent": {"admin": True, "approve": True}}),
    )
    await letters.load_letters(connection, administrator)
    where = str(
        connection.execute.call_args_list[1].args[0].whereclause.compile(
            compile_kwargs={"literal_binds": True}
        )
    )
    assert "referent_review_pending" in where
    assert "operator_revision" in where
    assert "delivery_unknown" in where
    assert "created_by_user_id" in where
    assert "reviewer_user_id" in where


@pytest.mark.anyio
@pytest.mark.parametrize("is_operator", [False, True])
async def test_progress_list_exposes_only_status_and_identity_to_operator(
    monkeypatch, is_operator
):
    user = actor("admin" if is_operator else "employee")
    record = {
        "id": uuid4(),
        "status": "pending_review",
        "created_by_name": "Sender",
        "created_at": datetime.now(UTC),
        "outgoing_number": None,
        "year_suffix": None,
        "subject": "This must not leave the progress endpoint",
    }
    connection = SimpleNamespace(execute=AsyncMock(return_value=mapped([record])))
    monkeypatch.setattr(progress, "ensure_module_action", AsyncMock())
    monkeypatch.setattr(
        progress,
        "module_permissions_for_user",
        AsyncMock(return_value={"ai_referent": {"admin": is_operator}}),
    )
    result = await progress.list_other_letter_progress(connection, user)
    if not is_operator:
        assert result.letters == []
        connection.execute.assert_not_awaited()
        return
    assert len(result.letters) == 1
    assert result.letters[0].status == "pending_review"
    assert "subject" not in result.letters[0].model_dump(by_alias=True)
    where = str(
        connection.execute.call_args.args[0].whereclause.compile(
            compile_kwargs={"literal_binds": True}
        )
    )
    assert "pending_review" in where
    assert "draft" not in where
    assert "IS DISTINCT FROM" in where


@pytest.mark.anyio
@pytest.mark.parametrize("status,allowed", [("pending_review", False),
                                             ("referent_review_pending", True)])
async def test_old_administrator_notification_does_not_expose_letter_cycle(
    monkeypatch, status, allowed
):
    administrator = actor("admin")
    letter_id = uuid4()
    letter = {
        "id": letter_id,
        "status": status,
        "created_by_user_id": uuid4(),
        "reviewer_user_id": uuid4(),
    }
    connection = SimpleNamespace(execute=AsyncMock(return_value=mapped(letter)))
    monkeypatch.setattr(
        repository,
        "module_permissions_for_user",
        AsyncMock(return_value={"ai_referent": {"view": True, "admin": True}}),
    )
    check = repository._ensure_ai_referent_notification_visible(
        connection,
        administrator,
        {"section": "ai_referent", "entity_id": letter_id},
    )
    if allowed:
        await check
    else:
        with pytest.raises(WorkspaceRepositoryError) as error:
            await check
        assert error.value.status_code == 404


@pytest.mark.anyio
async def test_telegram_history_query_limits_employee_to_own_sent_letters(monkeypatch):
    user = actor()
    connection = SimpleNamespace(execute=AsyncMock(side_effect=[mapped([]), mapped([])]))
    monkeypatch.setattr(letters, "ensure_module_action", AsyncMock())
    monkeypatch.setattr(
        letters, "module_permissions_for_user",
        AsyncMock(return_value={"ai_referent": {"admin": False}}),
    )
    result = await letters.load_letters(connection, user, history_only=True)
    assert result.letters == []
    statement = connection.execute.call_args_list[1].args[0]
    where = str(statement.whereclause)
    assert "ai_referent_letters.status" in where
    assert "ai_referent_letters.created_by_user_id" in where
    assert "reviewer_user_id" not in where

    connection.execute.reset_mock(side_effect=True)
    connection.execute.side_effect = [mapped([]), mapped([])]
    await letters.load_letters(connection, actor("manager"), history_only=True)
    manager_where = str(connection.execute.call_args_list[1].args[0].whereclause)
    assert "ai_referent_letters.status" in manager_where
    assert "created_by_user_id" not in manager_where

    connection.execute.reset_mock(side_effect=True)
    connection.execute.side_effect = [mapped([]), mapped([])]
    monkeypatch.setattr(
        letters, "module_permissions_for_user",
        AsyncMock(return_value={"ai_referent": {"admin": True}}),
    )
    await letters.load_letters(connection, user, history_only=True)
    operator_where = str(connection.execute.call_args_list[1].args[0].whereclause)
    assert "ai_referent_letters.status" in operator_where
    assert "created_by_user_id" not in operator_where



@pytest.mark.anyio
async def test_telegram_archive_reads_are_blocked_but_workspace_route_remains():
    with pytest.raises(HTTPException) as listing:
        await shared.agent_archive(Mock(), Mock())
    assert listing.value.status_code == 403
    with pytest.raises(HTTPException) as packet:
        await shared.agent_packet("archive", uuid4(), Mock(), Mock())
    assert packet.value.status_code == 403
    with pytest.raises(HTTPException) as file:
        await shared.agent_download_file(
            "archive", uuid4(), uuid4(), Mock(), Mock(), Mock()
        )
    assert file.value.status_code == 403
    assert shared.get_archive is not shared.agent_archive


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
@pytest.mark.parametrize("role", ["employee", "admin", "superadmin"])
@pytest.mark.parametrize(
    "action,status,target",
    [
        ("submit", "draft", "pending_review"),
        ("approve", "pending_review", "queued"),
        ("return_for_revision", "pending_review", "needs_revision"),
        ("queue_delivery", "approved", "queued"),
        ("retry_delivery", "failed", "queued"),
        ("cancel", "pending_review", "cancelled"),
    ],
)
async def test_letter_actions_keep_revision_audit_and_delivery_idempotency(
    monkeypatch, role, action, status, target
):
    user = actor(role)
    letter_id = uuid4()
    row = {
        "id": letter_id,
        "workflow_kind": "delivery",
        "revision": 3,
        "status": status,
        "created_by_user_id": user.id,
        "reviewer_user_id": user.id,
        "route": "exat",
        "recipient_organization": "Test organization",
        "recipient_address": "org@exat.uz",
        "reviewer_key": "askar",
        "outgoing_number": None,
    }
    connection = SimpleNamespace(execute=AsyncMock(), scalar=AsyncMock(return_value=1))
    monkeypatch.setattr(letters, "_letter_row", AsyncMock(return_value=row))
    monkeypatch.setattr(letters, "ensure_module_action", AsyncMock())
    validate = AsyncMock(return_value="askar")
    preflight = AsyncMock()
    monkeypatch.setattr(letters, "require_passed", preflight)
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
    if action == "submit":
        preflight.assert_awaited_once_with(connection, row)
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
@pytest.mark.parametrize("role", ["admin", "superadmin"])
@pytest.mark.parametrize(
    ("action", "status"),
    [
        ("submit", "draft"),
        ("approve", "pending_review"),
        ("return_for_revision", "pending_review"),
        ("queue_delivery", "approved"),
        ("retry_delivery", "failed"),
        ("release_delivery", "awaiting_final_send"),
        ("return_for_revision", "awaiting_final_send"),
        ("cancel", "pending_review"),
    ],
)
async def test_administrator_cannot_change_other_letter_before_operator_stage(
    monkeypatch, role, action, status
):
    administrator = actor(role)
    row = {
        "id": uuid4(),
        "revision": 3,
        "workflow_kind": "delivery",
        "status": status,
        "created_by_user_id": uuid4(),
        "reviewer_user_id": uuid4(),
    }
    connection = SimpleNamespace(execute=AsyncMock())
    monkeypatch.setattr(letters, "_letter_row", AsyncMock(return_value=row))
    monkeypatch.setattr(letters, "ensure_module_action", AsyncMock())
    validate = AsyncMock()
    monkeypatch.setattr(letters, "_validate_reviewer", validate)
    with pytest.raises(letters.AIReferentServiceError) as error:
        await letters.act_on_letter(
            connection,
            administrator,
            row["id"],
            AIReferentActionRequest(
                action=action, expectedRevision=3, comment="Review decision reason"
            ),
        )
    assert error.value.status_code == 403
    validate.assert_not_awaited()
    assert all(isinstance(call.args[0], Select) for call in connection.execute.call_args_list)


@pytest.mark.anyio
@pytest.mark.parametrize("status", ["draft", "needs_revision", "operator_revision"])
async def test_administrator_can_upload_only_at_operator_replacement_stage(
    monkeypatch, status
):
    administrator = actor("admin")
    letter_id = uuid4()
    query_result = Mock()
    query_result.mappings.return_value.first.return_value = {
        "id": letter_id,
        "status": status,
        "created_by_user_id": uuid4(),
    }
    connection = SimpleNamespace(execute=AsyncMock(return_value=query_result))
    monkeypatch.setattr(
        repository,
        "module_permissions_for_user",
        AsyncMock(return_value={"ai_referent": {"view": True, "edit": True, "admin": True}}),
    )
    operation = repository.validate_attachment_owner(
        connection, administrator, "ai_referent_letter", letter_id, write=True
    )
    if status == "operator_revision":
        await operation
    else:
        with pytest.raises(WorkspaceRepositoryError) as error:
            await operation
        assert error.value.status_code == 404


@pytest.mark.anyio
async def test_administrator_cannot_delete_another_letter(monkeypatch):
    administrator = actor("admin")
    letter_id = uuid4()
    query_result = Mock()
    query_result.mappings.return_value.first.return_value = {
        "id": letter_id,
        "revision": 3,
        "status": "pending_review",
        "created_by_user_id": uuid4(),
    }
    connection = SimpleNamespace(execute=AsyncMock(side_effect=[Mock(), query_result]))
    monkeypatch.setattr(deletion, "ensure_module_action", AsyncMock())
    with pytest.raises(HTTPException) as error:
        await deletion.request_deletion(connection, administrator, letter_id, 3)
    assert error.value.status_code == 403
    assert all(isinstance(call.args[0], Select) for call in connection.execute.call_args_list)


@pytest.mark.anyio
@pytest.mark.parametrize("module_admin", [False, True])
async def test_only_module_operator_can_open_another_users_sent_letter(
    monkeypatch, module_admin
):
    operator = actor()
    letter_id = uuid4()
    row = {
        "id": letter_id,
        "status": "sent",
        "created_by_user_id": uuid4(),
    }
    connection = SimpleNamespace()
    monkeypatch.setattr(letters, "ensure_module_action", AsyncMock())
    monkeypatch.setattr(letters, "_letter_row", AsyncMock(return_value=row))
    monkeypatch.setattr(
        letters,
        "module_permissions_for_user",
        AsyncMock(return_value={"ai_referent": {"admin": module_admin}}),
    )
    marker = object()
    response = AsyncMock(return_value=marker)
    monkeypatch.setattr(letters, "_response", response)
    if module_admin:
        assert await letters.load_letter(connection, operator, letter_id) is marker
    else:
        with pytest.raises(letters.AIReferentServiceError) as error:
            await letters.load_letter(connection, operator, letter_id)
        assert error.value.status_code == 404
        response.assert_not_awaited()


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
        "workflow_kind": "delivery",
        "status": status,
        "created_by_user_id": assigned,
        "reviewer_user_id": assigned,
    }
    monkeypatch.setattr(letters, "_letter_row", AsyncMock(return_value=row))

    async def authorize(_connection, _user, _module, permission):
        if permission == "admin":
            raise letters.AIReferentServiceError(403, "Operator permission required")

    monkeypatch.setattr(letters, "ensure_module_action", authorize)
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


@pytest.mark.anyio
async def test_sign_only_approval_queues_signature_without_number_or_delivery(monkeypatch):
    user = actor()
    letter_id = uuid4()
    row = {
        "id": letter_id,
        "revision": 2,
        "workflow_kind": "sign_only",
        "status": "pending_review",
        "created_by_user_id": uuid4(),
        "reviewer_user_id": user.id,
        "route": "exat",
    }
    connection = SimpleNamespace(execute=AsyncMock(), scalar=AsyncMock(return_value="agent"))
    monkeypatch.setattr(letters, "_letter_row", AsyncMock(return_value=row))
    monkeypatch.setattr(letters, "ensure_module_action", AsyncMock())
    monkeypatch.setattr(letters, "_validate_reviewer", AsyncMock(return_value="bobur"))
    reserve = AsyncMock()
    monkeypatch.setattr(letters, "_reserve_number", reserve)
    monkeypatch.setattr(letters, "_event", AsyncMock())
    monkeypatch.setattr(letters, "notify_letter", AsyncMock())
    monkeypatch.setattr(letters, "_response", AsyncMock(return_value=object()))
    await letters.act_on_letter(
        connection, user, letter_id,
        AIReferentActionRequest(action="approve", expectedRevision=2),
    )
    reserve.assert_not_awaited()
    statements = [call.args[0] for call in connection.execute.call_args_list]
    commands = [statement for statement in statements if isinstance(statement, Insert)
                and statement.table.name == "ai_referent_delivery_commands"]
    assert len(commands) == 1
    assert commands[0].compile().params["kind"] == "sign_only"
    changes = [statement for statement in statements if isinstance(statement, Update)]
    assert changes[0].compile().params["status"] == "queued"
    assert "outgoing_number" not in changes[0].compile().params


@pytest.mark.anyio
@pytest.mark.parametrize("action", ["send", "queue_delivery", "release_delivery", "confirm_sent"])
async def test_sign_only_rejects_every_external_delivery_action(monkeypatch, action):
    user = actor("admin")
    row = {
        "id": uuid4(), "revision": 2, "workflow_kind": "sign_only",
        "status": "signed", "created_by_user_id": user.id,
        "reviewer_user_id": user.id,
    }
    connection = SimpleNamespace(execute=AsyncMock())
    monkeypatch.setattr(letters, "_letter_row", AsyncMock(return_value=row))
    with pytest.raises(letters.AIReferentServiceError) as error:
        await letters.act_on_letter(
            connection, user, row["id"],
            AIReferentActionRequest(action=action, expectedRevision=2),
        )
    assert error.value.status_code == 422
    assert all(isinstance(call.args[0], Select) for call in connection.execute.call_args_list)


@pytest.mark.anyio
async def test_sign_only_result_requires_complete_page_set_and_finishes_signed(monkeypatch):
    letter_id, job_id, lease = uuid4(), uuid4(), uuid4()
    job = {
        "id": job_id, "letter_id": letter_id, "lease_token": lease,
        "claimed_by": "referent", "status": "claimed", "kind": "sign_only",
        "lease_until": datetime.now(UTC) + timedelta(minutes=2), "result": None,
    }
    row = {
        "id": letter_id, "status": "sending", "workflow_kind": "sign_only",
        "revision": 3, "sent_at": None, "final_pdf_file_id": None,
    }
    command_rows = SimpleNamespace(mappings=lambda: SimpleNamespace(one_or_none=lambda: job))
    filenames = [f"signed/{job_id}/{page:03d}.pdf" for page in (1, 2)]
    file_rows = SimpleNamespace(scalars=lambda: SimpleNamespace(all=lambda: filenames))
    connection = SimpleNamespace(execute=AsyncMock(side_effect=[
        Mock(), command_rows, file_rows, Mock(), Mock(),
    ]))
    monkeypatch.setattr(agent, "_letter_row", AsyncMock(return_value=row))
    monkeypatch.setattr(agent, "_event", AsyncMock())
    monkeypatch.setattr(agent, "notify_letter", AsyncMock())
    await agent.complete_job(
        connection, job_id, lease, "referent", "prepared", "two PDFs", signed_pages=2,
    )
    updates = [call.args[0] for call in connection.execute.call_args_list
               if isinstance(call.args[0], Update)]
    letter_update = next(query for query in updates if query.table.name == "ai_referent_letters")
    assert letter_update.compile().params["status"] == "signed"
    assert letter_update.compile().params["sent_at"] is None


@pytest.mark.anyio
async def test_sign_only_agent_cannot_report_external_send(monkeypatch):
    letter_id, job_id, lease = uuid4(), uuid4(), uuid4()
    job = {
        "id": job_id, "letter_id": letter_id, "lease_token": lease,
        "claimed_by": "referent", "status": "claimed", "kind": "sign_only",
        "lease_until": datetime.now(UTC) + timedelta(minutes=2), "result": None,
    }
    command_rows = SimpleNamespace(mappings=lambda: SimpleNamespace(one_or_none=lambda: job))
    connection = SimpleNamespace(execute=AsyncMock(side_effect=[Mock(), command_rows]))
    monkeypatch.setattr(agent, "_letter_row", AsyncMock(return_value={
        "id": letter_id, "status": "sending", "workflow_kind": "sign_only",
    }))
    with pytest.raises(HTTPException) as error:
        await agent.complete_job(connection, job_id, lease, "referent", "sent", "sent")
    assert error.value.status_code == 422
    assert all(isinstance(call.args[0], Select) for call in connection.execute.call_args_list)
