"""Owner-only survey storage; module administrators cannot read other authors' answers."""

import asyncio
import hashlib
import json
from datetime import UTC, datetime
from typing import Literal
from uuid import UUID, uuid4

from sqlalchemy import func, insert, select, update
from sqlalchemy.engine import RowMapping
from sqlalchemy.ext.asyncio import AsyncConnection
from starlette.concurrency import run_in_threadpool

from .access_control import ensure_module_action
from .auth import AuthenticatedUser
from .errors import WorkspaceRepositoryError
from .object_storage import ObjectStorage
from .survey_documents import parse_workbook
from .survey_schemas import (
    SurveyAnalysis,
    SurveyConfiguration,
    SurveyDetail,
    SurveyUpdate,
    SurveyWorkbook,
)
from .tables import audit_events, survey_analyses, users

SURVEY_PARSE_LIMIT = asyncio.Semaphore(2)


def analysis_response(row: RowMapping) -> SurveyAnalysis:
    return SurveyAnalysis(
        id=str(row["id"]), title=row["title"], file_name=row["file_name"],
        revision=row["revision"], archived=row["archived"], created_at=row["created_at"],
        updated_at=row["updated_at"],
        configuration=SurveyConfiguration.model_validate(row["configuration"]),
    )


async def require_analysis(
    connection: AsyncConnection, user: AuthenticatedUser, analysis_id: UUID, *, lock: bool = False,
) -> RowMapping:
    await ensure_module_action(connection, user, "survey_analytics", "view")
    query = select(survey_analyses).where(
        survey_analyses.c.id == analysis_id, survey_analyses.c.owner_user_id == user.id,
    )
    if lock:
        query = query.with_for_update()
    row = (await connection.execute(query)).mappings().one_or_none()
    if row is None:
        raise WorkspaceRepositoryError(404, "Анализ не найден или недоступен.")
    return row


async def list_analyses(
    connection: AsyncConnection, user: AuthenticatedUser,
) -> list[SurveyAnalysis]:
    await ensure_module_action(connection, user, "survey_analytics", "view")
    rows = (await connection.execute(select(survey_analyses).where(
        survey_analyses.c.owner_user_id == user.id,
    ).order_by(survey_analyses.c.updated_at.desc()))).mappings().all()
    return [analysis_response(row) for row in rows]


async def read_workbook(row: RowMapping, storage: ObjectStorage) -> SurveyWorkbook:
    return SurveyWorkbook.model_validate_json(await storage.get(row["parsed_key"]))


async def audit(
    connection: AsyncConnection, user: AuthenticatedUser, analysis_id: UUID, action: str,
) -> None:
    # Only record identifiers/actions, never filenames, answers, filters or search terms.
    await connection.execute(insert(audit_events).values(
        id=uuid4(), actor_user_id=user.id, action=f"survey.{action}",
        target_type="survey_analysis", target_id=analysis_id, details={},
        created_at=datetime.now(UTC),
    ))


