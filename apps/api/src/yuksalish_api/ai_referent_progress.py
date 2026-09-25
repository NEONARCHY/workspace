"""A status-only view of other employees' letters for AI Referent operators."""

from datetime import datetime
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import and_, select
from sqlalchemy.engine import RowMapping
from sqlalchemy.ext.asyncio import AsyncConnection
from sqlalchemy.sql import Select

from .access_control import ensure_module_action, module_permissions_for_user
from .ai_referent_schemas import AIReferentProgressItem, AIReferentProgressResponse
from .ai_referent_visibility import OPERATOR_VISIBLE_STATUSES, PROGRESS_ONLY_STATUSES
from .auth import AuthenticatedUser
from .tables import ai_referent_letters, users


def _progress_item(row: RowMapping) -> AIReferentProgressItem:
    number = row["outgoing_number"]
    suffix = row["year_suffix"]
    return AIReferentProgressItem(
        id=str(row["id"]),
        display_number=f"{int(number):04d}/{suffix}-AI" if number is not None and suffix else None,
        created_by_name=row["created_by_name"],
        status=row["status"],
        created_at=row["created_at"],
    )


async def _require_operator(connection: AsyncConnection, user: AuthenticatedUser) -> bool:
    await ensure_module_action(connection, user, "ai_referent", "view")
    permissions = await module_permissions_for_user(connection, user)
    return bool(permissions.get("ai_referent", {}).get("admin", False))


def _statement() -> Select[tuple[UUID, str, int | None, str | None, datetime, str]]:
    creator = users.alias("progress_creator")
    return select(
        ai_referent_letters.c.id,
        ai_referent_letters.c.status,
        ai_referent_letters.c.outgoing_number,
        ai_referent_letters.c.year_suffix,
        ai_referent_letters.c.created_at,
        creator.c.full_name.label("created_by_name"),
    ).select_from(
        ai_referent_letters.join(
            creator, creator.c.id == ai_referent_letters.c.created_by_user_id
        )
    )


async def list_other_letter_progress(
    connection: AsyncConnection,
    user: AuthenticatedUser,
    *,
    offset: int = 0,
    limit: int = 10,
) -> AIReferentProgressResponse:
    if not await _require_operator(connection, user):
        return AIReferentProgressResponse()
    statement = (
        _statement()
        .where(
            ai_referent_letters.c.status.in_(PROGRESS_ONLY_STATUSES),
            and_(
                ai_referent_letters.c.created_by_user_id.is_distinct_from(user.id),
                ai_referent_letters.c.reviewer_user_id.is_distinct_from(user.id),
                ai_referent_letters.c.initial_reviewer_user_id.is_distinct_from(user.id),
                ai_referent_letters.c.final_reviewer_user_id.is_distinct_from(user.id),
            ),
        )
        .order_by(ai_referent_letters.c.updated_at.desc(), ai_referent_letters.c.id)
        .offset(offset)
        .limit(limit)
    )
    rows = (await connection.execute(statement)).mappings().all()
    return AIReferentProgressResponse(letters=[_progress_item(row) for row in rows])


async def load_letter_progress(
    connection: AsyncConnection, user: AuthenticatedUser, letter_id: UUID
) -> AIReferentProgressItem:
    if not await _require_operator(connection, user):
        raise HTTPException(404, "Этап письма не найден.")
    statement = _statement().where(
        ai_referent_letters.c.id == letter_id,
        ai_referent_letters.c.status.in_(PROGRESS_ONLY_STATUSES | OPERATOR_VISIBLE_STATUSES),
    )
    row = (await connection.execute(statement)).mappings().one_or_none()
    if row is None:
        raise HTTPException(404, "Этап письма не найден.")
    return _progress_item(row)
