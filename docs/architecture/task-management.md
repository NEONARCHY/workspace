# Task management

**Status:** implemented in alpha 0.6.0 (BP-5 functional slice)

## Product flow

A task is a persistent PostgreSQL object with an author, primary assignee, project,
priority, deadline and lifecycle status. The desktop client presents the same data as
an operational list or a Kanban board. Dropping a card into a column uses the normal
status API, so server-side access checks and dependency rules cannot be bypassed by
the UI.

Each task card contains:

- a primary assignee plus `co_assignee` and `observer` participants;
- an ordered checklist with completion actor and time;
- append-only comments;
- private attachments through the shared MinIO/PostgreSQL attachment model;
- blocking or informational links to other visible tasks;
- an optional daily, weekly or monthly recurrence definition.

## Access rules

- Managers and administrators can read and edit all tasks.
- The author and primary assignee can read and edit their task.
- A co-assignee can read and work on the card, checklist, files and status.
- An observer can read the card, download its files and add comments, but cannot
  change execution data.
- Only the author, manager or administrator can change the participant list.
- Assigning a participant as the new primary assignee removes the duplicate
  participant record.

Task existence is hidden with `404` from users who have no access. A known but
forbidden mutation returns `403`.

## Integrity rules

Blocking dependencies form a directed acyclic graph. The API rejects self-links and
any edge that would create a blocking cycle. A task cannot enter `completed` while an
incomplete blocking dependency exists. Informational `relates` links do not block
completion.

The recurrence scheduler locks due rows with `FOR UPDATE SKIP LOCKED`. Every generated
task has a unique `(cycle_id, cycle_occurrence_key)`, making concurrent or repeated
scheduler runs idempotent. A new occurrence copies the current card description,
assignee, project, priority, participants and checklist titles; completion state,
comments, files and cross-workflow links start clean.

## API surface

- `POST /api/v1/tasks`
- `PATCH /api/v1/tasks/{task_id}`
- `PATCH /api/v1/tasks/{task_id}/status`
- `PUT|DELETE /api/v1/tasks/{task_id}/participants[...]`
- `POST|PATCH|DELETE /api/v1/tasks/{task_id}/checklist[...]`
- `POST /api/v1/tasks/{task_id}/comments`
- `PUT|DELETE /api/v1/tasks/{task_id}/dependencies[...]`
- `PUT /api/v1/tasks/{task_id}/cycle`
- `PUT /api/v1/attachments/task/{task_id}`

## Deliberate follow-ups

Calendar presentation, subtasks, automatic task chats, author-only result acceptance
and management workload dashboards are separate increments. Exact Bitrix behavioural
characterisation also remains evidence-dependent: representative production tasks
must be selected and inspected safely before claiming one-to-one parity for details
that were not exposed by the existing read-only baseline.
