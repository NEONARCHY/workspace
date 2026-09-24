"""Versioned virtual folders: never expose a referent's local filesystem path."""

import hashlib
import re
from collections.abc import AsyncIterable
from datetime import UTC, datetime
from io import BytesIO
from pathlib import PurePosixPath
from uuid import NAMESPACE_URL, UUID, uuid5
from zipfile import ZIP_DEFLATED, ZipFile

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.engine import RowMapping
from sqlalchemy.ext.asyncio import AsyncConnection

from .access_control import ensure_module_action
from .ai_referent_service import load_letter
from .auth import AuthenticatedUser
from .object_storage import ObjectStorage
from .tables import (
    ai_referent_archive,
    ai_referent_delivery_commands,
    ai_referent_files,
    ai_referent_incoming_letters,
    ai_referent_letters,
    attachments,
)


async def read_limited_packet(chunks: AsyncIterable[bytes], limit: int) -> bytes:
    content = bytearray()
    async for chunk in chunks:
        if len(content) + len(chunk) > limit:
            raise HTTPException(413, "Файл превышает допустимый размер.")
        content.extend(chunk)
    if not content:
        raise HTTPException(422, "Пустой файл.")
    return bytes(content)


def safe_relative_path(value: str) -> str:
    path = PurePosixPath(value)
    if (
        not value
        or value == "."
        or len(value) > 500
        or path.is_absolute()
        or ".." in path.parts
        or any(char in value for char in ("\\", ":", "\x00", "\r", "\n"))
        or str(path) != value
        or value.endswith("/")
    ):
        raise HTTPException(422, "Недопустимое имя файла внутри пакета.")
    return value


async def require_packet_access(
    connection: AsyncConnection, user: AuthenticatedUser, kind: str, owner_id: UUID
) -> None:
    await ensure_module_action(connection, user, "ai_referent", "view")
    if kind == "outgoing":
        await load_letter(connection, user, owner_id)
        return
    if kind == "journal":
        exists = await connection.scalar(
            select(ai_referent_files.c.id)
            .where(
                ai_referent_files.c.kind == kind,
                ai_referent_files.c.owner_id == owner_id,
            )
            .limit(1)
        )
    elif kind in {"incoming", "archive"}:
        table = ai_referent_incoming_letters if kind == "incoming" else ai_referent_archive
        exists = await connection.scalar(select(table.c.id).where(table.c.id == owner_id))
    else:
        exists = None
    if exists is None:
        raise HTTPException(404, "Пакет письма не найден.")


async def packet_entries(
    connection: AsyncConnection, kind: str, owner_id: UUID
) -> list[dict[str, object]]:
    result: list[dict[str, object]] = []
    if kind == "outgoing":
        rows = (
            (
                await connection.execute(
                    select(attachments)
                    .where(
                        attachments.c.owner_type == "ai_referent_letter",
                        attachments.c.owner_id == owner_id,
                    )
                    .order_by(attachments.c.created_at)
                )
            )
            .mappings()
            .all()
        )
        result.extend(
            {
                "id": str(row["id"]),
                "name": f"original/{row['id']}/{row['file_name']}",
                "byteSize": row["byte_size"],
                "sha256": row["sha256"],
                "source": "attachment",
                "createdAt": row["created_at"].isoformat(),
            }
            for row in rows
        )
    files = (
        (
            await connection.execute(
                select(ai_referent_files)
                .where(
                    ai_referent_files.c.kind == kind,
                    ai_referent_files.c.owner_id == owner_id,
                )
                .order_by(ai_referent_files.c.created_at.desc())
            )
        )
        .mappings()
        .all()
    )
    visible_prefix = await _published_sign_only_prefix(connection, kind, owner_id)
    result.extend(
        {
            "id": str(row["id"]),
            "name": row["relative_path"],
            "byteSize": row["byte_size"],
            "sha256": row["sha256"],
            "source": "packet",
            "createdAt": row["created_at"].isoformat(),
        }
        for row in files
        if visible_prefix is None or str(row["relative_path"]).startswith(visible_prefix)
    )
    return result


async def _published_sign_only_prefix(
    connection: AsyncConnection, kind: str, owner_id: UUID
) -> str | None:
    if kind != "outgoing":
        return None
    row = (
        (await connection.execute(
            select(ai_referent_letters.c.workflow_kind, ai_referent_letters.c.status)
            .where(ai_referent_letters.c.id == owner_id)
        )).mappings().one_or_none()
    )
    if row is None or row["workflow_kind"] != "sign_only":
        return None
    if row["status"] != "signed":
        return "signed/hidden/"
    job_id = await connection.scalar(
        select(ai_referent_delivery_commands.c.id).where(
            ai_referent_delivery_commands.c.letter_id == owner_id,
            ai_referent_delivery_commands.c.kind == "sign_only",
            ai_referent_delivery_commands.c.status == "completed",
        ).order_by(ai_referent_delivery_commands.c.completed_at.desc()).limit(1)
    )
    return f"signed/{job_id}/" if job_id else "signed/hidden/"


