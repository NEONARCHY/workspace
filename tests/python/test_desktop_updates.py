import base64
import json
import os
from io import BytesIO
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import HTTPException, Request
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import create_async_engine
from starlette.datastructures import UploadFile

import yuksalish_api.routers.updates as updates_router
from yuksalish_api.auth import load_authenticated_user
from yuksalish_api.errors import WorkspaceRepositoryError
from yuksalish_api.repository import find_active_user_by_username
from yuksalish_api.seed import seed_demo_data
from yuksalish_api.settings import Settings
from yuksalish_api.tables import audit_events, users
from yuksalish_api.update_service import (
    latest_manifest,
    policy_snapshot,
    publish_release,
    release_file_name,
    require_superadmin,
    set_mandatory,
    stage_release,
    staged_releases,
)


def test_release_name_rejects_unsafe_versions() -> None:
    assert release_file_name("1.2.3") == "Yuksalish-Workspace-Setup-1.2.3.exe"
    for version in ("../1.2.3", "1.2", "1.2.3-beta", "1.2.3/other"):
        with pytest.raises(WorkspaceRepositoryError):
            release_file_name(version)


def _upload_request(data: bytes) -> Request:
    sent = False

    async def receive() -> dict[str, object]:
        nonlocal sent
        if sent:
            return {"type": "http.request", "body": b"", "more_body": False}
        sent = True
        return {"type": "http.request", "body": data, "more_body": False}

    return Request(
        {"type": "http", "headers": [(b"content-type", b"application/octet-stream")]},
        receive,
    )


def _multipart_request(notes: list[str], payload: bytes) -> Request:
    boundary = "release-upload-boundary"
    metadata = json.dumps({"title": "Проверенное обновление", "notes": notes}, ensure_ascii=False)
    body = (
        f"--{boundary}\r\n"
        'Content-Disposition: form-data; name="metadata"\r\n\r\n'
        f"{metadata}\r\n"
        f"--{boundary}\r\n"
        'Content-Disposition: form-data; name="file"; '
        'filename="Yuksalish-Workspace-Setup-1.0.18.exe"\r\n'
        "Content-Type: application/octet-stream\r\n\r\n"
    ).encode() + payload + f"\r\n--{boundary}--\r\n".encode()
    sent = False

    async def receive() -> dict[str, object]:
        nonlocal sent
        if sent:
            return {"type": "http.request", "body": b"", "more_body": False}
        sent = True
        return {"type": "http.request", "body": body, "more_body": False}

    return Request({
        "type": "http", "method": "POST",
        "headers": [(b"content-type", f"multipart/form-data; boundary={boundary}".encode())],
        "app": SimpleNamespace(state=SimpleNamespace(settings=object())),
    }, receive)


