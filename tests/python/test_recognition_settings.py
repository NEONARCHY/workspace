from unittest.mock import AsyncMock
from uuid import NAMESPACE_URL, uuid4, uuid5

import pytest
from sqlalchemy.ext.asyncio import AsyncConnection

from yuksalish_api.auth import AuthenticatedUser
from yuksalish_api.recognition_schemas import RecognitionSettingsWrite
from yuksalish_api.recognition_service import RecognitionError, save_settings


def actor(role: str) -> AuthenticatedUser:
    return AuthenticatedUser(
        id=uuid4(), username="settings-test", full_name="Settings test",
        position_id=None, job_title=None, role=role,
    )


@pytest.mark.anyio
@pytest.mark.parametrize("role", ["admin", "superadmin"])
@pytest.mark.parametrize("visible", [False, True])
async def test_settings_have_a_stable_non_null_audit_target(role: str, visible: bool) -> None:
    connection = AsyncMock(spec=AsyncConnection)
    user = actor(role)
    saved = await save_settings(
        connection, user, RecognitionSettingsWrite(active_task_count_visible=visible)
    )
    assert saved.active_task_count_visible is visible
    assert saved.updated_at is not None
    assert connection.execute.await_count == 2
    setting, audit = [call.args[0].compile().params for call in connection.execute.call_args_list]
    assert setting["id"] == 1
    assert setting["active_task_count_visible"] is visible
    assert audit["target_id"] == uuid5(NAMESPACE_URL, "urn:workspace:recognition:settings:1")
    assert audit["target_id"] != user.id
    assert audit["actor_user_id"] == user.id
    assert audit["action"] == "recognition.settings.updated"
    assert audit["details"] == {"activeTaskCountVisible": visible}


@pytest.mark.anyio
@pytest.mark.parametrize("role", ["employee", "manager"])
async def test_non_admin_cannot_change_settings_or_write_audit(role: str) -> None:
    connection = AsyncMock(spec=AsyncConnection)
    with pytest.raises(RecognitionError) as failure:
        await save_settings(
            connection, actor(role), RecognitionSettingsWrite(active_task_count_visible=False)
        )
    assert failure.value.status_code == 403
    connection.execute.assert_not_awaited()
