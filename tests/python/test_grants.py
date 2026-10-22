"""Real PostgreSQL checks for the complete grant route and its trust boundaries."""

import asyncio
import os
from contextlib import asynccontextmanager
from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

import pytest
from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import func, insert, select, update
from sqlalchemy.ext.asyncio import create_async_engine

from yuksalish_api import grant_service, messenger_service
from yuksalish_api.access_control import request_module_action
from yuksalish_api.auth import AuthenticatedUser
from yuksalish_api.errors import WorkspaceRepositoryError
from yuksalish_api.grant_files_service import GrantInitialFile, create_with_files
from yuksalish_api.grant_schemas import (
    GrantAction,
    GrantCreate,
    GrantEdit,
    GrantReviewersWrite,
    GrantSettingsWrite,
)
from yuksalish_api.grant_tables import grant_events, grant_requests
from yuksalish_api.object_storage import InMemoryObjectStorage, ObjectStorageError
from yuksalish_api.repository import (
    create_attachment,
    get_attachment,
    load_workspace,
    validate_attachment_owner,
)
from yuksalish_api.seed import seed_demo_data
from yuksalish_api.tables import (
    chat_members,
    chats,
    module_access_rules,
    tasks,
    users,
    workspace_notifications,
)


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
                for role in (
                    "employee",
                    "employee",
                    "employee",
                    "employee",
                    "employee",
                    "superadmin",
                    "employee",
                ):
                    user_id = uuid4()
                    await connection.execute(
                        insert(users).values(
                            id=user_id,
                            username=f"grant-{user_id.hex[:12]}",
                            full_name="Grant Test",
                            role=role,
                            status="active",
                            created_at=datetime.now(UTC),
                            updated_at=datetime.now(UTC),
                        )
                    )
                    actors.append(
                        AuthenticatedUser(
                            id=user_id,
                            username=f"grant-{user_id.hex[:12]}",
                            full_name="Grant Test",
                            position_id=None,
                            job_title=None,
                            role=role,
                        )
                    )
                _, _, _, leader, chair, admin, _ = actors
                settings = await grant_service.get_settings(connection, admin)
                await grant_service.save_settings(
                    connection,
                    admin,
                    GrantSettingsWrite(
                        leader_user_id=leader.id,
                        chair_user_id=chair.id,
                        expected_revision=settings.revision,
                    ),
                )
                yield connection, actors
            finally:
                await transaction.rollback()
    finally:
        await engine.dispose()


def draft(assignee, coexecutor, **changes):
    return GrantCreate.model_validate(
        {
            "requestId": str(uuid4()),
            "title": "Prepare grant application",
            "description": "Proposal and supporting documents",
            "assigneeId": str(assignee.id),
            "coAssigneeIds": [str(coexecutor.id)],
            "dueAt": (datetime.now(UTC) + timedelta(days=7)).isoformat(),
            "checklist": ["Prepare narrative", "Check budget"],
            **changes,
        }
    )


def test_grant_module_and_navigation_contract():
    assert request_module_action("/api/v1/grants", "POST") == ("grants", "create")
    assert request_module_action("/api/v1/grants/id", "PUT") == ("grants", "edit")
    assert request_module_action("/api/v1/grants/id/actions", "POST") == ("grants", "view")
    assert request_module_action("/api/v1/grants/settings", "PUT") == ("grants", "admin")
    from yuksalish_api.workspace_schemas import DEFAULT_NAVIGATION, NavigationOrder

    old_order = [key for key in DEFAULT_NAVIGATION if key != "grants"]
    order = NavigationOrder(order=old_order, revision=0).order
    assert order[order.index("tasks") + 1] == "grants"
    assert [key for key in order if key != "grants"] == old_order


def test_deadline_and_checklist_validation():
    for change in (
        {"dueAt": "2026-12-01T09:00:00"},
        {"checklist": ["   "]},
        {"checklist": ["x" * 501]},
    ):
        with pytest.raises(ValidationError):
            GrantCreate.model_validate(
                {
                    "requestId": str(uuid4()),
                    "title": "Grant",
                    "assigneeId": str(uuid4()),
                    "dueAt": "2027-12-01T09:00:00+05:00",
                    **change,
                }
            )


