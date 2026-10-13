import asyncio
from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock
from uuid import uuid4

import pytest

from yuksalish_api import repository
from yuksalish_api.auth import AuthenticatedUser


@pytest.mark.parametrize("role,own,allowed", [
    ("employee", True, True), ("employee", False, False),
    ("manager", False, False), ("admin", False, True), ("superadmin", False, True),
])
def test_only_uploader_or_admin_can_remove_task_file(monkeypatch, role, own, allowed):
    actor = AuthenticatedUser(uuid4(), "tester", "Tester", None, None, role)
    task_id, attachment_id = uuid4(), uuid4()
    result = Mock()
    result.mappings.return_value.first.return_value = {
        "uploaded_by_user_id": actor.id if own else uuid4(),
        "file_name": "test.pdf", "storage_key": "private/test",
    }
    connection = SimpleNamespace(execute=AsyncMock(return_value=result))
    access = AsyncMock()
    monkeypatch.setattr(repository, "_task_access_row", access)
    if allowed:
        asyncio.run(repository.delete_task_attachment(connection, actor, task_id, attachment_id))
        assert connection.execute.await_count == 3  # locked read, removal, audit
        statements = [str(call.args[0]) for call in connection.execute.await_args_list]
        assert "DELETE FROM attachments" in statements[1]
        assert "core_audit_events" in statements[2]
    else:
        with pytest.raises(repository.WorkspaceRepositoryError) as error:
            asyncio.run(repository.delete_task_attachment(
                connection, actor, task_id, attachment_id,
            ))
        assert error.value.status_code == 403
        assert connection.execute.await_count == 1
    access.assert_awaited_once_with(connection, actor, task_id, edit=False)
    query = connection.execute.await_args_list[0].args[0].compile().params
    assert {task_id, attachment_id, "task"}.issubset(set(query.values()))


def test_inaccessible_task_cannot_delete_even_for_uploader(monkeypatch):
    actor = AuthenticatedUser(uuid4(), "tester", "Tester", None, None, "employee")
    connection = SimpleNamespace(execute=AsyncMock())
    monkeypatch.setattr(repository, "_task_access_row", AsyncMock(
        side_effect=repository.WorkspaceRepositoryError(404, "Task was not found"),
    ))
    with pytest.raises(repository.WorkspaceRepositoryError):
        asyncio.run(repository.delete_task_attachment(connection, actor, uuid4(), uuid4()))
    connection.execute.assert_not_awaited()


def test_missing_or_other_owner_file_is_not_deleted(monkeypatch):
    actor = AuthenticatedUser(uuid4(), "admin", "Admin", None, None, "admin")
    result = Mock()
    result.mappings.return_value.first.return_value = None
    connection = SimpleNamespace(execute=AsyncMock(return_value=result))
    monkeypatch.setattr(repository, "_task_access_row", AsyncMock())
    with pytest.raises(repository.WorkspaceRepositoryError) as error:
        asyncio.run(repository.delete_task_attachment(connection, actor, uuid4(), uuid4()))
    assert error.value.status_code == 404
    assert connection.execute.await_count == 1


def test_deadline_label_is_tashkent_not_server_timezone():
    assert repository._due_label(datetime(2026, 10, 13, 13, tzinfo=UTC)) == "13.10.2026, 18:00"
