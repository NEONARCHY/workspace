"""Hiring transactions. Administrative visibility is not authority to sign as another person."""

import asyncio
import hashlib
from datetime import UTC, datetime
from io import BytesIO
from typing import Literal
from uuid import UUID, uuid4
from zipfile import ZIP_DEFLATED, ZipFile

from sqlalchemy import func, insert, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.engine import RowMapping
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncConnection
from starlette.concurrency import run_in_threadpool

from .access_control import ensure_module_action
from .auth import AuthenticatedUser
from .errors import WorkspaceRepositoryError as Error
from .hr_hiring_pdf import (
    application_pdf,
    documents,
    place_signature,
    sign_generated,
    validate_signature,
)
from .hr_hiring_schemas import (
    HiringAction,
    HiringDetail,
    HiringFields,
    HiringRegistry,
    HiringSummary,
    HiringWrite,
    SignatureBox,
)
from .hr_hiring_tables import hiring_cases as cases
from .hr_hiring_tables import hiring_receipts as receipts
from .hr_hiring_tables import hiring_signatures as signatures
from .object_storage import ObjectStorage
from .tables import audit_events, hr_settings, users, workspace_notifications

PDF_LIMIT = asyncio.Semaphore(2)
EDITABLE = {"draft", "returned"}


async def route(connection: AsyncConnection, *, lock: bool = False) -> RowMapping:
    query = select(hr_settings).where(hr_settings.c.id == 1)
    if lock:
        query = query.with_for_update(read=True)
    row = (await connection.execute(query)).mappings().first()
    if row is None or not row["hr_user_id"] or not row["chair_user_id"]:
        raise Error(409, "Назначьте кадровика и председателя в настройках HR")
    return row


def is_hr(user: AuthenticatedUser, settings: RowMapping) -> bool:
    return user.role in {"admin", "superadmin"} or settings["hr_user_id"] == user.id


async def require_hr(connection: AsyncConnection, user: AuthenticatedUser) -> RowMapping:
    await ensure_module_action(connection, user, "hr", "edit")
    settings = await route(connection, lock=True)
    if not is_hr(user, settings):
        raise Error(403, "Оформление доступно кадровику")
    return settings


async def require_case(
    connection: AsyncConnection, user: AuthenticatedUser, case_id: UUID, *, lock: bool = False
) -> tuple[RowMapping, RowMapping]:
    await ensure_module_action(connection, user, "hr", "view")
    settings = await route(connection, lock=lock)
    query = select(cases).where(cases.c.id == case_id)
    if not is_hr(user, settings):
        query = query.where(cases.c.signer_id == user.id, cases.c.status != "draft")
    if lock:
        query = query.with_for_update()
    row = (await connection.execute(query)).mappings().one_or_none()
    if row is None:
        raise Error(404, "Оформление не найдено или недоступно")
    return row, settings


def summary(row: RowMapping, user: AuthenticatedUser, settings: RowMapping) -> HiringSummary:
    f = HiringFields.model_validate(row["fields"])
    return HiringSummary(
        id=row["id"],
        full_name=f.full_name,
        job_title=f.job_title,
        status=row["status"],
        revision=row["revision"],
        updated_at=row["updated_at"],
        can_edit=is_hr(user, settings) and row["status"] in EDITABLE,
        can_sign=row["signer_id"] == user.id
        and settings["chair_user_id"] == user.id
        and row["status"] == "pending",
    )


def detail(row: RowMapping, user: AuthenticatedUser, settings: RowMapping) -> HiringDetail:
    return HiringDetail(
        **summary(row, user, settings).model_dump(),
        fields=HiringFields.model_validate(row["fields"]),
        application_box=SignatureBox.model_validate(row["application_box"]),
        has_application=bool(row["application_key"]),
        application_pages=row["application_pages"],
        has_employee_scan=bool(row["employee_scan_key"]),
        return_comment=row["return_comment"],
        signer_name=row["signer_name"],
        approved_at=row["approved_at"],
        document_hashes=row["document_hashes"],
    )


