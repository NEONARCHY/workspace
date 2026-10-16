"""Consent, confidentiality, atomic materialisation and retry regressions."""

import asyncio
import os
from contextlib import asynccontextmanager
from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

import pytest
from httpx import ASGITransport, AsyncClient
from pydantic import SecretStr
from sqlalchemy import delete, func, insert, select, update
from sqlalchemy.ext.asyncio import create_async_engine

from yuksalish_api import task_proposal_service
from yuksalish_api.access_control import request_module_action
from yuksalish_api.auth import AuthenticatedUser
from yuksalish_api.main import create_app
from yuksalish_api.repository import WorkspaceRepositoryError, load_workspace
from yuksalish_api.seed import seed_demo_data
from yuksalish_api.settings import Settings
from yuksalish_api.tables import (
    audit_events,
    chat_members,
    chats,
    task_checklist_items,
    task_cycles,
    task_efficiency_events,
    task_participants,
    task_proposals,
    tasks,
    users,
    workspace_notifications,
)
from yuksalish_api.task_proposal_schemas import TaskProposalDecision, TaskProposalWrite
from yuksalish_api.task_proposal_service import decide_proposal, list_proposals, propose_task
from yuksalish_api.workspace_schemas import CreateTaskRequest


@asynccontextmanager
async def scenario():
    url = os.environ.get("YUKSALISH_TEST_DATABASE_URL")
    if not url:
        pytest.skip("YUKSALISH_TEST_DATABASE_URL is not configured")
    engine = create_async_engine(url)
    try:
        await seed_demo_data(engine)
        async with engine.connect() as connection:
            transaction = await connection.begin()
            try:
                actors = []
                for role in ("employee", "employee", "superadmin", "employee"):
                    user_id = uuid4()
                    await connection.execute(insert(users).values(
                        id=user_id, username=f"proposal-{user_id.hex[:12]}",
                        full_name="Proposal Employee", role=role, status="active",
                        created_at=datetime.now(UTC), updated_at=datetime.now(UTC),
                    ))
                    actors.append(AuthenticatedUser(
                        id=user_id, username=f"proposal-{user_id.hex[:12]}",
                        full_name="Proposal Employee", position_id=None,
                        job_title=None, role=role,
                    ))
                yield connection, actors
            finally:
                await transaction.rollback()
    finally:
        await engine.dispose()


def draft(creator, author, **changes):
    return TaskProposalWrite(
        request_id=uuid4(), author_user_id=author.id,
        task=CreateTaskRequest.model_validate({
            "title": "Employee proposal", "assigneeId": str(creator.id),
            "dueAt": (datetime.now(UTC) + timedelta(days=3)).isoformat(),
            **changes,
        }),
    )


def test_proposal_module_gate():
    assert request_module_action("/api/v1/task-proposals", "POST") == ("tasks", "create")
    assert request_module_action("/api/v1/task-proposals", "GET") == ("tasks", "view")
    assert request_module_action("/api/v1/task-proposals/id/decision", "POST") == ("tasks", "view")


