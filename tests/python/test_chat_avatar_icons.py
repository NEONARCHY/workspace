import asyncio
import importlib.util
import os
from pathlib import Path
from uuid import UUID, uuid4

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from pydantic import ValidationError
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import create_async_engine

from yuksalish_api import messenger_service as service
from yuksalish_api.auth import load_authenticated_user
from yuksalish_api.errors import WorkspaceRepositoryError
from yuksalish_api.project_hub_schemas import ProjectHubWrite, ProjectWorkItemWrite
from yuksalish_api.project_hub_service import load_hub, save_item, save_project
from yuksalish_api.repository import (
    create_project,
    create_trip_request,
    find_active_user_by_username,
    update_trip_request,
)
from yuksalish_api.seed import seed_demo_data
from yuksalish_api.tables import chat_members, chats
from yuksalish_api.workspace_schemas import (
    ChatPermissions,
    CreateChatRequest,
    CreateProjectRequest,
    CreateTripRequest,
    SetChatMemberRequest,
    UpdateChatAvatarRequest,
    UpdateChatRequest,
    UpdateTripRequest,
)


def test_curated_icons_only_and_no_direct_avatar_override() -> None:
    for key in (
        "team",
        "plane",
        "project",
        "briefcase",
        "building",
        "globe",
        "calendar",
        "document",
        "target",
        "compass",
        "star",
        "sparkles",
        None,
    ):
        assert UpdateChatAvatarRequest(avatar_icon_key=key).avatar_icon_key == key
    for key in ("unknown", "https://example.com/avatar.svg", "<script>"):
        with pytest.raises(ValidationError):
            UpdateChatAvatarRequest.model_validate({"avatarIconKey": key})
    with pytest.raises(ValidationError):
        CreateChatRequest(kind="direct", member_ids=[uuid4()], avatar_icon_key="plane")
    assert (
        CreateChatRequest(kind="group", title="Group", member_ids=[uuid4()]).avatar_icon_key is None
    )


def test_avatar_permissions_are_not_workspace_admin_privileges() -> None:
    actor_id = uuid4()
    group = {"kind": "group", "context_type": None, "created_by_user_id": actor_id}
    member = {"member_role": "member", "permissions": {}}
    assert not service.can_edit_chat_avatar(group, member, actor_id)
    moderator = {"member_role": "moderator", "permissions": {"edit_info": True}}
    assert service.can_edit_chat_avatar(group, moderator, actor_id)
    for context in ("project", "project_hub", "trip"):
        chat = {**group, "context_type": context}
        assert service.can_edit_chat_avatar(chat, member, actor_id)
        assert not service.can_edit_chat_avatar(chat, moderator, uuid4())
    for kind in ("direct", "department", "task"):
        assert not service.can_edit_chat_avatar({**group, "kind": kind}, moderator, actor_id)


