"""Task deadline requests stay in chat and require an authorized decision."""

import os
from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

import pytest
from httpx import ASGITransport, AsyncClient
from pydantic import SecretStr
from sqlalchemy import select
from sqlalchemy.ext.asyncio import create_async_engine

from yuksalish_api.efficiency_service import (
    calculate_aggregate,
    period_for,
    reconcile_deadline_decisions,
)
from yuksalish_api.main import create_app
from yuksalish_api.settings import Settings
from yuksalish_api.tables import task_deadline_requests, task_efficiency_events


@pytest.mark.anyio
@pytest.mark.postgres
async def test_task_deadline_extension_requires_setter_decision() -> None:
    database_url = os.environ.get("YUKSALISH_TEST_DATABASE_URL")
    if not database_url:
        pytest.skip("YUKSALISH_TEST_DATABASE_URL is not configured")
    password = "Yuksalish-Local-2026!"
    app = create_app(Settings(
        environment="test", database_url=database_url,
        auth_signing_key=SecretStr("deadline-test-signing-key"),
        auth_encryption_key=SecretStr("deadline-test-encryption-key"),
        demo_password=SecretStr(password), seed_demo_data=True,
    ))
    async with (
        app.router.lifespan_context(app),
        AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client,
    ):
        sessions = {}
        for username in ("malika", "baxtiyor", "aziza", "dilshod"):
            login = await client.post("/api/v1/auth/login", json={
                "username": username, "password": password, "deviceLabel": "deadline test",
            })
            assert login.status_code == 200
            sessions[username] = login.json()

        def headers(username: str) -> dict[str, str]:
            return {"Authorization": f"Bearer {sessions[username]['accessToken']}"}

        due = datetime.now(UTC) + timedelta(days=2)
        created = await client.post("/api/v1/tasks", headers=headers("malika"), json={
            "title": f"Deadline test {uuid4().hex[:8]}",
            "assigneeId": sessions["dilshod"]["user"]["id"],
            "dueAt": due.isoformat(),
        })
        assert created.status_code == 201
        task = created.json()
        task_id = task["id"]
        history_url = f"/api/v1/tasks/{task_id}/history"
        assert (await client.get(history_url)).status_code == 401
        private = await client.post("/api/v1/tasks", headers=headers("malika"), json={
            "title": "History access boundary", "assigneeId": sessions["baxtiyor"]["user"]["id"],
        })
        assert private.status_code == 201
        private_id = private.json()["id"]
        assert (await client.get(
            f"/api/v1/tasks/{private_id}/history", headers=headers("dilshod"),
        )).status_code == 404
        assert (await client.delete(
            f"/api/v1/tasks/{private_id}", headers=headers("malika"),
        )).status_code == 204
        for username, role in (("baxtiyor", "co_assignee"), ("aziza", "observer")):
            added = await client.put(
                f"/api/v1/tasks/{task_id}/participants", headers=headers("malika"),
                json={"userId": sessions[username]["user"]["id"], "role": role},
            )
            assert added.status_code == 200

        proposed = due + timedelta(days=2)
        request_url = f"/api/v1/tasks/{task_id}/deadline-requests"
        payload = {"proposedDueAt": proposed.isoformat(), "reason": "Ожидаем внешние документы"}
        observer_request = await client.post(
            request_url, headers=headers("aziza"), json=payload,
        )
        assert observer_request.status_code == 403, observer_request.text
        executor_edit = await client.patch(
            f"/api/v1/tasks/{task_id}", headers=headers("dilshod"), json={
                "title": task["title"], "description": "", "project": task["project"],
                "assigneeId": task["assigneeId"], "priority": task["priority"],
                "dueAt": proposed.isoformat(),
            },
        )
        assert executor_edit.status_code == 403

        requested = await client.post(request_url, headers=headers("baxtiyor"), json=payload)
        assert requested.status_code == 201
        record = requested.json()["deadlineRequests"][-1]
        assert record["status"] == "pending"
        assert requested.json()["dueAt"] == task["dueAt"]
        duplicate = await client.post(request_url, headers=headers("dilshod"), json=payload)
        assert duplicate.status_code == 409

        bootstrap = await client.get("/api/v1/workspace/bootstrap", headers=headers("malika"))
        assert bootstrap.status_code == 200
        assert any(
            item["id"] == record["messageId"] and item["systemKind"] == "task_deadline_request"
            for item in bootstrap.json()["messages"]
        )

        decision_url = f"{request_url}/{record['id']}/decision"
        assert (await client.post(
            decision_url, headers=headers("dilshod"), json={"approved": True},
        )).status_code == 403
        approved = await client.post(
            decision_url, headers=headers("malika"), json={"approved": True},
        )
        assert approved.status_code == 200
        assert approved.json()["deadlineRequests"][-1]["status"] == "approved"
        assert datetime.fromisoformat(approved.json()["dueAt"]) == proposed
        history = await client.get(history_url, headers=headers("aziza"))
        assert history.status_code == 200, history.text
        trail = history.json()
        assert trail["historyComplete"] is True
        assert sum(item["kind"] == "deadline_approved" for item in trail["events"]) == 1
        assert any(item["kind"] == "deadline_requested" for item in trail["events"])
        engine = create_async_engine(database_url)
        try:
            async with engine.connect() as connection:
                events = (await connection.execute(select(task_efficiency_events).where(
                    task_efficiency_events.c.task_id == UUID(task_id),
                ))).mappings().all()
                decisions = (await connection.execute(select(task_deadline_requests).where(
                    task_deadline_requests.c.task_id == UUID(task_id),
                ))).mappings().all()
                # Both the normal ledger and older missing-event records must
                # respect the persisted approval before the original deadline.
                for source in (events, [event for event in events
                                        if event["event_type"] != "deadline_changed"]):
                    for username in ("baxtiyor", "dilshod"):
                        arguments = {
                            "user_id": UUID(sessions[username]["user"]["id"]),
                            "period": period_for(due),
                            "tracking_started_at": min(event["occurred_at"] for event in events),
                        }
                        reconciled = reconcile_deadline_decisions(source, decisions)
                        before_new_due = calculate_aggregate(
                            reconciled, **arguments, as_of=due + timedelta(hours=1),
                        )
                        assert before_new_due["overdue_count"] == 0
                        assert before_new_due["eligible_count"] == 0
        finally:
            await engine.dispose()
        assert (await client.post(
            decision_url, headers=headers("malika"), json={"approved": True},
        )).status_code == 200

        second = await client.post(request_url, headers=headers("dilshod"), json={
            "proposedDueAt": (proposed + timedelta(days=1)).isoformat(),
            "reason": "Нужно дополнительное время",
        })
        assert second.status_code == 201
        second_id = second.json()["deadlineRequests"][-1]["id"]
        rejected = await client.post(
            f"{request_url}/{second_id}/decision",
            headers=headers("malika"), json={"approved": False},
        )
        assert rejected.status_code == 200
        assert rejected.json()["deadlineRequests"][-1]["status"] == "rejected"
        assert datetime.fromisoformat(rejected.json()["dueAt"]) == proposed

        third = await client.post(request_url, headers=headers("dilshod"), json={
            "proposedDueAt": (proposed + timedelta(days=2)).isoformat(),
            "reason": "Ещё один документ",
        })
        assert third.status_code == 201
        direct = await client.post(
            f"/api/v1/tasks/{task_id}/extend-deadline", headers=headers("malika"),
            json={"proposedDueAt": (proposed + timedelta(days=3)).isoformat()},
        )
        assert direct.status_code == 200
        assert direct.json()["deadlineRequests"][-1]["status"] == "superseded"
        deleted = await client.delete(f"/api/v1/tasks/{task_id}", headers=headers("malika"))
        assert deleted.status_code == 204
