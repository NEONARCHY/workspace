"""Delivery tests use only the explicitly isolated loopback test database."""

import asyncio
from contextlib import asynccontextmanager
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

import pytest
from sqlalchemy import delete, func, insert, select, update

from test_task_proposals import scenario as task_scenario
from yuksalish_api import repository as repo
from yuksalish_api.errors import WorkspaceRepositoryError
from yuksalish_api.settings import Settings
from yuksalish_api.tables import (
    approval_nodes,
    approval_requests,
    departments,
    module_access_rules,
    tasks,
    telegram_bot_grants,
    telegram_identities,
    users,
)
from yuksalish_api.telegram_notification_events import queue_payment, queue_task
from yuksalish_api.telegram_notification_schemas import DeliveryAck
from yuksalish_api.telegram_notification_service import acknowledge, claim, open_notice, prepare
from yuksalish_api.telegram_notification_tables import deliveries
from yuksalish_api.workspace_schemas import CreateApprovalRequest, CreateTaskRequest


@asynccontextmanager
async def scenario():
    async with task_scenario() as (c, people):
        central, regional, child = uuid4(), uuid4(), uuid4()
        for identifier, scope, parent in [
            (central, "central", None),
            (regional, "regional", None),
            (child, "central", regional),
        ]:
            await c.execute(
                insert(departments).values(
                    id=identifier,
                    name="Synthetic office",
                    code=identifier.hex,
                    scope=scope,
                    parent_id=parent,
                    created_at=datetime.now(UTC),
                )
            )
        for n, person in enumerate(people):
            await c.execute(
                update(users)
                .where(users.c.id == person.id)
                .values(department_id=[central, regional, central, child][n])
            )
            await c.execute(
                insert(telegram_identities).values(
                    user_id=person.id,
                    telegram_id=str(900000000 + n),
                    revision=1,
                    verified_at=datetime.now(UTC),
                    verification_source="admin",
                    updated_at=datetime.now(UTC),
                )
            )
            await c.execute(
                insert(telegram_bot_grants).values(
                    user_id=person.id,
                    bot_key="workspace_notifications",
                    updated_by_user_id=people[2].id,
                    updated_at=datetime.now(UTC),
                )
            )
        yield c, people, central, regional


async def task(c, people, assignee=None):
    return await repo.create_task(
        c,
        people[2],
        CreateTaskRequest(
            title="Synthetic notification task",
            description="Expected test result",
            assignee_id=str((assignee or people[0]).id),
        ),
    )


def settings(mode="preview"):
    return Settings(
        environment="test",
        telegram_notifications_mode=mode,
        telegram_notifications_workspace_url="http://127.0.0.1:5189",
    )


def test_new_task_is_transactional_deduplicated_and_central_only():
    async def run():
        async with scenario() as (c, people, _, __):
            created = await task(c, people)
            await queue_task(c, UUID(created.id))
            await task(c, people, people[1])
            await task(c, people, people[3])
            rows = (await c.execute(select(deliveries))).mappings().all()
            assert len(rows) == 1 and rows[0]["user_id"] == people[0].id
            assert "Expected test result" in rows[0]["body"]
            assert rows[0]["state"] == "pending"

    asyncio.run(run())


def test_preview_is_not_a_send_and_links_are_recipient_private():
    async def run():
        async with scenario() as (c, people, _, __):
            created = await task(c, people)
            lease = (await claim(c))[0]
            assert await claim(c) == []
            message = await prepare(c, lease.id, lease.lease_token, settings())
            assert message and not message.send_allowed and "workspaceNotice=" in message.url
            assert str(people[0].id) not in message.url and "token" not in message.url
            target = await open_notice(c, people[0], lease.id)
            assert target.section == "tasks" and target.entity_id == created.id
            with pytest.raises(WorkspaceRepositoryError) as denied:
                await open_notice(c, people[2], lease.id)
            assert denied.value.status_code == 404
            with pytest.raises(WorkspaceRepositoryError):
                await prepare(c, lease.id, lease.lease_token, settings())
            with pytest.raises(WorkspaceRepositoryError):
                await acknowledge(
                    c,
                    lease.id,
                    DeliveryAck(
                        lease_token=lease.lease_token, outcome="sent", telegram_message_id=7
                    ),
                )
            receipt = DeliveryAck(lease_token=lease.lease_token, outcome="preview")
            await acknowledge(c, lease.id, receipt)
            await acknowledge(c, lease.id, receipt)
            assert (
                await c.scalar(select(deliveries.c.state).where(deliveries.c.id == lease.id))
                == "previewed"
            )

    asyncio.run(run())


