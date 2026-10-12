"""System announcement permissions and persistent tombstones."""

import asyncio
from datetime import UTC, datetime
from unittest.mock import AsyncMock, Mock
from uuid import uuid4

import pytest

from yuksalish_api.auth import AuthenticatedUser
from yuksalish_api.repository import WorkspaceRepositoryError, _feed_post, delete_feed_post


def post_row() -> dict[str, object]:
    now = datetime.now(UTC)
    return {
        "id": uuid4(), "author_user_id": None, "system_kind": "birthday",
        "birthday_user_id": uuid4(), "title": "Birthday", "body": "Congratulations",
        "is_pinned": False, "created_at": now, "updated_at": now,
    }


@pytest.mark.parametrize("role,allowed", [
    ("employee", False), ("manager", False), ("admin", True), ("superadmin", True),
])
def test_system_post_deletion_capability_and_server_guard(role: str, allowed: bool) -> None:
    user = AuthenticatedUser(uuid4(), "tester", "Tester", None, None, role)
    row = post_row()
    assert _feed_post(row, user).can_delete is allowed
    assert not _feed_post(row, user).can_edit
    assert not _feed_post(row, user).can_pin
    result = Mock()
    result.mappings.return_value.first.return_value = row
    connection = Mock(execute=AsyncMock(return_value=result))
    if not allowed:
        with pytest.raises(WorkspaceRepositoryError) as error:
            asyncio.run(delete_feed_post(connection, user, row["id"]))
        assert error.value.status_code == 403
        assert connection.execute.await_count == 1
        return
    asyncio.run(delete_feed_post(connection, user, row["id"]))
    queries = [str(call.args[0]) for call in connection.execute.call_args_list]
    assert "deleted_at IS NULL" in queries[0]
    assert queries[1].startswith("UPDATE feed_posts SET")
    assert "deleted_at" in queries[1]
    assert "deleted_by_user_id" in queries[1]
    assert queries[2].startswith("DELETE FROM workspace_notifications")
