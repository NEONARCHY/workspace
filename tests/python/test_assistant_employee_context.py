# ruff: noqa: RUF001 - Russian employee queries are intentional.
"""Employee context must inherit existing visibility settings and exclude money."""

import asyncio
import base64
from datetime import UTC, date, datetime
from io import BytesIO
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock
from uuid import uuid4
from zipfile import ZipFile

import pytest

from yuksalish_api.assistant_service import (
    NotificationSnapshot,
    _mentioned_employees,
    _parse_action_fields,
    action_draft_answer,
    ask_assistant,
    employee_context,
    infer_action_kind,
    letter_attention_updates,
    message_history,
    parse_assistant_attachment,
    prepare_action_draft,
    recent_notification_updates,
    recent_task_updates,
)
from yuksalish_api.auth import AuthenticatedUser
from yuksalish_api.project_hub_service import visible_employee_project_summaries
from yuksalish_api.routers.assistant import AskRequest


def test_employee_name_matching_uses_name_tokens_and_case_endings() -> None:
    temur, asqar = uuid4(), uuid4()
    people = [(temur, "Темур Алмазов"), (asqar, "Аскар Маматханов")]
    assert _mentioned_employees("Какой стаж у Темура?", people) == [temur]
    assert _mentioned_employees("Что у Аскара?", people) == [asqar]
    assert _mentioned_employees("Расскажи про сотрудника", people) == []
    assert _mentioned_employees("Who is Temur Almazov?", people) == [temur]
    assert _mentioned_employees("Temur Almazov va Asqar Mamatxanov", people) == [temur, asqar]
    assert _mentioned_employees("Кто такой Темур ака?", people) == [temur]
    assert _mentioned_employees("Asqar Mamatkhanov", [(asqar, "Аскар Маматханов")]) == [asqar]


def test_action_intent_requires_explicit_request_and_json_is_allowlisted() -> None:
    assert infer_action_kind("Создай задачу для команды") == "task"
    assert infer_action_kind("Хочу отпроситься завтра") == "absence"
    assert infer_action_kind("Напиши Темур ака о встрече") == "message"
    assert infer_action_kind("Поставь задачу подготовить отчёт") == "task"
    assert infer_action_kind("Мне нужен отгул завтра") == "absence"
    assert infer_action_kind("Как создать задачу?") is None
    assert _parse_action_fields(
        '{"title":" Отчёт ","body":"Не применять", "secret":"ignored"}', "task"
    ) == {"title": "Отчёт"}
    assert _parse_action_fields(
        '{"purpose":"Встреча","startDate":"2030-02-30",'
        '"endDate":"2030-03-01"}', "trip"
    )["startDate"] == ""
    assert "Какой текст" in action_draft_answer({
        "kind": "message", "fields": {"recipient": "Темур"}, "ready": False,
    })


