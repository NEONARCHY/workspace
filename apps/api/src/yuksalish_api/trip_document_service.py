"""Private trip documents and atomic order registration for the new approval route."""

from __future__ import annotations

import hashlib
from datetime import UTC, datetime
from io import BytesIO
from pathlib import PurePath
from typing import Literal, cast
from uuid import UUID, uuid4
from zipfile import BadZipFile, ZipFile
from zoneinfo import ZoneInfo

from sqlalchemy import select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.engine import RowMapping
from sqlalchemy.ext.asyncio import AsyncConnection
from starlette.concurrency import run_in_threadpool

from .ai_referent_docx_safety import has_disallowed_external_relationships
from .auth import AuthenticatedUser
from .errors import WorkspaceRepositoryError as Error
from .hr_hiring_pdf import application_pdf, validate_signature
from .hr_hiring_tables import hiring_signatures
from .object_storage import ObjectStorage
from .tables import (
    hr_settings,
    trip_order_counters,
    trip_request_employees,
    trip_requests,
    users,
)
from .trip_order_pdf import brief_pdf, order_pdf

MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024
MAX_SIGNATURE_BYTES = 1024 * 1024
_LOCAL = ZoneInfo("Asia/Tashkent")
_EDITABLE = {"draft", "needs_revision"}
DocumentKind = Literal["attachment", "brief", "order", "order-preview"]


