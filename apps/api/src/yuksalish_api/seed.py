from collections.abc import Mapping, Sequence
from datetime import UTC, datetime, timedelta
from uuid import NAMESPACE_URL, UUID, uuid5

from pydantic import SecretStr
from sqlalchemy import update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncConnection, AsyncEngine

from .auth_service import hash_password
from .tables import (
    approval_edges,
    approval_nodes,
    approval_request_versions,
    approval_requests,
    approval_templates,
    chat_members,
    chats,
    departments,
    message_versions,
    messages,
    positions,
    task_checklist_items,
    task_comments,
    task_cycles,
    task_dependencies,
    task_participants,
    tasks,
    users,
)


def demo_uuid(key: str) -> UUID:
    return uuid5(NAMESPACE_URL, f"https://workspace.yuksalish.uz/demo/{key}")


def position_uuid(name: str) -> UUID:
    return uuid5(NAMESPACE_URL, f"https://workspace.yuksalish.uz/position/{name}")


async def _insert_missing(
    connection: AsyncConnection,
    table: object,
    rows: Sequence[Mapping[str, object]],
) -> None:
    if rows:
        await connection.execute(pg_insert(table).values(rows).on_conflict_do_nothing())  # type: ignore[arg-type]


async def seed_demo_data(
    engine: AsyncEngine,
    demo_password: SecretStr | None = None,
) -> None:
    now = datetime.now(UTC).replace(microsecond=0)
    department_id = demo_uuid("department/finance")
    person_ids = {
        "aziza": demo_uuid("user/aziza"),
        "baxtiyor": demo_uuid("user/baxtiyor"),
        "dilshod": demo_uuid("user/dilshod"),
        "malika": demo_uuid("user/malika"),
    }
    demo_positions = (
        "Финансовый менеджер",
        "Руководитель отдела",
        "Специалист по закупкам",
        "Директор",
    )
    chat_ids = {
        "finance": demo_uuid("chat/finance"),
        "baxtiyor": demo_uuid("chat/baxtiyor"),
        "office": demo_uuid("chat/office"),
        "payment": demo_uuid("chat/payment-148"),
    }
    message_rows = [
        {
            "id": demo_uuid("message/1"),
            "chat_id": chat_ids["finance"],
            "author_user_id": person_ids["dilshod"],
            "reply_to_message_id": None,
            "body": (
                "Получил обновлённый счёт на ноутбуки. Сумма 84 600 000 сум, "
                "срок оплаты до пятницы."
            ),
            "created_at": now - timedelta(minutes=11),
            "edited_at": None,
            "deleted_at": None,
        },
        {
            "id": demo_uuid("message/2"),
            "chat_id": chat_ids["finance"],
            "author_user_id": person_ids["baxtiyor"],
            "reply_to_message_id": None,
            "body": "Проверь соответствие бюджету проекта и добавь договор к заявке.",
            "created_at": now - timedelta(minutes=8),
            "edited_at": None,
            "deleted_at": None,
        },
        {
            "id": demo_uuid("message/3"),
            "chat_id": chat_ids["finance"],
            "author_user_id": person_ids["aziza"],
            "reply_to_message_id": None,
            "body": "Счёт и бюджет проверены. Можно запускать маршрут согласования оплаты.",
            "created_at": now - timedelta(minutes=2),
            "edited_at": None,
            "deleted_at": None,
        },
        {
            "id": demo_uuid("message/4"),
            "chat_id": chat_ids["baxtiyor"],
            "author_user_id": person_ids["baxtiyor"],
            "reply_to_message_id": None,
            "body": "Возьму задачу в работу сегодня. Итог прикреплю к карточке.",
            "created_at": now - timedelta(hours=1),
            "edited_at": None,
            "deleted_at": None,
        },
        {
            "id": demo_uuid("message/5"),
            "chat_id": chat_ids["office"],
            "author_user_id": person_ids["dilshod"],
            "reply_to_message_id": None,
            "body": "Прикрепил коммерческое предложение по мебели и оргтехнике.",
            "created_at": now - timedelta(days=1),
            "edited_at": None,
            "deleted_at": None,
        },
        {
            "id": demo_uuid("message/6"),
            "chat_id": chat_ids["payment"],
            "author_user_id": person_ids["aziza"],
            "reply_to_message_id": None,
            "body": (
                "Заявка прошла проверку бюджета и перешла на согласование финансовому менеджеру."
            ),
            "created_at": now - timedelta(days=1),
            "edited_at": None,
            "deleted_at": None,
        },
    ]
    template_id = demo_uuid("approval-template/payment-v3")
    workflow_nodes = [
        ("start", "start", "Новая заявка", "Сотрудник отправил форму", 40.0, 170.0),
        (
            "manager",
            "approval",
            "Руководитель отдела",
            "Один согласующий, срок 1 день",
            260.0,
            80.0,
        ),
        ("amount", "condition", "Сумма выше 50 млн?", "Поле: amount", 500.0, 80.0),
        (
            "finance",
            "approval",
            "Финансовый менеджер",
            "Проверка бюджета",
            740.0,
            20.0,
        ),
        ("director", "approval", "Директор", "Обязательное решение", 740.0, 150.0),
        ("approved", "end", "Оплата согласована", "Финальный статус", 980.0, 80.0),
        (
            "correction",
            "correction",
            "Вернуть на доработку",
            "Комментарий обязателен",
            500.0,
            280.0,
        ),
    ]
    workflow_edges = [
        ("start", "manager", "submit", None, {}, 0),
        ("manager", "amount", "approve", None, {}, 0),
        (
            "amount",
            "finance",
            "true",
            "Да",
            {"field": "amount", "operator": "gt", "value": 50_000_000},
            0,
        ),
        (
            "amount",
            "director",
            "false",
            "Нет",
            {"field": "amount", "operator": "lte", "value": 50_000_000},
            0,
        ),
        ("finance", "director", "approve", None, {}, 0),
        ("director", "approved", "approve", None, {}, 0),
        ("manager", "correction", "return", "Вернуть", {}, 0),
        ("correction", "start", "resubmit", None, {}, 0),
    ]

    async with engine.begin() as connection:
        await _insert_missing(
            connection,
            positions,
            [
                {
                    "id": position_uuid(name),
                    "name": name,
                    "is_active": True,
                    "sort_order": 1_000 + index * 10,
                    "source": "workspace",
                    "aliases": [],
                    "created_at": now,
                    "updated_at": now,
                }
                for index, name in enumerate(demo_positions)
            ],
        )
        await _insert_missing(
            connection,
            departments,
            [
                {
                    "id": department_id,
                    "code": "finance",
                    "name": "Финансы и закупки",
                    "parent_id": None,
                    "created_at": now,
                }
            ],
        )
        await _insert_missing(
            connection,
            users,
            [
                {
                    "id": person_ids["aziza"],
                    "username": "aziza",
                    "full_name": "Азиза Каримова",
                    "job_title": "Финансовый менеджер",
                    "role": "manager",
                    "status": "active",
                    "department_id": department_id,
                    "position_id": position_uuid("Финансовый менеджер"),
                    "created_at": now,
                    "updated_at": now,
                },
                {
                    "id": person_ids["baxtiyor"],
                    "username": "baxtiyor",
                    "full_name": "Бахтиёр Самугов",
                    "job_title": "Руководитель отдела",
                    "role": "manager",
                    "status": "active",
                    "department_id": department_id,
                    "position_id": position_uuid("Руководитель отдела"),
                    "created_at": now,
                    "updated_at": now,
                },
                {
                    "id": person_ids["dilshod"],
                    "username": "dilshod",
                    "full_name": "Дилшод Рахимов",
                    "job_title": "Специалист по закупкам",
                    "role": "employee",
                    "status": "active",
                    "department_id": department_id,
                    "position_id": position_uuid("Специалист по закупкам"),
                    "created_at": now,
                    "updated_at": now,
                },
                {
                    "id": person_ids["malika"],
                    "username": "malika",
                    "full_name": "Малика Нурова",
                    "job_title": "Директор",
                    "role": "admin",
                    "status": "active",
                    "department_id": department_id,
                    "position_id": position_uuid("Директор"),
                    "created_at": now,
                    "updated_at": now,
                },
            ],
        )
        if demo_password is not None:
            for user_id in person_ids.values():
                await connection.execute(
                    update(users)
                    .where(users.c.id == user_id, users.c.password_hash.is_(None))
                    .values(
                        password_hash=hash_password(demo_password.get_secret_value()),
                        password_changed_at=now,
                        updated_at=now,
                    )
                )
        await _insert_missing(
            connection,
            chats,
            [
                {
                    "id": chat_ids["finance"],
                    "kind": "group",
                    "title": "Финансы и закупки",
                    "context_type": "department",
                    "context_id": department_id,
                    "created_by_user_id": person_ids["aziza"],
                    "created_at": now,
                    "updated_at": now,
                },
                {
                    "id": chat_ids["baxtiyor"],
                    "kind": "direct",
                    "title": "Бахтиёр Самугов",
                    "context_type": None,
                    "context_id": None,
                    "created_by_user_id": person_ids["aziza"],
                    "created_at": now,
                    "updated_at": now,
                },
                {
                    "id": chat_ids["office"],
                    "kind": "project",
                    "title": "Проект: новый офис",
                    "context_type": "project",
                    "context_id": None,
                    "created_by_user_id": person_ids["baxtiyor"],
                    "created_at": now,
                    "updated_at": now,
                },
                {
                    "id": chat_ids["payment"],
                    "kind": "approval",
                    "title": "Заявка №148: оргтехника",
                    "context_type": "approval",
                    "context_id": demo_uuid("approval-request/148"),
                    "created_by_user_id": person_ids["aziza"],
                    "created_at": now,
                    "updated_at": now,
                },
            ],
        )
        member_rows = [
            {
                "chat_id": chat_id,
                "user_id": user_id,
                "member_role": "member",
                "joined_at": now,
                "muted_until": None,
            }
            for chat_id in chat_ids.values()
            for user_id in person_ids.values()
        ]
        await _insert_missing(connection, chat_members, member_rows)
        await _insert_missing(connection, messages, message_rows)
        await _insert_missing(
            connection,
            message_versions,
            [
                {
                    "message_id": row["id"],
                    "body": row["body"],
                    "change_reason": "initial",
                    "created_at": row["created_at"],
                }
                for row in message_rows
            ],
        )
        monthly_cycle_id = demo_uuid("task-cycle/monthly-budget")
        await _insert_missing(
            connection,
            task_cycles,
            [
                {
                    "id": monthly_cycle_id,
                    "title": "Сверить лимиты бюджета",
                    "schedule_kind": "monthly",
                    "schedule_config": {"interval": 1},
                    "timezone": "Asia/Tashkent",
                    "next_run_at": now + timedelta(days=30),
                    "is_enabled": True,
                    "created_by_user_id": person_ids["baxtiyor"],
                    "created_at": now,
                    "updated_at": now,
                }
            ],
        )
        await _insert_missing(
            connection,
            tasks,
            [
                {
                    "id": demo_uuid("task/104"),
                    "title": "Подготовить договор на поставку ноутбуков",
                    "description": "Собрать документы и проверить условия поставки.",
                    "status": "in_progress",
                    "priority": "high",
                    "author_user_id": person_ids["baxtiyor"],
                    "primary_assignee_user_id": person_ids["dilshod"],
                    "cycle_id": None,
                    "cycle_occurrence_key": None,
                    "project_key": "Новый офис",
                    "starts_at": now,
                    "due_at": now + timedelta(hours=5),
                    "result_text": None,
                    "source_message_id": demo_uuid("message/2"),
                    "created_at": now,
                    "updated_at": now,
                },
                {
                    "id": demo_uuid("task/105"),
                    "title": "Сверить лимиты бюджета на сентябрь",
                    "description": "Подтвердить доступный остаток бюджета.",
                    "status": "awaiting_review",
                    "priority": "normal",
                    "author_user_id": person_ids["baxtiyor"],
                    "primary_assignee_user_id": person_ids["aziza"],
                    "cycle_id": None,
                    "cycle_occurrence_key": None,
                    "project_key": "Финансы",
                    "starts_at": now,
                    "due_at": now + timedelta(days=1),
                    "result_text": None,
                    "source_message_id": None,
                    "created_at": now,
                    "updated_at": now,
                },
                {
                    "id": demo_uuid("task/106"),
                    "title": "Согласовать график поставки мебели",
                    "description": "Сверить даты с поставщиком и командой офиса.",  # noqa: RUF001
                    "status": "new",
                    "priority": "normal",
                    "author_user_id": person_ids["aziza"],
                    "primary_assignee_user_id": person_ids["baxtiyor"],
                    "cycle_id": None,
                    "cycle_occurrence_key": None,
                    "project_key": "Новый офис",
                    "starts_at": now,
                    "due_at": now + timedelta(days=2),
                    "result_text": None,
                    "source_message_id": None,
                    "created_at": now,
                    "updated_at": now,
                },
            ],
        )
        await connection.execute(
            update(tasks)
            .where(tasks.c.id == demo_uuid("task/105"), tasks.c.cycle_id.is_(None))
            .values(cycle_id=monthly_cycle_id, cycle_occurrence_key="initial")
        )
        await _insert_missing(
            connection,
            task_participants,
            [
                {
                    "task_id": demo_uuid("task/104"),
                    "user_id": person_ids["aziza"],
                    "participant_role": "observer",
                },
                {
                    "task_id": demo_uuid("task/106"),
                    "user_id": person_ids["dilshod"],
                    "participant_role": "co_assignee",
                },
            ],
        )
        await _insert_missing(
            connection,
            task_checklist_items,
            [
                {
                    "id": demo_uuid("task-checklist/104/1"),
                    "task_id": demo_uuid("task/104"),
                    "title": "Проверить реквизиты поставщика",
                    "is_completed": True,
                    "sort_order": 1,
                    "created_by_user_id": person_ids["baxtiyor"],
                    "completed_by_user_id": person_ids["dilshod"],
                    "completed_at": now - timedelta(minutes=20),
                    "created_at": now - timedelta(hours=2),
                    "updated_at": now - timedelta(minutes=20),
                },
                {
                    "id": demo_uuid("task-checklist/104/2"),
                    "task_id": demo_uuid("task/104"),
                    "title": "Согласовать условия поставки",
                    "is_completed": False,
                    "sort_order": 2,
                    "created_by_user_id": person_ids["baxtiyor"],
                    "completed_by_user_id": None,
                    "completed_at": None,
                    "created_at": now - timedelta(hours=2),
                    "updated_at": now - timedelta(hours=2),
                },
            ],
        )
        await _insert_missing(
            connection,
            task_comments,
            [
                {
                    "id": demo_uuid("task-comment/104/1"),
                    "task_id": demo_uuid("task/104"),
                    "author_user_id": person_ids["aziza"],
                    "body": "Бюджет подтверждён, можно завершать проверку договора.",
                    "created_at": now - timedelta(minutes=15),
                    "edited_at": None,
                }
            ],
        )
        await _insert_missing(
            connection,
            task_dependencies,
            [
                {
                    "task_id": demo_uuid("task/106"),
                    "depends_on_task_id": demo_uuid("task/104"),
                    "dependency_kind": "blocks",
                    "created_by_user_id": person_ids["aziza"],
                    "created_at": now,
                }
            ],
        )
        await _insert_missing(
            connection,
            approval_templates,
            [
                {
                    "id": template_id,
                    "template_key": "payment",
                    "name": "Заявка на оплату",
                    "request_kind": "payment",
                    "version": 3,
                    "status": "draft",
                    "form_schema": {
                        "fields": ["title", "amount", "currency", "purpose", "sourceTaskId"]
                    },
                    "created_by_user_id": person_ids["aziza"],
                    "created_at": now,
                    "published_at": None,
                }
            ],
        )
        await _insert_missing(
            connection,
            approval_nodes,
            [
                {
                    "id": demo_uuid(f"approval-node/{node_key}"),
                    "template_id": template_id,
                    "node_key": node_key,
                    "kind": kind,
                    "title": title,
                    "config": {"detail": detail},
                    "position_x": x,
                    "position_y": y,
                }
                for node_key, kind, title, detail, x, y in workflow_nodes
            ],
        )
        await _insert_missing(
            connection,
            approval_edges,
            [
                {
                    "id": demo_uuid(f"approval-edge/{source}/{target}/{outcome}"),
                    "template_id": template_id,
                    "source_node_key": source,
                    "target_node_key": target,
                    "outcome": outcome,
                    "label": label,
                    "condition": condition,
                    "sort_order": sort_order,
                }
                for source, target, outcome, label, condition, sort_order in workflow_edges
            ],
        )
        await _insert_missing(
            connection,
            approval_requests,
            [
                {
                    "id": demo_uuid("approval-request/148"),
                    "template_id": template_id,
                    "requester_user_id": person_ids["dilshod"],
                    "title": "Оплата ноутбуков для нового офиса",
                    "payload": {
                        "amount": 84_600_000,
                        "currency": "UZS",
                        "purpose": "Ноутбуки для нового офиса",
                        "number": "148",
                    },
                    "status": "running",
                    "active_node_keys": ["manager"],
                    "source_task_id": demo_uuid("task/104"),
                    "current_version": 1,
                    "created_at": now,
                    "updated_at": now,
                    "finished_at": None,
                },
                {
                    "id": demo_uuid("approval-request/147"),
                    "template_id": template_id,
                    "requester_user_id": person_ids["aziza"],
                    "title": "Продление лицензий на программное обеспечение",
                    "payload": {
                        "amount": 12_400_000,
                        "currency": "UZS",
                        "purpose": "Продление корпоративных лицензий",
                        "number": "147",
                    },
                    "status": "running",
                    "active_node_keys": ["finance"],
                    "source_task_id": None,
                    "current_version": 1,
                    "created_at": now - timedelta(days=1),
                    "updated_at": now,
                    "finished_at": None,
                },
                {
                    "id": demo_uuid("approval-request/142"),
                    "template_id": template_id,
                    "requester_user_id": person_ids["baxtiyor"],
                    "title": "Аванс на региональное мероприятие",
                    "payload": {
                        "amount": 6_800_000,
                        "currency": "UZS",
                        "purpose": "Организация регионального мероприятия",
                        "number": "142",
                    },
                    "status": "approved",
                    "active_node_keys": [],
                    "source_task_id": None,
                    "current_version": 1,
                    "created_at": now - timedelta(days=3),
                    "updated_at": now - timedelta(days=2),
                    "finished_at": now - timedelta(days=2),
                },
            ],
        )
        await _insert_missing(
            connection,
            approval_request_versions,
            [
                {
                    "id": demo_uuid(f"approval-request-version/{number}/1"),
                    "request_id": demo_uuid(f"approval-request/{number}"),
                    "version": 1,
                    "title": title,
                    "payload": payload,
                    "attachment_ids": [],
                    "edited_by_user_id": person_ids[requester],
                    "change_reason": "initial",
                    "change_comment": None,
                    "created_at": created_at,
                }
                for number, requester, title, payload, created_at in (
                    (
                        "148",
                        "dilshod",
                        "Оплата ноутбуков для нового офиса",
                        {
                            "amount": 84_600_000,
                            "currency": "UZS",
                            "purpose": "Ноутбуки для нового офиса",
                            "number": "148",
                        },
                        now,
                    ),
                    (
                        "147",
                        "aziza",
                        "Продление лицензий на программное обеспечение",
                        {
                            "amount": 12_400_000,
                            "currency": "UZS",
                            "purpose": "Продление корпоративных лицензий",
                            "number": "147",
                        },
                        now - timedelta(days=1),
                    ),
                    (
                        "142",
                        "baxtiyor",
                        "Аванс на региональное мероприятие",
                        {
                            "amount": 6_800_000,
                            "currency": "UZS",
                            "purpose": "Организация регионального мероприятия",
                            "number": "142",
                        },
                        now - timedelta(days=3),
                    ),
                )
            ],
        )
