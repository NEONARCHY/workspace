"""Real grant deadline permissions, requests, concurrency guards and audit history."""

import asyncio
import os
from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

import pytest
from fastapi import HTTPException
from httpx import ASGITransport, AsyncClient
from pydantic import ValidationError
from sqlalchemy import delete, func, insert, select, update
from sqlalchemy.ext.asyncio import create_async_engine

from test_grants import draft, scenario
from yuksalish_api import grant_deadlines, grant_service
from yuksalish_api.auth import issue_access_token, load_authenticated_user
from yuksalish_api.errors import WorkspaceRepositoryError
from yuksalish_api.events import WorkspaceEventBus
from yuksalish_api.grant_schemas import GrantAction, GrantEdit, GrantSettingsWrite
from yuksalish_api.grant_tables import (
    grant_deadline_requests,
    grant_events,
    grant_requests,
    grant_settings,
)
from yuksalish_api.main import create_app
from yuksalish_api.seed import seed_demo_data
from yuksalish_api.settings import Settings
from yuksalish_api.tables import (
    audit_events,
    chat_members,
    chats,
    module_access_rules,
    users,
    workspace_notifications,
)

pytestmark = [pytest.mark.anyio, pytest.mark.postgres]


@pytest.fixture
def anyio_backend():
    return "asyncio"


async def started(connection, actors, status="in_progress"):
    initiator, executor, co, _leader, chair, _admin, _stranger = actors
    grant = await grant_service.create_grant(connection, initiator, draft(executor, co))
    grant = await grant_service.act_on_grant(connection, chair, UUID(grant.id), GrantAction(
        action="approve_launch", expected_revision=grant.revision,
    ))
    if status != "in_progress":
        await connection.execute(update(grant_requests).where(
            grant_requests.c.id == UUID(grant.id),
        ).values(status=status, result_text="Prepared grant result"))
    return await grant_service.get_grant(connection, initiator, UUID(grant.id))


async def act(connection, user, grant, action, **fields):
    return await grant_service.act_on_grant(connection, user, UUID(grant.id), GrantAction(
        action=action, expected_revision=grant.revision, **fields,
    ))


@pytest.mark.parametrize("owner", [0, 4])
@pytest.mark.parametrize("stage", ["in_progress", "chair_review"])
async def test_owner_or_initiator_extends_without_changing_review_or_result(owner, stage):
    async with scenario() as (connection, actors):
        grant = await started(connection, actors, stage)
        old = grant.due_at
        due = old + timedelta(days=3)
        saved = await act(connection, actors[owner], grant, "extend_deadline",
                          due_at=due, text="Waiting for donor documents")
        assert saved.due_at == due and saved.status == grant.status
        assert saved.result_text == grant.result_text
        assert saved.revision == grant.revision + 1
        event = saved.events[-1]
        assert (event.action, event.old_due_at, event.due_at) == ("extend_deadline", old, due)
        assert event.actor_user_id == str(actors[owner].id)
        assert event.text == "Waiting for donor documents"


@pytest.mark.parametrize(("requester", "decider"), [(1, 0), (2, 4), (1, 4), (2, 0)])
@pytest.mark.parametrize("approve", [True, False])
async def test_executor_request_and_named_owner_decision(requester, decider, approve):
    async with scenario() as (connection, actors):
        grant = await started(connection, actors, "chair_review")
        due = grant.due_at + timedelta(days=2)
        requested = await act(connection, actors[requester], grant, "request_deadline",
                              due_at=due, text="Need the partner budget")
        assert requested.due_at == grant.due_at
        pending = requested.pending_deadline_request
        assert pending and pending.requested_by_user_id == str(actors[requester].id)
        assert pending.old_due_at == grant.due_at and pending.due_at == due
        owner_view = await grant_service.get_grant(connection, actors[decider], UUID(grant.id))
        assert "approve_deadline" in owner_view.allowed_actions
        assert "reject_deadline" in owner_view.allowed_actions
        # Deadline notifications preserve the outstanding review decision too.
        active = (await connection.execute(select(workspace_notifications.c.user_id).where(
            workspace_notifications.c.entity_id == UUID(grant.id),
            workspace_notifications.c.resolved_at.is_(None),
            workspace_notifications.c.requires_action.is_(True),
        ))).scalars().all()
        assert {actors[0].id, actors[4].id} <= set(active)
        saved = await act(connection, actors[decider], requested,
                          "approve_deadline" if approve else "reject_deadline",
                          request_id=UUID(pending.id), text="Decision with a reason")
        assert saved.status == "chair_review" and saved.result_text == grant.result_text
        assert saved.due_at == (due if approve else grant.due_at)
        assert saved.pending_deadline_request is None
        decision = saved.deadline_requests[0]
        assert decision.status == ("approved" if approve else "rejected")
        assert decision.decided_by_user_id == str(actors[decider].id)
        assert decision.decided_at and decision.decided_at.utcoffset() is not None
        assert decision.reason == "Need the partner budget"
        assert saved.events[-1].old_due_at == grant.due_at
        assert saved.events[-1].due_at == due
        with pytest.raises(WorkspaceRepositoryError) as stale:
            await act(connection, actors[decider], requested, "approve_deadline",
                      request_id=UUID(pending.id))
        assert stale.value.status_code == 409


