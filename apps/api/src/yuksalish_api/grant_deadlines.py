"""Deadline changes operate under the parent grant's revision and row lock."""

from datetime import UTC, datetime
from uuid import UUID, uuid4

from sqlalchemy import insert, select, update
from sqlalchemy.engine import RowMapping
from sqlalchemy.ext.asyncio import AsyncConnection

from .auth import AuthenticatedUser
from .errors import WorkspaceRepositoryError
from .grant_schemas import GrantAction, GrantDeadlineRequest
from .grant_tables import grant_deadline_requests as requests

ACTIONS = {"extend_deadline", "request_deadline", "approve_deadline", "reject_deadline"}


def actions(row: RowMapping, user: AuthenticatedUser, pending: RowMapping | None) -> list[str]:
    if row["status"] in {"completed", "launch_rejected"}:
        return []
    result = []
    if user.id in {row["author_user_id"], row["initiator_user_id"]}:
        result.append("extend_deadline")
        if pending is not None:
            result.extend(["approve_deadline", "reject_deadline"])
    if pending is None and (
        user.id == row["assignee_id"] or str(user.id) in row["co_assignee_ids"]
    ):
        result.append("request_deadline")
    return result


def response(row: RowMapping) -> GrantDeadlineRequest:
    return GrantDeadlineRequest(
        id=str(row["id"]), requested_by_user_id=str(row["requested_by_user_id"]),
        old_due_at=row["old_due_at"], due_at=row["due_at"], reason=row["reason"],
        status=row["status"],
        decided_by_user_id=str(row["decided_by_user_id"]) if row["decided_by_user_id"] else None,
        decision_reason=row["decision_reason"], created_at=row["created_at"],
        decided_at=row["decided_at"],
    )


async def pending(connection: AsyncConnection, grant_id: UUID) -> RowMapping | None:
    return (await connection.execute(select(requests).where(
        requests.c.grant_id == grant_id, requests.c.status == "pending",
    ))).mappings().first()


async def supersede(
    connection: AsyncConnection, grant_id: UUID, user_id: UUID, reason: str,
) -> None:
    await connection.execute(update(requests).where(
        requests.c.grant_id == grant_id, requests.c.status == "pending",
    ).values(status="superseded", decided_by_user_id=user_id,
             decision_reason=reason, decided_at=datetime.now(UTC)))


def validate_extension(value: datetime | None, current: datetime) -> datetime:
    if value is None or value <= datetime.now(UTC) or value <= current:
        raise WorkspaceRepositoryError(422, "Новый срок должен быть будущим и позже текущего")
    return value


async def apply(
    connection: AsyncConnection, row: RowMapping, user: AuthenticatedUser,
    payload: GrantAction, current: RowMapping | None,
) -> tuple[datetime, datetime]:
    """Return exact old/proposed dates; only extend/approve apply the second date."""
    text = payload.text.strip()
    if (
        payload.action in {"extend_deadline", "request_deadline", "reject_deadline"}
        and len(text) < 3
    ):
        raise WorkspaceRepositoryError(422, "Укажите причину от 3 символов")
    if payload.action in {"extend_deadline", "request_deadline"}:
        due_at = validate_extension(payload.due_at, row["due_at"])
        if payload.action == "request_deadline":
            if current is not None:
                raise WorkspaceRepositoryError(409, "Запрос на продление уже ожидает решения")
            await connection.execute(insert(requests).values(
                id=uuid4(), grant_id=row["id"], requested_by_user_id=user.id,
                old_due_at=row["due_at"], due_at=due_at, reason=text, status="pending",
                decision_reason="", created_at=datetime.now(UTC),
            ))
        else:
            await supersede(connection, row["id"], user.id, "Срок изменён напрямую: " + text)
        return row["due_at"], due_at
    if current is None or payload.request_id != current["id"]:
        raise WorkspaceRepositoryError(409, "Запрос уже рассмотрен или больше не актуален")
    if current["old_due_at"] != row["due_at"]:
        raise WorkspaceRepositoryError(409, "Срок изменился после запроса. Обновите карточку")
    if payload.action == "approve_deadline":
        validate_extension(current["due_at"], row["due_at"])
    await connection.execute(update(requests).where(requests.c.id == current["id"]).values(
        status="approved" if payload.action == "approve_deadline" else "rejected",
        decided_by_user_id=user.id, decision_reason=text, decided_at=datetime.now(UTC),
    ))
    return current["old_due_at"], current["due_at"]