async def create_analysis(
    connection: AsyncConnection, user: AuthenticatedUser, storage: ObjectStorage,
    request_id: UUID, filename: str, content: bytes,
    encoding: Literal["utf-8-sig", "cp1251"], delimiter: Literal[",", ";", "\t"],
) -> SurveyDetail:
    await ensure_module_action(connection, user, "survey_analytics", "view")
    await ensure_module_action(connection, user, "survey_analytics", "create")
    # Serialize imports by owner: bounded count and concurrent idempotency are atomic.
    await connection.execute(select(users.c.id).where(users.c.id == user.id).with_for_update())
    digest = hashlib.sha256(content + json.dumps(
        [filename, encoding, delimiter], ensure_ascii=False,
    ).encode()).hexdigest()
    existing = (await connection.execute(select(survey_analyses).where(
        survey_analyses.c.owner_user_id == user.id, survey_analyses.c.request_id == request_id,
    ))).mappings().one_or_none()
    if existing is not None:
        if existing["content_hash"] != digest:
            raise WorkspaceRepositoryError(409, "Этот запрос уже использован для другого файла.")
        return SurveyDetail(analysis=analysis_response(existing),
                            workbook=await read_workbook(existing, storage))
    count = await connection.scalar(select(func.count()).select_from(survey_analyses).where(
        survey_analyses.c.owner_user_id == user.id,
    ))
    if count is not None and count >= 50:
        raise WorkspaceRepositoryError(409, "Достигнут предел 50 личных анализов, включая архив.")
    try:
        async with SURVEY_PARSE_LIMIT:
            workbook = await run_in_threadpool(
                parse_workbook, filename, content, encoding=encoding, delimiter=delimiter,
            )
    except ValueError as error:
        raise WorkspaceRepositoryError(422, str(error)) from error
    analysis_id = uuid4()
    prefix = f"surveys/{user.id}/{analysis_id}"
    await storage.put(f"{prefix}/original", content, "application/octet-stream")
    await storage.put(f"{prefix}/parsed", workbook.model_dump_json(by_alias=True).encode(),
                      "application/json")
    now = datetime.now(UTC)
    row = (await connection.execute(insert(survey_analyses).values(
        id=analysis_id, owner_user_id=user.id, request_id=request_id, content_hash=digest,
        title=filename, file_name=filename, original_key=f"{prefix}/original",
        parsed_key=f"{prefix}/parsed", revision=1, archived=False,
        configuration=SurveyConfiguration().model_dump(mode="json", by_alias=True),
        created_at=now, updated_at=now,
    ).returning(survey_analyses))).mappings().one()
    await audit(connection, user, analysis_id, "created")
    return SurveyDetail(analysis=analysis_response(row), workbook=workbook)


def validate_configuration(config: SurveyConfiguration, workbook: SurveyWorkbook) -> None:
    if config.sheet >= len(workbook.sheets):
        raise WorkspaceRepositoryError(422, "Выберите существующий лист.")
    rows = workbook.sheets[config.sheet].rows
    if config.header_row >= len(rows):
        raise WorkspaceRepositoryError(422, "Укажите существующую строку заголовков.")
    width = max((len(row) for row in rows[config.header_row:]), default=0)
    columns = [item.column for item in config.filters]
    columns += [item.column for view in config.saved_views for item in view.filters]
    if (any(len(key) > 3 or not key.isascii() or not key.isdecimal() or int(key) >= width
            for key in config.types)
            or any(column >= width for column in columns)
            or len(config.model_dump_json()) > 64_000
            or any(len(value) > 200 for value in config.missing_values)):
        raise WorkspaceRepositoryError(422, "Некорректная или слишком большая настройка анализа.")


async def save_analysis(
    connection: AsyncConnection, user: AuthenticatedUser, analysis_id: UUID,
    payload: SurveyUpdate, storage: ObjectStorage,
) -> SurveyAnalysis:
    await ensure_module_action(connection, user, "survey_analytics", "edit")
    row = await require_analysis(connection, user, analysis_id, lock=True)
    if row["revision"] != payload.expected_revision:
        raise WorkspaceRepositoryError(409, "Анализ изменён. Откройте актуальную версию повторно.")
    validate_configuration(payload.configuration, await read_workbook(row, storage))
    if not payload.title.strip():
        raise WorkspaceRepositoryError(422, "Название не должно быть пустым.")
    result = (await connection.execute(update(survey_analyses).where(
        survey_analyses.c.id == analysis_id,
    ).values(title=payload.title.strip(), archived=payload.archived,
             configuration=payload.configuration.model_dump(mode="json", by_alias=True),
             revision=row["revision"] + 1, updated_at=datetime.now(UTC))
        .returning(survey_analyses))).mappings().one()
    await audit(connection, user, analysis_id, "saved")
    return analysis_response(result)
