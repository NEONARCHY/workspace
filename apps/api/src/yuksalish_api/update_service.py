"""Server-owned desktop release registry; no credentials or binaries are kept in Git."""

import base64
import hashlib
import json
import os
import re
import tempfile
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from uuid import NAMESPACE_URL, UUID, uuid4, uuid5

from fastapi import Request
from sqlalchemy import insert, select, update
from sqlalchemy.ext.asyncio import AsyncConnection

from .auth import AuthenticatedUser
from .errors import WorkspaceRepositoryError
from .settings import Settings
from .tables import audit_events, update_policy, update_releases
from .update_schemas import DesktopReleaseResponse, DesktopUpdatePolicyResponse

_VERSION = re.compile(r"^[0-9]+\.[0-9]+\.[0-9]+$")
_POLICY_AUDIT_ID = uuid5(NAMESPACE_URL, "https://workspace.yuksalish.uz/desktop-update/policy")


def _release_audit_id(version: str) -> UUID:
    return uuid5(NAMESPACE_URL, f"https://workspace.yuksalish.uz/desktop-update/{version}")


def require_superadmin(actor: AuthenticatedUser) -> None:
    if actor.role != "superadmin":
        raise WorkspaceRepositoryError(403, "Только суперадминистратор управляет обновлениями")


def release_file_name(version: str) -> str:
    if not _VERSION.fullmatch(version) or len(version) > 32:
        raise WorkspaceRepositoryError(422, "Номер версии должен иметь вид 1.2.3")
    return f"Yuksalish-Workspace-Setup-{version}.exe"


def release_path(settings: Settings, version: str) -> Path:
    return settings.update_directory / release_file_name(version)