def packet_archive_filename(number: str, subject: str) -> str:
    """A readable Windows-safe name; stored packet paths and IDs stay unchanged."""
    parts = []
    for value, limit, replacement in ((number, 36, "-"), (subject, 72, " ")):
        cleaned = re.sub(r'[<>:"/\\|?*\x00-\x1f]+', replacement, value)
        cleaned = re.sub(r"\s+", " ", cleaned).strip(" .-")[:limit].rstrip(" .-")
        if cleaned:
            parts.append(cleaned)
    stem = " — ".join(parts) or "Пакет документов"
    if re.fullmatch(r"(?i:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])", stem):
        stem = f"Письмо {stem}"
    return f"{stem}.zip"


async def packet_download_filename(
    connection: AsyncConnection, kind: str, owner_id: UUID
) -> str:
    if kind == "incoming":
        row = (
            await connection.execute(
                select(
                    ai_referent_incoming_letters.c.platform_incoming_number,
                    ai_referent_incoming_letters.c.sequence_number,
                    ai_referent_incoming_letters.c.subject,
                ).where(ai_referent_incoming_letters.c.id == owner_id)
            )
        ).mappings().one_or_none()
        return packet_archive_filename(
            str(row["platform_incoming_number"] or row["sequence_number"] or "Входящее"),
            str(row["subject"] or ""),
        ) if row else "Пакет документов.zip"
    if kind == "outgoing":
        row = (
            await connection.execute(
                select(
                    ai_referent_letters.c.outgoing_number,
                    ai_referent_letters.c.year_suffix,
                    ai_referent_letters.c.subject,
                ).where(ai_referent_letters.c.id == owner_id)
            )
        ).mappings().one_or_none()
        if row:
            number = (
                f"{int(row['outgoing_number']):04d}-{row['year_suffix']}-AI"
                if row["outgoing_number"] is not None and row["year_suffix"] else "Черновик"
            )
            return packet_archive_filename(number, str(row["subject"] or ""))
    if kind == "archive":
        payload = await connection.scalar(
            select(ai_referent_archive.c.payload).where(ai_referent_archive.c.id == owner_id)
        )
        if isinstance(payload, dict):
            return packet_archive_filename(
                str(payload.get("displayNumber") or "Архивное письмо"),
                str(payload.get("subject") or ""),
            )
    return "Excel-журналы.zip" if kind == "journal" else "Пакет документов.zip"


async def store_packet_file(
    connection: AsyncConnection,
    storage: ObjectStorage,
    *,
    kind: str,
    owner_id: UUID,
    name: str,
    content: bytes,
    content_type: str,
) -> dict[str, object]:
    name = safe_relative_path(name)
    digest = hashlib.sha256(content).hexdigest()
    file_id = uuid5(NAMESPACE_URL, f"ai-packet:{kind}:{owner_id}:{name}:{digest}")
    key = f"ai-referent/files/{file_id}/{digest}"
    await storage.put(key, content, content_type)
    await connection.execute(
        pg_insert(ai_referent_files)
        .values(
            id=file_id,
            kind=kind,
            owner_id=owner_id,
            relative_path=name,
            storage_key=key,
            sha256=digest,
            byte_size=len(content),
            content_type=content_type,
            created_at=datetime.now(UTC),
        )
        .on_conflict_do_nothing(index_elements=[ai_referent_files.c.id])
    )
    return {"id": str(file_id), "sha256": digest, "byteSize": len(content)}


async def file_metadata(
    connection: AsyncConnection, kind: str, owner_id: UUID, file_id: UUID, source: str
) -> RowMapping:
    if source == "attachment" and kind == "outgoing":
        query = select(attachments).where(
            attachments.c.id == file_id,
            attachments.c.owner_type == "ai_referent_letter",
            attachments.c.owner_id == owner_id,
        )
    else:
        query = select(ai_referent_files).where(
            ai_referent_files.c.id == file_id,
            ai_referent_files.c.kind == kind,
            ai_referent_files.c.owner_id == owner_id,
        )
    row = (await connection.execute(query)).mappings().one_or_none()
    if row is None:
        raise HTTPException(404, "Файл не найден.")
    if source != "attachment":
        visible_prefix = await _published_sign_only_prefix(connection, kind, owner_id)
        if visible_prefix is not None and not str(row["relative_path"]).startswith(
            visible_prefix
        ):
            raise HTTPException(404, "Файл ещё не опубликован.")
    return row


async def packet_zip(
    connection: AsyncConnection, storage: ObjectStorage, kind: str, owner_id: UUID
) -> bytes:
    entries = await packet_entries(connection, kind, owner_id)
    if sum(int(str(item["byteSize"])) for item in entries) > 200 * 1024 * 1024:
        raise HTTPException(413, "Пакет больше 200 МБ. Скачайте файлы по отдельности.")
    buffer = BytesIO()
    with ZipFile(buffer, "w", compression=ZIP_DEFLATED) as archive:
        for item in entries:
            record = await file_metadata(
                connection, kind, owner_id, UUID(str(item["id"])), str(item["source"])
            )
            content = await storage.get(record["storage_key"])
            if hashlib.sha256(content).hexdigest() != item["sha256"]:
                raise HTTPException(503, "Контрольная сумма файла не совпала.")
            # Version IDs keep same-named historical files unambiguous inside the ZIP.
            archive.writestr(f"{item['id']}/{safe_relative_path(str(item['name']))}", content)
    return buffer.getvalue()
