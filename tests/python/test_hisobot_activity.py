"""Factual draft generation, time/actor scope, retries, permission revocation and size."""

import asyncio
from datetime import UTC, date, datetime
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest
from sqlalchemy.ext.asyncio import AsyncConnection

from yuksalish_api import hisobot_activity as activity
from yuksalish_api.auth import AuthenticatedUser


def user() -> AuthenticatedUser:
    return AuthenticatedUser(
        id=uuid4(),
        username="draft-test",
        full_name="Тестовый сотрудник",
        position_id=None,
        job_title=None,
        role="employee",
    )


def rows(value: list[dict[str, object]]) -> MagicMock:
    result = MagicMock()
    result.mappings.return_value.all.return_value = value
    result.mappings.return_value.one_or_none.return_value = value[0] if value else None
    return result


def test_report_deduplicates_and_does_not_invent_work() -> None:
    fact = activity.ActivityFact(
        module="tasks", key="task-1", text="Результат отправлен на проверку."
    )
    content, omitted = activity.render_report(date(2026, 10, 21), [fact, fact])
    assert content == "Отчёт за 21.10.2026\n\n1. Результат отправлен на проверку."
    assert omitted == 0
    assert activity.render_report(date(2026, 10, 21), []) == ("", 0)
    assert activity.clean_title("Название\n2. чужой пункт\t ещё") == "Название 2. чужой пункт ещё"


def test_long_report_discloses_omissions_within_submission_limit() -> None:
    facts = [
        activity.ActivityFact(module="tasks", key=str(index), text="Проверена задача " * 30)
        for index in range(200)
    ]
    content, omitted = activity.render_report(date(2026, 10, 21), facts)
    assert 0 < len(content) <= 20_000
    assert omitted > 0
    assert f"не включено действий: {omitted}" in content
    assert len(facts) - omitted == content.count("Проверена задача " * 30)


