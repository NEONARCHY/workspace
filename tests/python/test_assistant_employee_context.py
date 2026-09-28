# ruff: noqa: RUF001 - Russian employee queries are intentional.
"""Employee context must inherit existing visibility settings and exclude money."""

import asyncio
import base64
from datetime import date
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
    parse_assistant_attachment,
)
from yuksalish_api.auth import AuthenticatedUser
from yuksalish_api.routers.assistant import AskRequest


def test_employee_name_matching_uses_name_tokens_and_case_endings() -> None:
    temur, asqar = uuid4(), uuid4()
    people = [(temur, "Темур Алмазов"), (asqar, "Аскар Маматханов")]
    assert _mentioned_employees("Какой стаж у Темура?", people) == [temur]
    assert _mentioned_employees("Что у Аскара?", people) == [asqar]
    assert _mentioned_employees("Расскажи про сотрудника", people) == []


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
    parts = model_call.await_args.args[3][-1]["parts"]
    assert parts[1]["inline_data"]["mime_type"] == "application/pdf"
    assert base64.b64decode(parts[1]["inline_data"]["data"]) == pdf.content
    assert connection.execute.await_count == 2
