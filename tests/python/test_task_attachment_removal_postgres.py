"""Task files can be removed without exposing other attachments or bypassing task rights."""

import os
from uuid import uuid4

import pytest
from httpx import ASGITransport, AsyncClient
from pydantic import SecretStr

from yuksalish_api.main import create_app
from yuksalish_api.object_storage import ObjectStorageError
from yuksalish_api.settings import Settings


@pytest.mark.anyio
@pytest.mark.postgres
async def test_task_attachment_removal_checks_owner_rights_and_storage() -> None:
    database_url = os.environ.get("YUKSALISH_TEST_DATABASE_URL")
    if not database_url:
        pytest.skip("YUKSALISH_TEST_DATABASE_URL is not configured")
    password = "Yuksalish-Local-2026!"
    app = create_app(Settings(
        environment="test", database_url=database_url,
        auth_signing_key=SecretStr("task-file-signing-key"),
        auth_encryption_key=SecretStr("task-file-encryption-key"),
        demo_password=SecretStr(password), seed_demo_data=True,
    ))
    async with (
        app.router.lifespan_context(app),
        AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client,
    ):
        async def login(username: str) -> dict:
            response = await client.post(
                "/api/v1/auth/login",
                json={"username": username, "password": password, "deviceLabel": "task-file-test"},
            )
            assert response.status_code == 200
            return response.json()

        admin = await login("malika")
        employee = await login("dilshod")
        admin_headers = {"Authorization": f"Bearer {admin['accessToken']}"}
        employee_headers = {"Authorization": f"Bearer {employee['accessToken']}"}
        task = await client.post(
            "/api/v1/tasks", headers=admin_headers,
            json={"title": f"Attachment removal {uuid4()}",
                  "assigneeId": employee["user"]["id"]},
        )
        assert task.status_code == 201
        task_id = task.json()["id"]
        uploaded = await client.put(
            f"/api/v1/attachments/task/{task_id}", headers={
                **admin_headers, "Content-Type": "text/plain",
            }, params={"fileName": "proof.txt"}, content=b"proof",
        )
        assert uploaded.status_code == 201
        attachment_id = uploaded.json()["id"]
        download_url = f"/api/v1/attachments/{attachment_id}"
        delete_url = f"/api/v1/attachments/task/{task_id}/{attachment_id}"
        assert (await client.get(download_url, headers=admin_headers)).content == b"proof"
        assert (await client.delete(
            f"/api/v1/attachments/task/{uuid4()}/{attachment_id}",
            headers=admin_headers,
        )).status_code == 404
        assert (await client.delete(delete_url, headers=employee_headers)).status_code == 403

        storage = app.state.object_storage
        original_delete = storage.delete

        async def unavailable(_key: str) -> None:
            raise ObjectStorageError("File could not be deleted")

        storage.delete = unavailable
        try:
            assert (await client.delete(delete_url, headers=admin_headers)).status_code == 503
        finally:
            storage.delete = original_delete
        assert (await client.get(download_url, headers=admin_headers)).content == b"proof"
        assert (await client.delete(delete_url, headers=admin_headers)).status_code == 204
        assert (await client.get(download_url, headers=admin_headers)).status_code == 404
        assert (await client.delete(delete_url, headers=admin_headers)).status_code == 404
