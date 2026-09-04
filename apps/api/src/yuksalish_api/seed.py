from collections.abc import Mapping, Sequence
from datetime import UTC, date, datetime, timedelta
from itertools import pairwise
from uuid import NAMESPACE_URL, UUID, uuid5

from pydantic import SecretStr
from sqlalchemy import select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncConnection, AsyncEngine

from .auth_service import hash_password
from .position_policy import PAYMENT_CREATOR_POSITION_NAMES
from .tables import (
    approval_edges,
    approval_nodes,
    approval_request_versions,
    approval_requests,
    approval_templates,
    calendar_event_attendees,
    calendar_events,
    chat_members,
    chats,
    departments,
    feed_comments,
    feed_posts,
    feed_reactions,
    message_receipts,
    message_versions,
    messages,
    positions,
    project_stage_actions,
    task_checklist_items,
    task_comments,
    task_cycles,
    task_dependencies,
    task_participants,
    tasks,
    trip_request_actions,
    trip_request_employees,
    trip_requests,
    users,
    workspace_projects,
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
    demo_positions = PAYMENT_CREATOR_POSITION_NAMES
    payment_position_ids = {
        name: str(position_uuid(name)) for name in PAYMENT_CREATOR_POSITION_NAMES
    }
    nargiza_position_id, javohir_position_id, umid_position_id, bobur_position_id = (
        payment_position_ids[name] for name in PAYMENT_CREATOR_POSITION_NAMES
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
    template_id = demo_uuid("approval-template/payment-v6")
    draft_template_id = demo_uuid("approval-template/payment-v7")
    workflow_nodes: list[tuple[str, str, str, str, float, float, dict[str, object]]] = [
        (
            "start",
            "start",
            "Запуск",
            "Заявку создаёт одна из четырёх уполномоченных должностей",
            40.0,
            180.0,
            {"creatorPositionIds": list(payment_position_ids.values())},
        ),
        (
            "project_financier",
            "approval",
            "Утверждение финансистом проекта",
            "Проверка проекта и источника финансирования",
            260.0,
            40.0,
            {"approverPositionId": nargiza_position_id},
        ),
        (
            "finance_manager_projects",
            "approval",
            "Утверждение финансовым менеджером по проектам",
            "Финансовая проверка заявки",
            480.0,
            40.0,
            {"approverPositionId": nargiza_position_id},
        ),
        (
            "members",
            "approval",
            "Работа с членами Юксалиш",  # noqa: RUF001 - Cyrillic title
            "Проверка рабочей группы",
            700.0,
            40.0,
            {"approverPositionId": nargiza_position_id},
        ),
        (
            "chair_assistant",
            "approval",
            "Утверждение помощником председателя",
            "Решение помощника председателя",
            920.0,
            40.0,
            {"approverPositionId": javohir_position_id},
        ),
        (
            "chief_accountant",
            "approval",
            "Утверждение главным бухгалтером",
            "Бухгалтерская проверка",
            1140.0,
            40.0,
            {"approverPositionId": nargiza_position_id},
        ),
        (
            "deputy_chair",
            "approval",
            "Утверждение заместителя председателя",
            "Решение заместителя председателя",
            260.0,
            320.0,
            {"approverPositionId": umid_position_id},
        ),
        (
            "chair",
            "approval",
            "Утверждение председателем",
            "Финальное управленческое решение",
            480.0,
            320.0,
            {"approverPositionId": bobur_position_id},
        ),
        (
            "awaiting_payment",
            "approval",
            "Ожидает оплаты",
            "Заявка передана на исполнение",
            700.0,
            320.0,
            {"approverPositionId": nargiza_position_id},
        ),
        (
            "payment",
            "approval",
            "Оплата",
            "Подтверждение фактической оплаты",
            920.0,
            320.0,
            {"approverPositionId": nargiza_position_id},
        ),
        (
            "correction",
            "correction",
            "Доработка",
            "Комментарий обязателен",
            700.0,
            570.0,
            {"approverPositionIds": list(payment_position_ids.values())},
        ),
        ("completed", "end", "Выполнено", "Оплата завершена", 1140.0, 320.0, {}),
        ("cancelled", "end", "Отмена", "Заявка отклонена или отменена", 1140.0, 570.0, {}),
    ]
    approval_stage_keys = [
        "project_financier",
        "finance_manager_projects",
        "members",
        "chair_assistant",
        "chief_accountant",
        "deputy_chair",
        "chair",
        "awaiting_payment",
        "payment",
    ]
    workflow_edges: list[tuple[str, str, str, str | None, dict[str, object], int]] = [
        ("start", approval_stage_keys[0], "submit", None, {}, 0),
        *[
            (source, target, "approve", None, {}, 0)
            for source, target in pairwise(approval_stage_keys)
        ],
        (approval_stage_keys[-1], "completed", "approve", None, {}, 0),
        *[(source, "correction", "return", "Вернуть", {}, 0) for source in approval_stage_keys],
        *[(source, "cancelled", "reject", "Отклонить", {}, 0) for source in approval_stage_keys],
        ("correction", "start", "resubmit", None, {}, 0),
    ]
    payment_form_schema = {
        "fields": [
            "title",
            "transferType",
            "projectName",
            "projectCode",
            "sourceAccount",
            "destinationAccount",
            "requestPriority",
            "deadline",
            "primaryFiles",
            "additionalFiles",
            "comment",
            "tripPurpose",
            "tripStartDate",
            "tripEndDate",
            "employeeIds",
            "paymentPurpose",
            "paymentReason",
            "amount",
            "currency",
            "responsibleUserId",
        ]
    }

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
                    "job_title": PAYMENT_CREATOR_POSITION_NAMES[0],
                    "role": "manager",
                    "status": "active",
                    "department_id": department_id,
                    "position_id": position_uuid(PAYMENT_CREATOR_POSITION_NAMES[0]),
                    "created_at": now,
                    "updated_at": now,
                },
                {
                    "id": person_ids["baxtiyor"],
                    "username": "baxtiyor",
                    "full_name": "Бахтиёр Самугов",
                    "job_title": PAYMENT_CREATOR_POSITION_NAMES[1],
                    "role": "manager",
                    "status": "active",
                    "department_id": department_id,
                    "position_id": position_uuid(PAYMENT_CREATOR_POSITION_NAMES[1]),
                    "created_at": now,
                    "updated_at": now,
                },
                {
                    "id": person_ids["dilshod"],
                    "username": "dilshod",
                    "full_name": "Дилшод Рахимов",
                    "job_title": PAYMENT_CREATOR_POSITION_NAMES[2],
                    "role": "employee",
                    "status": "active",
                    "department_id": department_id,
                    "position_id": position_uuid(PAYMENT_CREATOR_POSITION_NAMES[2]),
                    "created_at": now,
                    "updated_at": now,
                },
                {
                    "id": person_ids["malika"],
                    "username": "malika",
                    "full_name": "Малика Нурова",
                    "job_title": PAYMENT_CREATOR_POSITION_NAMES[3],
                    "role": "admin",
                    "status": "active",
                    "department_id": department_id,
                    "position_id": position_uuid(PAYMENT_CREATOR_POSITION_NAMES[3]),
                    "created_at": now,
                    "updated_at": now,
                },
            ],
        )
        for username, position_name in zip(
            person_ids,
            PAYMENT_CREATOR_POSITION_NAMES,
            strict=True,
        ):
            await connection.execute(
                update(users)
                .where(users.c.id == person_ids[username])
                .values(
                    position_id=position_uuid(position_name),
                    job_title=position_name,
                    updated_at=now,
                )
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
        existing_chat_ids = set((await connection.execute(select(chats.c.id))).scalars())
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
                "member_role": (
                    "owner" if chat_id == chat_ids["finance"] and user_id == person_ids["aziza"]
                    else "member"
                ),
                "joined_at": now,
                "muted_until": None,
            }
            for chat_id in chat_ids.values()
            if chat_id not in existing_chat_ids
            for user_id in person_ids.values()
            if chat_id != chat_ids["baxtiyor"]
            or user_id in {person_ids["aziza"], person_ids["baxtiyor"]}
        ]
        await _insert_missing(connection, chat_members, member_rows)
        await _insert_missing(connection, messages, message_rows)
        versioned_message_ids = set(
            (await connection.execute(select(message_versions.c.message_id))).scalars()
        )
        await _insert_missing(
            connection,
            message_versions,
            [
                {
                    "message_id": row["id"],
                    "body": row["body"],
                    "change_reason": "initial",
                    "actor_user_id": row["author_user_id"],
                    "created_at": row["created_at"],
                }
                for row in message_rows
                if row["id"] not in versioned_message_ids
            ],
        )
        await _insert_missing(
            connection,
            message_receipts,
            [
                {
                    "message_id": row["id"],
                    "user_id": user_id,
                    "delivered_at": row["created_at"],
                    "read_at": (
                        None
                        if user_id == person_ids["aziza"]
                        and row["chat_id"] == chat_ids["finance"]
                        and row["author_user_id"] != user_id
                        else row["created_at"]
                    ),
                }
                for row in message_rows
                for user_id in person_ids.values()
                if row["chat_id"] not in existing_chat_ids
                and (row["chat_id"] != chat_ids["baxtiyor"]
                     or user_id in {person_ids["aziza"], person_ids["baxtiyor"]})
            ],
        )
        feed_post_ids = {
            "launch": demo_uuid("feed-post/workspace-launch"),
            "office": demo_uuid("feed-post/office-update"),
        }
        await _insert_missing(
            connection,
            feed_posts,
            [
                {
                    "id": feed_post_ids["launch"],
                    "author_user_id": person_ids["baxtiyor"],
                    "title": "Рабочая среда Yuksalish",
                    "body": (
                        "Задачи, заявки, проекты и рабочие обсуждения теперь собраны "
                        "в одном защищённом приложении."
                    ),
                    "is_pinned": True,
                    "created_at": now - timedelta(days=1),
                    "updated_at": now - timedelta(hours=2),
                },
                {
                    "id": feed_post_ids["office"],
                    "author_user_id": person_ids["aziza"],
                    "title": "Статус проекта нового офиса",
                    "body": (
                        "Проверка бюджета завершена. Команда переходит к согласованию "
                        "графика поставок."
                    ),
                    "is_pinned": False,
                    "created_at": now - timedelta(hours=5),
                    "updated_at": now - timedelta(hours=4),
                },
            ],
        )
        await _insert_missing(
            connection,
            feed_comments,
            [
                {
                    "id": demo_uuid("feed-comment/office/1"),
                    "post_id": feed_post_ids["office"],
                    "author_user_id": person_ids["dilshod"],
                    "body": "Договор с поставщиком добавлю в задачу сегодня.",  # noqa: RUF001
                    "created_at": now - timedelta(hours=4),
                }
            ],
        )
        await _insert_missing(
            connection,
            feed_reactions,
            [
                {
                    "post_id": feed_post_ids["launch"],
                    "user_id": person_ids["aziza"],
                    "kind": "like",
                    "created_at": now - timedelta(hours=2),
                }
            ],
        )
        calendar_event_ids = {
            "planning": demo_uuid("calendar-event/weekly-planning"),
            "deadline": demo_uuid("calendar-event/payment-deadline"),
            "trip": demo_uuid("calendar-event/tashkent-trip"),
        }
        await _insert_missing(
            connection,
            calendar_events,
            [
                {
                    "id": calendar_event_ids["planning"],
                    "organizer_user_id": person_ids["baxtiyor"],
                    "title": "Еженедельное планирование",
                    "description": "Сверяем задачи, проекты и блокирующие вопросы.",
                    "event_type": "meeting",
                    "starts_at": now + timedelta(days=1),
                    "ends_at": now + timedelta(days=1, hours=1),
                    "all_day": False,
                    "location": "Переговорная",
                    "status": "scheduled",
                    "created_at": now,
                    "updated_at": now,
                },
                {
                    "id": calendar_event_ids["deadline"],
                    "organizer_user_id": person_ids["aziza"],
                    "title": "Срок оплаты оборудования",
                    "description": "Завершить маршрут заявки на оплату.",
                    "event_type": "deadline",
                    "starts_at": now + timedelta(days=3),
                    "ends_at": now + timedelta(days=3, hours=1),
                    "all_day": False,
                    "location": "",
                    "status": "scheduled",
                    "created_at": now,
                    "updated_at": now,
                },
                {
                    "id": calendar_event_ids["trip"],
                    "organizer_user_id": person_ids["malika"],
                    "title": "Командировка проектной команды",
                    "description": "Рабочая встреча с региональной командой.",  # noqa: RUF001
                    "event_type": "trip",
                    "starts_at": now + timedelta(days=7),
                    "ends_at": now + timedelta(days=9),
                    "all_day": True,
                    "location": "Самарканд",
                    "status": "scheduled",
                    "created_at": now,
                    "updated_at": now,
                },
            ],
        )
        await _insert_missing(
            connection,
            calendar_event_attendees,
            [
                {"event_id": event_id, "user_id": user_id}
                for event_id in calendar_event_ids.values()
                for user_id in person_ids.values()
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
                    "version": 6,
                    "status": "published",
                    "form_schema": payment_form_schema,
                    "created_by_user_id": person_ids["aziza"],
                    "created_at": now,
                    "published_at": now,
                },
                {
                    "id": draft_template_id,
                    "template_key": "payment",
                    "name": "Заявка на оплату",
                    "request_kind": "payment",
                    "version": 7,
                    "status": "draft",
                    "form_schema": payment_form_schema,
                    "created_by_user_id": person_ids["aziza"],
                    "created_at": now,
                    "published_at": None,
                },
            ],
        )
        await connection.execute(
            update(approval_templates)
            .where(
                approval_templates.c.template_key == "payment",
                approval_templates.c.status.in_(["draft", "published"]),
                approval_templates.c.version < 6,
            )
            .values(status="archived")
        )
        await _insert_missing(
            connection,
            approval_nodes,
            [
                {
                    "id": demo_uuid(f"approval-node/{current_template_id}/{node_key}"),
                    "template_id": current_template_id,
                    "node_key": node_key,
                    "kind": kind,
                    "title": title,
                    "config": {**config, "detail": detail},
                    "position_x": x,
                    "position_y": y,
                }
                for current_template_id in (template_id, draft_template_id)
                for node_key, kind, title, detail, x, y, config in workflow_nodes
            ],
        )
        await _insert_missing(
            connection,
            approval_edges,
            [
                {
                    "id": demo_uuid(
                        f"approval-edge/{current_template_id}/{source}/{target}/{outcome}"
                    ),
                    "template_id": current_template_id,
                    "source_node_key": source,
                    "target_node_key": target,
                    "outcome": outcome,
                    "label": label,
                    "condition": condition,
                    "sort_order": sort_order,
                }
                for current_template_id in (template_id, draft_template_id)
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
                    "responsible_user_id": person_ids["dilshod"],
                    "title": "Оплата ноутбуков для нового офиса",
                    "payload": {
                        "amount": 84_600_000,
                        "currency": "UZS",
                        "purpose": "Ноутбуки для нового офиса",
                        "number": "148",
                    },
                    "status": "running",
                    "active_node_keys": ["project_financier"],
                    "actor_overrides": {},
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
                    "responsible_user_id": person_ids["aziza"],
                    "title": "Продление лицензий на программное обеспечение",
                    "payload": {
                        "amount": 12_400_000,
                        "currency": "UZS",
                        "purpose": "Продление корпоративных лицензий",
                        "number": "147",
                    },
                    "status": "running",
                    "active_node_keys": ["chief_accountant"],
                    "actor_overrides": {},
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
                    "responsible_user_id": person_ids["baxtiyor"],
                    "title": "Аванс на региональное мероприятие",
                    "payload": {
                        "amount": 6_800_000,
                        "currency": "UZS",
                        "purpose": "Организация регионального мероприятия",
                        "number": "142",
                    },
                    "status": "approved",
                    "active_node_keys": [],
                    "actor_overrides": {},
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
        project_rows = [
            {
                "id": demo_uuid("project/digital-workspace"),
                "code": "YUK-WS",
                "title": "Yuksalish Workspace",
                "description": "Единая корпоративная среда для коммуникаций и процессов.",
                "manager_user_id": person_ids["baxtiyor"],
                "start_date": date(2026, 8, 1),
                "end_date": date(2026, 12, 20),
                "budget": 320_000_000,
                "spent_budget": 96_000_000,
                "currency": "UZS",
                "status": "in_progress",
                "stage": "preparation",
                "created_by_user_id": person_ids["aziza"],
                "created_at": now - timedelta(days=30),
                "updated_at": now,
            },
            {
                "id": demo_uuid("project/regional-forum"),
                "code": "FORUM-26",
                "title": "Региональный форум 2026",
                "description": "Подготовка программы, партнёров и площадки форума.",
                "manager_user_id": person_ids["aziza"],
                "start_date": date(2026, 9, 1),
                "end_date": date(2026, 11, 15),
                "budget": 48_000,
                "spent_budget": 13_500,
                "currency": "USD",
                "status": "in_progress",
                "stage": "approval",
                "created_by_user_id": person_ids["aziza"],
                "created_at": now - timedelta(days=18),
                "updated_at": now - timedelta(days=1),
            },
            {
                "id": demo_uuid("project/office"),
                "code": "OFFICE-26",
                "title": "Новый офис",
                "description": "Оснащение рабочих мест и запуск новой площадки.",
                "manager_user_id": person_ids["baxtiyor"],
                "start_date": date(2026, 6, 1),
                "end_date": date(2026, 8, 30),
                "budget": 510_000_000,
                "spent_budget": 498_000_000,
                "currency": "UZS",
                "status": "completed",
                "stage": "success",
                "created_by_user_id": person_ids["baxtiyor"],
                "created_at": now - timedelta(days=90),
                "updated_at": now - timedelta(days=4),
            },
        ]
        await _insert_missing(connection, workspace_projects, project_rows)
        await _insert_missing(
            connection,
            project_stage_actions,
            [
                {
                    "id": demo_uuid(f"project-action/{row['code']}/created"),
                    "project_id": row["id"],
                    "actor_user_id": row["created_by_user_id"],
                    "from_stage": None,
                    "to_stage": "start",
                    "action": "created",
                    "comment": None,
                    "created_at": row["created_at"],
                }
                for row in project_rows
            ]
            + [
                {
                    "id": demo_uuid(f"project-action/{row['code']}/{row['stage']}"),
                    "project_id": row["id"],
                    "actor_user_id": row["manager_user_id"],
                    "from_stage": "start",
                    "to_stage": row["stage"],
                    "action": "moved",
                    "comment": "Демонстрационный переход",
                    "created_at": row["updated_at"],
                }
                for row in project_rows
                if row["stage"] != "start"
            ],
        )
        trip_id = demo_uuid("trip-request/tashkent-samarkand")
        await _insert_missing(
            connection,
            trip_requests,
            [
                {
                    "id": trip_id,
                    "requester_user_id": person_ids["dilshod"],
                    "purpose": "Рабочая встреча с региональной командой",  # noqa: RUF001
                    "destination": "Самарканд",
                    "start_date": date(2026, 9, 18),
                    "end_date": date(2026, 9, 20),
                    "stage": "manager_approval",
                    "status": "running",
                    "created_at": now - timedelta(days=1),
                    "updated_at": now - timedelta(hours=4),
                    "finished_at": None,
                }
            ],
        )
        await _insert_missing(
            connection,
            trip_request_employees,
            [{"request_id": trip_id, "user_id": person_ids["dilshod"]}],
        )
        await _insert_missing(
            connection,
            trip_request_actions,
            [
                {
                    "id": demo_uuid("trip-action/tashkent-samarkand/created"),
                    "request_id": trip_id,
                    "actor_user_id": person_ids["dilshod"],
                    "from_stage": None,
                    "to_stage": "launch",
                    "action": "created",
                    "comment": None,
                    "created_at": now - timedelta(days=1),
                },
                {
                    "id": demo_uuid("trip-action/tashkent-samarkand/submitted"),
                    "request_id": trip_id,
                    "actor_user_id": person_ids["dilshod"],
                    "from_stage": "launch",
                    "to_stage": "manager_approval",
                    "action": "submit",
                    "comment": None,
                    "created_at": now - timedelta(hours=4),
                },
            ],
        )
