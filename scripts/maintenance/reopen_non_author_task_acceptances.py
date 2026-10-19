"""Reopen completed tasks whose last acceptance was not made by their author.

Run dry-run first. Apply only with the exact candidate count and ID digest returned
by that dry-run, after backing up the database. Original events remain immutable.
"""

import argparse
import asyncio
import hashlib
import os
from collections.abc import Mapping, Sequence
from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from sqlalchemy import text, update
from sqlalchemy.ext.asyncio import AsyncConnection, create_async_engine

from yuksalish_api.efficiency_service import record_task_event
from yuksalish_api.repository import _upsert_notification
from yuksalish_api.tables import tasks

_CANDIDATES_SQL = """
SELECT t.id, t.title, t.author_user_id, t.primary_assignee_user_id, t.due_at,
       accepted.id AS acceptance_event_id, accepted.actor_user_id AS accepted_by_user_id
FROM tasks AS t
JOIN LATERAL (
    SELECT e.id, e.actor_user_id, e.occurred_at
    FROM task_efficiency_events AS e
    WHERE e.task_id = t.id AND e.event_type = 'result_accepted'
    ORDER BY e.occurred_at DESC, e.created_at DESC, e.id DESC
    LIMIT 1
) AS accepted ON true
WHERE t.status = 'completed'
  AND accepted.actor_user_id <> t.author_user_id
  AND length(trim(t.result_text)) > 0
  AND EXISTS (
      SELECT 1 FROM task_efficiency_events AS submitted
      WHERE submitted.task_id = t.id
        AND submitted.event_type = 'result_submitted_for_review'
        AND submitted.occurred_at <= accepted.occurred_at
  )
  AND EXISTS (
      SELECT 1 FROM task_efficiency_events AS closed
      WHERE closed.task_id = t.id
        AND closed.event_type = 'task_completed'
        AND closed.actor_user_id = accepted.actor_user_id
        AND closed.occurred_at = accepted.occurred_at
  )
ORDER BY t.id
"""


def _digest(ids: list[UUID]) -> str:
    return hashlib.sha256("\n".join(sorted(str(value) for value in ids)).encode()).hexdigest()


async def find_candidates(
    connection: AsyncConnection, *, lock: bool = False,
) -> Sequence[Mapping[str, Any]]:
    query = _CANDIDATES_SQL + (" FOR UPDATE OF t" if lock else "")
    return (await connection.execute(text(query))).mappings().all()


async def reopen_candidates(
    connection: AsyncConnection, candidates: Sequence[Mapping[str, Any]],
) -> None:
    now = datetime.now(UTC)
    for row in candidates:
        updated = await connection.execute(
            update(tasks)
            .where(tasks.c.id == row["id"], tasks.c.status == "completed")
            .values(status="awaiting_review", updated_at=now)
        )
        if updated.rowcount != 1:
            raise RuntimeError(f"Task changed during correction: {row['id']}")
        await record_task_event(
            connection,
            task_id=row["id"],
            event_type="task_status_changed",
            occurred_at=now,
            actor_user_id=None,
            assignee_user_id=row["primary_assignee_user_id"],
            due_at=row["due_at"],
            old_value={"status": "completed"},
            new_value={"status": "awaiting_review"},
            reason_code="author_review_required",
            reason_text="Результат утверждён не постановщиком. Возвращено на проверку.",
            metadata={"supersededAcceptanceEventId": str(row["acceptance_event_id"])},
        )
        await _upsert_notification(
            connection,
            user_id=row["author_user_id"],
            event_key=f"task:review:pending:{row['id']}:{now.isoformat()}",
            kind="task",
            priority="attention",
            title="Результат ожидает вашей проверки",
            body=row["title"],
            section="tasks",
            entity_id=row["id"],
            requires_action=True,
            occurred_at=now,
        )


async def run(*, apply: bool, expected_count: int | None, expected_digest: str | None) -> None:
    database_url = os.environ.get("YUKSALISH_DATABASE_URL")
    if not database_url:
        raise SystemExit("YUKSALISH_DATABASE_URL is required")
    engine = create_async_engine(database_url, pool_pre_ping=True)
    try:
        async with engine.begin() as connection:
            candidates = await find_candidates(connection, lock=apply)
            digest = _digest([row["id"] for row in candidates])
            print(f"Candidates: {len(candidates)}; ID SHA-256: {digest}")
            for row in candidates:
                print(f"{row['id']} | {row['title']}")
            if not apply:
                return
            if expected_count is None or expected_digest is None:
                raise SystemExit("Apply requires --expected-count and --expected-id-sha256")
            if len(candidates) != expected_count or digest != expected_digest:
                raise SystemExit("Candidate set changed; no task was reopened")

            await reopen_candidates(connection, candidates)
            print(f"Reopened {len(candidates)} tasks for their authors' review")
    finally:
        await engine.dispose()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--expected-count", type=int)
    parser.add_argument("--expected-id-sha256")
    args = parser.parse_args()
    asyncio.run(run(
        apply=args.apply,
        expected_count=args.expected_count,
        expected_digest=args.expected_id_sha256,
    ))