@pytest.mark.postgres
def test_full_route_coexecutor_revision_and_only_named_acceptance():
    async def run():
        async with scenario() as (connection, actors):
            author, assignee, coexecutor, leader, chair, admin, outsider = actors
            before_tasks = await connection.scalar(select(func.count()).select_from(tasks))
            payload = draft(assignee, coexecutor)
            grant = await grant_service.create_grant(connection, author, payload)
            grant_id = UUID(grant.id)
            assert grant.status == "launch_review"
            assert grant.author_user_id is None
            assert grant.initiator_user_id == str(author.id)
            assert grant.workflow_version == 2
            for forbidden in (author, assignee, coexecutor, leader, admin):
                with pytest.raises(WorkspaceRepositoryError) as denied:
                    await grant_service.act_on_grant(
                        connection, forbidden, grant_id,
                        GrantAction(action="approve_launch", expected_revision=grant.revision),
                    )
                assert denied.value.status_code == 403
            for action in ("submit", "check"):
                with pytest.raises(WorkspaceRepositoryError) as denied:
                    await grant_service.act_on_grant(
                        connection, assignee, grant_id,
                        GrantAction(
                            action=action, text="Cannot start", expected_revision=grant.revision
                        ),
                    )
                assert denied.value.status_code == 403
            launch_workspace = await load_workspace(connection, chair)
            assert any(
                item.entity_id == grant.id and item.requires_action and not item.resolved_at
                for item in launch_workspace.notifications
            )
            grant = await grant_service.act_on_grant(
                connection, chair, grant_id,
                GrantAction(action="approve_launch", expected_revision=grant.revision),
            )
            assert grant.status == "in_progress"
            assert grant.author_user_id == str(chair.id)
            assert grant.initiator_user_id == str(author.id)
            assert grant.launch_approved_by_user_id == str(chair.id)
            assert grant.launch_approved_at is not None
            assert (await grant_service.create_grant(connection, author, payload)).id == grant.id
            assert (
                await connection.scalar(
                    select(func.count())
                    .select_from(chats)
                    .where(
                        chats.c.context_type == "grant",
                        chats.c.context_id == grant_id,
                    )
                )
                == 1
            )
            members = set(
                (
                    await connection.execute(
                        select(chat_members.c.user_id).where(
                            chat_members.c.chat_id == UUID(grant.chat_id),
                        )
                    )
                ).scalars()
            )
            assert members == {actor.id for actor in actors[:5]}
            assert await connection.scalar(select(chat_members.c.user_id).where(
                chat_members.c.chat_id == UUID(grant.chat_id),
                chat_members.c.member_role == "owner",
            )) == chair.id
            with pytest.raises(WorkspaceRepositoryError, match="чек-листа"):
                await grant_service.act_on_grant(
                    connection,
                    assignee,
                    grant_id,
                    GrantAction(
                        action="submit",
                        text="Ready",
                        expected_revision=grant.revision,
                    ),
                )
            for item in grant.checklist:
                grant = await grant_service.act_on_grant(
                    connection,
                    coexecutor,
                    grant_id,
                    GrantAction(
                        action="check",
                        expected_revision=grant.revision,
                        item_id=UUID(item.id),
                        completed=True,
                    ),
                )
            submitted_revision = grant.revision
            grant = await grant_service.act_on_grant(
                connection,
                coexecutor,
                grant_id,
                GrantAction(
                    action="submit", text="Complete proposal", expected_revision=grant.revision
                ),
            )
            assert grant.status == "leader_review"
            for forbidden in (author, assignee, coexecutor, chair, admin):
                with pytest.raises(WorkspaceRepositoryError) as denied:
                    await grant_service.act_on_grant(
                        connection,
                        forbidden,
                        grant_id,
                        GrantAction(action="approve", expected_revision=grant.revision),
                    )
                assert denied.value.status_code == 403
            # Bootstrap reconciliation must keep the deputy's action alive.
            workspace = await load_workspace(connection, leader)
            assert any(
                item.entity_id == grant.id and item.requires_action and not item.resolved_at
                for item in workspace.notifications
            )
            with pytest.raises(WorkspaceRepositoryError) as stale:
                await grant_service.act_on_grant(
                    connection,
                    leader,
                    grant_id,
                    GrantAction(action="approve", expected_revision=submitted_revision),
                )
            assert stale.value.status_code == 409
            with pytest.raises(WorkspaceRepositoryError) as empty_reason:
                await grant_service.act_on_grant(
                    connection,
                    leader,
                    grant_id,
                    GrantAction(action="return", text="  ", expected_revision=grant.revision),
                )
            assert empty_reason.value.status_code == 422
            grant = await grant_service.act_on_grant(
                connection,
                leader,
                grant_id,
                GrantAction(
                    action="return", text="Clarify budget", expected_revision=grant.revision
                ),
            )
            assert grant.status == "needs_revision"
            assert grant.result_text == "Complete proposal"
            grant = await grant_service.act_on_grant(
                connection,
                assignee,
                grant_id,
                GrantAction(
                    action="submit", text="Revised budget", expected_revision=grant.revision
                ),
            )
            assert grant.status == "leader_review"
            for actor, expected in (
                (leader, "chair_review"),
                (chair, "completed"),
            ):
                grant = await grant_service.act_on_grant(
                    connection,
                    actor,
                    grant_id,
                    GrantAction(action="approve", expected_revision=grant.revision),
                )
                assert grant.status == expected
            assert "approve" not in grant.allowed_actions
            assert any(event.text == "Clarify budget" for event in grant.events)
            assert sum(event.action == "submit" for event in grant.events) == 2
            assert await connection.scalar(select(func.count()).select_from(tasks)) == before_tasks
            assert (
                await connection.scalar(
                    select(func.count())
                    .select_from(
                        workspace_notifications,
                    )
                    .where(
                        workspace_notifications.c.entity_id == grant_id,
                        workspace_notifications.c.requires_action.is_(True),
                    )
                )
                == 0
            )
            await validate_attachment_owner(connection, assignee, "grant", grant_id, write=False)
            with pytest.raises(WorkspaceRepositoryError):
                await validate_attachment_owner(connection, assignee, "grant", grant_id, write=True)
            with pytest.raises(WorkspaceRepositoryError):
                await grant_service.get_grant(connection, outsider, grant_id)

    asyncio.run(run())


