import base64
import json
import os
from pathlib import Path

import pytest
from fastapi import Request
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import create_async_engine

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

                with pytest.raises(WorkspaceRepositoryError) as denied:
                    await staged_releases(connection, admin)
                assert denied.value.status_code == 403
                with pytest.raises(WorkspaceRepositoryError):
                    require_superadmin(admin)
                with pytest.raises(WorkspaceRepositoryError):
                    await set_mandatory(connection, owner, settings, True)

                payload = b"MZ" + b"test installer bytes"
                with pytest.raises(WorkspaceRepositoryError) as forbidden_upload:
                    await stage_release(
                        connection, admin, _upload_request(payload), settings, "0.30.0"
                    )
                assert forbidden_upload.value.status_code == 403
                staged = await stage_release(
                    connection, owner, _upload_request(payload), settings, "0.30.0"
                )
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
                with pytest.raises(WorkspaceRepositoryError) as forbidden_gate:
                    await set_mandatory(connection, admin, settings, True)
                assert forbidden_gate.value.status_code == 403
                required = await set_mandatory(connection, owner, settings, True)
                assert required.mandatory and required.minimum_version == "0.30.0"
                assert (await policy_snapshot(connection)).mandatory
                disabled = await set_mandatory(connection, owner, settings, False)
                assert not disabled.mandatory and disabled.minimum_version is None
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
                assert len(release_targets) == 1
                assert release_targets.isdisjoint({
                    row.target_id for row in audit_rows
                    if row.action == "desktop_update.mandatory_changed"
                })
            finally:
                await transaction.rollback()
    finally:
        await engine.dispose()
