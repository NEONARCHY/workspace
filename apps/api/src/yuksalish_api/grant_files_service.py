"""Atomic grant creation with private reference files and content-aware retries."""

import asyncio
import hashlib
import json
import logging
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import PurePosixPath
from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncConnection

from . import grant_service
from .auth import AuthenticatedUser
from .errors import WorkspaceRepositoryError
from .grant_schemas import GrantCreate, GrantDetail
from .grant_tables import grant_requests
from .image_metadata import image_dimensions
from .object_storage import ObjectStorage, ObjectStorageError
from .repository import create_attachment

MAX_INITIAL_FILES = 20
MAX_INITIAL_FILE_BYTES = 25 * 1024 * 1024
MAX_INITIAL_TOTAL_BYTES = 100 * 1024 * 1024
logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class GrantInitialFile:
    file_name: str
    content_type: str
    content: bytes


def validated_files(
    files: Sequence[GrantInitialFile], max_file_bytes: int
) -> list[GrantInitialFile]:
    if not 1 <= len(files) <= MAX_INITIAL_FILES:
        raise WorkspaceRepositoryError(422, "Выберите от 1 до 20 файлов")
    normalized = []
    for item in files:
        name = PurePosixPath(item.file_name.replace("\\", "/")).name.strip()
        if not name or name in {".", ".."} or len(name) > 255 or any(ord(c) < 32 for c in name):
            raise WorkspaceRepositoryError(422, "Недопустимое имя файла")
        if not item.content:
            raise WorkspaceRepositoryError(422, "Нельзя прикрепить пустой файл")
        if len(item.content) > min(max_file_bytes, MAX_INITIAL_FILE_BYTES):
            raise WorkspaceRepositoryError(413, "Файл должен быть не больше 25 МБ")
        normalized.append(GrantInitialFile(
            name, (item.content_type or "application/octet-stream")[:160], item.content,
        ))
    if sum(len(item.content) for item in normalized) > MAX_INITIAL_TOTAL_BYTES:
        raise WorkspaceRepositoryError(413, "Общий размер файлов должен быть не больше 100 МБ")
    return normalized


async def create_with_files(
    connection: AsyncConnection,
    user: AuthenticatedUser,
    payload: GrantCreate,
    storage: ObjectStorage,
    files: Sequence[GrantInitialFile],
    *,
    max_file_bytes: int = MAX_INITIAL_FILE_BYTES,
) -> GrantDetail:
    prepared = validated_files(files, max_file_bytes)
    manifest = [{"name": item.file_name, "type": item.content_type,
                 "size": len(item.content), "sha256": hashlib.sha256(item.content).hexdigest()}
                for item in prepared]
    digest = hashlib.sha256(json.dumps(manifest, sort_keys=True).encode()).hexdigest()
    keys: list[str] = []
    complete = False
    try:
        async with connection.begin_nested():
            await grant_service.lock_grant_creation(connection, payload.request_id)
            exists = await connection.scalar(select(grant_requests.c.id).where(
                grant_requests.c.id == payload.request_id,
            ))
            result = await grant_service.create_grant(
                connection, user, payload, initial_files_digest=digest,
            )
            # A committed creation already includes every source file. Never append on retry,
            # including after the chairman has already advanced the grant.
            if exists is None:
                for item in prepared:
                    key = f"grant/{payload.request_id}/{uuid4()}"
                    keys.append(key)
                    await storage.put(key, item.content, item.content_type)
                    width, height = await asyncio.to_thread(
                        image_dimensions, item.content, item.content_type,
                    )
                    await create_attachment(
                        connection, user, "grant", payload.request_id,
                        file_name=item.file_name, content_type=item.content_type,
                        byte_size=len(item.content),
                        sha256=hashlib.sha256(item.content).hexdigest(),
                        storage_key=key, image_width=width, image_height=height,
                    )
                result = await grant_service.get_grant(connection, user, payload.request_id)
        complete = True
        return result
    finally:
        if not complete:
            for key in keys:
                try:
                    await storage.delete(key)
                except ObjectStorageError:
                    # No DB commit has happened, so these random keys cannot back a live file.
                    logger.warning("Could not clean an uncommitted grant source file")