def test_action_draft_merges_followup_without_creating_record(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    generate = AsyncMock(side_effect=[
        '{"recipient":"Темур Алмазов"}',
        '{"body":"Добрый день, проверьте письмо."}',
    ])
    monkeypatch.setattr("yuksalish_api.assistant_service.generate_text", generate)
    first = asyncio.run(prepare_action_draft(
        "key", "message", "Напиши Темур Алмазов", None
    ))
    assert first == {
        "kind": "message", "fields": {"recipient": "Темур Алмазов"}, "ready": False,
    }
    second = asyncio.run(prepare_action_draft(
        "key", "message", "Попроси проверить письмо", first
    ))
    assert second["fields"]["recipient"] == "Темур Алмазов"
    assert second["fields"]["body"] == "Добрый день, проверьте письмо."
    assert second["ready"] is True
    assert "финальный шаг" in action_draft_answer(second)
    assert all(call.args[1] == "flash-lite" for call in generate.await_args_list)


def test_absence_kind_follows_explicit_leave_request(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        "yuksalish_api.assistant_service.generate_text",
        AsyncMock(return_value='{"reason":"Отпуск", "startDate":"2030-07-01", '
                               '"endDate":"2030-07-05"}'),
    )
    draft = asyncio.run(prepare_action_draft(
        "key", "absence", "Оформи отпуск с 1 по 5 июля", None
    ))
    assert draft["fields"]["absenceKind"] == "vacation"
    assert draft["ready"] is True


def test_action_draft_does_not_mark_reversed_dates_ready(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        "yuksalish_api.assistant_service.generate_text",
        AsyncMock(return_value='{"purpose":"Встреча", "destination":"Навои", '
                               '"startDate":"2030-07-05", "endDate":"2030-07-01"}'),
    )
    draft = asyncio.run(prepare_action_draft(
        "key", "trip", "Оформи командировку в Навои", None
    ))
    assert draft["ready"] is False
    assert "раньше даты начала" in action_draft_answer(draft)


def test_action_request_only_persists_chat_draft_and_respects_module_rights(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = AuthenticatedUser(uuid4(), "reader", "Reader", None, None, "employee")
    connection = SimpleNamespace(scalar=AsyncMock(return_value=0), execute=AsyncMock())
    monkeypatch.setattr(
        "yuksalish_api.assistant_service.message_history", AsyncMock(return_value=[])
    )
    permissions = AsyncMock(return_value={"tasks": {"create": True}})
    monkeypatch.setattr(
        "yuksalish_api.assistant_service.module_permissions_for_user", permissions
    )
    generate = AsyncMock(return_value='{"title":"Подготовить отчёт"}')
    monkeypatch.setattr("yuksalish_api.assistant_service.generate_text", generate)
    result = asyncio.run(ask_assistant(
        connection, user, "key", "flash-lite", "Создай задачу: подготовить отчёт"
    ))
    assert result["actionDraft"]["fields"]["title"] == "Подготовить отчёт"
    assert result["actionDraft"]["ready"] is True
    assert connection.execute.await_count == 2
    saved = connection.execute.await_args_list[-1].args[0].compile().params
    assert saved["action_draft"] == result["actionDraft"]
    permissions.return_value = {"tasks": {"create": False}}
    denied = asyncio.run(ask_assistant(
        connection, user, "key", "flash-lite", "Создай задачу: чужая"
    ))
    assert "нет права" in denied["content"]
    assert "actionDraft" not in denied
    generate.assert_awaited_once()


def test_explicit_new_action_replaces_unfinished_draft(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = AuthenticatedUser(uuid4(), "reader", "Reader", None, None, "employee")
    connection = SimpleNamespace(scalar=AsyncMock(return_value=0), execute=AsyncMock())
    monkeypatch.setattr(
        "yuksalish_api.assistant_service.message_history",
        AsyncMock(return_value=[{
            "id": "old", "role": "assistant", "model": "flash-lite", "content": "Черновик",
            "createdAt": "2026-09-28T09:00:00Z",
            "actionDraft": {"kind": "task", "fields": {"title": "Старая задача"}, "ready": True},
        }]),
    )
    monkeypatch.setattr(
        "yuksalish_api.assistant_service.module_permissions_for_user",
        AsyncMock(return_value={"projects": {"view": False}, "project_hub": {"create": True}}),
    )
    generate = AsyncMock(return_value='{"title":"Новый проект","code":"NEW"}')
    monkeypatch.setattr("yuksalish_api.assistant_service.generate_text", generate)
    result = asyncio.run(ask_assistant(
        connection, user, "key", "flash-lite", "Создай проект Новый проект", continue_draft=True
    ))
    assert result["actionDraft"]["kind"] == "project"
    assert result["actionDraft"]["fields"] == {"title": "Новый проект", "code": "NEW"}


def test_employee_name_resolution_requires_clarification_for_shared_first_name() -> None:
    first, second = uuid4(), uuid4()
    people = [(first, "Темур Алмазов"), (second, "Темур Каримов")]
    assert _mentioned_employees("Кто Темур?", people) == [first, second]
    assert _mentioned_employees("Кто Темур Алмазов?", people) == [first]
    assert _mentioned_employees("Кто Temura Karimova?", people) == [second]


def test_employee_context_suggests_full_names_for_ambiguous_bobur(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = AuthenticatedUser(uuid4(), "reader", "Reader", None, None, "employee")
    directory = Mock(all=lambda: [
        SimpleNamespace(id=uuid4(), full_name="Бобур Бекмуродов", job_title="Руководитель"),
        SimpleNamespace(id=uuid4(), full_name="Бобур Каримов", job_title="Специалист"),
    ])
    connection = SimpleNamespace(execute=AsyncMock(return_value=directory))
    load_profile = AsyncMock()
    monkeypatch.setattr(
        "yuksalish_api.assistant_service.module_permissions_for_user",
        AsyncMock(return_value={"employees": {"view": True}}),
    )
    monkeypatch.setattr("yuksalish_api.assistant_service.load_profile", load_profile)
    result = asyncio.run(employee_context(connection, user, "Кто такой Бобур?"))
    assert "Бобур Бекмуродов — Руководитель" in result
    assert "Бобур Каримов — Специалист" in result
    assert "Уточните, пожалуйста, полное имя" in result
    load_profile.assert_not_awaited()


def test_ambiguous_employee_question_returns_database_candidates_without_model(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = AuthenticatedUser(uuid4(), "reader", "Reader", None, None, "employee")
    directory = Mock(all=lambda: [
        SimpleNamespace(id=uuid4(), full_name="Бобур Бекмуродов", job_title="Руководитель"),
        SimpleNamespace(id=uuid4(), full_name="Бобур Каримов", job_title="Специалист"),
    ])
    connection = SimpleNamespace(
        scalar=AsyncMock(return_value=0),
        execute=AsyncMock(side_effect=[directory, None, None]),
    )
    monkeypatch.setattr(
        "yuksalish_api.assistant_service.module_permissions_for_user",
        AsyncMock(return_value={"employees": {"view": True}}),
    )
    monkeypatch.setattr(
        "yuksalish_api.assistant_service.message_history", AsyncMock(return_value=[])
    )
    generate = AsyncMock()
    monkeypatch.setattr("yuksalish_api.assistant_service.generate_text", generate)
    result = asyncio.run(ask_assistant(
        connection, user, "test-key", "flash-lite", "Кто такой Бобур?"
    ))
    assert "Бобур Бекмуродов — Руководитель" in result["content"]
    assert "Бобур Каримов — Специалист" in result["content"]
    assert "Уточните" in result["content"]
    assert result["sourceLabels"] == ["Проверены доступные сведения о сотрудниках"]
    generate.assert_not_awaited()
    assert connection.execute.await_count == 3
    saved_answer = connection.execute.await_args_list[-1].args[0].compile().params
    assert saved_answer["source_labels"] == result["sourceLabels"]


def test_message_history_distinguishes_old_and_new_source_metadata() -> None:
    old_id, new_id = uuid4(), uuid4()
    now = datetime(2026, 9, 28, tzinfo=UTC)
    result_rows = Mock(mappings=lambda: Mock(all=lambda: [
        {"id": new_id, "role": "assistant", "model": "flash-lite", "content": "Новый",
         "created_at": now, "source_labels": ["Профили сотрудников"],
         "references": [{"label": "Письмо", "section": "ai_referent", "entityId": str(uuid4())}],
         "action_draft": None},
        {"id": old_id, "role": "assistant", "model": "flash-lite", "content": "Старый",
         "created_at": now, "source_labels": None, "references": None,
         "action_draft": None},
    ]))
    connection = SimpleNamespace(execute=AsyncMock(return_value=result_rows))
    history = asyncio.run(message_history(connection, uuid4()))
    assert "sourceLabels" not in history[0]
    assert history[1]["sourceLabels"] == ["Профили сотрудников"]
    assert history[1]["references"][0]["label"] == "Письмо"


def test_recent_updates_include_only_scoped_navigation_targets(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = AuthenticatedUser(uuid4(), "reader", "Reader", None, None, "employee")
    task_id, notice_id = uuid4(), uuid4()
    now = datetime(2026, 9, 28, tzinfo=UTC)
    connection = SimpleNamespace(execute=AsyncMock(return_value=Mock(all=lambda: [
        SimpleNamespace(id=task_id, title="Подготовить отчёт", status="in_progress", updated_at=now)
    ])))
    monkeypatch.setattr(
        "yuksalish_api.assistant_service.module_permissions_for_user",
        AsyncMock(return_value={"tasks": {"view": True}}),
    )
    lines, links = asyncio.run(recent_task_updates(connection, user))
    assert "Подготовить отчёт" in lines[0]
    assert links == [{"label": "Задача: Подготовить отчёт", "section": "tasks",
                      "entityId": str(task_id)}]
    notice = NotificationSnapshot(
        id=notice_id, title="Новая задача", body="Проверьте результат",
        requires_action=True, section="tasks", entity_id=task_id, occurred_at=now,
    )
    monkeypatch.setattr(
        "yuksalish_api.assistant_service._visible_notification_rows",
        AsyncMock(return_value=[notice]),
    )
    notice_lines, notice_links = asyncio.run(recent_notification_updates(connection, user))
    assert "Новая задача" in notice_lines[0]
    assert notice_links[0]["section"] == "tasks"
    assert notice_links[0]["entityId"] == str(task_id)


def test_letter_attention_reuses_access_filtered_registry_and_actions(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = AuthenticatedUser(uuid4(), "reader", "Reader", None, None, "employee")
    connection = SimpleNamespace()
    letter_id = str(uuid4())
    load = AsyncMock(return_value=SimpleNamespace(letters=[
        SimpleNamespace(id=letter_id, subject="Письмо в министерство",
                        recipient_organization="", status="pending_review",
                        can_edit=False, available_actions=["approve"]),
        SimpleNamespace(id=str(uuid4()), subject="Не требует решения",
                        recipient_organization="", status="pending_review",
                        can_edit=False, available_actions=["remind"]),
    ]))
    monkeypatch.setattr(
        "yuksalish_api.assistant_service.module_permissions_for_user",
        AsyncMock(return_value={"ai_referent": {"view": True}}),
    )
    monkeypatch.setattr("yuksalish_api.assistant_service.load_letters", load)
    text, links = asyncio.run(letter_attention_updates(connection, user))
    assert "Письмо в министерство" in text
    assert "Не требует решения" not in text
    assert links == [{"label": "Письмо в министерство", "section": "ai_referent",
                      "entityId": letter_id}]
    load.assert_awaited_once_with(connection, user, active_only=True, limit=100)


def test_employee_context_denies_directory_without_permission(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = AuthenticatedUser(uuid4(), "reader", "Reader", None, None, "employee")
    connection = SimpleNamespace(execute=AsyncMock())
    monkeypatch.setattr(
        "yuksalish_api.assistant_service.module_permissions_for_user",
        AsyncMock(return_value={"employees": {"view": False}}),
    )
    assert "недоступен" in asyncio.run(employee_context(connection, user, "Кто Темур?"))
    connection.execute.assert_not_called()


def test_employee_context_reuses_profile_visibility_and_aggregate_only(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = AuthenticatedUser(uuid4(), "reader", "Reader", None, None, "employee")
    employee_id = uuid4()
    directory = Mock(all=lambda: [SimpleNamespace(id=employee_id, full_name="Темур Алмазов")])
    snapshot = Mock(first=lambda: SimpleNamespace(
        snapshot_date=date(2026, 9, 27), period="2026-09", percentage=90,
        on_time_count=9, eligible_count=10,
    ))
    connection = SimpleNamespace(execute=AsyncMock(side_effect=[directory, snapshot]))
    monkeypatch.setattr(
        "yuksalish_api.assistant_service.module_permissions_for_user",
        AsyncMock(return_value={
            "employees": {"view": True}, "team_overview": {"view": True},
        }),
    )
    monkeypatch.setattr(
        "yuksalish_api.assistant_service.load_profile",
        AsyncMock(return_value=SimpleNamespace(
            person=SimpleNamespace(name="Темур Алмазов", job_title="Специалист", role="employee"),
            department_name="Центральный аппарат", service_years=2, service_months=4,
            active_task_count=None, achievements=[
                SimpleNamespace(title="Наставник", category="support", unlocked=True),
                SimpleNamespace(title="Не получено", category="tasks", unlocked=False),
                SimpleNamespace(title="Финансы", category="payment_creation", unlocked=True),
            ],
            rewards=[SimpleNamespace(title="Благодарность")],
        )),
    )
    result = asyncio.run(employee_context(connection, user, "Какая эффективность у Темура?"))
    assert "90% (9/10)" in result
    assert "2026-09" in result
    assert "2 лет, 4 месяцев" in result
    assert "роль: сотрудник" in result
    assert "Наставник" in result and "Благодарность" in result
    assert "Не получено" not in result
    assert "Финансы" not in result
    assert "Активных задач" not in result
    assert "бюджет" not in result.casefold()
    assert "зарплат" not in result.casefold()


def test_employee_context_does_not_query_efficiency_without_permission(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = AuthenticatedUser(uuid4(), "reader", "Reader", None, None, "employee")
    employee_id = uuid4()
    connection = SimpleNamespace(execute=AsyncMock(return_value=Mock(all=lambda: [
        SimpleNamespace(id=employee_id, full_name="Темур Алмазов")
    ])))
    monkeypatch.setattr(
        "yuksalish_api.assistant_service.module_permissions_for_user",
        AsyncMock(return_value={
            "employees": {"view": True}, "team_overview": {"view": False},
        }),
    )
    monkeypatch.setattr(
        "yuksalish_api.assistant_service.load_profile",
        AsyncMock(return_value=SimpleNamespace(
            person=SimpleNamespace(name="Темур Алмазов", job_title=None, role="employee"),
            department_name=None, service_years=None, service_months=None,
            active_task_count=3, achievements=[], rewards=[],
        )),
    )
    result = asyncio.run(employee_context(connection, user, "Кто Темур?"))
    assert "Активных задач: 3" in result
    assert "Выполнение задач в срок" not in result
    assert connection.execute.await_count == 1


def test_employee_projects_only_include_visible_manager_projects(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = AuthenticatedUser(uuid4(), "reader", "Reader", None, None, "employee")
    employee_id = uuid4()
    directory = Mock(all=lambda: [SimpleNamespace(id=employee_id, full_name="Темур Алмазов")])
    projects = Mock(all=lambda: [SimpleNamespace(title="Развитие регионов", status="in_progress")])
    connection = SimpleNamespace(execute=AsyncMock(side_effect=[directory, projects]))
    monkeypatch.setattr(
        "yuksalish_api.assistant_service.module_permissions_for_user",
        AsyncMock(return_value={
            "employees": {"view": True}, "projects": {"view": True},
        }),
    )
    monkeypatch.setattr(
        "yuksalish_api.assistant_service.load_profile",
        AsyncMock(return_value=SimpleNamespace(
            person=SimpleNamespace(name="Темур Алмазов", job_title="Специалист", role="employee"),
            department_name=None, service_years=None, service_months=None,
            active_task_count=None, achievements=[], rewards=[],
        )),
    )
    result = asyncio.run(employee_context(connection, user, "Кто Темур?"))
    assert "Развитие регионов (in_progress)" in result
    assert "назначен руководителем" in result


def test_project_hub_employee_summary_filters_each_project_by_viewer_access(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    viewer = AuthenticatedUser(uuid4(), "reader", "Reader", None, None, "employee")
    employee_id = uuid4()
    visible_id, hidden_id = uuid4(), uuid4()
    members = Mock(all=lambda: [(visible_id, "responsible"), (hidden_id, "approver")])
    assignments = Mock(scalars=lambda: [visible_id])
    rows = [
        {"id": visible_id, "code": "P-1", "title": "Открытый проект",
         "manager_user_id": uuid4(), "created_by_user_id": uuid4(), "access_status": "open"},
        {"id": hidden_id, "code": "P-2", "title": "Закрытый проект",
         "manager_user_id": uuid4(), "created_by_user_id": uuid4(), "access_status": "closed"},
    ]
    projects = Mock(mappings=lambda: Mock(all=lambda: rows))
    connection = SimpleNamespace(execute=AsyncMock(side_effect=[members, assignments, projects]))
    can_view = AsyncMock(side_effect=[True, False])
    monkeypatch.setattr("yuksalish_api.project_hub_service._can_view_project", can_view)
    result = asyncio.run(visible_employee_project_summaries(connection, viewer, employee_id))
    assert result == [("P-1", "Открытый проект", ("исполнитель задач", "ответственный"))]
    assert can_view.await_count == 2


def test_employee_context_includes_only_project_hub_summaries_with_permission(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = AuthenticatedUser(uuid4(), "reader", "Reader", None, None, "employee")
    employee_id = uuid4()
    directory = Mock(all=lambda: [
        SimpleNamespace(id=employee_id, full_name="Темур Алмазов", job_title="Специалист")
    ])
    connection = SimpleNamespace(execute=AsyncMock(return_value=directory))
    monkeypatch.setattr(
        "yuksalish_api.assistant_service.module_permissions_for_user",
        AsyncMock(return_value={
            "employees": {"view": True}, "project_hub": {"view": True},
        }),
    )
    monkeypatch.setattr(
        "yuksalish_api.assistant_service.load_profile",
        AsyncMock(return_value=SimpleNamespace(
            person=SimpleNamespace(name="Темур Алмазов", job_title="Специалист", role="employee"),
            department_name=None, service_years=None, service_months=None,
            active_task_count=None, achievements=[], rewards=[],
        )),
    )
    summaries = AsyncMock(return_value=[("P-1", "Доступный проект", ("руководитель",))])
    monkeypatch.setattr(
        "yuksalish_api.assistant_service.visible_employee_project_summaries", summaries
    )
    result = asyncio.run(employee_context(connection, user, "Кто такой Темур ака?"))
    assert "P-1: Доступный проект (роль: руководитель)" in result
    summaries.assert_awaited_once_with(connection, user, employee_id)


def test_assistant_file_accepts_only_bounded_supported_content() -> None:
    pdf = base64.b64encode(b"%PDF-1.7\nsmall document").decode("ascii")
    result = parse_assistant_attachment("report.pdf", "application/pdf", pdf)
    assert result.content.startswith(b"%PDF-")
    assert AskRequest(message="Объясни файл", attachment={
        "name": "report.pdf", "mime_type": "application/pdf", "data_base64": pdf,
    }).attachment is not None
    with pytest.raises(ValueError, match="Поддерживаются"):
        parse_assistant_attachment(
            "fake.pdf", "application/pdf", base64.b64encode(b"fake").decode()
        )
    with pytest.raises(ValueError, match="повреждено"):
        parse_assistant_attachment("report.pdf", "application/pdf", "not-base64")
    with pytest.raises(ValueError, match="5 МБ"):
        parse_assistant_attachment(
            "large.pdf", "application/pdf",
            base64.b64encode(b"%PDF-" + b"x" * (5 * 1024 * 1024)).decode(),
        )
    with pytest.raises(ValueError, match="UTF-8"):
        parse_assistant_attachment("note.txt", "text/plain", base64.b64encode(b"\xff").decode())


def test_docx_attachment_extracts_text_without_other_package_files() -> None:
    package = BytesIO()
    with ZipFile(package, "w") as archive:
        archive.writestr(
            "word/document.xml",
            '<w:document xmlns:w="http://schemas.openxmlformats.org/'
            'wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>'
            'Рабочее письмо</w:t></w:r></w:p></w:body></w:document>',
        )
        archive.writestr("word/media/image.png", b"private image")
    attachment = parse_assistant_attachment(
        "letter.docx",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        base64.b64encode(package.getvalue()).decode("ascii"),
    )
    assert attachment.mime_type == "text/plain"
    assert attachment.content == "Рабочее письмо".encode()


def test_assistant_sends_file_only_in_current_model_request(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = AuthenticatedUser(uuid4(), "reader", "Reader", None, None, "employee")
    connection = SimpleNamespace(scalar=AsyncMock(return_value=0), execute=AsyncMock())
    model_call = AsyncMock(return_value="Краткий ответ")
    monkeypatch.setattr(
        "yuksalish_api.assistant_service.message_history", AsyncMock(return_value=[])
    )
    monkeypatch.setattr("yuksalish_api.assistant_service.generate_text", model_call)
    pdf = parse_assistant_attachment(
        "report.pdf", "application/pdf", base64.b64encode(b"%PDF-1.7\ncontent").decode()
    )
    result = asyncio.run(ask_assistant(connection, user, "test-key", "flash-lite", "Read it", pdf))
    assert result["content"] == "Краткий ответ"
    assert result["sourceLabels"] == ["Вложение «report.pdf» — только для текущего запроса"]
    parts = model_call.await_args.args[3][-1]["parts"]
    assert parts[1]["inline_data"]["mime_type"] == "application/pdf"
    assert base64.b64decode(parts[1]["inline_data"]["data"]) == pdf.content
    assert connection.execute.await_count == 2