@pytest.mark.parametrize(
    "change", ["identity", "grant", "region", "blocked", "module", "completed"]
)
def test_scope_and_rights_are_rechecked_immediately_before_prepare(change):
    async def run():
        async with scenario() as (c, people, _, regional):
            created = await task(c, people)
            lease = (await claim(c))[0]
            if change == "identity":
                await c.execute(
                    update(telegram_identities)
                    .where(telegram_identities.c.user_id == people[0].id)
                    .values(telegram_id="999999999", revision=2)
                )
            elif change == "grant":
                await c.execute(
                    delete(telegram_bot_grants).where(telegram_bot_grants.c.user_id == people[0].id)
                )
            elif change == "region":
                await c.execute(
                    update(users).where(users.c.id == people[0].id).values(department_id=regional)
                )
            elif change == "blocked":
                await c.execute(
                    update(users).where(users.c.id == people[0].id).values(status="blocked")
                )
            elif change == "completed":
                await c.execute(
                    update(tasks).where(tasks.c.id == UUID(created.id)).values(status="completed")
                )
            else:
                await c.execute(
                    insert(module_access_rules).values(
                        id=uuid4(),
                        subject_type="user",
                        subject_key=str(people[0].id),
                        module_key="tasks",
                        permissions={"view": False},
                        created_by_user_id=people[2].id,
                        created_at=datetime.now(UTC),
                        updated_at=datetime.now(UTC),
                    )
                )
            assert await prepare(c, lease.id, lease.lease_token, settings()) is None
            assert (
                await c.scalar(select(deliveries.c.state).where(deliveries.c.id == lease.id))
                == "skipped"
            )

    asyncio.run(run())


def test_expired_leases_are_fenced_but_unknown_sends_are_not_replayed():
    async def run():
        async with scenario() as (c, people, _, __):
            await task(c, people)
            original = (await claim(c))[0]
            await c.execute(
                update(deliveries)
                .where(deliveries.c.id == original.id)
                .values(lease_until=datetime.now(UTC) - timedelta(seconds=1))
            )
            current = (await claim(c))[0]
            assert original.lease_token != current.lease_token
            with pytest.raises(WorkspaceRepositoryError):
                await prepare(c, original.id, original.lease_token, settings())
            await prepare(c, current.id, current.lease_token, settings("live"))
            await c.execute(
                update(deliveries)
                .where(deliveries.c.id == current.id)
                .values(lease_until=datetime.now(UTC) - timedelta(seconds=1))
            )
            assert await claim(c) == []
            assert (
                await c.scalar(select(deliveries.c.state).where(deliveries.c.id == current.id))
                == "unknown"
            )
            with pytest.raises(WorkspaceRepositoryError):
                await acknowledge(
                    c, current.id, DeliveryAck(lease_token=current.lease_token, outcome="retry")
                )
            late = DeliveryAck(
                lease_token=current.lease_token, outcome="sent", telegram_message_id=42
            )
            await acknowledge(c, current.id, late)
            await acknowledge(c, current.id, late)
            assert await claim(c) == []

    asyncio.run(run())


def test_payment_targets_the_configured_current_approver_and_cancels_stale_stage():
    async def run():
        async with scenario() as (c, people, _, __):
            manager = replace(people[0], role="manager")
            await c.execute(update(users).where(users.c.id == manager.id).values(role="manager"))
            template = await repo._published_payment_template(c)
            await c.execute(
                update(approval_nodes)
                .where(
                    approval_nodes.c.template_id == template["id"],
                    approval_nodes.c.kind.not_in(["start", "end"]),
                )
                .values(config={"approverUserId": str(manager.id)})
            )
            payment = await repo.create_approval_request(
                c, people[2], CreateApprovalRequest(title="Synthetic payment", amount=123400)
            )
            await queue_payment(c, UUID(payment.id))
            rows = (await c.execute(select(deliveries))).mappings().all()
            assert (
                len(rows) == 1
                and rows[0]["kind"] == "payment_action"
                and rows[0]["user_id"] == manager.id
            )
            assert "123400" in rows[0]["body"]
            lease = (await claim(c))[0]
            await c.execute(
                update(approval_requests)
                .where(approval_requests.c.id == UUID(payment.id))
                .values(status="approved", active_node_keys=[])
            )
            assert await prepare(c, lease.id, lease.lease_token, settings()) is None

    asyncio.run(run())