async def registry(
    connection: AsyncConnection, user: AuthenticatedUser, offset: int
) -> HiringRegistry:
    await ensure_module_action(connection, user, "hr", "view")
    settings = await route(connection)
    query = select(cases)
    if not is_hr(user, settings):
        query = query.where(cases.c.signer_id == user.id, cases.c.status != "draft")
    total = await connection.scalar(select(func.count()).select_from(query.subquery()))
    rows = (
        (
            await connection.execute(
                query.order_by(cases.c.updated_at.desc(), cases.c.id).limit(50).offset(offset)
            )
        )
        .mappings()
        .all()
    )
    signer = (
        await connection.execute(
            select(users.c.full_name).where(
                users.c.id == settings["chair_user_id"],
                users.c.status == "active",
            )
        )
    ).scalar_one_or_none()
    ready = await connection.scalar(
        select(signatures.c.user_id).where(
            signatures.c.user_id == settings["chair_user_id"],
        )
    )
    return HiringRegistry(
        items=[summary(row, user, settings) for row in rows],
        total=total or 0,
        can_create=is_hr(user, settings),
        can_configure_signature=user.id == settings["chair_user_id"],
        signature_ready=bool(ready),
        signer_name=signer or "Не назначен",  # noqa: RUF001 - intentional Cyrillic document text
    )


async def audit(
    connection: AsyncConnection,
    user: AuthenticatedUser,
    target: UUID,
    action: str,
    revision: int = 0,
) -> None:
    await connection.execute(
        insert(audit_events).values(
            id=uuid4(),
            actor_user_id=user.id,
            action=f"hr.hiring_{action}",
            target_type="hr_hiring",
            target_id=target,
            details={"revision": revision},
            created_at=datetime.now(UTC),
        )
    )


def check_revision(row: RowMapping, expected: int) -> None:
    if row["revision"] != expected:
        raise Error(409, "Документы изменены. Обновите карточку перед повторным действием")


async def save_case(
    connection: AsyncConnection, user: AuthenticatedUser, case_id: UUID, payload: HiringWrite
) -> HiringDetail:
    settings = await require_hr(connection, user)
    existing = (
        (await connection.execute(select(cases).where(cases.c.id == case_id).with_for_update()))
        .mappings()
        .one_or_none()
    )
    if existing:
        # A successful create retried after a lost response must not create or overwrite a case.
        if payload.expected_revision == 0:
            if (
                existing["created_by"] == user.id
                and existing["fields"] == payload.fields.model_dump(mode="json")
                and existing["application_box"] == payload.application_box.model_dump(mode="json")
            ):
                return detail(existing, user, settings)
            raise Error(409, "Этот черновик уже существует. Откройте его заново")  # noqa: RUF001 - intentional Cyrillic document text
        check_revision(existing, payload.expected_revision)
        if existing["status"] not in EDITABLE:
            raise Error(409, "Согласуемые и подписанные данные нельзя редактировать")
    elif payload.expected_revision != 0:
        raise Error(404, "Черновик не найден")
    signer = (
        (
            await connection.execute(
                select(users).where(
                    users.c.id == settings["chair_user_id"],
                    users.c.status == "active",
                )
            )
        )
        .mappings()
        .one_or_none()
    )
    if not signer:
        raise Error(409, "Председатель неактивен")
    now = datetime.now(UTC)
    values = dict(
        fields=payload.fields.model_dump(mode="json"),
        application_box=payload.application_box.model_dump(mode="json"),
        revision=(existing["revision"] + 1) if existing else 1,
        contract_number=payload.fields.contract_number,
        order_number=payload.fields.order_number,
        document_year=payload.fields.document_date.year,
        updated_at=now,
        signer_id=signer["id"],
        signer_name=signer["full_name"],
    )
    try:
        # A savepoint lets a number collision become a useful 409, not a broken DB transaction.
        async with connection.begin_nested():
            if existing:
                result = await connection.execute(
                    update(cases).where(cases.c.id == case_id).values(**values).returning(cases)
                )
            else:
                result = await connection.execute(
                    insert(cases)
                    .values(
                        id=case_id,
                        created_by=user.id,
                        status="draft",
                        application_pages=0,
                        signed_keys={},
                        preview_keys={},
                        document_hashes={},
                        return_comment="",
                        created_at=now,
                        **values,
                    )
                    .returning(cases)
                )
            row = result.mappings().one()
    except IntegrityError as error:
        raise Error(409, "Номер договора или приказа уже используется в этом году") from error
    await audit(connection, user, case_id, "saved", row["revision"])
    return detail(row, user, settings)