@pytest.mark.anyio
async def test_multipart_upload_accepts_long_notes_and_checks_role_first(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    notes = [f"Изменение {index}: " + "Подробное описание " * 7 for index in range(50)]
    payload = b"MZinstaller"
    captured: dict[str, object] = {}
    result = object()

    async def fake_stage_release(*args: object, upload: UploadFile | None = None) -> object:
        assert upload is not None
        captured["title"] = args[5]
        captured["notes"] = args[6]
        captured["file"] = await upload.read()
        return result

    monkeypatch.setattr(updates_router, "stage_release", fake_stage_release)
    with pytest.raises(HTTPException) as forbidden:
        await updates_router.upload_release_multipart(
            _multipart_request(notes, payload), SimpleNamespace(role="admin"), object(),
            "1.0.18",
        )
    assert forbidden.value.status_code == 403

    actual = await updates_router.upload_release_multipart(
        _multipart_request(notes, payload), SimpleNamespace(role="superadmin"), object(),
        "1.0.18",
    )
    assert actual is result
    assert captured == {"title": "Проверенное обновление", "notes": notes, "file": payload}


@pytest.mark.anyio
@pytest.mark.postgres
async def test_only_superadmin_can_publish_and_force_a_available_release(
    tmp_path: Path,
) -> None:
    database_url = os.environ.get("YUKSALISH_TEST_DATABASE_URL")
    if not database_url:
        pytest.skip("YUKSALISH_TEST_DATABASE_URL is not configured")
    engine = create_async_engine(database_url)
    settings = Settings(environment="test", database_url=database_url, update_directory=tmp_path)
    try:
        await seed_demo_data(engine)
        async with engine.connect() as connection:
            transaction = await connection.begin()
            try:
                owner_record = await find_active_user_by_username(connection, "malika")
                admin_record = await find_active_user_by_username(connection, "baxtiyor")
                assert owner_record is not None and admin_record is not None
                await connection.execute(
                    update(users).where(users.c.id == owner_record["id"]).values(role="superadmin")
                )
                await connection.execute(
                    update(users).where(users.c.id == admin_record["id"]).values(role="admin")
                )
                owner = await load_authenticated_user(connection, owner_record["id"])
                admin = await load_authenticated_user(connection, admin_record["id"])
                assert owner is not None and admin is not None

                assert await staged_releases(connection, admin) == []
                with pytest.raises(WorkspaceRepositoryError):
                    require_superadmin(admin)
                with pytest.raises(WorkspaceRepositoryError):
                    await set_mandatory(connection, owner, settings, True)

                payload = b"MZ" + b"test installer bytes"
                with pytest.raises(WorkspaceRepositoryError) as forbidden_upload:
                    await stage_release(
                        connection, admin, _upload_request(payload), settings, "0.30.0",
                        "Понятное обновление", ["Улучшили удобство ежедневной работы."],
                    )
                assert forbidden_upload.value.status_code == 403
                staged = await stage_release(
                    connection, owner, _upload_request(payload), settings, "0.30.0",
                    "Понятное обновление", ["Улучшили удобство ежедневной работы."],
                )
                assert staged.title == "Понятное обновление"
                assert staged.size_bytes == len(payload)
                assert staged.published_at is None
                with pytest.raises(WorkspaceRepositoryError) as forbidden_publish:
                    await publish_release(connection, admin, settings, "0.30.0")
                assert forbidden_publish.value.status_code == 403
                published = await publish_release(connection, owner, settings, "0.30.0")
                assert published.published_version == "0.30.0"
                manifest = json.loads(latest_manifest(published))
                assert manifest["files"][0]["sha512"] == base64.b64encode(
                    bytes.fromhex(staged.sha512)
                ).decode()
                release_path = tmp_path / release_file_name("0.30.0")
                release_path.write_bytes(b"MZcorrupt installer bytes")
                with pytest.raises(WorkspaceRepositoryError) as damaged:
                    await set_mandatory(connection, owner, settings, True)
                assert damaged.value.status_code == 409
                release_path.write_bytes(payload)
                required = await set_mandatory(connection, admin, settings, True)
                assert required.mandatory and required.minimum_version == "0.30.0"
                assert (await policy_snapshot(connection)).mandatory
                disabled = await set_mandatory(connection, owner, settings, False)
                assert not disabled.mandatory and disabled.minimum_version is None
                upload = UploadFile(
                    file=BytesIO(payload), filename="Yuksalish-Workspace-Setup-0.30.1.exe",
                )
                multipart_staged = await stage_release(
                    connection, owner, _upload_request(payload), settings, "0.30.1",
                    "Следующее обновление", ["Подготовили следующее обновление приложения."],
                    upload=upload,
                )
                assert multipart_staged.size_bytes == len(payload)
                assert (tmp_path / release_file_name("0.30.1")).read_bytes() == payload
                audit_rows = (
                    await connection.execute(
                        select(audit_events.c.action, audit_events.c.target_id).where(
                            audit_events.c.action.in_((
                                "desktop_update.staged",
                                "desktop_update.published",
                                "desktop_update.mandatory_changed",
                            ))
                        )
                    )
                ).all()
                actions = {row.action for row in audit_rows}
                assert {
                    "desktop_update.staged",
                    "desktop_update.published",
                    "desktop_update.mandatory_changed",
                } <= actions
                assert all(row.target_id is not None for row in audit_rows)
                release_targets = {
                    row.target_id for row in audit_rows
                    if row.action in {"desktop_update.staged", "desktop_update.published"}
                }
                assert len(release_targets) == 2
                assert release_targets.isdisjoint({
                    row.target_id for row in audit_rows
                    if row.action == "desktop_update.mandatory_changed"
                })
            finally:
                await transaction.rollback()
    finally:
        await engine.dispose()
