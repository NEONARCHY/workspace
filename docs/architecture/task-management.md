# Task management

**Status:** implemented through desktop 0.22.0 / API 0.18.0

## Product flow

A task is a persistent PostgreSQL object with an author, primary assignee, project,
priority, deadline and lifecycle status. The desktop client presents one filtered
dataset as a table, a Kanban board or a monthly task calendar. Selecting a task in
any view opens the same full card; changing a Kanban column uses the normal status
API, so server-side access and dependency rules cannot be bypassed by the UI.

The calendar shows tasks on their local due date, preserves the active state/role
filters and text search, and keeps tasks without a deadline in a separate visible
queue. Month navigation never changes task data.

Each task card contains:

- a primary assignee plus `co_assignee` and `observer` participants;
- an ordered checklist with completion actor and time;
- append-only comments and private attachments;
- blocking or informational links to other visible tasks;
- subtasks and a protected result review/return flow;
- an optional standard or calendar recurrence definition;
- a direct action to its automatically managed task chat.

## Access and automatic chats

- Managers and administrators can read and edit all tasks.
- The author and primary assignee can read and edit their task.
- A co-assignee can work on the card; an observer can read and comment.
- Only the author, manager or administrator can change participants.
- Chat membership consists of the author, current assignee, co-assignees and
  observers. Managerial task visibility alone does not reveal the conversation.

Task creation and each generated recurrence create exactly one `kind=task` chat in
the same transaction. The partial unique index on `(context_type, context_id)` makes
that operation safe under retries. A card title/description change updates the chat;
assignee and participant changes reconcile its members. Migration
`0021_task_calendar_chats` backfills existing tasks, while the deterministic demo
seed creates the same links on a clean installation.

## Recurrence rules

Daily, weekly and monthly rules retain an integer interval. A calendar rule can run:

- on any selected combination of weekdays; or
- on any selected combination of month days from 1 through 31.

The user chooses the local time of the next occurrence. The server validates the
IANA timezone and calculates later occurrences in local time before converting them
to UTC. A selected day such as 31 is skipped in months where it does not exist.

The scheduler locks due rows with `FOR UPDATE SKIP LOCKED`. Every generated task has
a unique `(cycle_id, cycle_occurrence_key)`, making concurrent or repeated runs
idempotent. A new occurrence copies description, assignee, project, priority,
participants and checklist titles; completion state, comments, files and other
cross-workflow links start clean.

## Integrity and API

Blocking dependencies form a directed acyclic graph. The API rejects self-links and
an edge that would create a cycle. A task cannot be submitted while a blocking task
is incomplete, and a parent cannot be accepted while a subtask remains open.

Relevant endpoints:

- `POST /api/v1/tasks`
- `PATCH /api/v1/tasks/{task_id}`
- `PATCH /api/v1/tasks/{task_id}/status`
- `POST /api/v1/tasks/{task_id}/submit-result`
- `POST /api/v1/tasks/{task_id}/accept-result`
- `POST /api/v1/tasks/{task_id}/return-for-revision`
- `PUT|DELETE /api/v1/tasks/{task_id}/participants[...]`
- `POST|PATCH|DELETE /api/v1/tasks/{task_id}/checklist[...]`
- `POST /api/v1/tasks/{task_id}/comments`
- `PUT|DELETE /api/v1/tasks/{task_id}/dependencies[...]`
- `PUT /api/v1/tasks/{task_id}/cycle`
- `PUT /api/v1/attachments/task/{task_id}`

## Verification boundary

Automated checks cover calendar navigation/selection, the custom-cycle contract,
idempotent materialisation, migration from an empty database, one-chat-per-task and
membership reconciliation. A short user check of real task density and a two-client
conversation remains useful before expanding the pilot. Exact Bitrix behavioural
characterisation still requires safely selected representative production tasks.
