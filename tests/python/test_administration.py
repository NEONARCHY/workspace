import os
from datetime import UTC, datetime
from uuid import UUID, uuid4

import pytest
from pydantic import ValidationError
from sqlalchemy import func, insert, select
from sqlalchemy.ext.asyncio import create_async_engine

from yuksalish_api import administration_service, messenger_service
from yuksalish_api.access_control import request_module_action
from yuksalish_api.administration_schemas import (
    AdministrativeChatInspectionCreateRequest,
    EmployeeStatusUpdateRequest,
)
from yuksalish_api.auth import load_authenticated_user
from yuksalish_api.directory_service import DirectoryServiceError, update_employee_status
from yuksalish_api.errors import WorkspaceRepositoryError
from yuksalish_api.repository import find_active_user_by_username
from yuksalish_api.seed import seed_demo_data
from yuksalish_api.tables import audit_events, chat_members, module_access_rules, users
from yuksalish_api.workspace_schemas import CreateChatRequest, SendMessageRequest


def test_administration_payloads_require_a_meaningful_reason() -> None:
    with pytest.raises(ValidationError):
        EmployeeStatusUpdateRequest(status="blocked", reason="коротко")
    with pytest.raises(ValidationError):
        AdministrativeChatInspectionCreateRequest.model_validate(
            {"chatId": str(UUID(int=1)), "reason": "too short", "durationMinutes": 30}
        )
    payload = EmployeeStatusUpdateRequest(
        status="archived",
        reason="  Завершено   сотрудничество  ",
    )
    assert payload.reason == "Завершено сотрудничество"


def test_administration_routes_require_server_side_admin_permissions() -> None:
    assert request_module_action("/api/v1/directory/employees/id/status", "PATCH") == (
        "employees",
        "admin",
    )
    assert request_module_action("/api/v1/administration/chats", "GET") == (
        "messenger",
        "admin",
    )
    assert request_module_action("/api/v1/administration/chat-inspections", "POST") == (
        "messenger",
        "admin",
    )


@pytest.mark.anyio
@pytest.mark.postgres
async def test_employee_status_and_chat_inspection_are_audited_and_read_only() -> None:
    database_url = os.environ.get("YUKSALISH_TEST_DATABASE_URL")
    if not database_url:
        pytest.skip("YUKSALISH_TEST_DATABASE_URL is not configured")
    engine = create_async_engine(database_url)
    try:
        await seed_demo_data(engine)
        async with engine.connect() as connection:
            transaction = await connection.begin()
            try:
                records = {}
                for username in ("malika", "dilshod", "baxtiyor"):
                    record = await find_active_user_by_username(connection, username)
                    assert record is not None
                    records[username] = record
                admin = await load_authenticated_user(connection, records["malika"]["id"])
                owner = await load_authenticated_user(connection, records["dilshod"]["id"])
                peer = await load_authenticated_user(connection, records["baxtiyor"]["id"])
                assert admin is not None and owner is not None and peer is not None

                chat = await messenger_service.create_chat(
                    connection,
                    owner,
                    CreateChatRequest(
                        kind="group",
                        title="Private administration test",
                        member_ids=[peer.id],
                    ),
                )
                sent = await messenger_service.send_chat_message(
                    connection,
                    owner,
                    UUID(chat.id),
                    SendMessageRequest(body="Read-only inspection evidence"),
                )
                listed = await administration_service.list_administrative_chats(
                    connection, admin, "Private administration"
                )
                assert [item.id for item in listed] == [chat.id]
                assert listed[0].message_count == 1
                assert all(member.user_id != str(admin.id) for member in listed[0].members)

                inspection = await administration_service.create_chat_inspection(
                    connection,
                    admin,
                    AdministrativeChatInspectionCreateRequest(
                        chat_id=UUID(chat.id),
                        reason="Проверка обращения сотрудника",
                        duration_minutes=15,
                    ),
                )
                assert [message.id for message in inspection.messages] == [sent.id]
                assert inspection.messages[0].body == "Read-only inspection evidence"
                membership = await connection.scalar(
                    select(func.count()).select_from(chat_members).where(
                        chat_members.c.chat_id == UUID(chat.id),
                        chat_members.c.user_id == admin.id,
                    )
                )
                assert membership == 0

                await administration_service.revoke_chat_inspection(
                    connection, admin, UUID(inspection.id)
                )
                with pytest.raises(WorkspaceRepositoryError) as expired:
                    await administration_service.get_chat_inspection(
                        connection, admin, UUID(inspection.id)
                    )
                assert expired.value.status_code == 410

                await connection.execute(
                    insert(module_access_rules).values(
                        id=uuid4(),
                        subject_type="user",
                        subject_key=str(peer.id),
                        module_key="employees",
                        permissions={
                            "view": True,
                            "create": False,
                            "edit": False,
                            "approve": False,
                            "admin": True,
                        },
                        created_by_user_id=admin.id,
                        created_at=datetime.now(UTC),
                        updated_at=datetime.now(UTC),
                    )
                )
                fired = await update_employee_status(
                    connection,
                    peer,
                    owner.id,
                    EmployeeStatusUpdateRequest(
                        status="archived",
                        reason="Завершение трудовых отношений",
                    ),
                )
                assert fired.status == "archived"
                restored = await update_employee_status(
                    connection,
                    peer,
                    owner.id,
                    EmployeeStatusUpdateRequest(
                        status="active",
                        reason="Отмена ошибочного увольнения",
                    ),
                )
                assert restored.status == "active"

                updated = await update_employee_status(
                    connection,
                    admin,
                    owner.id,
                    EmployeeStatusUpdateRequest(
                        status="blocked",
                        reason="Временная блокировка по обращению",
                    ),
                )
                assert updated.status == "blocked"
                assert await connection.scalar(
                    select(users.c.status).where(users.c.id == owner.id)
                ) == "blocked"
                with pytest.raises(DirectoryServiceError):
                    await update_employee_status(
                        connection,
                        admin,
                        admin.id,
                        EmployeeStatusUpdateRequest(
                            status="archived",
                            reason="Недопустимая операция над собой",
                        ),
                    )
                actions = set(
                    (
                        await connection.execute(
                            select(audit_events.c.action).where(
                                audit_events.c.actor_user_id == admin.id
                            )
                        )
                    ).scalars()
                )
                assert {
                    "chat.admin_inspection_started",
                    "chat.admin_inspection_opened",
                    "chat.admin_inspection_revoked",
                    "employee.status_updated",
                } <= actions
            finally:
                await transaction.rollback()
    finally:
        await engine.dispose()
