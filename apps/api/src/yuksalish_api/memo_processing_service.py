# ruff: noqa: RUF001
"""Named HR/accounting actors and mandatory private order, without admin bypass."""

import hashlib
from datetime import UTC, datetime
from io import BytesIO
from pathlib import PurePath
from uuid import UUID

from pypdf import PdfReader
from pypdf.errors import PdfReadError
from sqlalchemy import and_, func, or_, select, update
from sqlalchemy.engine import RowMapping
from sqlalchemy.ext.asyncio import AsyncConnection
from sqlalchemy.sql.elements import ColumnElement
from starlette.concurrency import run_in_threadpool

from .access_control import ensure_module_action, module_permissions_for_user
from .auth import AuthenticatedUser, load_authenticated_user
from .chairman_memo_schemas import MemoDetail, MemoRevision
from .chairman_memo_tables import memoranda as m
from .errors import WorkspaceRepositoryError as Error
from .position_policy import is_executive_leader
from .tables import hr_settings, workspace_notifications

MAX_ORDER_BYTES = 10 * 1024 * 1024


def processing_visible(user: AuthenticatedUser) -> ColumnElement[bool]:
    return or_(
        and_(
            m.c.status.in_(["hr_pending", "accountant_pending", "completed"]),
            m.c.hr_user_id == user.id,
        ),
        and_(
            m.c.status.in_(["accountant_pending", "completed"]), m.c.accountant_user_id == user.id
        ),
    )


async def inbox(c: AsyncConnection, user: AuthenticatedUser) -> int:
    return int(
        await c.scalar(
            select(func.count())
            .select_from(m)
            .where(
                or_(
                    and_(m.c.status == "hr_pending", m.c.hr_user_id == user.id),
                    and_(m.c.status == "accountant_pending", m.c.accountant_user_id == user.id),
                )
            )
        )
        or 0
    )


async def actors(c: AsyncConnection, chair_id: UUID) -> dict[str, object]:
    settings = (
        (await c.execute(select(hr_settings).where(hr_settings.c.id == 1))).mappings().first()
    )
    if settings is None:
        raise Error(409, "Назначьте кадровика и главного бухгалтера в настройках HR")
    result: dict[str, object] = {}
    for field, label in [
        ("hr_user_id", "кадровика"),
        ("accountant_user_id", "главного бухгалтера"),
    ]:
        identifier = settings[field]
        person = await load_authenticated_user(c, identifier) if identifier else None
        if person is None or person.id == chair_id:
            raise Error(409, f"Назначьте действующего {label}, отличного от председателя")
        permissions = (await module_permissions_for_user(c, person))["home"]
        if not permissions["view"] or not permissions["approve"]:
            raise Error(409, f"У {label} нет доступа к обработке билдирги на Главной")
        result[field] = person.id
    if result["hr_user_id"] == result["accountant_user_id"]:
        raise Error(409, "Кадровик и главный бухгалтер должны быть разными сотрудниками")
    return result


async def flags(
    c: AsyncConnection, user: AuthenticatedUser, row: RowMapping, approve: bool
) -> dict[str, object]:
    names: dict[str, str | None] = {}
    for field, result in [("hr_user_id", "hr_name"), ("accountant_user_id", "accountant_name")]:
        person = await load_authenticated_user(c, row[field]) if row[field] else None
        names[result] = person.full_name if person else None
    return {
        **names,
        "can_start_processing": approve
        and row["status"] == "approved"
        and row["chair_user_id"] == user.id
        and is_executive_leader(user.job_title),
        "can_attach_order": approve
        and row["status"] == "hr_pending"
        and row["hr_user_id"] == user.id,
        "can_complete": approve
        and row["status"] == "accountant_pending"
        and row["accountant_user_id"] == user.id
        and bool(row["order_content"]),
        "order_byte_size": len(row["order_content"] or b""),
    }


def validate_order(content: bytes) -> None:
    if not content or len(content) > MAX_ORDER_BYTES or not content.startswith(b"%PDF-"):
        raise Error(422, "Прикрепите приказ в PDF размером до 10 МБ")
    try:
        reader = PdfReader(BytesIO(content), strict=True)
        if reader.is_encrypted or not 1 <= len(reader.pages) <= 100:
            raise Error(422, "Приказ должен быть читаемым PDF без пароля, до 100 страниц")
    except (PdfReadError, ValueError, TypeError, KeyError, RecursionError) as problem:
        raise Error(422, "Не удалось прочитать PDF приказа") from problem