async def test_deadline_roles_module_rights_and_terminal_records_are_enforced():
    async with scenario() as (connection, actors):
        grant = await started(connection, actors)
        due = grant.due_at + timedelta(days=2)
        for actor in [actors[1], actors[2], actors[3], actors[5], actors[6]]:
            with pytest.raises((WorkspaceRepositoryError, HTTPException)) as denied:
                await act(connection, actor, grant, "extend_deadline", due_at=due, text="Reason")
            assert denied.value.status_code in {403, 404}
        for actor in [actors[0], actors[3], actors[5], actors[6]]:
            with pytest.raises((WorkspaceRepositoryError, HTTPException)) as denied:
                await act(connection, actor, grant, "request_deadline", due_at=due, text="Reason")
            assert denied.value.status_code in {403, 404}
        requested = await act(connection, actors[1], grant, "request_deadline",
                              due_at=due, text="Reason")
        for actor in [actors[1], actors[2], actors[3], actors[5]]:
            with pytest.raises(WorkspaceRepositoryError) as denied:
                await act(connection, actor, requested, "approve_deadline",
                          request_id=UUID(requested.pending_deadline_request.id))
            assert denied.value.status_code == 403
        await connection.execute(insert(module_access_rules).values(
            id=uuid4(), subject_type="user", subject_key=str(actors[0].id), module_key="grants",
            permissions={"edit": False}, created_by_user_id=actors[5].id,
            created_at=datetime.now(UTC), updated_at=datetime.now(UTC),
        ))
        with pytest.raises(HTTPException) as denied:
            await act(connection, actors[0], requested, "extend_deadline",
                      due_at=due, text="Reason")
        assert denied.value.status_code == 403
        completed = await act(connection, actors[4], await grant_service.get_grant(
            connection, actors[4], UUID(grant.id),
        ), "extend_deadline", due_at=due + timedelta(days=1), text="Reason")
        await connection.execute(update(grant_requests).where(
            grant_requests.c.id == UUID(grant.id),
        ).values(status="completed"))
        for action in ("extend_deadline", "request_deadline"):
            with pytest.raises(WorkspaceRepositoryError) as denied:
                await act(connection, actors[4], completed, action, due_at=due, text="Reason")
            assert denied.value.status_code == 403


@pytest.mark.parametrize("change", ["missing", "earlier", "past", "blank", "short"])
async def test_invalid_extension_does_not_change_due_revision_or_history(change):
    async with scenario() as (connection, actors):
        grant = await started(connection, actors)
        fields = {"due_at": grant.due_at + timedelta(days=1), "text": "Need more time"}
        if change == "missing":
            fields["due_at"] = None
        if change == "earlier":
            fields["due_at"] = grant.due_at - timedelta(hours=1)
        if change == "past":
            fields["due_at"] = datetime.now(UTC) - timedelta(days=1)
        if change in {"blank", "short"}:
            fields["text"] = " " if change == "blank" else "ab"
        with pytest.raises(WorkspaceRepositoryError) as error:
            await act(connection, actors[0], grant, "extend_deadline", **fields)
        assert error.value.status_code == 422
        saved = await grant_service.get_grant(connection, actors[0], UUID(grant.id))
        assert (saved.due_at, saved.revision, len(saved.events)) == (
            grant.due_at, grant.revision, len(grant.events),
        )