async def save_signature(
    connection: AsyncConnection, user: AuthenticatedUser, storage: ObjectStorage, content: bytes
) -> None:
    await ensure_module_action(connection, user, "hr", "approve")
    settings = await route(connection)
    if user.id != settings["chair_user_id"]:
        raise Error(403, "Только назначенный председатель может настроить свою подпись")
    normalized = await run_in_threadpool(validate_signature, content)
    key = f"hr-hiring/signatures/{user.id}/{uuid4()}.png"
    await storage.put(key, normalized, "image/png")
    await connection.execute(
        pg_insert(signatures)
        .values(
            user_id=user.id,
            storage_key=key,
            sha256=hashlib.sha256(normalized).hexdigest(),
            updated_at=datetime.now(UTC),
        )
        .on_conflict_do_update(
            index_elements=[signatures.c.user_id],
            set_={
                "storage_key": key,
                "sha256": hashlib.sha256(normalized).hexdigest(),
                "updated_at": datetime.now(UTC),
            },
        )
    )
    await audit(connection, user, user.id, "signature_configured")


async def upload_document(
    connection: AsyncConnection,
    user: AuthenticatedUser,
    storage: ObjectStorage,
    case_id: UUID,
    expected: int,
    kind: Literal["application", "employee-scan"],
    content: bytes,
    digest: str,
) -> HiringDetail:
    await require_hr(connection, user)
    row, settings = await require_case(connection, user, case_id, lock=True)
    hashes = dict(row["document_hashes"])
    # Content identity makes a lost-response retry safe even with the previous revision.
    if hashes.get(f"{kind}_original") == digest:
        return detail(row, user, settings)
    check_revision(row, expected)
    if (kind == "application" and row["status"] not in EDITABLE) or (
        kind == "employee-scan" and row["status"] not in {"awaiting_employee", "completed"}
    ):
        raise Error(409, "На этом этапе документ нельзя заменить")  # noqa: RUF001 - intentional Cyrillic document text
    async with PDF_LIMIT:
        normalized, pages = await run_in_threadpool(application_pdf, content)
    key = f"hr-hiring/{case_id}/{uuid4()}"
    await storage.put(f"{key}/original", content, "application/octet-stream")
    await storage.put(f"{key}/normalized.pdf", normalized, "application/pdf")
    hashes[f"{kind}_original"] = digest
    hashes[f"{kind}_normalized"] = hashlib.sha256(normalized).hexdigest()
    values: dict[str, object] = {
        "document_hashes": hashes,
        "revision": row["revision"] + 1,
        "updated_at": datetime.now(UTC),
    }
    if kind == "application":
        values.update(
            application_key=f"{key}/normalized.pdf",
            application_pages=pages,
            application_original_key=f"{key}/original",
        )
    else:
        values.update(employee_scan_key=f"{key}/normalized.pdf")
    new = (
        (
            await connection.execute(
                update(cases).where(cases.c.id == case_id).values(**values).returning(cases)
            )
        )
        .mappings()
        .one()
    )
    await audit(connection, user, case_id, f"{kind}_uploaded", new["revision"])
    return detail(new, user, settings)


