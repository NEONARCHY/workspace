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
    _mentioned_employees,
    ask_assistant,
    employee_context,
    message_history,
    parse_assistant_attachment,
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
         "created_at": now, "source_labels": ["Профили сотрудников"]},
        {"id": old_id, "role": "assistant", "model": "flash-lite", "content": "Старый",
         "created_at": now, "source_labels": None},
    ]))
    connection = SimpleNamespace(execute=AsyncMock(return_value=result_rows))
    history = asyncio.run(message_history(connection, uuid4()))
    assert "sourceLabels" not in history[0]
    assert history[1]["sourceLabels"] == ["Профили сотрудников"]


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
            person=SimpleNamespace(name="Темур Алмазов", job_title="Специалист"),
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
            person=SimpleNamespace(name="Темур Алмазов", job_title=None),
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
            person=SimpleNamespace(name="Темур Алмазов", job_title="Специалист"),
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
            person=SimpleNamespace(name="Темур Алмазов", job_title="Специалист"),
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