@pytest.mark.anyio
@pytest.mark.postgres
async def test_consent_creates_one_task_and_chat_with_complete_draft():
    async with scenario() as (connection, actors):
        creator, author, admin, observer = actors
        before = await connection.scalar(select(func.count()).select_from(tasks))
        before_events = await connection.scalar(
            select(func.count()).select_from(task_efficiency_events),
        )
        payload = draft(creator, author, description="Expected result", priority="high",
                        participants=[{"userId": str(admin.id), "role": "co_assignee"},
                                      {"userId": str(observer.id), "role": "observer"}],
                        checklist=[{"title": "Step one"}, {"title": "Step two"}],
                        cycle={"title": "Repeat", "scheduleKind": "weekly"})
        proposal = await propose_task(connection, creator, payload)
        assert proposal.status == "pending" and proposal.task_id is None
        assert await connection.scalar(select(func.count()).select_from(tasks)) == before
        assert await connection.scalar(
            select(func.count()).select_from(task_efficiency_events),
        ) == before_events
        assert not await list_proposals(connection, admin)
        assert len(await list_proposals(connection, author)) == 1
        # Loading bootstrap must not auto-resolve the pending action notification.
        workspace = await load_workspace(connection, author)
        assert any(item.entity_id == proposal.id and item.requires_action
                   and item.resolved_at is None for item in workspace.notifications)
        assert (await propose_task(connection, creator, payload)).id == proposal.id
        for unauthorized in (creator, admin, observer):
            with pytest.raises(WorkspaceRepositoryError) as forbidden:
                await decide_proposal(connection, unauthorized, UUID(proposal.id),
                                      TaskProposalDecision(action="approve"))
            assert forbidden.value.status_code == 403
        approved = await decide_proposal(connection, author, UUID(proposal.id),
                                        TaskProposalDecision(action="approve"))
        assert approved.task_id and approved.status == "approved"
        repeated = await decide_proposal(connection, author, UUID(proposal.id),
                                        TaskProposalDecision(action="approve"))
        assert repeated.task_id == approved.task_id
        assert await connection.scalar(select(func.count()).select_from(tasks)) == before + 1
        task_id = UUID(approved.task_id)
        task = (await connection.execute(
            select(tasks).where(tasks.c.id == task_id),
        )).mappings().one()
        assert task["author_user_id"] == author.id
        assert task["primary_assignee_user_id"] == creator.id
        assert task["description"] == "Expected result" and task["priority"] == "high"
        assert await connection.scalar(select(task_cycles.c.created_by_user_id).where(
            task_cycles.c.id == task["cycle_id"],
        )) == author.id
        assert len((await connection.execute(select(task_participants).where(
            task_participants.c.task_id == task_id,
        ))).all()) == 2
        assert len((await connection.execute(select(task_checklist_items).where(
            task_checklist_items.c.task_id == task_id,
        ))).all()) == 2
        chat = (await connection.execute(select(chats.c.id).where(
            chats.c.context_type == "task", chats.c.context_id == task_id,
        ))).scalar_one()
        members = set((await connection.execute(select(chat_members.c.user_id).where(
            chat_members.c.chat_id == chat,
        ))).scalars())
        assert members == {item.id for item in actors}
        assert await connection.scalar(select(func.count()).select_from(audit_events).where(
            audit_events.c.target_id == UUID(proposal.id),
            audit_events.c.action == "task_proposal.approved",
            audit_events.c.actor_user_id == author.id,
        )) == 1
        assert await connection.scalar(select(workspace_notifications.c.resolved_at).where(
            workspace_notifications.c.event_key == f"task-proposal:{proposal.id}",
        )) is not None


@pytest.mark.anyio
@pytest.mark.postgres
@pytest.mark.parametrize("action", ["reject", "cancel"])
async def test_reject_and_withdraw_never_create_tasks(action):
    async with scenario() as (connection, actors):
        creator, author, _, _ = actors
        payload = draft(creator, author)
        proposal = await propose_task(connection, creator, payload)
        before = await connection.scalar(select(func.count()).select_from(tasks))
        actor = author if action == "reject" else creator
        if action == "reject":
            with pytest.raises(WorkspaceRepositoryError) as missing_reason:
                await decide_proposal(connection, actor, UUID(proposal.id),
                                      TaskProposalDecision(action="reject"))
            assert missing_reason.value.status_code == 422
        result = await decide_proposal(connection, actor, UUID(proposal.id),
                                       TaskProposalDecision(action=action, reason="Not agreed"))
        assert result.task_id is None and result.reason == "Not agreed"
        with pytest.raises(WorkspaceRepositoryError) as conflict:
            await decide_proposal(connection, author, UUID(proposal.id),
                                  TaskProposalDecision(action="approve"))
        assert conflict.value.status_code == 409
        assert await connection.scalar(select(func.count()).select_from(tasks)) == before


@pytest.mark.anyio
@pytest.mark.postgres
async def test_approval_revalidates_active_people_and_expired_deadline():
    async with scenario() as (connection, actors):
        creator, author, _, observer = actors
        payload = draft(creator, author, participants=[
            {"userId": str(observer.id), "role": "observer"},
        ])
        proposal = await propose_task(connection, creator, payload)
        await connection.execute(update(users).where(
            users.c.id == observer.id,
        ).values(status="blocked"))
        with pytest.raises(WorkspaceRepositoryError):
            await decide_proposal(connection, author, UUID(proposal.id),
                                  TaskProposalDecision(action="approve"))
        assert (await list_proposals(connection, author))[0].status == "pending"
        await connection.execute(update(users).where(
            users.c.id == observer.id,
        ).values(status="active"))
        expired = payload.task.model_dump(mode="json", by_alias=True)
        expired["dueAt"] = (datetime.now(UTC) - timedelta(minutes=1)).isoformat()
        await connection.execute(update(task_proposals).where(
            task_proposals.c.id == UUID(proposal.id),
        ).values(payload=expired))
        with pytest.raises(WorkspaceRepositoryError) as too_late:
            await decide_proposal(connection, author, UUID(proposal.id),
                                  TaskProposalDecision(action="approve"))
        assert too_late.value.status_code == 409
        assert (await list_proposals(connection, author))[0].task_id is None