@pytest.mark.postgres
def test_initial_files_are_private_atomic_and_retries_do_not_duplicate_them():
    async def run():
        async with scenario() as (connection, actors):
            initiator, assignee, coexecutor, _leader, chair, _admin, outsider = actors
            storage = InMemoryObjectStorage()
            payload = draft(assignee, coexecutor, checklist=[])
            files = [GrantInitialFile("terms.txt", "text/plain", b"Terms of the grant"),
                     GrantInitialFile("budget.csv", "text/csv", b"cost,100")]
            grant = await create_with_files(connection, initiator, payload, storage, files)
            assert grant.status == "launch_review"
            assert {item.file_name for item in grant.attachments} == {"terms.txt", "budget.csv"}
            assert sum(event.action == "file_uploaded" for event in grant.events) == 2
            for attachment in grant.attachments:
                # Resolve by filename: storage listing order is deliberately not assumed.
                original = next(item for item in files if item.file_name == attachment.file_name)
                _, key = await get_attachment(connection, coexecutor, UUID(attachment.id))
                assert await storage.get(key) == original.content
                with pytest.raises(WorkspaceRepositoryError):
                    await get_attachment(connection, outsider, UUID(attachment.id))
            first_ids = {item.id for item in grant.attachments}
            replay = await create_with_files(connection, initiator, payload, storage, files)
            assert {item.id for item in replay.attachments} == first_ids
            grant = await grant_service.act_on_grant(
                connection, chair, payload.request_id,
                GrantAction(action="approve_launch", expected_revision=grant.revision),
            )
            replay = await create_with_files(connection, initiator, payload, storage, files)
            assert replay.author_user_id == str(chair.id)
            assert {item.id for item in replay.attachments} == first_ids
            with pytest.raises(WorkspaceRepositoryError) as changed:
                await create_with_files(connection, initiator, payload, storage, [
                    GrantInitialFile("terms.txt", "text/plain", b"Changed terms"), files[1],
                ])
            assert changed.value.status_code == 409

    asyncio.run(run())