def test_outbox_failure_rolls_back_the_business_creation(monkeypatch):
    from yuksalish_api import telegram_notification_events

    async def fail(*args, **kwargs):
        raise RuntimeError("Injected queue failure")

    async def run():
        async with scenario() as (c, people, _, __):
            before = await c.scalar(select(func.count()).select_from(tasks))
            monkeypatch.setattr(telegram_notification_events, "enqueue", fail)
            with pytest.raises(RuntimeError, match="Injected"):
                async with c.begin_nested():
                    await task(c, people)
            assert await c.scalar(select(func.count()).select_from(tasks)) == before
            assert await c.scalar(select(func.count()).select_from(deliveries)) == 0

    asyncio.run(run())


def test_retry_ack_is_idempotent_and_old_lease_cannot_replay():
    async def run():
        async with scenario() as (c, people, _, __):
            await task(c, people)
            lease = (await claim(c))[0]
            await prepare(c, lease.id, lease.lease_token, settings("live"))
            ack = DeliveryAck(lease_token=lease.lease_token, outcome="retry", retry_after=1)
            await acknowledge(c, lease.id, ack)
            await acknowledge(c, lease.id, ack)
            await c.execute(
                update(deliveries)
                .where(deliveries.c.id == lease.id)
                .values(retry_at=datetime.now(UTC) - timedelta(seconds=1))
            )
            next_lease = (await claim(c))[0]
            with pytest.raises(WorkspaceRepositoryError):
                await acknowledge(c, lease.id, ack)
            assert next_lease.lease_token != lease.lease_token

    asyncio.run(run())


def test_region_cannot_receive_notification_grant_and_unknown_department_fails_closed():
    from fastapi import HTTPException

    from yuksalish_api.telegram_access_schemas import TelegramAccessUpdate
    from yuksalish_api.telegram_access_service import save_telegram_access
    from yuksalish_api.telegram_notification_scope import central_office

    async def run():
        async with scenario() as (c, people, _, __):
            with pytest.raises(HTTPException) as denied:
                await save_telegram_access(
                    c,
                    people[2],
                    people[1].id,
                    TelegramAccessUpdate(
                        telegram_id="900000001",
                        bot_keys=["workspace_notifications"],
                        expected_revision=1,
                    ),
                )
            assert denied.value.status_code == 422
            await c.execute(
                update(users).where(users.c.id == people[0].id).values(department_id=None)
            )
            assert not await central_office(c, people[0].id)

    asyncio.run(run())


def test_bridge_authentication_mode_gate_and_anonymous_link():
    from fastapi import FastAPI
    from httpx import ASGITransport, AsyncClient
    from pydantic import SecretStr

    from yuksalish_api.database import get_connection
    from yuksalish_api.routers.telegram_notifications import router

    async def run():
        async with scenario() as (c, people, _, __):
            await task(c, people)
            app = FastAPI()
            app.state.settings = settings()
            app.state.settings.telegram_notifications_bridge_token = SecretStr("test-only-" * 5)
            app.include_router(router, prefix="/api/v1")

            async def connection():
                yield c

            app.dependency_overrides[get_connection] = connection
            async with AsyncClient(
                transport=ASGITransport(app=app), base_url="https://test.invalid"
            ) as client:
                url = "/api/v1/telegram-notifications/bridge/claim"
                assert (await client.post(url, json={"mode": "preview"})).status_code == 401
                client.headers["Authorization"] = "Bearer " + "test-only-" * 5
                assert (await client.post(url, json={"mode": "live"})).status_code == 409
                app.state.settings.telegram_notifications_mode = "off"
                assert (await client.post(url, json={"mode": "preview"})).status_code == 403
                assert (
                    await c.scalar(
                        select(func.count())
                        .select_from(deliveries)
                        .where(deliveries.c.state == "pending")
                    )
                    == 1
                )

    asyncio.run(run())


def test_co_assignees_receive_one_event_observers_and_author_do_not():
    async def run():
        async with scenario() as (c, people, central, _):
            await c.execute(
                update(users).where(users.c.id == people[1].id).values(department_id=central)
            )
            await c.execute(
                update(users).where(users.c.id == people[3].id).values(department_id=central)
            )
            await repo.create_task(
                c,
                people[2],
                CreateTaskRequest(
                    title="Synthetic team task",
                    assignee_id=str(people[0].id),
                    participants=[
                        {"userId": str(people[1].id), "role": "co_assignee"},
                        {"userId": str(people[3].id), "role": "observer"},
                    ],
                ),
            )
            targets = (await c.execute(select(deliveries.c.user_id))).scalars().all()
            assert set(targets) == {people[0].id, people[1].id}

    asyncio.run(run())