def _hash(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def _safe_name(file_name: str) -> str:
    cleaned = file_name.strip()
    if (
        not cleaned or len(cleaned) > 240 or cleaned in {".", ".."}
        or "/" in cleaned or "\\" in cleaned or any(ord(char) < 32 for char in cleaned)
    ):
        raise Error(422, "Некорректное имя файла")
    return PurePath(cleaned).name


def validate_attachment(content: bytes, file_name: str) -> str:
    """Accept bounded, passive source files; never execute an uploaded document."""
    if not content or len(content) > MAX_ATTACHMENT_BYTES:
        raise Error(413, "Билдирги должна быть не больше 10 МиБ")
    suffix = PurePath(_safe_name(file_name)).suffix.lower()
    if suffix == ".pdf" or suffix in {".jpg", ".jpeg", ".png"}:
        try:
            application_pdf(content)
        except ValueError as error:
            raise Error(422, str(error)) from error
        if suffix == ".pdf" and content.startswith(b"%PDF-"):
            return "application/pdf"
        if suffix in {".jpg", ".jpeg"} and content.startswith(b"\xff\xd8"):
            return "image/jpeg"
        if suffix == ".png" and content.startswith(b"\x89PNG\r\n\x1a\n"):
            return "image/png"
        raise Error(422, "Расширение не соответствует содержимому файла")
    if suffix != ".docx":
        raise Error(415, "Поддерживаются PDF, DOCX, JPG и PNG")
    try:
        with ZipFile(BytesIO(content)) as package:
            members = package.infolist()
            names = {item.filename for item in members}
            if (
                len(members) > 200 or "word/document.xml" not in names
                or "[Content_Types].xml" not in names
                or sum(item.file_size for item in members) > 30 * 1024 * 1024
                or any(item.file_size > 20 * 1024 * 1024 for item in members)
                or any("vba" in name.lower() or "embeddings/" in name.lower() for name in names)
                or has_disallowed_external_relationships(package)
            ):
                raise Error(422, "DOCX содержит недопустимые вложения или внешние ресурсы")
    except (BadZipFile, OSError, RuntimeError) as error:
        raise Error(422, "Некорректный DOCX") from error
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document"


async def _row(
    connection: AsyncConnection, request_id: UUID, *, lock: bool = False,
) -> RowMapping:
    query = select(trip_requests).where(trip_requests.c.id == request_id)
    if lock:
        query = query.with_for_update()
    row = (await connection.execute(query)).mappings().first()
    if row is None:
        raise Error(404, "Поездка не найдена")
    return row


def _require_editable(row: RowMapping, user: AuthenticatedUser) -> None:
    if row["requester_user_id"] != user.id or row["workflow_version"] != 2:
        raise Error(403, "Изменить билдирги может только инициатор")
    if row["stage"] != "launch" or row["status"] not in _EDITABLE:
        raise Error(409, "После отправки билдирги изменить нельзя")


async def put_attachment(
    connection: AsyncConnection, user: AuthenticatedUser, storage: ObjectStorage,
    request_id: UUID, file_name: str, content: bytes,
) -> None:
    row = await _row(connection, request_id, lock=True)
    _require_editable(row, user)
    safe_name = _safe_name(file_name)
    media_type = await run_in_threadpool(validate_attachment, content, safe_name)
    key = f"trip-requests/{request_id}/sources/{uuid4()}"
    await storage.put(key, content, media_type)
    await connection.execute(update(trip_requests).where(trip_requests.c.id == request_id).values(
        brief_attachment_key=key,
        brief_attachment_name=safe_name,
        brief_attachment_type=media_type,
        brief_attachment_sha256=_hash(content),
        employee_signature_key=None,
        employee_signature_sha256=None,
        signed_brief_key=None,
        signed_brief_sha256=None,
        updated_at=datetime.now(UTC),
    ))


async def remove_attachment(
    connection: AsyncConnection, user: AuthenticatedUser, request_id: UUID,
) -> None:
    row = await _row(connection, request_id, lock=True)
    _require_editable(row, user)
    await connection.execute(update(trip_requests).where(trip_requests.c.id == request_id).values(
        brief_attachment_key=None,
        brief_attachment_name=None,
        brief_attachment_type=None,
        brief_attachment_sha256=None,
        employee_signature_key=None,
        employee_signature_sha256=None,
        signed_brief_key=None,
        signed_brief_sha256=None,
        updated_at=datetime.now(UTC),
    ))


async def put_employee_signature(
    connection: AsyncConnection, user: AuthenticatedUser, storage: ObjectStorage,
    request_id: UUID, content: bytes,
) -> None:
    row = await _row(connection, request_id, lock=True)
    _require_editable(row, user)
    if not row["brief_text"] and not row["brief_attachment_key"]:
        raise Error(422, "Напишите билдирги или прикрепите исходный документ")
    if not row["expense_source"]:
        raise Error(422, "Укажите источник покрытия расходов")
    try:
        normalized = await run_in_threadpool(validate_signature, content)
    except ValueError as error:
        raise Error(422, str(error)) from error
    key = f"trip-requests/{request_id}/signatures/{uuid4()}.png"
    await storage.put(key, normalized, "image/png")
    await connection.execute(update(trip_requests).where(trip_requests.c.id == request_id).values(
        employee_signature_key=key,
        employee_signature_sha256=_hash(normalized),
        signed_brief_key=None,
        signed_brief_sha256=None,
        updated_at=datetime.now(UTC),
    ))


async def _verified(storage: ObjectStorage, key: str | None, digest: str | None) -> bytes:
    if not key or not digest:
        raise Error(409, "Документ ещё не подготовлен")
    content = await storage.get(key)
    if _hash(content) != digest:
        raise Error(503, "Сохранённый документ повреждён")
    return content


async def _people(connection: AsyncConnection, request_id: UUID) -> list[tuple[str, str]]:
    rows = (await connection.execute(
        select(users.c.full_name, users.c.job_title)
        .select_from(trip_request_employees.join(
            users, users.c.id == trip_request_employees.c.user_id,
        ))
        .where(trip_request_employees.c.request_id == request_id)
        .order_by(users.c.full_name)
    )).all()
    return [(str(name), str(title or "")) for name, title in rows]


async def _appointed_chair(connection: AsyncConnection) -> UUID:
    chair_id = await connection.scalar(select(hr_settings.c.chair_user_id).where(
        hr_settings.c.id == 1,
    ))
    if chair_id is None:
        raise Error(409, "Назначьте председателя в настройках HR")
    return cast(UUID, chair_id)


async def prepare_signed_brief(
    connection: AsyncConnection, user: AuthenticatedUser, storage: ObjectStorage,
    request_id: UUID,
) -> None:
    row = await _row(connection, request_id, lock=True)
    _require_editable(row, user)
    if not row["brief_text"] and not row["brief_attachment_key"]:
        raise Error(422, "Напишите билдирги или прикрепите исходный документ")
    if not row["expense_source"]:
        raise Error(422, "Укажите источник покрытия расходов")
    signature = await _verified(
        storage, row["employee_signature_key"], row["employee_signature_sha256"],
    )
    if row["brief_attachment_key"]:
        await _verified(
            storage, row["brief_attachment_key"], row["brief_attachment_sha256"],
        )
    chair_id = await _appointed_chair(connection)
    names = await _people(connection, request_id)
    requester = await connection.scalar(select(users.c.full_name).where(users.c.id == user.id))
    chair = await connection.scalar(select(users.c.full_name).where(
        users.c.id == chair_id, users.c.status == "active",
    ))
    if not requester or not chair:
        raise Error(409, "Инициатор или председатель не найден")
    cover = await run_in_threadpool(
        brief_pdf,
        requester=str(requester), chair=str(chair), purpose=row["purpose"],
        destination=row["destination"], start=row["start_date"], end=row["end_date"],
        employees=[name for name, _ in names], expense_source=row["expense_source"],
        brief_text=row["brief_text"] or "", attachment_name=row["brief_attachment_name"],
        signature=signature, signed_on=datetime.now(_LOCAL).date(),
    )
    # Reject layouts that cannot become a usable order before entering the chair's queue.
    await run_in_threadpool(
        order_pdf,
        order_number="000-WS", issued=datetime.now(_LOCAL).date(),
        purpose=row["purpose"], destination=row["destination"],
        start=row["start_date"], end=row["end_date"], employees=names,
        expense_source=row["expense_source"], requester=str(requester),
        chair=str(chair), signature=None,
    )
    key = f"trip-requests/{request_id}/brief/{uuid4()}.pdf"
    await storage.put(key, cover, "application/pdf")
    await connection.execute(update(trip_requests).where(trip_requests.c.id == request_id).values(
        signed_brief_key=key, signed_brief_sha256=_hash(cover),
        updated_at=datetime.now(UTC),
    ))


async def issue_order(
    connection: AsyncConnection, user: AuthenticatedUser, storage: ObjectStorage,
    request_id: UUID,
) -> None:
    row = await _row(connection, request_id, lock=True)
    chair_id = await _appointed_chair(connection)
    if user.id != chair_id:
        raise Error(403, "Приказ может подписать только назначенный председатель")
    if row["workflow_version"] != 2 or row["stage"] != "manager_approval":
        raise Error(409, "Поездка не ожидает приказа председателя")
    await _verified(storage, row["signed_brief_key"], row["signed_brief_sha256"])
    signer = (await connection.execute(select(hiring_signatures).where(
        hiring_signatures.c.user_id == user.id,
    ))).mappings().first()
    if signer is None:
        raise Error(409, "Сначала настройте личную подпись председателя в HR")
    image = await _verified(storage, signer["storage_key"], signer["sha256"])
    people = await _people(connection, request_id)
    requester = await connection.scalar(select(users.c.full_name).where(
        users.c.id == row["requester_user_id"],
    ))
    chair = await connection.scalar(select(users.c.full_name).where(
        users.c.id == user.id, users.c.status == "active",
    ))
    if not requester or not chair:
        raise Error(409, "Инициатор или председатель не найден")
    issued = datetime.now(_LOCAL)
    sequence = await connection.scalar(
        pg_insert(trip_order_counters)
        .values(year=issued.year, last_sequence=1)
        .on_conflict_do_update(
            index_elements=[trip_order_counters.c.year],
            set_={"last_sequence": trip_order_counters.c.last_sequence + 1},
        )
        .returning(trip_order_counters.c.last_sequence)
    )
    if sequence is None:
        raise Error(500, "Сбой регистрации приказа")
    number = f"{sequence:03d}-WS"
    content = await run_in_threadpool(
        order_pdf,
        order_number=number, issued=issued.date(), purpose=row["purpose"],
        destination=row["destination"], start=row["start_date"], end=row["end_date"],
        employees=people, expense_source=row["expense_source"],
        requester=str(requester), chair=str(chair), signature=image,
    )
    key = f"trip-requests/{request_id}/orders/{uuid4()}.pdf"
    await storage.put(key, content, "application/pdf")
    await connection.execute(update(trip_requests).where(trip_requests.c.id == request_id).values(
        order_pdf_key=key,
        order_pdf_sha256=_hash(content),
        order_number=number,
        order_year=issued.year,
        order_sequence=sequence,
        order_signer_user_id=user.id,
        order_issued_at=issued.astimezone(UTC),
    ))


async def read_document(
    connection: AsyncConnection, user: AuthenticatedUser, storage: ObjectStorage,
    request_id: UUID, kind: DocumentKind,
) -> tuple[bytes, str, str]:
    row = await _row(connection, request_id)
    chair_id = await connection.scalar(select(hr_settings.c.chair_user_id).where(
        hr_settings.c.id == 1,
    ))
    participants = (await connection.execute(select(trip_request_employees.c.user_id).where(
        trip_request_employees.c.request_id == request_id,
    ))).scalars().all()
    if (
        user.id != row["requester_user_id"]
        and not (user.id == chair_id and row["stage"] != "launch")
        and not (row["status"] == "approved" and user.id in participants)
    ):
        raise Error(404, "Документ поездки не найден")
    if kind == "order-preview":
        if row["stage"] != "manager_approval":
            raise Error(404, "Предпросмотр приказа недоступен")
        if chair_id is None:
            raise Error(409, "Назначьте председателя в настройках HR")
        people = await _people(connection, request_id)
        requester = await connection.scalar(select(users.c.full_name).where(
            users.c.id == row["requester_user_id"],
        ))
        chair = await connection.scalar(select(users.c.full_name).where(
            users.c.id == chair_id,
        ))
        if not requester or not chair:
            raise Error(409, "Инициатор или председатель не найден")
        content = await run_in_threadpool(
            order_pdf,
            order_number="000-WS", issued=datetime.now(_LOCAL).date(),
            purpose=row["purpose"], destination=row["destination"],
            start=row["start_date"], end=row["end_date"], employees=people,
            expense_source=row["expense_source"], requester=str(requester),
            chair=str(chair), signature=None,
        )
        return content, "application/pdf", "trip-order-preview.pdf"
    keys = {
        "attachment": (
            row["brief_attachment_key"], row["brief_attachment_sha256"],
            row["brief_attachment_type"], row["brief_attachment_name"],
        ),
        "brief": (
            row["signed_brief_key"], row["signed_brief_sha256"],
            "application/pdf", "bildirgi-signed.pdf",
        ),
        "order": (
            row["order_pdf_key"], row["order_pdf_sha256"],
            "application/pdf", f"order-{row['order_number'] or 'trip'}.pdf",
        ),
    }
    key, digest, media_type, file_name = keys[kind]
    if not key or not digest:
        raise Error(404, "Документ поездки не найден")
    return await _verified(storage, key, digest), str(media_type), str(file_name)
