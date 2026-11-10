from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock
from uuid import uuid4

import pytest
from fastapi import HTTPException
from sqlalchemy.sql.dml import Delete, Insert
from starlette.requests import Request

from yuksalish_api import repository
from yuksalish_api.auth import AuthenticatedUser
from yuksalish_api.routers import workspace


@pytest.mark.anyio
@pytest.mark.parametrize("role,own,status,assigned,visible,allowed", [
    ("employee", True, "running", False, True, True),
    ("employee", True, "needs_revision", False, True, True),
    ("employee", False, "running", True, True, False),
    ("employee", False, "needs_revision", True, True, True),
    ("employee", False, "needs_revision", False, True, False),
    ("employee", True, "running", False, False, False),
    ("admin", False, "running", False, True, False),
    ("superadmin", False, "running", False, True, True),
    ("superadmin", True, "approved", False, True, False),
    ("employee", True, "rejected", False, True, False),
    ("employee", True, "cancelled", False, True, False),
])
async def test_payment_file_removal_uses_existing_edit_permissions(
    monkeypatch, role, own, status, assigned, visible, allowed,
):
    actor = AuthenticatedUser(uuid4(), "tester", "Tester", None, None, role)
    request_id, attachment_id = uuid4(), uuid4()
    row = {"id": request_id, "requester_user_id": actor.id if own else uuid4(),
           "status": status, "active_node_keys": ["correction"], "title": "Payment",
           "payload": {}, "current_version": 3}
    request_result, file_result = Mock(), Mock()
    request_result.mappings.return_value.first.return_value = row
    file_result.mappings.return_value.first.return_value = {
        "file_name": "old.pdf", "document_role": "primary", "storage_key": "private/old",
        "uploaded_by_user_id": uuid4(),  # Editable request files need not belong to the editor.
    }
    connection = SimpleNamespace(execute=AsyncMock(side_effect=[
        request_result, request_result, file_result, Mock(), Mock(),
    ]))
    monkeypatch.setattr(repository, "_visible_approval_requests", AsyncMock(
        return_value=[row] if visible else [],
    ))
    monkeypatch.setattr(repository, "_can_act_on_node", AsyncMock(return_value=assigned))
    version = AsyncMock(return_value=4)
    monkeypatch.setattr(repository, "_append_request_version", version)
    if allowed:
        await repository.delete_approval_attachment(connection, actor, request_id, attachment_id)
        version.assert_awaited_once_with(
            connection, row, actor.id, title="Payment", payload={},
            change_reason="attachment_removed", change_comment="old.pdf",
        )
        statements = [call.args[0] for call in connection.execute.await_args_list]
        assert "FOR UPDATE" in str(statements[0])
        assert "FOR UPDATE" in str(statements[2])
        assert {request_id, attachment_id, "approval_request"}.issubset(
            set(statements[2].compile().params.values()),
        )
        assert isinstance(statements[3], Delete)
        assert statements[3].table is repository.attachments
        assert isinstance(statements[4], Insert)
        assert statements[4].table is repository.audit_events
        details = statements[4].compile().params["details"]
        assert details["fileName"] == "old.pdf" and details["version"] == 4
    else:
        with pytest.raises(repository.WorkspaceRepositoryError) as error:
            await repository.delete_approval_attachment(
                connection, actor, request_id, attachment_id,
            )
        assert error.value.status_code == 404
        assert connection.execute.await_count == 2
        version.assert_not_awaited()


@pytest.mark.anyio
@pytest.mark.parametrize("missing_parent", [False, True])
async def test_missing_or_differently_owned_payment_file_is_not_removed(
    monkeypatch, missing_parent,
):
    actor = AuthenticatedUser(uuid4(), "tester", "Tester", None, None, "superadmin")
    request_result, missing_result = Mock(), Mock()
    request_result.mappings.return_value.first.return_value = {"id": uuid4()}
    missing_result.mappings.return_value.first.return_value = None
    connection = SimpleNamespace(execute=AsyncMock(side_effect=[
        missing_result if missing_parent else request_result, missing_result,
    ]))
    access = AsyncMock()
    monkeypatch.setattr(repository, "validate_attachment_owner", access)
    with pytest.raises(repository.WorkspaceRepositoryError) as error:
        await repository.delete_approval_attachment(connection, actor, uuid4(), uuid4())
    assert error.value.status_code == 404
    assert connection.execute.await_count == (1 if missing_parent else 2)
    assert access.await_count == (0 if missing_parent else 1)


@pytest.mark.anyio
@pytest.mark.parametrize("failure", [None, "permission", "repository", "commit"])
async def test_payment_file_endpoint_checks_edit_and_commits_before_broadcast(monkeypatch, failure):
    actor = AuthenticatedUser(uuid4(), "tester", "Tester", None, None, "manager")
    request_id, attachment_id = uuid4(), uuid4()
    order = []
    connection = AsyncMock()

    async def commit():
        if failure == "commit":
            raise RuntimeError("Commit failed")
        order.append("commit")

    async def publish(event):
        assert order == ["commit"]
        assert event == {"type": "attachment.deleted", "entityId": str(attachment_id)}
        order.append("publish")

    connection.commit.side_effect = commit
    bus = SimpleNamespace(publish=AsyncMock(side_effect=publish))
    permission = AsyncMock(side_effect=HTTPException(403) if failure == "permission" else None)
    remove = AsyncMock(side_effect=repository.WorkspaceRepositoryError(404, "Missing")
                       if failure == "repository" else None)
    monkeypatch.setattr(workspace, "ensure_module_action", permission)
    monkeypatch.setattr(workspace, "delete_approval_attachment", remove)
    monkeypatch.setattr(workspace, "_event_bus", lambda _: bus)
    request = Request({"type": "http"})
    if failure:
        with pytest.raises(RuntimeError if failure == "commit" else HTTPException):
            await workspace.remove_approval_attachment(
                request_id, attachment_id, request, actor, connection,
            )
        bus.publish.assert_not_awaited()
        if failure != "commit":
            connection.commit.assert_not_awaited()
        if failure == "permission":
            remove.assert_not_awaited()
    else:
        response = await workspace.remove_approval_attachment(
            request_id, attachment_id, request, actor, connection,
        )
        assert response.status_code == 204
        assert order == ["commit", "publish"]
    permission.assert_awaited_once_with(connection, actor, "payment_requests", "edit")
