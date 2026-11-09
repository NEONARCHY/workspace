import os
from datetime import UTC, datetime
from typing import Any
from unittest.mock import AsyncMock, Mock
from uuid import UUID, uuid4

import pytest
from fastapi import HTTPException
from sqlalchemy import insert, select, update
from sqlalchemy.ext.asyncio import AsyncConnection, create_async_engine

from yuksalish_api.assistant_service import _visible_notification_rows, personal_activity_context
from yuksalish_api.auth import AuthenticatedUser
from yuksalish_api.repository import (
    WorkspaceRepositoryError,
    _visible_approval_requests,
    act_on_request,
    create_approval_request,
    create_attachment,
    get_attachment,
    load_workspace,
    mark_notification_read,
    publish_workflow,
    update_approval_request,
    validate_attachment_owner,
)
from yuksalish_api.seed import seed_demo_data
from yuksalish_api.tables import (
    approval_nodes,
    approval_requests,
    approval_templates,
    module_access_rules,
    users,
    workspace_notifications,
)
from yuksalish_api.telegram_notification_service import open_notice
from yuksalish_api.telegram_notification_tables import deliveries
from yuksalish_api.workspace_schemas import (
    ApprovalActionRequest,
    CreateApprovalRequest,
    UpdateApprovalRequest,
)


def _user(role: str = "employee", position_id: UUID | None = None) -> AuthenticatedUser:
    identifier = uuid4()
    return AuthenticatedUser(
        id=identifier, username=f"visibility-{identifier.hex}", full_name="Visibility test",
        position_id=position_id, job_title=None, role=role,
    )


@pytest.mark.anyio
@pytest.mark.parametrize("assignment", ["user", "position", "positions", "role"])
async def test_published_approvers_see_all_requests_before_and_after_their_stage(
    assignment: str,
) -> None:
    user = _user(position_id=uuid4())
    config = {
        "user": {"approverUserId": str(user.id)},
        "position": {"approverPositionId": str(user.position_id)},
        "positions": {"approverPositionIds": [str(uuid4()), str(user.position_id)]},
        "role": {"approverRole": user.role},
    }[assignment]
    template_id = uuid4()
    node = {
        "template_id": template_id, "node_key": "review", "kind": "approval",
        "template_status": "published", "config": config,
    }
    rows = [
        {"id": uuid4(), "template_id": template_id, "requester_user_id": uuid4(),
         "active_node_keys": stages, "status": status}
        for stages, status in [(["earlier"], "running"), ([], "approved"), ([], "rejected")]
    ]
    connection = AsyncMock()
    result = Mock()
    result.mappings.return_value.all.return_value = [node]
    connection.execute.return_value = result
    assert await _visible_approval_requests(connection, user, rows) == rows


@pytest.mark.anyio
@pytest.mark.parametrize("role", ["employee", "manager", "admin", "superadmin"])
async def test_only_administrators_have_unconditional_payment_visibility(role: str) -> None:
    user = _user(role)
    own = {"id": uuid4(), "template_id": uuid4(), "requester_user_id": user.id}
    foreign = {
        "id": uuid4(), "template_id": uuid4(), "requester_user_id": uuid4(),
        "responsible_user_id": user.id,
    }
    connection = AsyncMock()
    result = Mock()
    result.mappings.return_value.all.return_value = []
    connection.execute.return_value = result
    visible = await _visible_approval_requests(connection, user, [own, foreign])
    assert visible == ([own, foreign] if role in {"admin", "superadmin"} else [own])
    if role in {"admin", "superadmin"}:
        connection.execute.assert_not_called()


async def _insert_user(connection: AsyncConnection, user: AuthenticatedUser) -> None:
    now = datetime.now(UTC)
    await connection.execute(insert(users).values(
        id=user.id, username=user.username, full_name=user.full_name,
        role=user.role, status="active", created_at=now, updated_at=now,
    ))


