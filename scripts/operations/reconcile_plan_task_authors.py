"""One-time, guarded reconciliation of imported plan tasks and one actor's approvals.

Run inside the API runtime with its database environment. Dry-run is the default.
The expected counts and database name make an accidental broad update fail closed.
"""

import argparse
import asyncio
from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

from sqlalchemy import insert, select, text, update

from yuksalish_api.database import create_database_engine
from yuksalish_api.efficiency_service import record_task_event
from yuksalish_api.repository import _sync_task_chat, _upsert_notification
from yuksalish_api.settings import Settings
from yuksalish_api.tables import audit_events, task_participants, tasks

AUTHOR_CANDIDATES = text("""
    SELECT t.id AS task_id, t.title, t.description, t.primary_assignee_user_id,
           p.id AS plan_id, p.owner_user_id, t.author_user_id
      FROM tasks t
      JOIN task_plan_links l ON l.task_id = t.id
      JOIN task_plans p ON p.id = l.plan_id
     WHERE p.created_by_user_id = :actor_id
       AND t.author_user_id = p.created_by_user_id
       AND p.owner_user_id IS NOT NULL
       AND p.owner_user_id <> p.created_by_user_id
       AND l.created_at = p.created_at
       AND t.created_at >= p.created_at
       AND t.created_at < p.created_at + interval '10 seconds'
       AND (SELECT count(*) FROM task_plan_links other WHERE other.task_id = t.id) = 1
     ORDER BY p.id, t.id
     FOR UPDATE OF t, p
""")

ACCEPTANCE_CANDIDATES = text("""
    SELECT t.id AS task_id, t.title, t.primary_assignee_user_id, t.due_at,
           t.author_user_id, acceptance.id AS acceptance_id
      FROM tasks t
      JOIN LATERAL (
        SELECT e.id, e.actor_user_id
          FROM task_efficiency_events e
         WHERE e.task_id = t.id AND e.event_type = 'result_accepted'
         ORDER BY e.occurred_at DESC, e.id DESC
         LIMIT 1
      ) acceptance ON true
     WHERE t.status = 'completed'
       AND acceptance.actor_user_id = :actor_id
       AND EXISTS (SELECT 1 FROM task_plan_links l WHERE l.task_id = t.id)
     ORDER BY t.id
     FOR UPDATE OF t
""")


async def reconcile(args: argparse.Namespace) -> None:
    engine = create_database_engine(Settings())
    try:
        async with engine.begin() as connection:
            await connection.execute(text("SET LOCAL lock_timeout = '5s'"))
            database_name = await connection.scalar(text("SELECT current_database()"))
            if database_name != args.database_name:
                raise RuntimeError(f"Expected database {args.database_name}, got {database_name}")
            actor_id = UUID(args.actor_id)
            parameters = {"actor_id": actor_id}
            authors = (await connection.execute(AUTHOR_CANDIDATES, parameters)).mappings().all()
            acceptances = (await connection.execute(
                ACCEPTANCE_CANDIDATES, parameters,
            )).mappings().all()
            if len(authors) != args.expected_authors or len(acceptances) != args.expected_approvals:
                raise RuntimeError(
                    "Candidate count changed: "
                    f"authors={len(authors)} (expected {args.expected_authors}), "
                    f"approvals={len(acceptances)} (expected {args.expected_approvals})"
                )
            print(f"Database: {database_name}")
            print(f"Imported task authors to correct: {len(authors)}")
            print(f"Accepted plan results to reopen: {len(acceptances)}")
            print("Acceptance task IDs:", ", ".join(str(row["task_id"]) for row in acceptances))
            if not args.apply:
                print("Dry run only; no records changed.")
                return

            now = datetime.now(UTC)
            new_authors = {row["task_id"]: row["owner_user_id"] for row in authors}
            for row in authors:
                await connection.execute(update(tasks).where(
                    tasks.c.id == row["task_id"],
                    tasks.c.author_user_id == actor_id,
                ).values(author_user_id=row["owner_user_id"], updated_at=now))
                await _sync_task_chat(
                    connection, task_id=row["task_id"], title=row["title"],
                    description=row["description"], author_user_id=row["owner_user_id"],
                    assignee_user_id=row["primary_assignee_user_id"], occurred_at=now,
                )
                await connection.execute(insert(audit_events).values(
                    id=uuid4(), actor_user_id=actor_id, action="task.plan_author_corrected",
                    target_type="task", target_id=row["task_id"],
                    details={"planId": str(row["plan_id"]),
                             "from": str(row["author_user_id"]),
                             "to": str(row["owner_user_id"])},
                    created_at=now,
                ))

            for index, row in enumerate(acceptances):
                occurred_at = now + timedelta(microseconds=index + 1)
                await connection.execute(update(tasks).where(
                    tasks.c.id == row["task_id"], tasks.c.status == "completed",
                ).values(status="awaiting_review", updated_at=occurred_at))
                author_id = new_authors.get(row["task_id"], row["author_user_id"])
                event_id = await record_task_event(
                    connection, task_id=row["task_id"], event_type="task_status_changed",
                    occurred_at=occurred_at, actor_user_id=actor_id,
                    assignee_user_id=row["primary_assignee_user_id"], due_at=row["due_at"],
                    old_value={"status": "completed"},
                    new_value={"status": "awaiting_review"},
                    metadata={"reason": "plan_result_acceptance_revoked",
                              "acceptanceEventId": str(row["acceptance_id"])},
                )
                await connection.execute(insert(audit_events).values(
                    id=uuid4(), actor_user_id=actor_id,
                    action="task.plan_result_acceptance_revoked",
                    target_type="task", target_id=row["task_id"],
                    details={"acceptanceEventId": str(row["acceptance_id"])},
                    created_at=occurred_at,
                ))
                await _upsert_notification(
                    connection, user_id=author_id,
                    event_key=f"task:plan-review-restored:{event_id}:{author_id}",
                    kind="task", priority="attention", title="Результат снова ожидает проверки",
                    body=row["title"], section="tasks", entity_id=row["task_id"],
                    requires_action=True, occurred_at=occurred_at,
                )
                executor_ids = {row["primary_assignee_user_id"]}
                executor_ids.update((await connection.execute(select(
                    task_participants.c.user_id,
                ).where(
                    task_participants.c.task_id == row["task_id"],
                    task_participants.c.participant_role == "co_assignee",
                ))).scalars())
                for executor_id in executor_ids - {author_id}:
                    await _upsert_notification(
                        connection, user_id=executor_id,
                        event_key=f"task:plan-review-restored:{event_id}:{executor_id}",
                        kind="task", priority="normal",
                        title="Принятие результата отменено",
                        body=row["title"], section="tasks", entity_id=row["task_id"],
                        requires_action=False, occurred_at=occurred_at,
                    )
            print("Applied atomically; transaction will commit.")
    finally:
        await engine.dispose()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--actor-id", required=True, help="Importer and approving user's UUID")
    parser.add_argument("--database-name", required=True)
    parser.add_argument("--expected-authors", required=True, type=int)
    parser.add_argument("--expected-approvals", required=True, type=int)
    parser.add_argument("--apply", action="store_true", help="Commit the guarded correction")
    asyncio.run(reconcile(parser.parse_args()))


if __name__ == "__main__":
    main()