def _verify_release_file(path: Path, expected_sha512: str, expected_size: int) -> bool:
    if not path.is_file() or path.stat().st_size != expected_size:
        return False
    digest = hashlib.sha512()
    with path.open("rb") as release:
        for chunk in iter(lambda: release.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest() == expected_sha512


def _release(row: Any) -> DesktopReleaseResponse:
    return DesktopReleaseResponse(
        version=row["version"],
        file_name=row["file_name"],
        sha512=row["sha512"],
        size_bytes=row["size_bytes"],
        uploaded_at=row["uploaded_at"],
        published_at=row["published_at"],
    )


async def policy_snapshot(connection: AsyncConnection) -> DesktopUpdatePolicyResponse:
    row = (
        await connection.execute(
            select(update_policy, update_releases)
            .select_from(
                update_policy.outerjoin(
                    update_releases,
                    update_releases.c.version == update_policy.c.published_version,
                )
            )
            .where(update_policy.c.id == 1)
        )
    ).mappings().one()
    release = _release(row) if row["version"] is not None else None
    return DesktopUpdatePolicyResponse(
        published_version=row["published_version"],
        minimum_version=row["minimum_version"],
        mandatory=bool(row["mandatory"]),
        updated_at=row["updated_at"],
        release=release,
    )


async def staged_releases(
    connection: AsyncConnection, actor: AuthenticatedUser,
) -> list[DesktopReleaseResponse]:
    require_superadmin(actor)
    rows = (
        await connection.execute(
            select(update_releases).order_by(update_releases.c.uploaded_at.desc())
        )
    ).mappings().all()
    return [_release(row) for row in rows]


async def _audit(
    connection: AsyncConnection,
    actor: AuthenticatedUser,
    action: str,
    target_id: UUID,
    details: dict[str, Any],
) -> None:
    await connection.execute(
        insert(audit_events).values(
            id=uuid4(),
            actor_user_id=actor.id,
            action=action,
            target_type="desktop_update",
            target_id=target_id,
            details=details,
            created_at=datetime.now(UTC),
        )
    )


async def stage_release(
    connection: AsyncConnection,
    actor: AuthenticatedUser,
    request: Request,
    settings: Settings,
    version: str,
) -> DesktopReleaseResponse:
    require_superadmin(actor)
    file_name = release_file_name(version)
    content_type = request.headers.get("content-type", "").split(";", maxsplit=1)[0]
    if content_type != "application/octet-stream":
        raise WorkspaceRepositoryError(415, "Передайте установщик как application/octet-stream")
    existing = await connection.scalar(
        select(update_releases.c.version).where(update_releases.c.version == version)
    )
    if existing is not None:
        raise WorkspaceRepositoryError(409, "Эта версия уже загружена")
    directory = settings.update_directory
    directory.mkdir(parents=True, exist_ok=True)
    target = directory / file_name
    if target.exists():
        raise WorkspaceRepositoryError(409, "Файл версии уже существует на сервере")
    digest = hashlib.sha512()
    total = 0
    descriptor, temporary_name = tempfile.mkstemp(
        prefix=".upload-", suffix=".tmp", dir=directory
    )
    os.close(descriptor)
    temporary = Path(temporary_name)
    try:
        with temporary.open("wb") as output:
            async for chunk in request.stream():
                total += len(chunk)
                if total > settings.update_max_bytes:
                    raise WorkspaceRepositoryError(413, "Установщик превышает допустимый размер")
                digest.update(chunk)
                output.write(chunk)
        with temporary.open("rb") as input_file:
            if input_file.read(2) != b"MZ":
                raise WorkspaceRepositoryError(422, "Загруженный файл не похож на Windows EXE")
        if total == 0:
            raise WorkspaceRepositoryError(422, "Пустой установщик нельзя опубликовать")
        os.replace(temporary, target)
        now = datetime.now(UTC)
        await connection.execute(
            insert(update_releases).values(
                version=version,
                file_name=file_name,
                sha512=digest.hexdigest(),
                size_bytes=total,
                uploaded_by_user_id=actor.id,
                uploaded_at=now,
                published_at=None,
            )
        )
        await _audit(
            connection, actor, "desktop_update.staged", _release_audit_id(version),
            {"version": version, "sizeBytes": total},
        )
        return DesktopReleaseResponse(
            version=version, file_name=file_name, sha512=digest.hexdigest(),
            size_bytes=total, uploaded_at=now,
        )
    finally:
        temporary.unlink(missing_ok=True)


async def publish_release(
    connection: AsyncConnection,
    actor: AuthenticatedUser,
    settings: Settings,
    version: str,
) -> DesktopUpdatePolicyResponse:
    require_superadmin(actor)
    release_file_name(version)
    row = (
        await connection.execute(
            select(update_releases).where(update_releases.c.version == version)
        )
    ).mappings().first()
    if row is None or not _verify_release_file(
        release_path(settings, version), row["sha512"], row["size_bytes"]
    ):
        raise WorkspaceRepositoryError(409, "Файл обновления отсутствует или повреждён")
    policy = await policy_snapshot(connection)
    if policy.published_version is not None:
        current = tuple(int(part) for part in policy.published_version.split("."))
        candidate = tuple(int(part) for part in version.split("."))
        if candidate <= current:
            raise WorkspaceRepositoryError(409, "Новая версия должна быть выше опубликованной")
    now = datetime.now(UTC)
    await connection.execute(
        update(update_releases).where(update_releases.c.version == version).values(published_at=now)
    )
    await connection.execute(
        update(update_policy).where(update_policy.c.id == 1).values(
            published_version=version, updated_by_user_id=actor.id, updated_at=now,
        )
    )
    await _audit(
        connection, actor, "desktop_update.published", _release_audit_id(version),
        {"version": version},
    )
    return await policy_snapshot(connection)


async def set_mandatory(
    connection: AsyncConnection,
    actor: AuthenticatedUser,
    settings: Settings,
    mandatory: bool,
) -> DesktopUpdatePolicyResponse:
    require_superadmin(actor)
    policy = await policy_snapshot(connection)
    if mandatory and (
        policy.published_version is None
        or policy.release is None
        or not _verify_release_file(
            release_path(settings, policy.published_version),
            policy.release.sha512,
            policy.release.size_bytes,
        )
    ):
        raise WorkspaceRepositoryError(409, "Сначала опубликуйте доступную сборку")
    minimum_version = policy.published_version if mandatory else None
    now = datetime.now(UTC)
    await connection.execute(
        update(update_policy).where(update_policy.c.id == 1).values(
            mandatory=mandatory,
            minimum_version=minimum_version,
            updated_by_user_id=actor.id,
            updated_at=now,
        )
    )
    await _audit(connection, actor, "desktop_update.mandatory_changed", _POLICY_AUDIT_ID, {
        "mandatory": mandatory, "minimumVersion": minimum_version,
    })
    return await policy_snapshot(connection)


def latest_manifest(policy: DesktopUpdatePolicyResponse) -> str:
    release = policy.release
    if release is None:
        raise WorkspaceRepositoryError(404, "Обновление ещё не опубликовано")
    sha512_base64 = base64.b64encode(bytes.fromhex(release.sha512)).decode("ascii")
    # JSON is a YAML subset and avoids parsing untrusted hand-written release metadata.
    return json.dumps({
        "version": release.version,
        "files": [{"url": release.file_name, "sha512": sha512_base64, "size": release.size_bytes}],
        "path": release.file_name,
        "sha512": sha512_base64,
    })