@pytest.mark.anyio
@pytest.mark.postgres
async def test_cannot_impersonate_change_assignee_or_reuse_request_id():
    async with scenario() as (connection, actors):
        creator, author, admin, _ = actors
        with pytest.raises(WorkspaceRepositoryError):
            await propose_task(connection, creator, draft(creator, creator))
        with pytest.raises(WorkspaceRepositoryError):
            await propose_task(
                connection, creator, draft(creator, author, assigneeId=str(admin.id)),
            )
        payload = draft(creator, author)
        await propose_task(connection, creator, payload)
        changed = payload.model_copy(update={
            "task": payload.task.model_copy(update={"title": "Different conditions"}),
        })
        with pytest.raises(WorkspaceRepositoryError) as conflict:
            await propose_task(connection, creator, changed)
        assert conflict.value.status_code == 409


@pytest.mark.anyio
@pytest.mark.postgres
async def test_http_concurrent_consent_and_failed_creation_are_atomic(monkeypatch):
    url = os.environ.get("YUKSALISH_TEST_DATABASE_URL")
    if not url:
        pytest.skip("YUKSALISH_TEST_DATABASE_URL is not configured")
    app = create_app(Settings(
        environment="test", database_url=url, seed_demo_data=True,
        demo_password=SecretStr("Yuksalish-Local-2026!"),
        auth_signing_key=SecretStr("proposal-test-signing-key"),
        auth_encryption_key=SecretStr("proposal-test-encryption-key"),
    ))
    async with (
        app.router.lifespan_context(app),
        AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client,
    ):
        sessions = {}
        for username in ("dilshod", "baxtiyor"):
            login = await client.post("/api/v1/auth/login", json={
                "username": username, "password": "Yuksalish-Local-2026!",
                "deviceLabel": "proposal integration test",
            })
            assert login.status_code == 200
            sessions[username] = login.json()
        creator, author = sessions["dilshod"], sessions["baxtiyor"]
        creator_headers = {"Authorization": f"Bearer {creator['accessToken']}"}
        author_headers = {"Authorization": f"Bearer {author['accessToken']}"}
        proposal_id = uuid4()
        created = await client.post("/api/v1/task-proposals", headers=creator_headers, json={
            "requestId": str(proposal_id), "authorUserId": author["user"]["id"],
            "task": {"title": "Atomic consent test", "assigneeId": creator["user"]["id"]},
        })
        assert created.status_code == 201, created.text
        endpoint = f"/api/v1/task-proposals/{proposal_id}/decision"
        assert (await client.post(endpoint, json={"action": "approve"})).status_code == 401
        assert (await client.post(
            endpoint, headers=creator_headers, json={"action": "approve"},
        )).status_code == 403
        original_create = task_proposal_service.create_task

        async def fail_after_insert(*args, **kwargs):
            await original_create(*args, **kwargs)
            raise WorkspaceRepositoryError(409, "Injected failure after task and chat")

        monkeypatch.setattr(task_proposal_service, "create_task", fail_after_insert)
        failed = await client.post(endpoint, headers=author_headers, json={"action": "approve"})
        assert failed.status_code == 409
        engine = app.state.database_engine
        async with engine.connect() as connection:
            assert await connection.scalar(select(func.count()).select_from(tasks).where(
                tasks.c.title == "Atomic consent test",
            )) == 0
            assert await connection.scalar(select(task_proposals.c.status).where(
                task_proposals.c.id == proposal_id,
            )) == "pending"
        monkeypatch.setattr(task_proposal_service, "create_task", original_create)
        results = await asyncio.gather(*(
            client.post(endpoint, headers=author_headers, json={"action": "approve"})
            for _ in range(2)
        ))
        assert [result.status_code for result in results] == [200, 200]
        task_id = results[0].json()["taskId"]
        assert task_id == results[1].json()["taskId"]
        assert (await client.delete(
            f"/api/v1/tasks/{task_id}", headers=author_headers,
        )).status_code == 204
        async with engine.begin() as connection:
            await connection.execute(delete(task_proposals).where(
                task_proposals.c.id == proposal_id,
            ))