async def attach_order(
    c: AsyncConnection,
    user: AuthenticatedUser,
    identifier: UUID,
    value: MemoRevision,
    filename: str,
    content: bytes,
    requesters: frozenset[UUID],
) -> MemoDetail:
    from .chairman_memo_service import audit, check_revision, detail, row

    await ensure_module_action(c, user, "home", "approve")
    record = await row(c, user, identifier, lock=True)
    check_revision(record, value)
    if record["status"] != "hr_pending" or record["hr_user_id"] != user.id:
        raise Error(403, "Приказ прикрепляет только назначенный кадровик на своём этапе")
    name = PurePath(filename.replace("\\", "/")).name
    if not name.casefold().endswith(".pdf") or len(name) > 240 or any(ord(x) < 32 for x in name):
        raise Error(422, "Укажите имя PDF приказа до 240 знаков")
    await run_in_threadpool(validate_order, content)
    revision = record["revision"] + 1
    digest = hashlib.sha256(content).hexdigest()
    await c.execute(
        update(m)
        .where(m.c.id == identifier)
        .values(
            order_file_name=name,
            order_content=content,
            order_sha256=digest,
            revision=revision,
            updated_at=datetime.now(UTC),
        )
    )
    await audit(
        c,
        user.id,
        identifier,
        "order_attached",
        revision,
        record["pdf_sha256"],
        from_status=record["status"],
        to_status=record["status"],
        order_hash=digest,
    )
    return await detail(c, user, identifier, requesters)


async def process(
    c: AsyncConnection,
    user: AuthenticatedUser,
    record: RowMapping,
    action: str,
    requesters: frozenset[UUID],
) -> MemoDetail:
    from .chairman_memo_service import audit, detail, notify

    await ensure_module_action(c, user, "home", "approve")
    now, revision = datetime.now(UTC), record["revision"] + 1
    values: dict[str, object] = {"revision": revision, "updated_at": now}
    if action == "start_processing":
        if (
            record["status"] != "approved"
            or record["chair_user_id"] != user.id
            or not is_executive_leader(user.job_title)
        ):
            raise Error(403, "Продолжить оформление может назначенный председатель после одобрения")
        values.update(await actors(c, user.id))
        values["status"] = "hr_pending"
        target, title = values["hr_user_id"], "Билдирги: подготовьте и прикрепите приказ"
    elif action == "hr_complete":
        if record["status"] != "hr_pending" or record["hr_user_id"] != user.id:
            raise Error(403, "Передать приказ может только назначенный кадровик")
        if not record["order_content"]:
            raise Error(422, "Сначала прикрепите приказ в PDF")
        accountant = await load_authenticated_user(c, record["accountant_user_id"])
        if (
            accountant is None
            or not (await module_permissions_for_user(c, accountant))["home"]["approve"]
        ):
            raise Error(409, "Назначенный главный бухгалтер недоступен. Передача остановлена")
        values.update(status="accountant_pending", hr_completed_at=now)
        target, title = accountant.id, "Билдирги: приказ передан главному бухгалтеру"
    elif action == "complete":
        if record["status"] != "accountant_pending" or record["accountant_user_id"] != user.id:
            raise Error(403, "Отметить выполнение может только назначенный главный бухгалтер")
        if not record["order_content"]:
            raise Error(409, "Приказ отсутствует. Завершение невозможно")
        values.update(status="completed", completed_at=now)
        target, title = record["requester_user_id"], "Ваша билдирги выполнена"
    else:
        raise Error(422, "Неизвестное действие по билдирги")
    await c.execute(
        update(workspace_notifications)
        .where(
            workspace_notifications.c.entity_id == record["id"],
            workspace_notifications.c.event_key.like("chairman-memo:%"),
            workspace_notifications.c.requires_action.is_(True),
            workspace_notifications.c.resolved_at.is_(None),
        )
        .values(resolved_at=now)
    )
    await c.execute(update(m).where(m.c.id == record["id"]).values(**values))
    if not isinstance(target, UUID):
        raise Error(409, "Исполнитель следующего этапа не назначен")
    await notify(
        c,
        record,
        target,
        title,
        action=action != "complete",
        status=str(values["status"]),
        revision=revision,
    )
    if action != "complete" and target != record["requester_user_id"]:
        await notify(
            c,
            record,
            record["requester_user_id"],
            title,
            action=False,
            status=str(values["status"]),
            revision=revision,
        )
    await audit(
        c,
        user.id,
        record["id"],
        action,
        revision,
        record["pdf_sha256"],
        from_status=record["status"],
        to_status=str(values["status"]),
        order_hash=record["order_sha256"],
    )
    return await detail(c, user, record["id"], requesters)