@pytest.mark.postgres
def test_failed_source_file_rolls_back_the_grant_chat_events_and_notifications():
    class FailingStorage(InMemoryObjectStorage):
        def __init__(self):
            super().__init__()
            self.keys = []

        async def put(self, key, content, content_type):
            self.keys.append(key)
            if len(self.keys) == 2:
                raise ObjectStorageError("Synthetic storage failure")
            await super().put(key, content, content_type)

    async def run():
        async with scenario() as (connection, actors):
            initiator, assignee, coexecutor, *_ = actors
            payload = draft(assignee, coexecutor)
            storage = FailingStorage()
            files = [GrantInitialFile("one.txt", "text/plain", b"one"),
                     GrantInitialFile("two.txt", "text/plain", b"two")]
            with pytest.raises(ObjectStorageError):
                await create_with_files(connection, initiator, payload, storage, files)
            assert await connection.scalar(select(grant_requests.c.id).where(
                grant_requests.c.id == payload.request_id,
            )) is None
            for table, owner in ((chats, chats.c.context_id),
                                 (grant_events, grant_events.c.grant_id),
                                 (workspace_notifications, workspace_notifications.c.entity_id)):
                assert await connection.scalar(
                    select(func.count()).select_from(table).where(owner == payload.request_id)
                ) == 0
            for key in storage.keys:
                with pytest.raises(ObjectStorageError):
                    await storage.get(key)
            retry = await create_with_files(
                connection, initiator, payload, InMemoryObjectStorage(), files,
            )
            assert len(retry.attachments) == 2

    asyncio.run(run())


@pytest.mark.postgres
def test_settings_snapshots_edit_membership_and_attachment_privacy():
    async def run():
        async with scenario() as (connection, actors):
            author, assignee, coexecutor, leader, chair, admin, outsider = actors
            grant = await grant_service.create_grant(
                connection, author, draft(assignee, coexecutor)
            )
            grant_id = UUID(grant.id)
            assert not await grant_service.list_grants(connection, outsider)
            with pytest.raises(WorkspaceRepositoryError):
                await validate_attachment_owner(
                    connection, outsider, "grant", grant_id, write=False
                )
            with pytest.raises(WorkspaceRepositoryError):
                await messenger_service.chat_access(connection, outsider, UUID(grant.chat_id))
            settings = await grant_service.get_settings(connection, admin)
            with pytest.raises(HTTPException):
                await grant_service.save_settings(
                    connection,
                    author,
                    GrantSettingsWrite(
                        leader_user_id=outsider.id,
                        chair_user_id=chair.id,
                        expected_revision=settings.revision,
                    ),
                )
            await grant_service.save_settings(
                connection,
                admin,
                GrantSettingsWrite(
                    leader_user_id=outsider.id,
                    chair_user_id=chair.id,
                    expected_revision=settings.revision,
                ),
            )
            assert (
                await grant_service.get_grant(connection, author, grant_id)
            ).leader_user_id == str(leader.id)
            new_grant = await grant_service.create_grant(
                connection, author, draft(assignee, coexecutor)
            )
            assert new_grant.leader_user_id == str(outsider.id)
            grant = await grant_service.edit_grant(
                connection,
                author,
                grant_id,
                GrantEdit(
                    title="Updated grant title",
                    description="Clear result",
                    assignee_id=assignee.id,
                    co_assignee_ids=[],
                    due_at=datetime.now(UTC) + timedelta(days=9),
                    checklist=[],
                    expected_revision=grant.revision,
                ),
            )
            with pytest.raises(WorkspaceRepositoryError):
                await grant_service.get_grant(connection, coexecutor, grant_id)
            with pytest.raises(WorkspaceRepositoryError):
                await messenger_service.chat_access(connection, coexecutor, UUID(grant.chat_id))
            await connection.execute(
                insert(module_access_rules).values(
                    id=uuid4(),
                    subject_type="user",
                    subject_key=str(assignee.id),
                    module_key="grants",
                    permissions={
                        "view": False,
                        "create": False,
                        "edit": False,
                        "approve": False,
                        "admin": False,
                    },
                    created_by_user_id=admin.id,
                    created_at=datetime.now(UTC),
                    updated_at=datetime.now(UTC),
                )
            )
            with pytest.raises(HTTPException):
                await grant_service.list_grants(connection, assignee)
            with pytest.raises(HTTPException):
                await messenger_service.chat_access(connection, assignee, UUID(grant.chat_id))
            workspace = await load_workspace(connection, assignee)
            assert not any(chat.id == grant.chat_id for chat in workspace.chats)
            assert not any(item.section == "grants" for item in workspace.notifications)

    asyncio.run(run())


