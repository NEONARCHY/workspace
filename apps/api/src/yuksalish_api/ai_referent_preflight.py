"""Content-bound, read-only Word preflight on the assigned referent computer."""

from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

from fastapi import HTTPException
from sqlalchemy import select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.engine import RowMapping
from sqlalchemy.ext.asyncio import AsyncConnection

from .ai_referent_schemas import AIReferentDocumentCheck
from .tables import (
    ai_referent_configuration as configuration,
)
from .tables import (
    ai_referent_delivery_commands as commands,
)
from .tables import (
    ai_referent_document_checks as checks,
)
from .tables import (
    ai_referent_reviewers as reviewers,
)
from .tables import (
    attachments,
    users,
)

FAILURE = (
    "Проверка безопасного размещения подписи не пройдена. "
    "Обратитесь к IT-специалисту и загрузите исправленный DOCX."
)


def check_response(row: RowMapping) -> AIReferentDocumentCheck:
    return AIReferentDocumentCheck(
        id=str(row["id"]),
        status=row["status"],
        reviewer_keys=row["reviewer_keys"],
        detail=row["detail"],
    )


async def ensure_check(
    connection: AsyncConnection,
    user_id: UUID,
    sha256: str,
    workflow_kind: str,
    file_name: str,
    storage_key: str,
    *,
    restart_failed: bool = False,
) -> RowMapping:
    revision = await connection.scalar(select(configuration.c.revision))
    now = datetime.now(UTC)
    await connection.execute(
        insert(checks)
        .values(
            id=uuid4(),
            user_id=user_id,
            sha256=sha256,
            workflow_kind=workflow_kind,
            configuration_revision=revision or 1,
            file_name=file_name,
            storage_key=storage_key,
            status="pending",
            reviewer_keys=[],
            detail="",
            attempt_count=0,
            created_at=now,
            updated_at=now,
        )
        .on_conflict_do_nothing(constraint="uq_ai_document_check")
    )
    result = (
        (
            await connection.execute(
                select(checks).where(
                    checks.c.user_id == user_id,
                    checks.c.sha256 == sha256,
                    checks.c.workflow_kind == workflow_kind,
                    checks.c.configuration_revision == (revision or 1),
                )
            )
        )
        .mappings()
        .one()
    )
    if restart_failed and result["status"] == "failed":
        return (
            (
                await connection.execute(
                    update(checks)
                    .where(checks.c.id == result["id"])
                    .values(
                        status="pending",
                        detail="",
                        updated_at=now,
                    )
                    .returning(checks)
                )
            )
            .mappings()
            .one()
        )
    return result


async def letter_check(connection: AsyncConnection, row: RowMapping) -> RowMapping | None:
    revision = await connection.scalar(select(configuration.c.revision))
    found = (
        (
            await connection.execute(
                select(checks)
                .join(
                    attachments,
                    (attachments.c.sha256 == checks.c.sha256)
                    & (attachments.c.uploaded_by_user_id == checks.c.user_id),
                )
                .where(
                    attachments.c.owner_type == "ai_referent_letter",
                    attachments.c.owner_id == row["id"],
                    attachments.c.document_role == "primary",
                    checks.c.workflow_kind == row["workflow_kind"],
                    checks.c.configuration_revision == (revision or 1),
                )
                .order_by(checks.c.created_at.desc())
                .limit(1)
            )
        )
        .mappings()
        .first()
    )
    if found is not None or row["status"] not in {"draft", "needs_revision"}:
        return found
    primary = (
        (
            await connection.execute(
                select(attachments)
                .where(
                    attachments.c.owner_type == "ai_referent_letter",
                    attachments.c.owner_id == row["id"],
                    attachments.c.document_role == "primary",
                    attachments.c.file_name.ilike("%.docx"),
                )
                .limit(1)
            )
        )
        .mappings()
        .first()
    )
    if primary is None:
        return None
    return await ensure_check(
        connection,
        primary["uploaded_by_user_id"],
        primary["sha256"],
        row["workflow_kind"],
        primary["file_name"],
        primary["storage_key"],
    )