async def exercise_icons(url: str) -> None:
    engine = create_async_engine(url)
    try:
        await seed_demo_data(engine)
        async with engine.connect() as connection:
            transaction = await connection.begin()
            try:
                actors = []
                for username in ("dilshod", "baxtiyor", "malika"):
                    row = await find_active_user_by_username(connection, username)
                    assert row is not None
                    actor = await load_authenticated_user(connection, row["id"])
                    assert actor is not None
                    actors.append(actor)
                owner, peer, admin = actors
                group = await service.create_chat(
                    connection,
                    owner,
                    CreateChatRequest(
                        kind="group",
                        title="Icon QA",
                        member_ids=[peer.id],
                        avatar_icon_key="star",
                    ),
                )
                chat_id = UUID(group.id)
                assert group.avatar_icon_key == "star" and group.can_edit_avatar
                peer_view = await service.chat_summary(connection, peer, chat_id)
                assert peer_view.avatar_icon_key == "star" and not peer_view.can_edit_avatar
                for actor, expected in ((peer, 403), (admin, 404)):
                    with pytest.raises(WorkspaceRepositoryError) as denied:
                        await service.update_chat_avatar(
                            connection,
                            actor,
                            chat_id,
                            UpdateChatAvatarRequest(avatar_icon_key="plane"),
                        )
                    assert denied.value.status_code == expected
                changed = await service.update_chat_avatar(
                    connection, owner, chat_id, UpdateChatAvatarRequest(avatar_icon_key="compass")
                )
                assert changed.avatar_icon_key == "compass"
                renamed = await service.update_chat(
                    connection, owner, chat_id, UpdateChatRequest(title="Renamed by an old client")
                )
                assert renamed.avatar_icon_key == "compass"
                await service.set_chat_member(
                    connection,
                    owner,
                    chat_id,
                    peer.id,
                    SetChatMemberRequest(
                        role="moderator", permissions=ChatPermissions(edit_info=True)
                    ),
                )
                assert (await service.chat_summary(connection, peer, chat_id)).can_edit_avatar
                reset = await service.update_chat_avatar(
                    connection, peer, chat_id, UpdateChatAvatarRequest(avatar_icon_key=None)
                )
                assert reset.avatar_icon_key is None
                direct = await service.create_chat(
                    connection, owner, CreateChatRequest(kind="direct", member_ids=[peer.id])
                )
                with pytest.raises(WorkspaceRepositoryError) as denied:
                    await service.update_chat_avatar(
                        connection,
                        owner,
                        UUID(direct.id),
                        UpdateChatAvatarRequest(avatar_icon_key="team"),
                    )
                assert denied.value.status_code == 403

                trip = await create_trip_request(
                    connection,
                    owner,
                    CreateTripRequest(
                        purpose="Avatar QA",
                        destination="Tashkent",
                        start_date="2026-11-01",
                        end_date="2026-11-02",
                        employee_ids=[str(owner.id)],
                        chat_icon_key="calendar",
                    ),
                )
                assert trip.chat_id
                trip_chat_id = UUID(trip.chat_id)
                assert (
                    await service.chat_summary(connection, owner, trip_chat_id)
                ).avatar_icon_key == "calendar"
                await service.update_chat_avatar(
                    connection,
                    owner,
                    trip_chat_id,
                    UpdateChatAvatarRequest(avatar_icon_key="compass"),
                )
                await update_trip_request(
                    connection,
                    owner,
                    UUID(trip.id),
                    UpdateTripRequest(
                        purpose="Updated trip",
                        destination="Tashkent",
                        start_date="2026-11-01",
                        end_date="2026-11-03",
                        employee_ids=[str(owner.id)],
                    ),
                )
                assert (
                    await service.chat_summary(connection, owner, trip_chat_id)
                ).avatar_icon_key == "compass"
                project = await create_project(
                    connection,
                    admin,
                    CreateProjectRequest(
                        code=f"ICON-{uuid4().hex[:8]}",
                        title="Avatar project QA",
                        manager_user_id=str(peer.id),
                        budget=0,
                        spent_budget=0,
                        currency="UZS",
                        chat_icon_key="target",
                    ),
                )
                assert project.chat_id
                project_chat_id = UUID(project.chat_id)
                assert (
                    await service.chat_summary(connection, admin, project_chat_id)
                ).avatar_icon_key == "target"
                assert not (
                    await service.chat_summary(connection, peer, project_chat_id)
                ).can_edit_avatar
                with pytest.raises(WorkspaceRepositoryError) as denied:
                    await service.update_chat_avatar(
                        connection,
                        peer,
                        project_chat_id,
                        UpdateChatAvatarRequest(avatar_icon_key="plane"),
                    )
                assert denied.value.status_code == 403
                hub_payload = ProjectHubWrite(
                    code=f"ICON-{uuid4().hex[:12]}",
                    title="Current project with a chat",
                    manager_user_id=str(admin.id),
                    responsible_user_ids=[str(peer.id)],
                    chat_icon_key="compass",
                )
                hub_project = await save_project(connection, admin, hub_payload)
                assert hub_project.chat_id
                hub_chat_id = UUID(hub_project.chat_id)
                hub_view = await service.chat_summary(connection, peer, hub_chat_id)
                assert hub_view.context_type == "project_hub" and hub_view.kind == "project"
                assert hub_view.avatar_icon_key == "compass" and not hub_view.can_edit_avatar
                await service.update_chat_avatar(
                    connection, admin, hub_chat_id, UpdateChatAvatarRequest(avatar_icon_key="star")
                )
                # A public project's unrelated reader does not gain its conversation.
                outsider_projects = (await load_hub(connection, owner)).projects
                assert next(p for p in outsider_projects if p.id == hub_project.id).chat_id is None
                with pytest.raises(WorkspaceRepositoryError) as denied:
                    await service.chat_summary(connection, owner, hub_chat_id)
                assert denied.value.status_code == 404
                for actor in (owner, peer):
                    with pytest.raises(WorkspaceRepositoryError) as denied:
                        await service.update_chat_avatar(
                            connection,
                            actor,
                            hub_chat_id,
                            UpdateChatAvatarRequest(avatar_icon_key="plane"),
                        )
                    assert denied.value.status_code == (404 if actor is owner else 403)
                item_payload = ProjectWorkItemWrite(
                    title="Assigned work",
                    kind="task",
                    assignee_user_ids=[str(owner.id)],
                )
                item = await save_item(connection, admin, UUID(hub_project.id), item_payload)
                assert (await service.chat_summary(connection, owner, hub_chat_id)).id == str(
                    hub_chat_id
                )
                updated_project = await save_project(
                    connection,
                    admin,
                    hub_payload.model_copy(update={"responsible_user_ids": []}),
                    UUID(hub_project.id),
                )
                assert updated_project.chat_id == hub_project.chat_id
                assert (
                    await service.chat_summary(connection, admin, hub_chat_id)
                ).avatar_icon_key == "star"
                with pytest.raises(WorkspaceRepositoryError) as denied:
                    await service.chat_summary(connection, peer, hub_chat_id)
                assert denied.value.status_code == 404
                await save_item(
                    connection,
                    admin,
                    UUID(hub_project.id),
                    item_payload.model_copy(update={"assignee_user_ids": []}),
                    UUID(item.id),
                )
                with pytest.raises(WorkspaceRepositoryError) as denied:
                    await service.chat_summary(connection, owner, hub_chat_id)
                assert denied.value.status_code == 404
                # Backfill an existing project, then repeat migration safely without duplicates.
                await save_project(connection, admin, hub_payload, UUID(hub_project.id))
                await save_item(
                    connection, admin, UUID(hub_project.id), item_payload, UUID(item.id)
                )
                await connection.execute(
                    delete(chat_members).where(chat_members.c.chat_id == hub_chat_id)
                )
                await connection.execute(delete(chats).where(chats.c.id == hub_chat_id))

                def backfill(sync_connection):
                    migration_path = (
                        Path(__file__).parents[2]
                        / "apps/api/migrations/versions/0073_project_hub_chats.py"
                    )
                    spec = importlib.util.spec_from_file_location("chat_backfill", migration_path)
                    assert spec and spec.loader
                    migration = importlib.util.module_from_spec(spec)
                    spec.loader.exec_module(migration)
                    with Operations.context(MigrationContext.configure(sync_connection)):
                        migration.upgrade()
                        migration.upgrade()

                await connection.run_sync(backfill)
                assert (
                    await connection.scalar(
                        select(func.count())
                        .select_from(chats)
                        .where(
                            chats.c.context_type == "project_hub",
                            chats.c.context_id == UUID(hub_project.id),
                        )
                    )
                    == 1
                )
                restored_id = await connection.scalar(
                    select(chats.c.id).where(
                        chats.c.context_type == "project_hub",
                        chats.c.context_id == UUID(hub_project.id),
                    )
                )
                assert restored_id is not None
                restored = await service.chat_summary(connection, admin, restored_id)
                assert restored.avatar_icon_key is None and restored.can_edit_avatar
                assert {m.user_id for m in restored.members} == {
                    str(admin.id),
                    str(peer.id),
                    str(owner.id),
                }
            finally:
                await transaction.rollback()
    finally:
        await engine.dispose()


def test_chat_avatar_persistence_and_rights_postgres() -> None:
    url = os.environ.get("YUKSALISH_TEST_DATABASE_URL")
    if not url:
        pytest.skip("YUKSALISH_TEST_DATABASE_URL is not configured")
    asyncio.run(exercise_icons(url))