@pytest.mark.postgres
def test_bad_creation_is_atomic_and_review_cannot_edit_submission():
    async def run():
        async with scenario() as (connection, actors):
            author, assignee, coexecutor, leader, chair, _admin, _outsider = actors
            before = await connection.scalar(select(func.count()).select_from(grant_requests))
            for payload in (
                draft(assignee, coexecutor, coAssigneeIds=[str(assignee.id)]),
                draft(assignee, coexecutor, assigneeId=str(uuid4())),
            ):
                with pytest.raises(WorkspaceRepositoryError):
                    await grant_service.create_grant(connection, author, payload)
            assert (
                await connection.scalar(select(func.count()).select_from(grant_requests)) == before
            )
            grant = await grant_service.create_grant(
                connection, author, draft(assignee, coexecutor, checklist=[])
            )
            grant_id = UUID(grant.id)
            grant = await grant_service.act_on_grant(
                connection, chair, grant_id,
                GrantAction(action="approve_launch", expected_revision=grant.revision),
            )
            grant = await grant_service.act_on_grant(
                connection,
                assignee,
                grant_id,
                GrantAction(action="submit", text="Evidence", expected_revision=grant.revision),
            )
            await connection.execute(
                update(users).where(users.c.id == chair.id).values(status="archived")
            )
            event_count = await connection.scalar(select(func.count()).select_from(grant_events))
            with pytest.raises(WorkspaceRepositoryError):
                await grant_service.act_on_grant(
                    connection,
                    leader,
                    grant_id,
                    GrantAction(action="approve", expected_revision=grant.revision),
                )
            assert (
                await grant_service.get_grant(connection, author, grant_id)
            ).status == "leader_review"
            assert (
                await connection.scalar(select(func.count()).select_from(grant_events))
                == event_count
            )
            with pytest.raises(WorkspaceRepositoryError):
                await grant_service.edit_grant(
                    connection,
                    author,
                    grant_id,
                    GrantEdit(
                        title="Hidden edit",
                        description="",
                        assignee_id=assignee.id,
                        due_at=datetime.now(UTC) + timedelta(days=9),
                        expected_revision=grant.revision,
                    ),
                )

    asyncio.run(run())


