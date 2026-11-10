import os
from unittest.mock import AsyncMock
from uuid import UUID

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import create_async_engine

from yuksalish_api import repository
from yuksalish_api.auth import load_authenticated_user
from yuksalish_api.seed import seed_demo_data
from yuksalish_api.tables import (
    approval_request_versions,
    approval_requests,
    attachments,
    audit_events,
)
from yuksalish_api.workspace_schemas import CreateApprovalRequest


@pytest.mark.anyio
@pytest.mark.postgres
async def test_payment_file_delete_versions_access_and_transaction_rollback(monkeypatch):
    database_url = os.environ.get("YUKSALISH_TEST_DATABASE_URL")
    if not database_url:
        pytest.skip("YUKSALISH_TEST_DATABASE_URL is not configured")
    engine = create_async_engine(database_url)
    try:
        await seed_demo_data(engine)
        async with engine.connect() as connection:
            transaction = await connection.begin()
            try:
                user_row = await repository.find_active_user_by_username(connection, "aziza")
                assert user_row is not None
                actor = await load_authenticated_user(connection, user_row["id"])
                assert actor is not None
                request = await repository.create_approval_request(
                    connection, actor, CreateApprovalRequest(title="Payment file QA", amount=1000),
                )
                request_id = UUID(request.id)
                files = []
                for role in ("primary", "additional"):
                    files.append(await repository.create_attachment(
                        connection, actor, "approval_request", request_id,
                        file_name=f"{role}.pdf", content_type="application/pdf",
                        byte_size=42, sha256="a" * 64, storage_key=f"qa/{request_id}/{role}",
                        document_role=role,
                    ))
                removed_id, kept_id = [UUID(item.id) for item in files]
                before = await connection.scalar(select(approval_requests.c.current_version).where(
                    approval_requests.c.id == request_id,
                ))
                await repository.delete_approval_attachment(
                    connection, actor, request_id, removed_id,
                )
                versions = (await connection.execute(select(approval_request_versions).where(
                    approval_request_versions.c.request_id == request_id,
                ).order_by(approval_request_versions.c.version))).mappings().all()
                assert versions[-1]["version"] == before + 1
                assert versions[-1]["change_reason"] == "attachment_removed"
                assert versions[-1]["change_comment"] == "primary.pdf"
                assert versions[-1]["attachment_ids"] == [str(kept_id)]
                assert str(removed_id) in versions[-2]["attachment_ids"]
                audit = (await connection.execute(select(audit_events).where(
                    audit_events.c.target_id == request_id,
                    audit_events.c.action == "approval.attachment_deleted",
                ))).mappings().one()
                assert audit["actor_user_id"] == actor.id
                assert audit["details"]["attachmentId"] == str(removed_id)
                assert audit["details"]["storageKey"] == f"qa/{request_id}/primary"
                with pytest.raises(repository.WorkspaceRepositoryError) as gone:
                    await repository.get_attachment(connection, actor, removed_id)
                assert gone.value.status_code == 404
                assert (await repository.get_attachment(connection, actor, kept_id))[0].id \
                    == str(kept_id)
                with pytest.raises(repository.WorkspaceRepositoryError):
                    await repository.delete_approval_attachment(
                        connection, actor, request_id, removed_id,
                    )
                assert await connection.scalar(select(approval_requests.c.current_version).where(
                    approval_requests.c.id == request_id,
                )) == before + 1

                # Failure while recording the new version must restore the file metadata.
                with monkeypatch.context() as patch:
                    patch.setattr(repository, "_append_request_version", AsyncMock(
                        side_effect=RuntimeError("Version write failed"),
                    ))
                    with pytest.raises(RuntimeError, match="Version write failed"):
                        async with connection.begin_nested():
                            await repository.delete_approval_attachment(
                                connection, actor, request_id, kept_id,
                            )
                assert await connection.scalar(select(attachments.c.id).where(
                    attachments.c.id == kept_id,
                )) == kept_id
                assert await connection.scalar(select(approval_requests.c.current_version).where(
                    approval_requests.c.id == request_id,
                )) == before + 1
            finally:
                await transaction.rollback()
    finally:
        await engine.dispose()