async def act_case(
    connection: AsyncConnection,
    user: AuthenticatedUser,
    storage: ObjectStorage,
    case_id: UUID,
    action: HiringAction,
) -> HiringDetail:
    row, settings = await require_case(connection, user, case_id, lock=True)
    fingerprint = hashlib.sha256(action.model_dump_json().encode()).hexdigest()
    receipt = (
        (
            await connection.execute(
                select(receipts).where(
                    receipts.c.case_id == case_id,
                    receipts.c.request_id == action.request_id,
                )
            )
        )
        .mappings()
        .first()
    )
    if receipt:
        if receipt["actor_id"] != user.id or receipt["fingerprint"] != fingerprint:
            raise Error(409, "Ключ повторного запроса уже использован для другого действия")
        return detail(row, user, settings)
    check_revision(row, action.expected_revision)
    values: dict[str, object] = {"revision": row["revision"] + 1, "updated_at": datetime.now(UTC)}
    if action.action in {"approve", "return"}:
        await ensure_module_action(connection, user, "hr", "approve")
        if user.id != row["signer_id"] or user.id != settings["chair_user_id"]:
            raise Error(403, "Подписать или вернуть может только назначенный руководитель")
        if row["status"] != "pending":
            raise Error(409, "Пакет не ожидает решения руководителя")
        if action.action == "return":
            if not action.comment.strip():
                raise Error(422, "Укажите причину возврата")
            values.update(status="returned", return_comment=action.comment.strip())
        else:
            signature = (
                (
                    await connection.execute(
                        select(signatures)
                        .where(
                            signatures.c.user_id == user.id,
                        )
                        .with_for_update()
                    )
                )
                .mappings()
                .first()
            )
            if not signature:
                raise Error(409, "Сначала настройте личную подпись руководителя")
            image = await storage.get(signature["storage_key"])
            if hashlib.sha256(image).hexdigest() != signature["sha256"]:
                raise Error(503, "Не удалось проверить сохранённую подпись")  # noqa: RUF001 - intentional Cyrillic document text
            original = await storage.get(row["application_key"])
            if (
                hashlib.sha256(original).hexdigest()
                != row["document_hashes"]["application_normalized"]
            ):
                raise Error(503, "Согласованная ариза повреждена")
            async with PDF_LIMIT:
                packet: dict[str, bytes] = {}
                for name in ("contract", "order"):
                    unsigned = await storage.get(row["preview_keys"][name])
                    if (
                        hashlib.sha256(unsigned).hexdigest()
                        != row["document_hashes"][f"preview_{name}"]
                    ):
                        raise Error(503, "Согласованная версия документа повреждена")
                    packet[name] = await run_in_threadpool(sign_generated, unsigned, image)
                packet["application"] = await run_in_threadpool(
                    place_signature,
                    original,
                    SignatureBox.model_validate(row["application_box"]),
                    image,
                )
            # Publish references only after every document succeeds. Files are never overwritten.
            keys: dict[str, str] = {}
            hashes = dict(row["document_hashes"])
            for name, content in packet.items():
                key = f"hr-hiring/{case_id}/signed/{uuid4()}/{name}.pdf"
                await storage.put(key, content, "application/pdf")
                keys[name], hashes[name] = key, hashlib.sha256(content).hexdigest()
            values.update(
                status="awaiting_employee",
                signed_keys=keys,
                document_hashes=hashes,
                approved_at=datetime.now(UTC),
                return_comment="",
            )
    else:
        await require_hr(connection, user)
        if action.action == "submit":
            if row["status"] not in EDITABLE or not row["application_key"]:
                raise Error(409, "Сохраните черновик и загрузите аризу перед отправкой")
            if row["signer_id"] != settings["chair_user_id"]:
                raise Error(409, "Маршрут изменён. Сохраните черновик с новым руководителем")  # noqa: RUF001 - intentional Cyrillic document text
            box = SignatureBox.model_validate(row["application_box"])
            if box.page > row["application_pages"]:
                raise Error(422, "Выбранной страницы подписи нет в аризе")
            try:
                async with PDF_LIMIT:
                    previews = await run_in_threadpool(
                        documents, HiringFields.model_validate(row["fields"]), row["signer_name"]
                    )
            except ValueError as error:
                raise Error(422, str(error)) from error
            preview_keys: dict[str, str] = {}
            preview_hashes = dict(row["document_hashes"])
            for name, content in previews.items():
                key = f"hr-hiring/{case_id}/preview/{uuid4()}/{name}.pdf"
                await storage.put(key, content, "application/pdf")
                preview_keys[name] = key
                preview_hashes[f"preview_{name}"] = hashlib.sha256(content).hexdigest()
            values.update(
                status="pending",
                return_comment="",
                preview_keys=preview_keys,
                document_hashes=preview_hashes,
            )
        else:
            if row["status"] != "awaiting_employee":
                raise Error(409, "Пакет не ожидает подписи сотрудника")
            if not action.employee_signature_confirmed and not row["employee_scan_key"]:
                raise Error(422, "Подтвердите подпись сотрудника на бумажном договоре")
            values.update(status="completed")
    new = (
        (
            await connection.execute(
                update(cases).where(cases.c.id == case_id).values(**values).returning(cases)
            )
        )
        .mappings()
        .one()
    )
    await connection.execute(
        insert(receipts).values(
            case_id=case_id,
            request_id=action.request_id,
            actor_id=user.id,
            fingerprint=fingerprint,
            created_at=datetime.now(UTC),
        )
    )
    await audit(connection, user, case_id, action.action, new["revision"])
    target = row["signer_id"] if action.action == "submit" else settings["hr_user_id"]
    await connection.execute(
        pg_insert(workspace_notifications)
        .values(
            id=uuid4(),
            user_id=target,
            event_key=f"hr-hiring:{case_id}:{new['revision']}",
            kind="approval",
            priority="normal",
            title="Приём на работу: новый этап",
            body="Откройте HR → Приём на работу, чтобы проверить пакет документов.",
            section="hr",
            entity_id=case_id,
            requires_action=new["status"] != "completed",
            is_reminder=False,
            occurred_at=datetime.now(UTC),
        )
        .on_conflict_do_nothing()
    )
    return detail(new, user, settings)