async def test_direct_change_supersedes_pending_and_old_decision_cannot_overwrite_it():
    async with scenario() as (connection, actors):
        grant = await started(connection, actors)
        requested = await act(connection, actors[2], grant, "request_deadline",
                              due_at=grant.due_at + timedelta(days=2), text="Partner delayed")
        saved = await act(connection, actors[0], requested, "extend_deadline",
                          due_at=grant.due_at + timedelta(days=4), text="Agreed with partner")
        assert saved.deadline_requests[0].status == "superseded"
        with pytest.raises(WorkspaceRepositoryError) as conflict:
            await act(connection, actors[4], saved, "approve_deadline",
                      request_id=UUID(requested.pending_deadline_request.id))
        assert conflict.value.status_code in {403, 409}
        final = await grant_service.get_grant(connection, actors[0], UUID(grant.id))
        assert final.due_at == saved.due_at
        assert await connection.scalar(select(func.count()).select_from(
            grant_deadline_requests,
        ).where(
            grant_deadline_requests.c.grant_id == UUID(grant.id),
            grant_deadline_requests.c.status == "pending",
        )) == 0


async def test_edit_and_completion_resolve_pending_requests_and_legacy_grants_work():
    async with scenario() as (connection, actors):
        grant = await started(connection, actors)
        requested = await act(connection, actors[1], grant, "request_deadline",
                              due_at=grant.due_at + timedelta(days=2), text="Need more time")
        edited = await grant_service.edit_grant(connection, actors[4], UUID(grant.id), GrantEdit(
            title=grant.title, description=grant.description, assignee_id=actors[1].id,
            co_assignee_ids=[actors[2].id], due_at=grant.due_at + timedelta(days=1),
            checklist=[], expected_revision=requested.revision,
        ))
        assert edited.deadline_requests[0].status == "superseded"
        assert edited.events[-1].old_due_at == grant.due_at
        await connection.execute(update(grant_requests).where(
            grant_requests.c.id == UUID(grant.id),
        ).values(workflow_version=1, author_user_id=actors[0].id, status="chair_review",
                 launch_approved_at=None, launch_approved_by_user_id=None))
        legacy = await grant_service.get_grant(connection, actors[0], UUID(grant.id))
        requested = await act(connection, actors[1], legacy, "request_deadline",
                              due_at=edited.due_at + timedelta(days=2), text="Legacy request")
        completed = await act(connection, actors[4], requested, "approve")
        assert completed.status == "completed"
        assert completed.deadline_requests[0].status == "superseded"
        assert completed.pending_deadline_request is None
        assert "request_deadline" not in completed.allowed_actions


async def test_wrong_request_and_expired_proposal_cannot_be_approved(monkeypatch):
    async with scenario() as (connection, actors):
        grant = await started(connection, actors)
        due = grant.due_at + timedelta(days=1)
        requested = await act(connection, actors[1], grant, "request_deadline",
                              due_at=due, text="Waiting for partner")
        with pytest.raises(WorkspaceRepositoryError) as mismatch:
            await act(connection, actors[0], requested, "approve_deadline", request_id=uuid4())
        assert mismatch.value.status_code == 409

        class LaterClock:
            @staticmethod
            def now(_timezone):
                return due + timedelta(minutes=1)

        monkeypatch.setattr(grant_deadlines, "datetime", LaterClock)
        with pytest.raises(WorkspaceRepositoryError) as expired:
            await act(connection, actors[0], requested, "approve_deadline",
                      request_id=UUID(requested.pending_deadline_request.id))
        assert expired.value.status_code == 422
        saved = await grant_service.get_grant(connection, actors[0], UUID(grant.id))
        assert saved.due_at == grant.due_at and saved.revision == requested.revision
        assert saved.pending_deadline_request.status == "pending"


def test_naive_deadline_is_rejected_before_service_and_db():
    with pytest.raises(ValidationError):
        GrantAction(action="extend_deadline", expected_revision=1, text="Reason",
                    due_at=datetime(2027, 1, 1, 9))