@pytest.mark.anyio
@pytest.mark.postgres
async def test_payment_queue_files_notifications_and_delegation_share_visibility() -> None:
    database_url = os.environ.get("YUKSALISH_TEST_DATABASE_URL")
    if not database_url:
        pytest.skip("YUKSALISH_TEST_DATABASE_URL is not configured")
    engine = create_async_engine(database_url)
    try:
        await seed_demo_data(engine)
        async with engine.connect() as connection:
            transaction = await connection.begin()
            try:
                author, other_author = _user(), _user("manager")
                approver, outsider, manager = _user(), _user(), _user("manager")
                correction_only, delegate = _user(), _user()
                admin, superadmin = _user("admin"), _user("superadmin")
                actors = [author, other_author, approver, outsider, manager,
                          correction_only, delegate, admin, superadmin]
                for actor in actors:
                    await _insert_user(connection, actor)
                template_id = await connection.scalar(select(approval_templates.c.id).where(
                    approval_templates.c.template_key == "payment",
                    approval_templates.c.status == "published",
                ))
                assert template_id is not None
                # Only the named reviewer is an approver. Creating/correcting and
                # an unsaved draft assignment must not grant the complete queue.
                await connection.execute(update(approval_nodes).where(
                    approval_nodes.c.template_id == template_id,
                    approval_nodes.c.kind == "start",
                ).values(config={}))
                await connection.execute(update(approval_nodes).where(
                    approval_nodes.c.template_id == template_id,
                    approval_nodes.c.kind == "approval",
                ).values(config={"approverUserId": str(approver.id)}))
                await connection.execute(update(approval_nodes).where(
                    approval_nodes.c.template_id == template_id,
                    approval_nodes.c.kind == "correction",
                ).values(config={"approverUserId": str(correction_only.id)}))
                draft_ids = select(approval_templates.c.id).where(
                    approval_templates.c.template_key == "payment",
                    approval_templates.c.status == "draft",
                )
                await connection.execute(update(approval_nodes).where(
                    approval_nodes.c.template_id.in_(draft_ids),
                    approval_nodes.c.kind == "approval",
                ).values(config={"approverUserId": str(outsider.id)}))
                requests = []
                files = []
                for creator, status in [(author, "running"), (author, "approved"),
                                        (other_author, "running"), (other_author, "rejected")]:
                    request = await create_approval_request(
                        connection, creator, CreateApprovalRequest(
                            title=f"Visibility {status} {len(requests)}", amount=100,
                            responsible_user_id=str(outsider.id),
                        ),
                    )
                    attachment = await create_attachment(
                        connection, creator, "approval_request", UUID(request.id),
                        file_name="invoice.pdf", content_type="application/pdf", byte_size=1,
                        sha256="a" * 64, storage_key=f"visibility/{request.id}",
                    )
                    if status != "running":
                        await connection.execute(update(approval_requests).where(
                            approval_requests.c.id == UUID(request.id),
                        ).values(status=status, active_node_keys=[], finished_at=datetime.now(UTC)))
                    requests.append(request)
                    files.append(attachment)
                ids = {request.id for request in requests}
                for actor, expected in [
                    (author, {requests[0].id, requests[1].id}),
                    (other_author, {requests[2].id, requests[3].id}),
                    (approver, ids), (admin, ids), (superadmin, ids),
                    (outsider, set()), (manager, set()), (correction_only, set()),
                ]:
                    snapshot = await load_workspace(connection, actor)
                    assert {item.id for item in snapshot.requests} & ids == expected
                    context = await personal_activity_context(connection, actor)
                    for request in requests:
                        assert (request.title in context) == (request.id in expected)
                    assert {item.id for item in snapshot.attachments} & {
                        item.id for item in files
                    } == {file.id for request, file in zip(requests, files, strict=True)
                          if request.id in expected}
                    for request, file in zip(requests, files, strict=True):
                        if request.id in expected:
                            metadata, _ = await get_attachment(connection, actor, UUID(file.id))
                            assert metadata.id == file.id
                        else:
                            with pytest.raises(WorkspaceRepositoryError) as denied:
                                await get_attachment(connection, actor, UUID(file.id))
                            assert denied.value.status_code == 404
                # Global visibility is independent of decision rights and file writes.
                with pytest.raises(WorkspaceRepositoryError) as upload_denied:
                    await validate_attachment_owner(
                        connection, approver, "approval_request", UUID(requests[0].id), write=True,
                    )
                assert upload_denied.value.status_code == 404
                with pytest.raises(WorkspaceRepositoryError) as decision_denied:
                    await act_on_request(connection, manager, UUID(requests[0].id),
                                         ApprovalActionRequest(action="approve"))
                assert decision_denied.value.status_code == 404
                # A correction-only creator cannot open or change another author's
                # request, even while it is on the correction stage.
                await connection.execute(update(approval_requests).where(
                    approval_requests.c.id == UUID(requests[1].id),
                ).values(status="needs_revision", active_node_keys=["correction"]))
                for action in ["resubmit", "clarify", "move"]:
                    with pytest.raises(WorkspaceRepositoryError) as correction_denied:
                        await act_on_request(
                            connection, correction_only, UUID(requests[1].id),
                            ApprovalActionRequest(action=action, node_key="correction"),
                        )
                    assert correction_denied.value.status_code == 404
                with pytest.raises(WorkspaceRepositoryError) as edit_denied:
                    await update_approval_request(
                        connection, correction_only, UUID(requests[1].id),
                        UpdateApprovalRequest(title="Forbidden", amount=100),
                    )
                assert edit_denied.value.status_code == 404
                assert not {item.id for item in (
                    await load_workspace(connection, correction_only)
                ).requests} & ids
                # Old notifications cannot reveal a request after access is revoked.
                for actor in [outsider, approver]:
                    notification_id, delivery_id = uuid4(), uuid4()
                    common: dict[str, Any] = {
                        "user_id": actor.id, "entity_id": UUID(requests[0].id),
                        "event_key": f"visibility:{actor.id}",
                        "title": "Private payment", "body": "Private payment details",
                    }
                    await connection.execute(insert(workspace_notifications).values(
                        id=notification_id, **common, kind="approval", priority="normal",
                        section="payment_requests", requires_action=False, is_reminder=False,
                        occurred_at=datetime.now(UTC),
                    ))
                    await connection.execute(insert(deliveries).values(
                        id=delivery_id, **common, kind="payment_action", state="pending",
                        created_at=datetime.now(UTC),
                    ))
                    snapshot = await load_workspace(connection, actor)
                    if actor.id == outsider.id:
                        assert str(notification_id) not in {n.id for n in snapshot.notifications}
                        assistant_notices = await _visible_notification_rows(
                            connection, actor, limit=300,
                        )
                        assert notification_id not in {n.id for n in assistant_notices}
                        for operation in [mark_notification_read, open_notice]:
                            identifier = notification_id if operation == mark_notification_read \
                                else delivery_id
                            with pytest.raises(WorkspaceRepositoryError) as denied:
                                await operation(connection, actor, identifier)
                            assert denied.value.status_code == 404
                    else:
                        assert str(notification_id) in {n.id for n in snapshot.notifications}
                        assert (await open_notice(connection, actor, delivery_id)).entity_id \
                            == requests[0].id
                # A delegated employee sees this request and can decide on that stage.
                delegated = await act_on_request(
                    connection, approver, UUID(requests[0].id),
                    ApprovalActionRequest(action="delegate", delegate_to_user_id=str(delegate.id)),
                )
                snapshot = await load_workspace(connection, delegate)
                assert {item.id for item in snapshot.requests} & ids == {delegated.id}
                assert (await get_attachment(connection, delegate, UUID(files[0].id)))[0].id \
                    == files[0].id
                decided = await act_on_request(
                    connection, delegate, UUID(delegated.id),
                    ApprovalActionRequest(action="approve"),
                )
                assert decided.active_node_keys != delegated.active_node_keys
                # Publishing a new route grants its approvers the full queue.
                # Historical approvers retain only requests using their old route.
                draft_id = await connection.scalar(select(approval_templates.c.id).where(
                    approval_templates.c.template_key == "payment",
                    approval_templates.c.status == "draft",
                ))
                assert draft_id is not None
                await connection.execute(update(approval_nodes).where(
                    approval_nodes.c.template_id == draft_id,
                    approval_nodes.c.kind == "start",
                ).values(config={}))
                await publish_workflow(connection, admin, draft_id)
                latest = await create_approval_request(
                    connection, author, CreateApprovalRequest(title="New route", amount=100),
                )
                previous = await load_workspace(connection, approver)
                assert {item.id for item in previous.requests} & (ids | {latest.id}) == ids
                current = await load_workspace(connection, outsider)
                assert {item.id for item in current.requests} & (ids | {latest.id}) \
                    == ids | {latest.id}
                now = datetime.now(UTC)
                for actor, permissions in [(manager, {"admin": True}), (outsider, {})]:
                    await connection.execute(insert(module_access_rules).values(
                        id=uuid4(), subject_type="user", subject_key=str(actor.id),
                        module_key="payment_requests", permissions=permissions,
                        created_by_user_id=admin.id, created_at=now, updated_at=now,
                    ))
                    assert not (await load_workspace(connection, actor)).requests
                    assert "Заявка:" not in await personal_activity_context(connection, actor)
                # Even a published approver cannot read an old notice when the
                # module itself is disabled for their account.
                blocked_notice = uuid4()
                await connection.execute(insert(workspace_notifications).values(
                    id=blocked_notice, user_id=outsider.id, event_key="visibility:blocked",
                    entity_id=UUID(latest.id), title="Private", body="Private",
                    kind="approval", priority="normal", section="payment_requests",
                    requires_action=False, is_reminder=False, occurred_at=now,
                ))
                with pytest.raises(HTTPException) as module_denied:
                    await mark_notification_read(connection, outsider, blocked_notice)
                assert module_denied.value.status_code == 403
            finally:
                await transaction.rollback()
    finally:
        await engine.dispose()