async def read_document(
    connection: AsyncConnection,
    user: AuthenticatedUser,
    storage: ObjectStorage,
    case_id: UUID,
    kind: str,
) -> tuple[bytes, str]:
    row, _ = await require_case(connection, user, case_id)
    if kind == "packet":
        if not row["signed_keys"]:
            raise Error(409, "Подписанный пакет ещё не готов")
        contents = [(name, await storage.get(key)) for name, key in row["signed_keys"].items()]
        for name, content in contents:
            if hashlib.sha256(content).hexdigest() != row["document_hashes"][name]:
                raise Error(503, "Целостность подписанного пакета не подтверждена")
        if row["employee_scan_key"]:
            contents.append(("employee-scan", await storage.get(row["employee_scan_key"])))
        output = BytesIO()
        with ZipFile(output, "w", ZIP_DEFLATED) as archive:
            for name, content in contents:
                archive.writestr(f"{name}.pdf", content)
        await audit(connection, user, case_id, "packet_read", row["revision"])
        return output.getvalue(), "application/zip"
    if kind in row["signed_keys"]:
        content = await storage.get(row["signed_keys"][kind])
        if hashlib.sha256(content).hexdigest() != row["document_hashes"][kind]:
            raise Error(503, "Целостность подписанного документа не подтверждена")
    elif kind in row["preview_keys"] and row["status"] == "pending":
        content = await storage.get(row["preview_keys"][kind])
    elif kind in {"contract", "order"}:
        try:
            async with PDF_LIMIT:
                content = (
                    await run_in_threadpool(
                        documents, HiringFields.model_validate(row["fields"]), row["signer_name"]
                    )
                )[kind]
        except ValueError as error:
            raise Error(422, str(error)) from error
    elif kind in {"application", "application-placement"}:
        if not row["application_key"]:
            raise Error(404, "Ариза ещё не загружена")
        content = await storage.get(row["application_key"])
        if kind == "application-placement":
            content = await run_in_threadpool(
                place_signature, content, SignatureBox.model_validate(row["application_box"]), None
            )
    elif kind == "employee-scan" and row["employee_scan_key"]:
        content = await storage.get(row["employee_scan_key"])
    else:
        raise Error(404, "Документ не найден")
    await audit(connection, user, case_id, "document_read", row["revision"])
    return content, "application/pdf"