@pytest.mark.postgres
def test_explicit_admin_reassignment_restarts_review_and_reconciles_access():
    async def run():
        async with scenario() as (connection, actors):
            author, assignee, coexecutor, leader, chair, admin, replacement = actors
            grant = await grant_service.create_grant(
                connection,
                author,
                draft(assignee, coexecutor, checklist=[]),
            )
            grant_id = UUID(grant.id)
            grant = await grant_service.act_on_grant(
                connection, chair, grant_id,
                GrantAction(action="approve_launch", expected_revision=grant.revision),
            )
            grant = await grant_service.act_on_grant(
                connection,
                assignee,
                grant_id,
                GrantAction(action="submit", text="Proposal", expected_revision=grant.revision),
            )
            grant = await grant_service.act_on_grant(
                connection,
                leader,
                grant_id,
                GrantAction(action="approve", expected_revision=grant.revision),
            )
            payload = GrantReviewersWrite(
                leader_user_id=replacement.id,
                chair_user_id=chair.id,
                expected_revision=grant.revision,
                reason="Назначен новый руководитель",
            )
            with pytest.raises(HTTPException):
                await grant_service.change_reviewers(connection, author, grant_id, payload)
            grant = await grant_service.change_reviewers(connection, admin, grant_id, payload)
            assert grant.status == "leader_review"
            assert grant.leader_user_id == str(replacement.id)
            assert any(event.action == "reviewers_changed" for event in grant.events)
            with pytest.raises(WorkspaceRepositoryError):
                await grant_service.get_grant(connection, leader, grant_id)
            with pytest.raises(WorkspaceRepositoryError):
                await messenger_service.chat_access(connection, leader, UUID(grant.chat_id))
            await messenger_service.chat_access(connection, replacement, UUID(grant.chat_id))
            old_workspace = await load_workspace(connection, leader)
            assert not any(item.entity_id == grant.id for item in old_workspace.notifications)

    asyncio.run(run())


@pytest.mark.postgres
def test_result_files_are_private_revisioned_and_frozen_during_review():
    async def run():
        async with scenario() as (connection, actors):
            author, assignee, coexecutor, _leader, chair, _admin, outsider = actors
            grant = await grant_service.create_grant(
                connection,
                author,
                draft(assignee, coexecutor, checklist=[]),
            )
            grant_id = UUID(grant.id)
            grant = await grant_service.act_on_grant(
                connection, chair, grant_id,
                GrantAction(action="approve_launch", expected_revision=grant.revision),
            )
            attachment = await create_attachment(
                connection,
                assignee,
                "grant",
                grant_id,
                file_name="proposal.txt",
                content_type="text/plain",
                byte_size=10,
                sha256="a" * 64,
                storage_key=f"test/grant/{uuid4()}",
            )
            current = await grant_service.get_grant(connection, assignee, grant_id)
            assert current.revision == grant.revision + 1
            assert current.attachments[0].id == attachment.id
            await get_attachment(connection, coexecutor, UUID(attachment.id))
            with pytest.raises(WorkspaceRepositoryError):
                await get_attachment(connection, outsider, UUID(attachment.id))
            with pytest.raises(WorkspaceRepositoryError) as stale:
                await grant_service.act_on_grant(
                    connection,
                    assignee,
                    grant_id,
                    GrantAction(action="submit", text="Proposal", expected_revision=grant.revision),
                )
            assert stale.value.status_code == 409
            submitted = await grant_service.act_on_grant(
                connection,
                assignee,
                grant_id,
                GrantAction(action="submit", text="Proposal", expected_revision=current.revision),
            )
            assert "upload" not in submitted.allowed_actions
            with pytest.raises(WorkspaceRepositoryError):
                await validate_attachment_owner(connection, assignee, "grant", grant_id, write=True)

    asyncio.run(run())