def test_actor_history_differentiate_completed_review_and_checklist(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    owner = user()
    other = uuid4()
    now = datetime(2026, 10, 21, 12, 40, tzinfo=UTC)
    permissions = AsyncMock(return_value={"tasks": {"view": True}})
    monkeypatch.setattr(activity, "module_permissions_for_user", permissions)
    connection = AsyncMock(spec=AsyncConnection)
    event_rows = [
        {
            "task_id": "a",
            "title": "Личная задача",
            "event_type": "task_completed",
            "actor_user_id": other,
            "assignee_user_id": owner.id,
        },
        {
            "task_id": "b",
            "title": "Задача коллеги",
            "event_type": "task_completed",
            "actor_user_id": owner.id,
            "assignee_user_id": other,
        },
        {"task_id": "c", "title": "Результат", "event_type": "result_submitted_for_review"},
        {
            "task_id": "d",
            "title": "Начата",
            "event_type": "task_status_changed",
            "new_value": {"status": "in_progress"},
        },
        {
            "task_id": "e",
            "title": "Черновая задача",
            "event_type": "task_status_changed",
            "new_value": {"status": "new"},
        },
        {
            "task_id": "old-plan",
            "title": "Архивный план",
            "event_type": "task_completed",
            "reason_code": "historical_plan_import",
        },
    ]
    connection.execute.side_effect = [
        rows(event_rows),
        rows(
            [
                {"id": "point", "title": "Проверить договор", "task_title": "Поставка"},
            ]
        ),
    ]
    facts = asyncio.run(activity.collect_activity(connection, owner, now))
    assert len(facts) == 5
    text = "\n".join(fact.text for fact in facts)
    assert "Завершена задача «Личная задача»" in text
    assert "Проверен и принят результат по задаче «Задача коллеги»" in text
    assert "отправлен на проверку" in text
    assert "Взята в работу" in text
    assert "Выполнен пункт «Проверить договор»" in text
    assert "Черновая задача" not in text
    assert "Архивный план" not in text
    # 00:00 Tashkent is 19:00 UTC on the preceding calendar date.
    for call in connection.execute.await_args_list:
        params = call.args[0].compile().params
        assert owner.id in params.values()
        assert datetime(2026, 10, 20, 19, tzinfo=UTC) in params.values()
        assert now in params.values()


def test_payments_trips_and_both_project_models_use_real_actions(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    owner = user()
    monkeypatch.setattr(
        activity,
        "module_permissions_for_user",
        AsyncMock(
            return_value={
                name: {"view": True}
                for name in ["payment_requests", "trip_approvals", "projects", "project_hub"]
            }
        ),
    )
    connection = AsyncMock(spec=AsyncConnection)
    connection.execute.side_effect = [
        rows([{"request_id": "pay", "node_key": "stage-1", "action": "approve", "title": "Счёт"}]),
        rows(
            [
                {
                    "request_id": "trip",
                    "action": "approve",
                    "to_stage": "hr",
                    "destination": "Самарканд",
                    "purpose": "Встреча",
                }
            ]
        ),
        rows(
            [{"project_id": "legacy", "action": "moved", "to_stage": "failure", "title": "Проект"}]
        ),
        rows([{"id": "hub", "title": "Новый проект"}]),
        rows(
            [
                {
                    "item_id": "item",
                    "to_status": "completed",
                    "title": "Работа",
                    "project_title": "Проект",
                }
            ]
        ),
        rows([{"request_id": "fund", "step": 1, "action": "approve", "title": "Финансирование"}]),
    ]
    facts = asyncio.run(
        activity.collect_activity(connection, owner, datetime(2026, 10, 21, 12, tzinfo=UTC))
    )
    assert len(facts) == 6
    text = "\n".join(fact.text for fact in facts)
    assert "Заявка на оплату «Счёт»: согласование" in text
    assert "Кадровая служба" in text
    assert "Поездка выполнена" not in text
    assert "Завершён без реализации" in text
    assert "Успешно завершён" not in text
    assert "Создан проект" in text
    assert "Работа «Работа»" in text
    assert "Финансирование проекта" in text


def test_disabled_modules_are_not_queried(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(activity, "module_permissions_for_user", AsyncMock(return_value={}))
    connection = AsyncMock(spec=AsyncConnection)
    assert asyncio.run(activity.collect_activity(connection, user(), datetime.now(UTC))) == []
    connection.execute.assert_not_awaited()


def test_snapshot_is_not_rebuilt_on_repeated_reminder(monkeypatch: pytest.MonkeyPatch) -> None:
    owner = user()
    connection = AsyncMock(spec=AsyncConnection)
    connection.scalar.return_value = owner.id
    collect = AsyncMock()
    monkeypatch.setattr(activity, "collect_activity", collect)
    asyncio.run(activity.ensure_activity_draft(connection, owner, datetime.now(UTC)))
    collect.assert_not_awaited()
    connection.execute.assert_not_awaited()


def test_snapshot_insert_handles_concurrent_retry(monkeypatch: pytest.MonkeyPatch) -> None:
    connection = AsyncMock(spec=AsyncConnection)
    connection.scalar.return_value = None
    monkeypatch.setattr(activity, "collect_activity", AsyncMock(return_value=[]))
    asyncio.run(activity.ensure_activity_draft(connection, user(), datetime.now(UTC)))
    assert "ON CONFLICT (user_id, report_date) DO NOTHING" in str(
        connection.execute.await_args.args[0]
    )


def test_read_is_private_and_redacts_revoked_module(monkeypatch: pytest.MonkeyPatch) -> None:
    owner = user()
    connection = AsyncMock(spec=AsyncConnection)
    connection.execute.return_value = rows(
        [
            {
                "generated_at": datetime(2026, 10, 21, 12, 40, tzinfo=UTC),
                "seen_at": None,
                "facts": [
                    {"module": "tasks", "key": "allowed", "text": "Своя задача"},
                    {"module": "payment_requests", "key": "revoked", "text": "Скрытая заявка"},
                ],
            }
        ]
    )
    monkeypatch.setattr(
        activity,
        "module_permissions_for_user",
        AsyncMock(
            return_value={
                "tasks": {"view": True},
                "ai_hisobot": {"view": True},
            }
        ),
    )
    draft = asyncio.run(activity.read_activity_draft(connection, owner, date(2026, 10, 21)))
    assert draft is not None and draft.activity_count == 1
    assert "Своя задача" in draft.content and "Скрытая заявка" not in draft.content
    assert owner.id in connection.execute.await_args.args[0].compile().params.values()
    monkeypatch.setattr(
        activity,
        "module_permissions_for_user",
        AsyncMock(
            return_value={
                "tasks": {"view": True},
            }
        ),
    )
    assert asyncio.run(activity.read_activity_draft(connection, owner, date(2026, 10, 21))) is None
