from uuid import uuid4

import pytest

from yuksalish_api.auth import AuthenticatedUser
from yuksalish_api.repository import (
    WorkspaceRepositoryError,
    publish_workflow,
    save_workflow,
)
from yuksalish_api.workspace_schemas import SaveWorkflowRequest


class UnexpectedDatabaseAccess:
    async def execute(self, _statement: object) -> None:
        raise AssertionError("Forbidden workflow requests must be rejected before database access")


@pytest.mark.anyio
@pytest.mark.parametrize("role", ["employee", "manager"])
async def test_non_administrators_cannot_edit_or_publish_workflows(role: str) -> None:
    actor = AuthenticatedUser(
        id=uuid4(),
        username=role,
        full_name=role.title(),
        position_id=None,
        job_title=None,
        role=role,
    )
    connection = UnexpectedDatabaseAccess()
    template_id = uuid4()

    with pytest.raises(WorkspaceRepositoryError, match="Only administrators") as edit_error:
        await save_workflow(
            connection,  # type: ignore[arg-type]
            actor,
            template_id,
            SaveWorkflowRequest(nodes=[], edges=[]),
        )
    assert edit_error.value.status_code == 403

    with pytest.raises(WorkspaceRepositoryError, match="Only administrators") as publish_error:
        await publish_workflow(connection, actor, template_id)  # type: ignore[arg-type]
    assert publish_error.value.status_code == 403