@pytest.mark.postgres
def test_launch_return_rejection_and_initiator_survives_owner_change():
    async def run():
        async with scenario() as (connection, actors):
            initiator, assignee, coexecutor, _leader, chair, admin, replacement = actors
            grant = await grant_service.create_grant(
                connection, initiator, draft(assignee, coexecutor, checklist=[])
            )
            grant_id = UUID(grant.id)
            with pytest.raises(WorkspaceRepositoryError) as empty:
                await grant_service.act_on_grant(
                    connection, chair, grant_id,
                    GrantAction(action="return_launch", expected_revision=grant.revision),
                )
            assert empty.value.status_code == 422
            grant = await grant_service.act_on_grant(
                connection, chair, grant_id,
                GrantAction(action="return_launch", text="Уточните бюджет",
                            expected_revision=grant.revision),
            )
            assert grant.status == "launch_revision"
            assert grant.author_user_id is None
            initiator_view = await grant_service.get_grant(connection, initiator, grant_id)
            assert "submit_launch" in initiator_view.allowed_actions
            grant = await grant_service.act_on_grant(
                connection, initiator, grant_id,
                GrantAction(action="submit_launch", expected_revision=grant.revision),
            )
            pending_revision = grant.revision
            grant = await grant_service.act_on_grant(
                connection, chair, grant_id,
                GrantAction(action="approve_launch", expected_revision=pending_revision),
            )
            with pytest.raises(WorkspaceRepositoryError) as repeated:
                await grant_service.act_on_grant(
                    connection, chair, grant_id,
                    GrantAction(action="approve_launch", expected_revision=pending_revision),
                )
            assert repeated.value.status_code == 409
            assert sum(event.action == "approve_launch" for event in grant.events) == 1
            initiator_view = await grant_service.get_grant(connection, initiator, grant_id)
            assert "edit" not in initiator_view.allowed_actions
            assert any(item.id == grant.id for item in
                       await grant_service.list_grants(connection, initiator))
            await messenger_service.chat_access(connection, initiator, UUID(grant.chat_id))
            original_approval = grant.launch_approved_at
            grant = await grant_service.change_reviewers(
                connection, admin, grant_id, GrantReviewersWrite(
                    expected_revision=grant.revision, leader_user_id=actors[3].id,
                    chair_user_id=replacement.id, reason="Назначен новый председатель",
                ),
            )
            assert grant.author_user_id == str(replacement.id)
            assert grant.initiator_user_id == str(initiator.id)
            assert grant.launch_approved_by_user_id == str(chair.id)
            assert grant.launch_approved_at == original_approval
            assert await connection.scalar(select(chat_members.c.user_id).where(
                chat_members.c.chat_id == UUID(grant.chat_id),
                chat_members.c.member_role == "owner",
            )) == replacement.id
            declined = await grant_service.create_grant(
                connection, initiator, draft(assignee, coexecutor, checklist=[])
            )
            declined = await grant_service.act_on_grant(
                connection, chair, UUID(declined.id), GrantAction(
                    action="reject_launch", text="Конкурс не соответствует приоритетам",
                    expected_revision=declined.revision,
                ),
            )
            assert declined.status == "launch_rejected"
            assert declined.author_user_id is None
            assert not declined.allowed_actions
            assert declined.events[-1].text == "Конкурс не соответствует приоритетам"
            finished_chat, _ = await messenger_service.chat_access(
                connection, initiator, UUID(declined.chat_id)
            )
            assert await messenger_service.context_chat_finished(connection, finished_chat)

    asyncio.run(run())


@pytest.mark.postgres
def test_existing_legacy_grant_retains_its_author_review_route():
    async def run():
        async with scenario() as (connection, actors):
            author, assignee, coexecutor, leader, chair, _admin, _outsider = actors
            grant = await grant_service.create_grant(
                connection, author, draft(assignee, coexecutor, checklist=[])
            )
            grant_id = UUID(grant.id)
            # Represent an existing pre-upgrade record; do not fabricate launch approval.
            await connection.execute(update(grant_requests).where(
                grant_requests.c.id == grant_id,
            ).values(workflow_version=1, author_user_id=author.id, status="in_progress"))
            grant = await grant_service.act_on_grant(
                connection, assignee, grant_id,
                GrantAction(
                    action="submit", text="Legacy result", expected_revision=grant.revision
                ),
            )
            assert grant.status == "author_review"
            assert grant.author_user_id == str(author.id)
            assert grant.launch_approved_at is None
            for actor, expected in ((author, "leader_review"), (leader, "chair_review"),
                                    (chair, "completed")):
                grant = await grant_service.act_on_grant(
                    connection, actor, grant_id,
                    GrantAction(action="approve", expected_revision=grant.revision),
                )
                assert grant.status == expected

    asyncio.run(run())