async def test_http_concurrent_request_and_decision_are_atomic(monkeypatch):
    url = os.environ.get("YUKSALISH_TEST_DATABASE_URL")
    if not url:
        pytest.skip("YUKSALISH_TEST_DATABASE_URL is not configured")
    engine = create_async_engine(url)
    await seed_demo_data(engine)
    ids = [uuid4() for _ in range(7)]
    now = datetime.now(UTC)
    async with engine.begin() as connection:
        previous_settings = (await connection.execute(select(grant_settings))).mappings().first()
        await connection.execute(insert(users), [{
            "id": user_id, "username": f"deadline-{user_id.hex}", "full_name": "Deadline QA",
            "role": "superadmin" if index == 5 else "employee", "status": "active",
            "created_at": now, "updated_at": now,
        } for index, user_id in enumerate(ids)])
        actors = [await load_authenticated_user(connection, user_id) for user_id in ids]
        settings = await grant_service.get_settings(connection, actors[5])
        await grant_service.save_settings(connection, actors[5], GrantSettingsWrite(
            leader_user_id=ids[3], chair_user_id=ids[4], expected_revision=settings.revision,
        ))
        grant = await started(connection, actors, "chair_review")
    app_settings = Settings(environment="test", database_url=url, seed_demo_data=False)
    app = create_app(app_settings)
    app.state.database_engine = engine
    app.state.event_bus = WorkspaceEventBus()

    def headers(index):
        token = issue_access_token(ids[index], app_settings.auth_signing_key)
        return {"Authorization": "Bearer " + token}

    path = f"/api/v1/grants/{grant.id}"
    try:
        async with AsyncClient(
            transport=ASGITransport(app=app, raise_app_exceptions=False), base_url="http://test",
        ) as client:
            due = (grant.due_at + timedelta(days=2)).isoformat()
            payload = {"action": "request_deadline", "expectedRevision": grant.revision,
                       "dueAt": due, "text": "Waiting for partner documents"}
            responses = await asyncio.gather(*[
                client.post(path + "/actions", headers=headers(index), json=payload)
                for index in (1, 2)
            ])
            assert sorted(response.status_code for response in responses) == [200, 409]
            requested = next(
                response.json() for response in responses if response.status_code == 200
            )
            assert len(requested["deadlineRequests"]) == 1
            request_id = requested["pendingDeadlineRequest"]["id"]
            decision = {"action": "approve_deadline", "expectedRevision": requested["revision"],
                        "requestId": request_id}
            decisions = await asyncio.gather(*[
                client.post(path + "/actions", headers=headers(index), json=decision)
                for index in (0, 4)
            ])
            assert sorted(response.status_code for response in decisions) == [200, 409]
            final = (await client.get(path, headers=headers(0))).json()
            assert datetime.fromisoformat(final["dueAt"]) == datetime.fromisoformat(due)
            assert final["status"] == "chair_review"
            assert final["pendingDeadlineRequest"] is None
            assert sum(event["action"] == "approve_deadline" for event in final["events"]) == 1
            assert (await client.get(path, headers=headers(6))).status_code == 404
            invalid = {"action": "extend_deadline", "expectedRevision": final["revision"],
                       "dueAt": "2099-12-01T09:00:00", "text": "Missing timezone"}
            invalid_response = await client.post(
                path + "/actions", headers=headers(0), json=invalid,
            )
            assert invalid_response.status_code == 422
            async def fail_notification(*_args, **_kwargs):
                raise RuntimeError("Synthetic notification failure")

            with monkeypatch.context() as patch:
                patch.setattr(grant_service, "_notify", fail_notification)
                next_due = datetime.fromisoformat(final["dueAt"]) + timedelta(days=1)
                failed = await client.post(path + "/actions", headers=headers(1), json={
                    "action": "request_deadline", "expectedRevision": final["revision"],
                    "dueAt": next_due.isoformat(),
                    "text": "This request must roll back with the notification",
                })
            assert failed.status_code == 500
            unchanged = (await client.get(path, headers=headers(0))).json()
            assert unchanged["revision"] == final["revision"]
            assert unchanged["dueAt"] == final["dueAt"]
            assert unchanged["pendingDeadlineRequest"] is None
            assert unchanged["deadlineRequests"] == final["deadlineRequests"]
            assert unchanged["events"] == final["events"]
    finally:
        async with engine.begin() as connection:
            for table in (grant_deadline_requests, grant_events):
                await connection.execute(delete(table).where(table.c.grant_id == UUID(grant.id)))
            await connection.execute(delete(workspace_notifications).where(
                workspace_notifications.c.entity_id == UUID(grant.id),
            ))
            await connection.execute(delete(grant_requests).where(
                grant_requests.c.id == UUID(grant.id),
            ))
            await connection.execute(delete(chat_members).where(
                chat_members.c.chat_id == UUID(grant.chat_id),
            ))
            await connection.execute(delete(chats).where(chats.c.id == UUID(grant.chat_id)))
            await connection.execute(delete(audit_events).where(
                audit_events.c.actor_user_id.in_(ids),
            ))
            if previous_settings is not None:
                await connection.execute(update(grant_settings).values(**dict(previous_settings)))
            else:
                await connection.execute(delete(grant_settings))
            await connection.execute(delete(users).where(users.c.id.in_(ids)))
        await engine.dispose()