async def require_passed(connection: AsyncConnection, row: RowMapping) -> None:
    check = await letter_check(connection, row)
    if not check or check["status"] in {"pending", "checking"}:
        raise HTTPException(409, "Дождитесь проверки DOCX роботом на ПК референта.")
    if check["status"] != "passed":
        raise HTTPException(422, FAILURE)
    signer = row.get("final_reviewer_key") or row["reviewer_key"]
    if signer not in check["reviewer_keys"]:
        raise HTTPException(
            422,
            "Документ DOCX не содержит безопасного места для подписи выбранного руководителя. "
            "Обратитесь к IT-специалисту.",
        )


async def claim_check(connection: AsyncConnection, agent_id: str) -> RowMapping | None:
    config = (await connection.execute(select(configuration).with_for_update())).mappings().one()
    if config["execution_agent_id"] != agent_id:
        raise HTTPException(409, "Проверка доступна только назначенному ПК референта.")
    now = datetime.now(UTC)
    await connection.execute(
        update(checks)
        .where(
            checks.c.status == "checking",
            checks.c.lease_until < now,
        )
        .values(
            status="failed",
            detail="Робот не закончил проверку. Повторите её или обратитесь в IT.",
            updated_at=now,
        )
    )
    if await connection.scalar(
        select(commands.c.id)
        .where(
            commands.c.status == "claimed",
            commands.c.lease_until > now,
        )
        .limit(1)
    ) or await connection.scalar(
        select(checks.c.id)
        .where(
            checks.c.status == "checking",
        )
        .limit(1)
    ):
        return None
    row = (
        (
            await connection.execute(
                select(checks)
                .where(
                    checks.c.status == "pending",
                    checks.c.configuration_revision == config["revision"],
                )
                .order_by(checks.c.created_at)
                .limit(1)
                .with_for_update(skip_locked=True)
            )
        )
        .mappings()
        .first()
    )
    if row is None:
        return None
    return (
        (
            await connection.execute(
                update(checks)
                .where(checks.c.id == row["id"])
                .values(
                    status="checking",
                    claimed_by=agent_id,
                    lease_token=uuid4(),
                    lease_until=now + timedelta(minutes=3),
                    attempt_count=row["attempt_count"] + 1,
                    updated_at=now,
                )
                .returning(checks)
            )
        )
        .mappings()
        .one()
    )


async def checked_lease(
    connection: AsyncConnection,
    check_id: UUID,
    agent_id: str,
    lease: UUID,
) -> RowMapping:
    row = (
        (
            await connection.execute(
                select(checks)
                .where(
                    checks.c.id == check_id,
                    checks.c.claimed_by == agent_id,
                    checks.c.lease_token == lease,
                    checks.c.lease_until > datetime.now(UTC),
                    checks.c.status == "checking",
                )
                .with_for_update()
            )
        )
        .mappings()
        .first()
    )
    if row is None:
        raise HTTPException(409, "Проверка больше не принадлежит этому агенту.")
    return row


async def reviewer_names(connection: AsyncConnection) -> list[dict[str, str]]:
    rows = (
        (
            await connection.execute(
                select(reviewers.c.key, users.c.full_name)
                .join(
                    users,
                    users.c.id == reviewers.c.user_id,
                )
                .where(reviewers.c.enabled.is_(True), users.c.status == "active")
            )
        )
        .mappings()
        .all()
    )
    return [{"key": row["key"], "name": row["full_name"]} for row in rows]


async def finish_check(
    connection: AsyncConnection,
    check_id: UUID,
    agent_id: str,
    lease: UUID,
    passed_keys: list[str],
) -> None:
    # A lost response can be retried with the same fenced result.
    row = (
        (await connection.execute(select(checks).where(checks.c.id == check_id))).mappings().first()
    )
    keys = sorted(set(passed_keys))
    if (
        row
        and row["lease_token"] == lease
        and row["claimed_by"] == agent_id
        and (row["status"] in {"passed", "failed"} and row["reviewer_keys"] == keys)
    ):
        return
    await checked_lease(connection, check_id, agent_id, lease)
    allowed = {item["key"] for item in await reviewer_names(connection)}
    if not set(keys) <= allowed:
        raise HTTPException(422, "Неизвестная подпись в результате проверки.")
    await connection.execute(
        update(checks)
        .where(checks.c.id == check_id)
        .values(
            status="passed" if keys else "failed",
            reviewer_keys=keys,
            detail="" if keys else FAILURE,
            updated_at=datetime.now(UTC),
        )
    )
