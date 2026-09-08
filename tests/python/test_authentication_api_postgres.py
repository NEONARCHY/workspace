import os
from uuid import uuid4

import pytest
from httpx import ASGITransport, AsyncClient
from pydantic import SecretStr
from sqlalchemy import delete

from yuksalish_api.auth_service import generate_totp
from yuksalish_api.main import create_app
from yuksalish_api.settings import Settings
from yuksalish_api.tables import users


@pytest.mark.anyio
@pytest.mark.postgres
async def test_authentication_http_vertical_slice() -> None:
    database_url = os.environ.get("YUKSALISH_TEST_DATABASE_URL")
    if not database_url:
        pytest.skip("YUKSALISH_TEST_DATABASE_URL is not configured")
    demo_password = "Yuksalish-Local-2026!"
    settings = Settings(
        environment="test",
        database_url=database_url,
        auth_signing_key=SecretStr("http-integration-signing-key"),
        auth_encryption_key=SecretStr("http-integration-encryption-key"),
        demo_password=SecretStr(demo_password),
        seed_demo_data=True,
    )
    app = create_app(settings)
    transport = ASGITransport(app=app)
    username = f"api.employee.{uuid4().hex[:8]}"

    async with (
        app.router.lifespan_context(app),
        AsyncClient(transport=transport, base_url="http://test") as client,
    ):
        missing = await client.get("/api/v1/auth/me")
        assert missing.status_code == 401

        login = await client.post(
            "/api/v1/auth/login",
            json={
                "username": "malika",
                "password": demo_password,
                "deviceLabel": "HTTP admin",
            },
        )
        assert login.status_code == 200
        admin_session = login.json()
        admin_headers = {"Authorization": f"Bearer {admin_session['accessToken']}"}

        me = await client.get("/api/v1/auth/me", headers=admin_headers)
        assert me.status_code == 200
        assert me.json()["role"] == "admin"

        workspace = await client.get("/api/v1/workspace/bootstrap", headers=admin_headers)
        assert workspace.status_code == 200
        assert workspace.json()["notifications"]
        notification_id = workspace.json()["notifications"][0]["id"]
        marked = await client.patch(
            f"/api/v1/notifications/{notification_id}/read",
            headers=admin_headers,
        )
        assert marked.status_code == 200
        assert marked.json()["readAt"] is not None
        preferences = await client.put(
            "/api/v1/notification-preferences",
            headers=admin_headers,
            json={
                "desktopEnabled": False,
                "messagesEnabled": True,
                "tasksEnabled": True,
                "approvalsEnabled": True,
                "tripsEnabled": True,
                "calendarEnabled": True,
                "remindersEnabled": True,
            },
        )
        assert preferences.status_code == 200
        assert preferences.json()["desktopEnabled"] is False
        read_all = await client.post(
            "/api/v1/notifications/read-all",
            headers=admin_headers,
        )
        assert read_all.status_code == 204
        chat_id = workspace.json()["chats"][0]["id"]
        message = await client.post(
            f"/api/v1/chats/{chat_id}/messages",
            headers=admin_headers,
            json={"body": "HTTP cross-workflow source message"},
        )
        assert message.status_code == 201
        message_id = message.json()["id"]
        uploaded = await client.put(
            f"/api/v1/attachments/message/{message_id}",
            headers={**admin_headers, "Content-Type": "text/plain"},
            params={"fileName": "invoice.txt"},
            content=b"invoice-body",
        )
        assert uploaded.status_code == 201
        assert uploaded.json()["sha256"]
        downloaded = await client.get(
            f"/api/v1/attachments/{uploaded.json()['id']}",
            headers=admin_headers,
        )
        assert downloaded.status_code == 200
        assert downloaded.content == b"invoice-body"

        task = await client.post(
            "/api/v1/tasks",
            headers=admin_headers,
            json={
                "title": "HTTP task from message",
                "assigneeId": admin_session["user"]["id"],
                "sourceMessageId": message_id,
            },
        )
        assert task.status_code == 201
        assert task.json()["sourceMessageId"] == message_id
        assert task.json()["chatId"]
        task_id = task.json()["id"]
        task_chat_id = task.json()["chatId"]
        task_workspace = await client.get("/api/v1/workspace/bootstrap", headers=admin_headers)
        assert task_workspace.status_code == 200
        assert any(
            chat["id"] == task_chat_id and chat["kind"] == "task"
            for chat in task_workspace.json()["chats"]
        )
        participant_id = next(
            person["id"]
            for person in workspace.json()["people"]
            if person["id"] != admin_session["user"]["id"]
        )
        edited_task = await client.patch(
            f"/api/v1/tasks/{task_id}",
            headers=admin_headers,
            json={
                "title": "HTTP task card edited",
                "description": "Full task card from the HTTP contract",
                "project": "Workspace BP-5",
                "assigneeId": admin_session["user"]["id"],
                "priority": "urgent",
                "dueAt": "2026-09-20T09:00:00Z",
            },
        )
        assert edited_task.status_code == 200
        assert edited_task.json()["priority"] == "urgent"
        participant = await client.put(
            f"/api/v1/tasks/{task_id}/participants",
            headers=admin_headers,
            json={"userId": participant_id, "role": "observer"},
        )
        assert participant.status_code == 200
        assert participant.json()["participants"][0]["role"] == "observer"
        checklist = await client.post(
            f"/api/v1/tasks/{task_id}/checklist",
            headers=admin_headers,
            json={"title": "Verify the BP-5 task card"},
        )
        assert checklist.status_code == 201
        checklist_id = checklist.json()["checklist"][0]["id"]
        checked = await client.patch(
            f"/api/v1/tasks/{task_id}/checklist/{checklist_id}",
            headers=admin_headers,
            json={"isCompleted": True},
        )
        assert checked.status_code == 200
        assert checked.json()["checklistDone"] == 1
        commented = await client.post(
            f"/api/v1/tasks/{task_id}/comments",
            headers=admin_headers,
            json={"body": "BP-5 HTTP comment"},
        )
        assert commented.status_code == 201
        assert commented.json()["comments"][-1]["body"] == "BP-5 HTTP comment"
        task_file = await client.put(
            f"/api/v1/attachments/task/{task_id}",
            headers={**admin_headers, "Content-Type": "text/plain"},
            params={"fileName": "task-result.txt"},
            content=b"task-result",
        )
        assert task_file.status_code == 201

        blocker = await client.post(
            "/api/v1/tasks",
            headers=admin_headers,
            json={
                "title": "HTTP blocking task",
                "assigneeId": admin_session["user"]["id"],
            },
        )
        assert blocker.status_code == 201
        blocker_id = blocker.json()["id"]
        dependency = await client.put(
            f"/api/v1/tasks/{task_id}/dependencies",
            headers=admin_headers,
            json={"dependsOnTaskId": blocker_id, "dependencyKind": "blocks"},
        )
        assert dependency.status_code == 200
        blocked_completion = await client.post(
            f"/api/v1/tasks/{task_id}/submit-result",
            headers=admin_headers,
            json={"resultText": "Parent result"},
        )
        assert blocked_completion.status_code == 409
        blocker_submitted = await client.post(
            f"/api/v1/tasks/{blocker_id}/submit-result",
            headers=admin_headers,
            json={"resultText": "Blocking result"},
        )
        assert blocker_submitted.status_code == 200
        blocker_completed = await client.post(
            f"/api/v1/tasks/{blocker_id}/accept-result",
            headers=admin_headers,
        )
        assert blocker_completed.status_code == 200
        subtask = await client.post(
            "/api/v1/tasks",
            headers=admin_headers,
            json={
                "title": "HTTP child task",
                "assigneeId": admin_session["user"]["id"],
                "parentTaskId": task_id,
                "project": "Workspace BP-5",
            },
        )
        assert subtask.status_code == 201
        assert subtask.json()["parentTaskId"] == task_id
        subtask_id = subtask.json()["id"]
        assert (
            await client.post(
                f"/api/v1/tasks/{subtask_id}/submit-result",
                headers=admin_headers,
                json={"resultText": "Child result"},
            )
        ).status_code == 200
        assert (
            await client.post(
                f"/api/v1/tasks/{subtask_id}/accept-result",
                headers=admin_headers,
            )
        ).status_code == 200
        submitted = await client.post(
            f"/api/v1/tasks/{task_id}/submit-result",
            headers=admin_headers,
            json={"resultText": "Parent result"},
        )
        assert submitted.status_code == 200
        returned = await client.post(
            f"/api/v1/tasks/{task_id}/return-for-revision",
            headers=admin_headers,
            json={"reasonCode": "corrections_required", "reasonText": "Clarify totals"},
        )
        assert returned.status_code == 200
        assert returned.json()["latestReturn"]["reasonText"] == "Clarify totals"
        assert (
            await client.post(
                f"/api/v1/tasks/{task_id}/submit-result",
                headers=admin_headers,
                json={"resultText": "Corrected parent result"},
            )
        ).status_code == 200
        accepted = await client.post(
            f"/api/v1/tasks/{task_id}/accept-result",
            headers=admin_headers,
        )
        assert accepted.status_code == 200
        assert accepted.json()["status"] == "completed"
        dependency_removed = await client.delete(
            f"/api/v1/tasks/{task_id}/dependencies/{blocker_id}",
            headers=admin_headers,
        )
        assert dependency_removed.status_code == 200
        participant_removed = await client.delete(
            f"/api/v1/tasks/{task_id}/participants/{participant_id}",
            headers=admin_headers,
        )
        assert participant_removed.status_code == 200
        checklist_removed = await client.delete(
            f"/api/v1/tasks/{task_id}/checklist/{checklist_id}",
            headers=admin_headers,
        )
        assert checklist_removed.status_code == 200
        cycle = await client.put(
            f"/api/v1/tasks/{task_id}/cycle",
            headers=admin_headers,
            json={
                "title": "HTTP calendar cycle",
                "scheduleKind": "calendar",
                "interval": 1,
                "calendarRule": "month_days",
                "monthDays": [1, 15, 28],
                "timezone": "Asia/Tashkent",
                "nextRunAt": "2026-09-21T06:00:00Z",
                "isEnabled": True,
            },
        )
        assert cycle.status_code == 200
        assert cycle.json()["cycle"]["scheduleKind"] == "calendar"
        assert cycle.json()["cycle"]["calendarRule"] == "month_days"
        assert cycle.json()["cycle"]["monthDays"] == [1, 15, 28]
        assert cycle.json()["cycle"]["nextRunAt"] == "2026-09-28T06:00:00Z"
        finance_login = await client.post(
            "/api/v1/auth/login",
            json={
                "username": "aziza",
                "password": demo_password,
                "deviceLabel": "HTTP payment actor",
            },
        )
        assert finance_login.status_code == 200
        finance_headers = {"Authorization": f"Bearer {finance_login.json()['accessToken']}"}
        approval = await client.post(
            "/api/v1/approval-requests",
            headers=finance_headers,
            json={
                "title": "HTTP approval from task",
                "amount": 5_000_000,
                "currency": "UZS",
                "purpose": "Initial purpose",
                "sourceTaskId": task.json()["id"],
                "transferType": "Другие услуги",
                "projectName": "Workspace",
                "projectCode": "HTTP-BP6",
                "sourceAccount": "Operating account",
                "destinationAccount": "Supplier account",
                "requestPriority": "urgent",
                "paymentPurpose": "Оплата за услуги",
                "paymentReason": "Contract HTTP-42",
                "responsibleUserId": participant_id,
                "employeeIds": [participant_id],
            },
        )
        assert approval.status_code == 201
        approval_id = approval.json()["id"]
        assert approval.json()["revision"] == 1
        assert approval.json()["details"]["projectCode"] == "HTTP-BP6"
        assert approval.json()["responsibleUserId"] == participant_id
        approval_file = await client.put(
            f"/api/v1/attachments/approval_request/{approval_id}",
            headers={**finance_headers, "Content-Type": "application/pdf"},
            params={"fileName": "contract.pdf", "documentRole": "additional"},
            content=b"contract-body",
        )
        assert approval_file.status_code == 201
        assert approval_file.json()["documentRole"] == "additional"
        returned = await client.post(
            f"/api/v1/approval-requests/{approval_id}/actions",
            headers=finance_headers,
            json={"action": "return", "comment": "Correct the amount"},
        )
        assert returned.status_code == 200
        assert returned.json()["status"] == "needs_revision"
        assert returned.json()["actions"][-1]["action"] == "return"
        assert returned.json()["actions"][-1]["comment"] == "Correct the amount"
        revised = await client.patch(
            f"/api/v1/approval-requests/{approval_id}",
            headers=finance_headers,
            json={
                "title": "HTTP corrected approval",
                "amount": 4_800_000,
                "currency": "UZS",
                "purpose": "Corrected purpose",
                "changeComment": "Corrected after review",
            },
        )
        assert revised.status_code == 200
        assert revised.json()["revision"] == 3
        assert len(revised.json()["versions"]) == 3
        resubmitted = await client.post(
            f"/api/v1/approval-requests/{approval_id}/actions",
            headers=finance_headers,
            json={"action": "resubmit", "comment": "Ready again"},
        )
        assert resubmitted.status_code == 200
        assert resubmitted.json()["status"] == "running"

        directory = await client.get("/api/v1/directory", headers=admin_headers)
        assert directory.status_code == 200
        assert len(directory.json()["positions"]) >= 20
        position_name = f"API Position {uuid4().hex[:8]}"
        position = await client.post(
            "/api/v1/directory/positions",
            headers=admin_headers,
            json={"name": position_name, "sortOrder": 50_000},
        )
        assert position.status_code == 201
        position_id = position.json()["id"]
        cyrillic_position = await client.post(
            "/api/v1/directory/positions",
            headers=admin_headers,
            json={"name": "Новая должность"},
        )
        assert cyrillic_position.status_code == 422

        invitation = await client.post(
            "/api/v1/auth/invitations",
            headers=admin_headers,
            json={
                "username": username,
                "fullName": "API Employee",
                "positionId": position_id,
                "role": "employee",
            },
        )
        assert invitation.status_code == 201

        activated = await client.post(
            "/api/v1/auth/invitations/accept",
            json={
                "inviteToken": invitation.json()["inviteToken"],
                "password": "Secure-API-Employee-2026!",
                "deviceLabel": "HTTP employee",
            },
        )
        assert activated.status_code == 200
        employee_session = activated.json()
        assert employee_session["user"]["jobTitle"] == position_name
        employee_headers = {"Authorization": f"Bearer {employee_session['accessToken']}"}

        denied_position = await client.post(
            "/api/v1/directory/positions",
            headers=employee_headers,
            json={"name": "Denied Position"},
        )
        assert denied_position.status_code == 403

        forbidden = await client.post(
            "/api/v1/auth/invitations",
            headers=employee_headers,
            json={
                "username": f"denied.{uuid4().hex[:8]}",
                "fullName": "Denied User",
                "role": "employee",
            },
        )
        assert forbidden.status_code == 403

        directory = await client.get("/api/v1/directory", headers=admin_headers)
        employee = next(
            item for item in directory.json()["employees"] if item["username"] == username
        )
        changed = await client.patch(
            f"/api/v1/directory/employees/{employee['id']}",
            headers=admin_headers,
            json={"role": "manager", "positionId": position_id},
        )
        assert changed.status_code == 200
        assert changed.json()["role"] == "manager"

        parent_department = await client.post(
            "/api/v1/directory/departments",
            headers=admin_headers,
            json={
                "code": f"api-{uuid4().hex[:8]}",
                "name": "API Directorate",
            },
        )
        assert parent_department.status_code == 201
        department = await client.post(
            "/api/v1/directory/departments",
            headers=admin_headers,
            json={
                "code": f"api-{uuid4().hex[:8]}",
                "name": "API Department",
                "parentId": parent_department.json()["id"],
            },
        )
        assert department.status_code == 201
        cycle = await client.patch(
            f"/api/v1/directory/departments/{parent_department.json()['id']}",
            headers=admin_headers,
            json={"parentId": department.json()["id"]},
        )
        assert cycle.status_code == 409
        changed = await client.patch(
            f"/api/v1/directory/employees/{employee['id']}",
            headers=admin_headers,
            json={
                "role": "manager",
                "positionId": position_id,
                "departmentId": department.json()["id"],
            },
        )
        assert changed.status_code == 200
        assert changed.json()["departmentId"] == department.json()["id"]

        denied_rule = await client.put(
            f"/api/v1/directory/access-rules/user/{employee['id']}/tasks",
            headers=admin_headers,
            json={
                "permissions": {
                    "view": False,
                    "create": False,
                    "edit": False,
                    "approve": False,
                    "admin": False,
                }
            },
        )
        assert denied_rule.status_code == 200
        denied_workspace = await client.get(
            "/api/v1/workspace/bootstrap",
            headers=employee_headers,
        )
        assert denied_workspace.status_code == 200
        assert denied_workspace.json()["tasks"] == []
        task_access = next(
            item
            for item in denied_workspace.json()["moduleAccess"]
            if item["moduleKey"] == "tasks"
        )
        assert task_access["permissions"]["view"] is False
        denied_task = await client.post(
            "/api/v1/tasks",
            headers=employee_headers,
            json={"title": "Must be denied"},
        )
        assert denied_task.status_code == 403
        inherited_again = await client.delete(
            f"/api/v1/directory/access-rules/user/{employee['id']}/tasks",
            headers=admin_headers,
        )
        assert inherited_again.status_code == 204
        restored_workspace = await client.get(
            "/api/v1/workspace/bootstrap",
            headers=employee_headers,
        )
        restored_access = next(
            item
            for item in restored_workspace.json()["moduleAccess"]
            if item["moduleKey"] == "tasks"
        )
        assert restored_access["permissions"]["view"] is True

        department_deny = await client.put(
            f"/api/v1/directory/access-rules/department/{department.json()['id']}/tasks",
            headers=admin_headers,
            json={
                "permissions": {
                    "view": False,
                    "create": False,
                    "edit": False,
                    "approve": False,
                    "admin": False,
                }
            },
        )
        assert department_deny.status_code == 200
        department_workspace = await client.get(
            "/api/v1/workspace/bootstrap",
            headers=employee_headers,
        )
        assert next(
            item
            for item in department_workspace.json()["moduleAccess"]
            if item["moduleKey"] == "tasks"
        )["permissions"]["view"] is False
        personal_allow = await client.put(
            f"/api/v1/directory/access-rules/user/{employee['id']}/tasks",
            headers=admin_headers,
            json={
                "permissions": {
                    "view": True,
                    "create": True,
                    "edit": True,
                    "approve": True,
                    "admin": False,
                }
            },
        )
        assert personal_allow.status_code == 200
        personal_workspace = await client.get(
            "/api/v1/workspace/bootstrap",
            headers=employee_headers,
        )
        assert next(
            item
            for item in personal_workspace.json()["moduleAccess"]
            if item["moduleKey"] == "tasks"
        )["permissions"]["view"] is True

        deactivated = await client.patch(
            f"/api/v1/directory/positions/{position_id}",
            headers=admin_headers,
            json={"isActive": False},
        )
        assert deactivated.status_code == 200
        assert deactivated.json()["isActive"] is False

        status = await client.get("/api/v1/auth/totp", headers=employee_headers)
        assert status.json() == {"enabled": False}
        setup = await client.post("/api/v1/auth/totp/setup", headers=employee_headers)
        assert setup.status_code == 200
        code, _ = generate_totp(setup.json()["secret"])
        confirmed = await client.post(
            "/api/v1/auth/totp/confirm",
            headers=employee_headers,
            json={"code": code},
        )
        assert confirmed.json() == {"enabled": True}

        reset = await client.post(
            "/api/v1/auth/password-resets",
            headers=admin_headers,
            json={"username": username, "resetTotp": True},
        )
        assert reset.status_code == 201
        assert reset.json()["resetTotp"] is True
        recovered = await client.post(
            "/api/v1/auth/password-resets/complete",
            json={
                "resetToken": reset.json()["resetToken"],
                "password": "Recovered-API-Employee-2026!",
                "deviceLabel": "Recovered HTTP employee",
            },
        )
        assert recovered.status_code == 200
        revoked_by_reset = await client.get("/api/v1/auth/me", headers=employee_headers)
        assert revoked_by_reset.status_code == 401
        employee_session = recovered.json()
        employee_headers = {"Authorization": f"Bearer {employee_session['accessToken']}"}
        reset_totp_status = await client.get("/api/v1/auth/totp", headers=employee_headers)
        assert reset_totp_status.json() == {"enabled": False}

        sessions = await client.get("/api/v1/auth/sessions", headers=employee_headers)
        assert sessions.status_code == 200
        assert sessions.json()[0]["current"] is True

        refreshed = await client.post(
            "/api/v1/auth/refresh",
            json={"refreshToken": employee_session["refreshToken"]},
        )
        assert refreshed.status_code == 200
        refreshed_headers = {"Authorization": f"Bearer {refreshed.json()['accessToken']}"}
        logout = await client.post("/api/v1/auth/logout", headers=refreshed_headers)
        assert logout.status_code == 204
        revoked = await client.get("/api/v1/auth/me", headers=refreshed_headers)
        assert revoked.status_code == 401

        async with app.state.database_engine.begin() as connection:
            await connection.execute(delete(users).where(users.c.username == username))
